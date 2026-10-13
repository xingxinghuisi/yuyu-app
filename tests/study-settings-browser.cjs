/* Real browser input + real FastAPI persistence in the isolated test database.
   PYTHONPATH and NODE_PATH follow the existing quiz-browser.cjs setup. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

function backend() {
  const child = spawn(process.env.PYTHON || 'python', ['-u', 'tests/api-bridge.py'],
    { stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
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
        const timer = setTimeout(() => {
          pending.delete(id); reject(Error('Test backend request timed out'));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, path: url, data, headers }) + '\n');
      });
    },
    close() { child.stdin.end(); }
  };
}

async function main() {
  const bridge = backend();
  let browser;
  async function api(method, url, data, headers) {
    const response = await bridge.send(method, url, data, headers);
    assert.ok(response.status >= 200 && response.status < 300, url + ': ' + response.status);
    return JSON.parse(Buffer.from(response.body, 'base64').toString());
  }
  try {
    const username = 'settings_' + Date.now().toString(36), password = 'Settings2026';
    await api('POST', '/api/auth/register', { username, password });
    const { token } = await api('POST', '/api/auth/login', { username, password });
    const headers = { Authorization: 'Bearer ' + token };
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const width of [390, 1280]) {
      await api('PUT', '/api/auth/profile', { daily_goal: 30, study_batch_size: 30 }, headers);
      const context = await browser.newContext({ viewport: { width, height: 900 },
        isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce' });
      let failSave = false;
      const saves = [], errors = [];
      await context.route('http://kotoba.test/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const data = request.postData() ? JSON.parse(request.postData()) : undefined;
        if (url.pathname === '/api/auth/profile' && request.method() === 'PUT') {
          saves.push(data);
          if (failSave) {
            failSave = false;
            return route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"暂时无法保存"}' });
          }
        }
        const response = await bridge.send(request.method(), url.pathname + url.search, data, await request.allHeaders());
        await route.fulfill({ status: response.status, contentType: response.contentType,
          body: Buffer.from(response.body, 'base64') });
      });
      await context.addInitScript(({ token, username }) => {
        localStorage.setItem('yuyu_token', token);
        localStorage.setItem('yuyu_username', username);
        localStorage.setItem('yuyu_theme', 'light');
      }, { token, username });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://kotoba.test/#/me/study');
      await page.waitForFunction(() => !document.querySelector('#study-settings-save')?.disabled);
      const batch = page.getByLabel('每次学习词数', { exact: true });
      const goal = page.getByLabel('每日学习目标', { exact: true });
      const save = page.getByRole('button', { name: '保存设置', exact: true });
      assert.equal(await batch.inputValue(), '30');
      assert.equal(await goal.inputValue(), '30');
      assert.equal(await batch.getAttribute('inputmode'), 'numeric');
      for (const input of [batch, goal]) {
        for (const value of ['', '0', '201', '1.5']) {
          await input.fill(value);
          await save.click();
          assert.equal(saves.length, 0, 'Invalid input must not save');
          assert.equal(await input.evaluate(element => element.checkValidity()), false);
        }
        await input.fill('30');
      }
      await batch.fill('50');
      await goal.fill('83');
      if (width === 390) await save.tap();
      else await goal.press('Enter');
      await page.waitForFunction(() => document.querySelector('#study-settings-status').textContent.startsWith('已保存'));
      assert.deepEqual(saves, [{ daily_goal: 83, study_batch_size: 50 }]);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#study-settings-save')?.disabled);
      assert.equal(await batch.inputValue(), '50');
      assert.equal(await goal.inputValue(), '83');

      // A failed request keeps the typed values and permits retrying them.
      failSave = true;
      await batch.fill('65');
      await goal.fill('97');
      await save.click();
      await page.waitForFunction(() => document.querySelector('#study-settings-status').textContent.startsWith('保存失败'));
      assert.equal(await batch.inputValue(), '65');
      assert.equal(await goal.inputValue(), '97');
      assert.equal((await api('GET', '/api/auth/me', undefined, headers)).study_batch_size, 50);
      await save.click();
      await page.waitForFunction(() => document.querySelector('#study-settings-status').textContent.startsWith('已保存'));
      assert.equal((await api('GET', '/api/auth/me', undefined, headers)).daily_goal, 97);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      const out = path.resolve('data/study-settings-preview');
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, 'settings-' + width + '.png'), fullPage: true });
      if (width === 390) {
        await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
        await page.screenshot({ path: path.join(out, 'settings-390-dark.png'), fullPage: true });
      }
      await page.goto('http://kotoba.test/#/study');
      await page.evaluate(() => { speak = function () {}; });
      await page.locator('[data-bid="level-n5"]').click();
      await page.locator('#m-seq').click();
      await page.locator('#word-card').waitFor();
      assert.match(await page.locator('.quiz-progress .txt').innerText(), /1 \/ 65/);
      assert.equal(await page.evaluate(() => ST.words.length), 65);
      assert.equal(await page.evaluate(() => ST.goal), 97);
      assert.deepEqual(errors, []);
      console.log('PASS ' + width + 'px: direct input, validation, persistence, retry, and a real 65-word learning session');
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    bridge.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
