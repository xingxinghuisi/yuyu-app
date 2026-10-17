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
      let failCheck = false;
      let holdCheck = false, releaseCheck;
      const checks = [];
      await context.route('http://kotoba.test/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const data = request.postData() ? JSON.parse(request.postData()) : undefined;
        if (url.pathname === '/api/quiz/submit') submissions.push(data);
        if (url.pathname === '/api/quiz/check') {
          checks.push(data);
          if (failCheck) { failCheck=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'测试网络失败'})}); }
          if (holdCheck) await new Promise(resolve => { releaseCheck=resolve; });
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
          const correct = q.options.indexOf(answer), wrong = (correct + 1) % q.options.length;
          const options = page.locator('.option');
          assert.equal(await page.locator('#q-next').isVisible(), false);
          if (flow === 'mini') {
            if (index===0) {
              failCheck=true;
              await options.nth(wrong).click();
              await page.getByText(/核对未成功/).waitFor();
              assert.equal(await page.locator('.option:disabled').count(),0);
              assert.equal(await page.evaluate(()=>MQ.idx),0);
            }
            const chosen=index===0 ? wrong : correct;
            expected.push({qid:q.qid,answer:q.options[chosen]});
            await options.nth(chosen).click();
            await page.locator('.mini-answer-feedback').waitFor();
            assert.equal(await page.locator('.option:disabled').count(),q.options.length);
            assert.equal(await page.locator('.option.correct').getAttribute('data-i'),String(correct));
            if(index===0) {
              assert.match(await page.locator('#fb-zone').innerText(),/选错了/);
              assert.ok((await page.locator('#fb-zone').innerText()).includes(answer));
              assert.equal(await page.locator('.option.wrong').getAttribute('data-i'),String(wrong));
              const out=path.resolve('data/quiz-preview');fs.mkdirSync(out,{recursive:true});
              await page.screenshot({path:path.join(out,'wrong-feedback-'+width+'.png'),fullPage:true});
            } else assert.match(await page.locator('#fb-zone').innerText(),/答对了/);
            assert.equal(submissions.length,before,'Instant check does not submit the whole quiz');
            if(index<questions.length-1) await page.waitForFunction(index=>MQ.idx===index+1,index);
            continue;
          }
          expected.push({ qid: q.qid, answer });
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
        if (flow === 'mini') {
          assert.match(await page.locator('#app').innerText(), /答对\s*2\s*\/\s*3/);
          assert.match(await page.locator('.mini-wrong-review').innerText(),/你的选择：[\s\S]*正确答案：/);
          assert.equal(checks.length,4,'Three successful checks and one explicit retry');
        }
        // The completed session cannot submit or alter answers again.
        await page.evaluate(flow => flow === 'mini' ? submitMiniQuiz() : submitQuiz(), flow);
        assert.equal(submissions.length, before + 1);
        console.log('PASS ' + width + 'px ' + flow + ': ' + (flow==='mini' ? 'wrong/correct feedback, failed-check retry, auto-next, 2/3 and wrong review' : 'answers remain changeable; final choices grade 3/3') + '; one final submission');
      }
      // A late check result and its timer must never replace the learning page.
      holdCheck=true;
      await page.evaluate(wordIds=>startMiniQuiz(wordIds),wordIds);
      await page.locator('.option').first().click();
      await page.getByText('正在核对…',{exact:true}).waitFor();
      await page.locator('#btn-mq-exit').click();
      await page.locator('#word-card').waitFor();
      const checked=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/quiz/check');
      holdCheck=false;releaseCheck();await checked;
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.mini-answer-feedback').count(),0);
      assert.equal(await page.locator('#word-card').count(),1);
      console.log('PASS '+width+'px: leaving during an in-flight check preserves the learning page');
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    bridge.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
