/* Focused checks against the isolated test service, never the user's 8770 preview. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.EXAM_PREVIEW_URL || 'http://127.0.0.1:8771';
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 390, height: 650 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(base + '/preview-exam');
    await page.locator('.exam-pack').waitFor();
    const token = await page.evaluate(() => localStorage.getItem('yuyu_token'));
    async function api(method, endpoint, data) {
      const response = await context.request.fetch(base + '/api/private-exams' + endpoint,
        { method, headers: { Authorization: 'Bearer ' + token }, data });
      assert.ok(response.ok()); return response.json();
    }
    const exam = 'jlpt-n2-2026-07';
    const first = await api('POST', '/' + exam + '/attempts', { section_id: 'listening', mode: 'practice', restart: true });
    await api('PUT', '/attempts/' + first.id, { answers: { 'l2-4': 2 }, cursor: 'l2-4', audio_position: 20 });
    await page.reload();
    await page.locator('[data-resume][data-section="listening"]').click();
    await page.locator('#exam-question').waitFor();
    await page.waitForFunction(() => document.querySelector('.exam-scan')?.naturalWidth > 0);
    const before = await page.locator('#exam-next').boundingBox();
    assert.ok(before.y > 0 && before.y + before.height <= 650);
    await page.locator('#exam-next').click();
    assert.match(await page.locator('#exam-question h2').innerText(), /第 5 题/);
    assert.ok(Math.abs((await page.locator('#exam-next').boundingBox()).y - before.y) <= 2);
    const out = path.resolve('data/exam-preview/screenshots');
    fs.mkdirSync(out, { recursive: true });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await page.screenshot({ path: path.join(out, 'listening-390x650-dark.png') });
    await page.locator('#exam-exit').click();
    await page.locator('[data-resume][data-section="listening"]').waitFor();
    const menu = page.locator('[data-restart-menu$="-listening"]');
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.locator('[data-start][data-section="listening"][data-mode="practice"][data-restart="true"]').click();
    await page.locator('#modal-ok').click();
    await page.locator('#exam-question').waitFor();
    const id = new URLSearchParams((await page.evaluate(() => location.hash)).split('?')[1]).get('attempt');
    assert.notEqual(id, first.id);
    assert.match(await page.locator('#exam-question h2').innerText(), /问题 1 · 第 1 题/);
    const history = (await api('GET', '/' + exam + '/attempts')).attempts;
    assert.equal(history.filter(a => a.section_id === 'listening').length, 1);
    assert.equal(history.find(a => a.section_id === 'listening').id, id);
    assert.equal((await api('GET', '/attempts/' + first.id)).answers['l2-4'], 2);
    await page.goto(base + '/#/me');
    await page.locator('.profile-head').waitFor();
    assert.equal(await page.locator('#app a[href="#/exams"]').count(), 0, 'Profile no longer contains the exam entry');
    await page.locator('#tabbar [aria-label="考试"]').click();
    await page.locator('.exam-pack').waitFor();
    assert.equal(await page.locator('body > .exam-answer-tools').count(), 0, 'Leaving listening removes the fixed controls');
    assert.equal(await page.locator('#tabbar [aria-label="考试"]').getAttribute('aria-current'), 'page');
    console.log('PASS 390x650: fixed listening controls, real restart UI, latest-only history, preserved old attempt, independent exam Tab');
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
