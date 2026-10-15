/* Run against the isolated loopback preview; uses the real user's local pack, never commits it. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.EXAM_PREVIEW_URL || 'http://127.0.0.1:8771';
const pack = JSON.parse(fs.readFileSync('data/private-exams/jlpt-n2-2026-07/exam.json', 'utf8'));
const output = path.resolve('data/exam-preview/screenshots');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390,
        hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/preview-exam');
      await page.locator('.exam-pack').waitFor();
      await page.evaluate(() => document.documentElement.dataset.theme = 'light');
      const token = await page.evaluate(() => localStorage.getItem('yuyu_token'));
      const headers = { Authorization: 'Bearer ' + token };
      async function api(method, url, data) {
        const response = await context.request.fetch(base + '/api/private-exams' + url, { method, headers, data });
        assert.ok(response.ok(), url + ': ' + response.status());
        return response.json();
      }
      const freshLanguage = await api('POST', '/' + pack.id + '/attempts', { section_id: 'language', mode: 'practice', restart: true });
      await page.reload();
      await page.locator('[data-resume][data-section="language"]').waitFor();
      assert.deepEqual(await page.locator('#tabbar .tab span').allTextContents(), ['探索', '学习', '复习', '考试', '我的']);
      assert.equal(await page.locator('#tabbar [aria-label="考试"]').getAttribute('aria-current'), 'page');
      await page.screenshot({ path: path.join(output, 'catalog-' + width + '.png'), fullPage: true });
      await page.locator('[data-resume][data-section="language"]').click();
      await page.locator('#exam-question').waitFor();
      await page.waitForFunction(() => document.querySelector('.exam-scan')?.naturalWidth > 0);
      await page.locator('#exam-question .exam-open-image').click();
      await page.getByLabel('原图缩放', { exact: true }).selectOption('300');
      assert.equal(await page.locator('.exam-image-viewer img').evaluate(img => img.style.width), '300%');
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      assert.equal(await page.locator('[data-question]').count(), 71);
      const attemptId = new URLSearchParams((await page.evaluate(() => location.hash)).split('?')[1]).get('attempt');
      assert.equal(attemptId, freshLanguage.id);
      const first = pack.questions.find(q => q.id === 'r001');
      const second = pack.questions.find(q => q.id === 'r002');
      await page.locator('[data-choice="' + first.correct + '"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      await page.locator('#exam-next').click();
      const wrong = second.correct === 1 ? 2 : 1;
      await page.locator('[data-choice="' + wrong + '"]').click();
      await page.locator('#exam-mark').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      await page.reload();
      await page.locator('#exam-mark[aria-pressed="true"]').waitFor();
      assert.equal(await page.locator('[data-choice="' + wrong + '"]').getAttribute('aria-pressed'), 'true');
      await page.waitForFunction(() => document.querySelector('.exam-scan')?.naturalWidth > 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No viewport overflow');
      await page.screenshot({ path: path.join(output, 'question-' + width + '.png'), fullPage: true });
      if (width === 390) {
        await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
        await page.screenshot({ path: path.join(output, 'question-390-dark.png'), fullPage: true });
        await page.evaluate(() => document.documentElement.dataset.theme = 'light');
      }

      // A real failed save must retain the selected answer and recover it on reload.
      let failNext = true;
      await context.route('**/api/private-exams/attempts/**', async route => {
        if (failNext && route.request().method() === 'PUT') {
          failNext = false;
          return route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"temporary"}' });
        }
        return route.continue();
      });
      await page.locator('[data-question="r003"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent.includes('保存失败'));
      const third = pack.questions.find(q => q.id === 'r003');
      failNext = true;
      await page.locator('[data-choice="' + third.correct + '"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent.includes('保存失败'));
      await page.reload();
      await page.locator('[data-choice="' + third.correct + '"][aria-pressed="true"]').waitFor();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      assert.equal((await api('GET', '/attempts/' + attemptId)).answers.r003, third.correct);
      await page.locator('[data-question="r010"]').click();
      await page.waitForFunction(() => document.querySelector('.exam-scan')?.naturalWidth > 0);
      await page.locator('[data-question="r070"]').click();
      assert.equal(await page.locator('#exam-question .exam-scan').count(), 2, 'Table and reference page retained');
      await page.locator('[data-question="r002"]').click();
      await page.locator('#exam-submit').click();
      await page.locator('#modal-ok').click();
      await page.locator('.exam-result').waitFor();
      assert.match(await page.locator('.exam-score').innerText(), /2\s*\/\s*71/);
      await page.locator('#exam-wrong-only').check();
      assert.equal(await page.locator('[data-review]').count(), 69);
      await page.locator('[data-review="r002"]').click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll('#exam-review-question img')).every(img => img.complete && img.naturalWidth));
      await page.screenshot({ path: path.join(output, 'result-' + width + '.png'), fullPage: true });

      await page.getByRole('link', { name: '‹ 返回个人考试', exact: true }).click();
      await api('POST', '/' + pack.id + '/attempts', { section_id: 'listening', mode: 'practice', restart: true });
      await page.reload();
      await page.locator('[data-resume][data-section="listening"]').click();
      await page.locator('#exam-audio').waitFor();
      await page.waitForFunction(() => document.querySelector('#exam-audio').duration > 1800);
      assert.equal(await page.locator('[data-question]').count(), 30);
      const duration = await page.locator('#exam-audio').evaluate(audio => audio.duration);
      await page.locator('#exam-audio').evaluate(audio => { audio.currentTime = 12; return audio.play(); });
      await page.waitForFunction(() => document.querySelector('#exam-audio').currentTime > 13);
      await page.locator('#exam-next').click();
      assert.equal(await page.locator('#exam-audio').evaluate(audio => audio.paused), false, 'Question navigation keeps the recording playing');
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#exam-audio')?.currentTime >= 12);
      // The concrete reported case: 2-4 -> 2-5 keeps controls on screen and avoids a page jump.
      await page.locator('[data-question="l2-4"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-question .exam-scan')?.naturalWidth > 0);
      await page.locator('#exam-zoom-value').fill('275');
      await page.locator('#exam-zoom-value').press('Tab');
      assert.equal(await page.locator('#exam-scans').evaluate(el => el.style.width), '275%');
      const scrollBefore = await page.evaluate(() => scrollY);
      const controlsBefore = await page.locator('#exam-next').boundingBox();
      await page.locator('#exam-next').click();
      assert.match(await page.locator('#exam-question h2').innerText(), /问题 2 · 第 5 题/);
      assert.equal(await page.locator('#exam-zoom-value').inputValue(), '275');
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) <= 2, 'Next listening item does not move the page');
      const controlsAfter = await page.locator('#exam-next').boundingBox();
      assert.ok(Math.abs(controlsBefore.y - controlsAfter.y) <= 2, 'Answer navigation stays in place');
      assert.ok(controlsAfter.y >= 0 && controlsAfter.y + controlsAfter.height <= 900, 'Next button stays in viewport');
      await page.evaluate(() => scrollBy(0, 100));
      const controlsScrolled = await page.locator('#exam-next').boundingBox();
      assert.ok(Math.abs(controlsScrolled.y - controlsAfter.y) <= 2, 'Listening controls are fixed to the viewport while scrolling');
      await page.evaluate(y => scrollTo(0, y), scrollBefore);
      await page.locator('#exam-zoom-fit').click();
      assert.equal(await page.locator('#exam-zoom-value').inputValue(), '100');
      await page.waitForFunction(() => document.querySelector('#exam-question .exam-scan')?.naturalWidth > 0);
      await page.screenshot({ path: path.join(output, 'listening-next-' + width + '.png') });
      await page.locator('#exam-zoom-value').fill('225');
      await page.locator('#exam-zoom-value').press('Tab');
      await page.reload();
      await page.locator('#exam-question').waitFor();
      assert.equal(await page.locator('#exam-zoom-value').inputValue(), '225', 'Zoom persists across refresh');
      await page.locator('#exam-zoom-fit').click();
      await page.locator('#exam-exit').click();
      await page.locator('[data-resume][data-section="listening"]').waitFor();
      const listed = await api('GET', '/' + pack.id + '/attempts');
      assert.equal(listed.attempts.filter(a => a.section_id === 'listening').length, 1);
      const listeningId = listed.attempts.find(a => a.section_id === 'listening').id;
      await page.locator('[data-resume][data-section="listening"]').click();
      await page.locator('#exam-question').waitFor();
      assert.equal(new URLSearchParams((await page.evaluate(() => location.hash)).split('?')[1]).get('attempt'), listeningId);
      assert.match(await page.locator('#exam-question h2').innerText(), /问题 2 · 第 5 题/, 'Resume restores the exact question');
      await page.locator('[data-question="l4-1"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      await page.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.locator('[data-choice]').count(), 3);
      await page.locator('[data-question="l5-2"]').click();
      assert.match(await page.locator('#exam-question h2').innerText(), /小问 1/);
      await page.locator('[data-question="l5-3"]').click();
      assert.match(await page.locator('#exam-question h2').innerText(), /小问 2/);
      await page.locator('[data-question="l4-1"]').click();
      await page.screenshot({ path: path.join(output, 'listening-' + width + '.png'), fullPage: true });

      // Independently validate every real answer position in both sections.
      for (const section of pack.sections) {
        const a = await api('POST', '/' + pack.id + '/attempts', { section_id: section.id, mode: 'practice', restart: true });
        const answers = Object.fromEntries(pack.questions.filter(q => q.section_id === section.id).map(q => [q.id, q.correct]));
        await api('PUT', '/attempts/' + a.id, { answers });
        const result = await api('POST', '/attempts/' + a.id + '/submit');
        assert.equal(result.score.correct, section.question_count);
        assert.equal(result.score.total, section.question_count);
        assert.equal(result.review.length, section.question_count);
      }
      assert.deepEqual(errors, []);
      console.log('PASS ' + width + 'px: resume, failed-save recovery, grading, review, original tables, 30 listening answers, audio playback (' + Math.round(duration) + 's), all 101 answer positions');
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
