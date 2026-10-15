/* Real Chrome + FastAPI + the isolated data/map-tests database.
   Uses the same Python/runtime and NODE_PATH setup as map-browser.cjs.
   No production account, external audio, or mocked grading responses. */
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
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line);
    const item = pending.get(result.id);
    if (item) { pending.delete(result.id); clearTimeout(item.timer); item.resolve(result); }
  });
  function fail(error) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
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
    close() { child.stdin.end(); },
  };
}

async function main() {
  const bridge = backend();
  let browser;
  async function api(method, url, data, headers) {
    const response = await bridge.send(method, url, data, headers);
    assert.ok(response.status >= 200 && response.status < 300, method + ' ' + url + ': ' + response.status);
    return JSON.parse(Buffer.from(response.body, 'base64').toString());
  }
  try {
    const username = 'quiz_' + Date.now().toString(36), password = 'QuizTest2026';
    await api('POST', '/api/auth/register', { username, password });
    const { token } = await api('POST', '/api/auth/login', { username, password });
    const headers = { Authorization: 'Bearer ' + token };
    const plan = await api('POST', '/api/study/plan', { book_id: 'level-n5' }, headers);
    const wordIds = plan.words.slice(0, 5).map(word => word.id);
    const words = new Map();
    async function correctAnswer(q) {
      if (!words.has(q.word_id)) words.set(q.word_id, await api('GET', '/api/vocab/' + q.word_id, undefined, headers));
      const word = words.get(q.word_id);
      const answer = q.type === 'choice_zh' ? word.kanji || word.kana : word.display_meaning;
      assert.ok(q.options.includes(answer), 'Correct answer exists in the real options');
      return answer;
    }
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 },
        isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const submissions = [], errors = [];
      await context.route('http://kotoba.test/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const data = request.postData() ? JSON.parse(request.postData()) : undefined;
        if (url.pathname === '/api/quiz/submit') submissions.push(data);
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
      await page.goto('http://kotoba.test/#/quiz');
      await page.locator('#btn-quiz-start').waitFor();
      // Exercise listening selection without downloading or playing third-party audio.
      await page.evaluate(() => { speak = function () {}; });
      for (const flow of ['mini', 'exam']) {
        const state = flow === 'mini' ? 'MQ' : 'QZ';
        const next = flow === 'mini' ? '#btn-mq-next' : '#btn-q-next';
        const before = submissions.length;
        if (flow === 'mini') {
          // Mini quizzes belong to a live learning batch, including its account and cursor.
          await page.evaluate(() => startStudyFlow());
          await page.locator('#word-card').waitFor();
        }
        await page.evaluate(({ flow, wordIds }) => {
          if (flow === 'mini') startMiniQuiz(wordIds);
          else startQuiz('N5', 3, 'normal');
        }, { flow, wordIds });
        await page.locator('.option').first().waitFor();
        const questions = await page.evaluate(state => window[state].questions, state);
        assert.deepEqual(questions.map(q => q.type), ['choice_ja', 'choice_zh', 'listening']);
        const expected = [];
        for (const [index, q] of questions.entries()) {
          const answer = await correctAnswer(q);
          expected.push({ qid: q.qid, answer });
          const correct = q.options.indexOf(answer), wrong = (correct + 1) % q.options.length;
          const options = page.locator('.option');
          assert.equal(await page.locator('#q-next').isVisible(), false);
          // First make the wrong selection, then change it repeatedly, including keyboard input.
          if (width === 390) await options.nth(wrong).tap();
          else { await options.nth(wrong).focus(); await page.keyboard.press('Space'); }
          assert.equal(await page.locator('.option:disabled').count(), 0);
          await options.nth((wrong + 1) % q.options.length).click();
          if (width === 390) await options.nth(correct).tap();
          else { await options.nth(correct).focus(); await page.keyboard.press('Enter'); }
          assert.equal(await page.locator('.option.selected').count(), 1);
          assert.equal(await page.locator('.option[aria-pressed="true"]').getAttribute('data-i'), String(correct));
          assert.equal(await page.locator('.option:disabled').count(), 0);
          assert.deepEqual(await page.evaluate(state => window[state].answers, state), expected);
          assert.equal(submissions.length, before, 'Selecting or changing an answer does not submit it');
          if (index === questions.length - 1 && flow === 'mini') {
            const out = path.resolve('data/quiz-preview'); fs.mkdirSync(out, { recursive: true });
            await page.screenshot({ path: path.join(out, 'selection-' + width + '.png'), fullPage: true });
          }
          await page.locator(next).click();
        }
        await page.waitForFunction(flow => document.querySelector('#app').textContent.includes(
          flow === 'mini' ? '小测完成' : '正确率 100%'), flow);
        assert.equal(submissions.length, before + 1, 'One grading request for the whole quiz');
        assert.deepEqual(submissions.at(-1).qid_answers, expected);
        if (flow === 'mini') assert.match(await page.locator('#app').innerText(), /答对\s*3\s*\/\s*3/);
        // The completed session cannot submit or alter answers again.
        await page.evaluate(flow => flow === 'mini' ? submitMiniQuiz() : submitQuiz(), flow);
        assert.equal(submissions.length, before + 1);
        console.log('PASS ' + width + 'px ' + flow + ': all three question types can change answers; last choices grade 3/3; no duplicate submission');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    bridge.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
