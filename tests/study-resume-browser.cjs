/* Real browser + real FastAPI/SQLite in the isolated api-bridge test DB. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

function backend() {
  const child = spawn(process.env.PYTHON || 'python', ['-u', 'tests/api-bridge.py'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
      TEST_DATA_DIR: path.resolve('data/study-resume-tests') }
  });
  const pending = new Map();
  let next = 0;
  function fail(error) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line), item = pending.get(result.id);
    if (item) { pending.delete(result.id); clearTimeout(item.timer); item.resolve(result); }
  });
  child.on('error', fail);
  child.on('exit', code => fail(Error('Test backend exited: ' + code)));
  return {
    send(method, url, data, headers) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('API timed out: ' + url)); }, 30000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, path: url, data, headers }) + '\n');
      });
    },
    close() { child.stdin.end(); child.kill(); }
  };
}

async function main() {
  const bridge = backend();
  let browser;
  async function api(method, url, data, token) {
    const response = await bridge.send(method, url, data, token ? { Authorization: 'Bearer ' + token } : undefined);
    assert.ok(response.status >= 200 && response.status < 300, url + ': ' + response.status);
    return JSON.parse(Buffer.from(response.body, 'base64').toString());
  }
  async function account(name, batch = 8) {
    const password = 'Resume2026';
    await api('POST', '/api/auth/register', { username: name, password });
    const { token } = await api('POST', '/api/auth/login', { username: name, password });
    await api('PUT', '/api/auth/profile', { daily_goal: 100, study_batch_size: batch }, token);
    return { token, username: name };
  }
  try {
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const width of [390, 1280]) {
      const a = await account('resume_' + width + '_' + Date.now().toString(36));
      const b = await account('other_' + width + '_' + Date.now().toString(36), 4);
      const context = await browser.newContext({ viewport: { width, height: 900 },
        isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const plans = [], grades = [], errors = [];
      let holdMini = false, releaseMini, miniStarted = false;
      await context.route('http://kotoba.test/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const data = request.postData() ? JSON.parse(request.postData()) : undefined;
        if (url.pathname === '/api/study/plan') plans.push(data);
        if (url.pathname === '/api/study/answer') grades.push(data);
        if (url.pathname === '/api/quiz/start' && holdMini) {
          miniStarted = true;
          await new Promise(resolve => { releaseMini = resolve; });
        }
        const response = await bridge.send(request.method(), url.pathname + url.search, data, await request.allHeaders());
        await route.fulfill({ status: response.status, contentType: response.contentType,
          body: Buffer.from(response.body, 'base64') });
      });
      await context.addInitScript(() => localStorage.setItem('yuyu_theme', 'light'));
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://kotoba.test/#/login');
      async function switchAccount(user) {
        await page.evaluate(user => {
          localStorage.setItem('yuyu_token', user.token);
          localStorage.setItem('yuyu_username', user.username);
          location.hash = '#/study';
          navigate();
        }, user);
        await page.locator('[data-bid="level-n5"]').waitFor();
      }
      async function openBook(book = 'level-n5', order) {
        await page.locator('[data-bid="' + book + '"]').click();
        if (order) await page.locator('#m-' + order).click();
        await page.locator('#word-card').waitFor();
        await page.evaluate(() => { speak = function () {}; });
      }
      async function exit() {
        await page.locator('#btn-exit').click();
        await page.locator('[data-bid="level-n5"]').waitFor();
      }
      async function grade(known = true) {
        const old = await page.evaluate(() => ST.idx);
        await page.locator(known ? '#btn-know' : '#btn-unknown').click();
        await page.waitForFunction(old => ST && ST.idx === old + 1 && !_studyGrading, old);
        await page.locator('#word-card').waitFor();
      }
      async function position(idx, total, id) {
        assert.match(await page.locator('.quiz-progress .txt').innerText(), new RegExp((idx + 1) + ' / ' + total));
        assert.equal(await page.evaluate(() => ST.words[ST.idx].id), id);
      }
      await switchAccount(a);
      await openBook('level-n5', 'seq');
      const n5 = await page.evaluate(() => ST.words.map(w => w.id));
      assert.equal(n5.length, 8);
      await grade(); await grade(false);
      await page.locator('#btn-back').click();
      await position(1, 8, n5[1]);
      await exit();
      assert.match(await page.locator('[data-bid="level-n5"]').innerText(), /继续上次 · 2 \/ 8/);
      await openBook();
      await position(1, 8, n5[1]);
      assert.match(await page.locator('.study-graded').innerText(), /不认识/);
      assert.equal(plans.length, 1, 'Resume must not generate another plan');
      await page.locator('#btn-fwd').click();
      await grade();
      await position(3, 8, n5[3]);

      // Reload preserves the exact queue, denominator, grades and cursor.
      await page.reload();
      await openBook();
      await position(3, 8, n5[3]);
      assert.deepEqual(await page.evaluate(() => ST.words.map(w => w.id)), n5);
      assert.equal(plans.length, 1);
      await api('PUT', '/api/auth/profile', { study_batch_size: 4 }, a.token);
      await exit(); await openBook();
      await position(3, 8, n5[3]);

      // Leaving during the grade animation must not leave the grading lock set.
      await page.locator('#btn-know').click();
      await exit(); await openBook();
      await position(4, 8, n5[4]);
      assert.equal(await page.evaluate(() => _studyGrading), false);

      // A delayed mini-quiz response must not replace another page after leaving.
      holdMini = true;
      await page.locator('#btn-know').click();
      await page.waitForFunction(() => document.querySelector('.skel-wrap')?.getAttribute('aria-label').includes('小测'));
      assert.ok(miniStarted, 'The delayed mini-quiz request must have started');
      await page.evaluate(() => { location.hash = '#/me'; });
      await page.getByText('学习设置', { exact: true }).waitFor();
      const returned = page.waitForResponse(r => new URL(r.url()).pathname === '/api/quiz/start');
      holdMini = false; releaseMini(); await returned;
      await page.waitForLoadState('networkidle');
      assert.equal(await page.evaluate(() => ST), null);
      assert.equal(await page.locator('.mini-quiz-head').count(), 0);
      await page.evaluate(() => { location.hash = '#/study'; });
      await openBook();
      await position(5, 8, n5[5]);
      await grade();
      await exit();
      assert.deepEqual(grades.map(g => g.word_id), n5.slice(0, 6), 'Resuming or looking back must not grade twice');
      assert.deepEqual(grades.map(g => g.grade), [4, 1, 4, 4, 4, 4]);

      // Each book has its own checkpoint; shuffled order is not randomized again.
      await openBook('level-n4', 'shuffle');
      const n4 = await page.evaluate(() => ST.words.map(w => w.id));
      assert.equal(n4.length, 4, 'New settings apply to the next batch');
      await grade(); await exit();
      await openBook();
      await position(6, 8, n5[6]);
      await exit(); await page.reload();
      await openBook('level-n4');
      assert.equal(await page.evaluate(() => StudyCtx.order), 'shuffle');
      assert.deepEqual(await page.evaluate(() => ST.words.map(w => w.id)), n4);
      await position(1, 4, n4[1]);
      await grade(); await grade();
      await page.locator('#btn-know').click();
      await page.getByRole('heading', { name: '本轮 4 词已学完' }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem(studyCheckpointKey('level-n4'))), null);
      await page.locator('#done-shelf').click();
      await openBook('level-n4', 'seq');
      assert.ok((await page.evaluate(() => ST.words.map(w => w.id))).every(id => !n4.includes(id)));
      await exit();

      // Tokens can change on re-login; checkpoints follow account IDs, never the other account.
      await switchAccount(b);
      await openBook('level-n5', 'seq');
      await position(0, 4, n5[0]);
      await exit(); await switchAccount(a); await openBook();
      await position(6, 8, n5[6]);
      await exit();

      // A malformed checkpoint falls back to a fresh plan without crashing.
      await page.evaluate(() => {
        const key = studyCheckpointKey('level-n4');
        const saved = JSON.parse(localStorage.getItem(key));
        saved.idx = 999;
        localStorage.setItem(key, JSON.stringify(saved));
      });
      await page.reload();
      await openBook('level-n4', 'seq');
      assert.equal(await page.evaluate(() => ST.idx), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await exit(); await openBook();
      const out = path.resolve('data/study-resume-preview');
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, 'resume-' + width + '.png'), fullPage: true });
      assert.deepEqual(errors, []);
      console.log('PASS ' + width + 'px: exit/reload, lookback without duplicate grades, unchanged batch, shuffle/book/account isolation, completed batch, stale mini-quiz and invalid checkpoint');
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    bridge.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
