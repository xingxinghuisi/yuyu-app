/* Full frontend over disposable loopback HTTP; API/media fixtures, never the user's database.
 * Run from yuyu-anime-app, with Playwright available via NODE_PATH. This tests UI contracts,
 * not backend authorization, real recordings, source-page images or OCR accuracy. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const packsRoot = path.resolve(root, '../deliverables/jlpt-cloud-pilot/private-app-library-v1/packs');
const packs = fs.readdirSync(packsRoot).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(packsRoot, f), 'utf8')));
const original = packs.find(p => p.id === 'jlpt-n2-2026-07');
assert.ok(original, 'Converted representative N2 pack exists');
const clone = value => JSON.parse(JSON.stringify(value));
const first = clone(original.questions.find(q => q.id === 'r001'));
first.stem_fragments.push({ text: '<img src=x onerror="window.fixtureXss=1"> 😀', annotations: [], table_rows: [] });
first.source_notes = [{ message: 'FIXTURE_SOURCE_NOTE' }];
first.explanation_fragments = [{ text: 'FIXTURE_EXPLANATION', annotations: [], table_rows: [] }];
const reading = clone(original.questions.find(q => q.section_id === 'language' && q.material_ids?.length));
assert.ok(reading, 'Shared reading question exists');
reading.stem_fragments.push({ text: '', table_rows: [['時刻', '料金'], ['09:00', '500円']] });
const pending = clone(first);
Object.assign(pending, { id: 'pending', label: '待核对题', short_label: '待', grading_status: 'withheld', correct: null,
  stem_fragments: [{ text: '资料待核对测试题', annotations: [], table_rows: [] }], review_notice: 'FIXTURE_PENDING_NOTICE', assets: [] });
const legacy = clone(first);
Object.assign(legacy, { id: 'legacy', label: '原图兼容题', short_label: '图', correct: 2 });
delete legacy.stem_fragments; delete legacy.options;
const listening = clone(original.questions.find(q => q.section_id === 'listening'));
Object.assign(listening, { id: 'listen', label: '听力第 1 题', short_label: '听1', correct: 1,
  transcript_fragments: [{ text: 'FIXTURE_TRANSCRIPT', annotations: [], table_rows: [] }] });
const listening2 = clone(listening);
Object.assign(listening2, { id: 'listen2', label: '听力第 2 题', short_label: '听2', assets: [], stem_fragments: [], options: [] });
const fixture = { ...clone(original), sections: [
  { id: 'language', title: '语言知识・阅读', minutes: 110, question_count: 4 },
  { id: 'listening', title: '听力', minutes: 50, question_count: 2 }
], questions: [first, reading, pending, legacy, listening, listening2] };
const safeKeys = ['id', 'section_id', 'label', 'short_label', 'group_title', 'instruction', 'option_count', 'assets', 'stem_fragments', 'options', 'material_ids', 'grading_status', 'review_notice'];
const examData = id => id === fixture.id ? fixture : packs.find(p => p.id === id);
const publicPack = (pack = fixture) => ({ ...clone(pack), questions: pack.questions.map(q => Object.fromEntries(safeKeys.filter(k => k in q).map(k => [k, q[k]]))),
  materials: pack.materials.filter(m => m.section !== 'listening' && m.kind !== 'listening_transcript') });
const attempts = new Map();
const requests = [];
let serial = 0;
let failNextSave = false;
let workerGeneration = 1;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ5kAAAAASUVORK5CYII=', 'base64');
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
function response(res, value, code = 200, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
}
function result(a) {
  const questions = examData(a.exam_id).questions.filter(q => q.section_id === a.section_id).map(q => a.all_pending ? { ...q, grading_status: 'withheld', correct: null } : q);
  const graded = questions.filter(q => q.grading_status !== 'withheld');
  const answered = questions.filter(q => a.answers[q.id] != null).length;
  const correct = graded.filter(q => a.answers[q.id] === q.correct).length;
  return { ...a, score: { correct, total: graded.length, answered, accuracy: graded.length ? Math.round(1000 * correct / graded.length) / 10 : null,
    excluded: questions.length - graded.length, question_count: questions.length, unanswered: questions.length - answered },
    review: questions.map(q => ({ ...clone(q), selected: a.answers[q.id] ?? null, is_graded: q.grading_status !== 'withheld',
      is_correct: q.grading_status === 'withheld' ? null : a.answers[q.id] === q.correct })) };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  requests.push({ method: req.method, path: url.pathname, search: url.search });
  let body = '';
  for await (const chunk of req) body += chunk;
  body = body ? JSON.parse(body) : {};
  const endpoint = url.pathname.replace(/^\/api\/private-exams/, '');
  if (url.pathname === '/sw.js') return response(res, 'fixture nginx forbidden', 403, 'text/plain');
  if (url.pathname === '/api/app-shell/worker') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(frontend, 'sw.js'), 'utf8') + '\n// fixture generation ' + workerGeneration);
  }
  if (url.pathname === '/preview-exam') return response(res, '<script>localStorage.setItem("yuyu_token","fixture");localStorage.setItem("yuyu_username","fixture");location.replace("/#/exams")</script>', 200, 'text/html; charset=utf-8');
  if (url.pathname.startsWith('/api/private-exams')) {
    if (endpoint === '/media-session') return response(res, {});
    if (endpoint === '') return response(res, { exams: packs.map(p => ({ id: p.id, title: p.title, level: p.level, year: p.year, month: p.month,
      sections: p.id === fixture.id ? fixture.sections : p.sections })) });
    if (/\/assets\//.test(endpoint)) return response(res, png, 200, 'image/png');
    if (endpoint.endsWith('/audio')) return response(res, wav, 200, 'audio/wav');
    const history = endpoint.match(/^\/([^/]+)\/attempts$/);
    if (history) {
      if (req.method === 'GET') return response(res, { attempts: [...attempts.values()].filter(a => a.exam_id === history[1]).map(a => a.status === 'submitted' ? result(a) : a) });
      const a = { id: 'fixture-' + ++serial, exam_id: history[1], section_id: body.section_id, mode: body.mode, status: 'active',
        started_at: Date.now() / 1000, server_now: Date.now() / 1000, deadline_at: null, answers: {}, marked: {}, cursor: examData(history[1]).questions.find(q => q.section_id === body.section_id).id, audio_position: 0 };
      attempts.set(a.id, a); return response(res, a);
    }
    const attempt = endpoint.match(/^\/attempts\/([^/]+)(\/submit)?$/);
    if (attempt) {
      const a = attempts.get(attempt[1]);
      if (!a) return response(res, { detail: 'Not found' }, 404);
      if (req.method === 'PUT') {
        if (failNextSave) { failNextSave = false; return response(res, { detail: 'temporary fixture failure' }, 503); }
        for (const [id, value] of Object.entries(body.answers || {})) { if (value == null) delete a.answers[id]; else a.answers[id] = value; }
        Object.assign(a.marked, body.marked || {});
        if (body.cursor) a.cursor = body.cursor;
        if (body.audio_position != null) a.audio_position = body.audio_position;
      }
      if (attempt[2]) a.status = 'submitted';
      return response(res, a.status === 'submitted' ? result(a) : a);
    }
    const requestedPack = examData(endpoint.slice(1));
    if (requestedPack) return response(res, publicPack(requestedPack));
    return response(res, { detail: 'Unimplemented fixture route' }, 404);
  }
  if (url.pathname.startsWith('/api/')) return response(res, { ui_lang: 'zh' });
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const file = path.resolve(frontend, relative);
  if (!file.startsWith(frontend + path.sep) || !fs.existsSync(file)) return response(res, 'Not found', 404, 'text/plain');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
  return response(res, fs.readFileSync(file), 200, types[path.extname(file)] || 'application/octet-stream');
});
async function main() {
  const port = Number(process.env.EXAM_V2_FIXTURE_PORT || 8773);
  assert.ok(port !== 8770 && port !== 8771, 'Never use existing previews');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + port;
  const output = path.join(root, 'data/exam-v2-tests/browser-fixture');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const width of [390, 1280]) {
      attempts.clear(); requests.length = 0;
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390,
        serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/preview-exam');
      await page.locator('[data-level]').first().waitFor();
      const historyCount = () => requests.filter(r => r.method === 'GET' && /\/[^/]+\/attempts$/.test(r.path)).length;
      assert.equal(historyCount(), 0, 'Initial level page never loads all exam histories');
      assert.deepEqual(await page.locator('[data-level]').allTextContents().then(texts => texts.map(t => t.match(/N[1-5]/)[0])), ['N5','N4','N3','N2','N1']);
      assert.equal(await page.locator('.exam-pack').count(), 0, 'No entire library shown at entry');
      await page.screenshot({ path: path.join(output, 'levels-' + width + '.png'), fullPage: true });
      await page.locator('[data-level="N5"]').click();
      await page.getByText('N5 暂未导入试卷。当前可使用 N1、N2 资料。').waitFor();
      await page.getByRole('link', { name: '级别', exact: true }).click();
      await page.locator('[data-level="N2"]').click();
      await page.locator('[data-year="2025"]').waitFor();
      assert.equal(historyCount(), 0, 'Selecting level only lists years');
      assert.equal(await page.locator('[data-month]').count(), 0);
      await page.screenshot({ path: path.join(output, 'years-' + width + '.png'), fullPage: true });
      await page.locator('[data-year="2025"]').click();
      await page.locator('[data-month="7"]').waitFor();
      assert.equal(historyCount(), 0, 'Selecting year only lists months');
      await page.screenshot({ path: path.join(output, 'months-' + width + '.png'), fullPage: true });
      await page.locator('[data-month="7"]').click();
      await page.getByRole('heading', { name: /2025.*7/ }).waitFor();
      assert.equal(historyCount(), 1, 'Only the chosen month loads its history');
      await page.getByRole('link', { name: 'N2', exact: true }).click();
      await page.locator('[data-year="2026"]').click();
      await page.locator('[data-month="7"]').click();
      await page.locator('[data-start="' + fixture.id + '"][data-section="language"][data-mode="practice"]').waitFor();
      assert.equal(historyCount(), 2);
      assert.equal(await page.locator('.exam-pack').count(), 1);
      await page.screenshot({ path: path.join(output, 'catalog-' + width + '.png'), fullPage: true });
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
      const selectColors = await page.locator('.exam-breadcrumb').evaluate(el => ({ text: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
      assert.notEqual(selectColors.text, selectColors.bg, 'Dark catalog controls remain readable');
      await page.screenshot({ path: path.join(output, 'catalog-dark-' + width + '.png'), fullPage: true });
      await page.evaluate(() => document.documentElement.dataset.theme = 'light');
      await page.locator('[data-start][data-section="language"][data-mode="practice"]').click();
      await page.locator('#exam-question .exam-text-option').first().waitFor();
      const a = [...attempts.values()][0];
      assert.match(await page.locator('#exam-question').innerText(), /祖父は濃い/);
      assert.equal(await page.locator('#exam-question u').first().innerText(), '濃い');
      assert.deepEqual(await page.locator('.exam-option-index').allTextContents(), ['1', '2', '3', '4']);
      assert.equal(await page.locator('#exam-question img[src="x"]').count(), 0, 'Markup is escaped');
      assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
      assert.doesNotMatch(await page.locator('#app').innerText(), /FIXTURE_EXPLANATION|FIXTURE_TRANSCRIPT|FIXTURE_SOURCE_NOTE|参考答案/);
      assert.equal(await page.locator('.exam-original').getAttribute('open'), null, 'Text is primary and scan is collapsed');
      assert.equal(await page.locator('.exam-scan').isVisible(), false);
      await page.screenshot({ path: path.join(output, 'text-question-' + width + '.png'), fullPage: true });
      await page.locator('.exam-original summary').click();
      await page.waitForFunction(() => document.querySelector('.exam-scan')?.naturalWidth > 0);
      assert.ok((await page.locator('.exam-scan').first().getAttribute('src')).endsWith('?attempt=' + a.id));
      await page.locator('#exam-question .exam-open-image').first().click();
      await page.getByLabel('原图缩放', { exact: true }).selectOption('300');
      assert.equal(await page.locator('.exam-image-viewer img').evaluate(el => el.style.width), '300%');
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('[data-choice="' + first.correct + '"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      await page.locator('#exam-next').click();
      await page.locator('.exam-passage').waitFor();
      assert.ok((await page.locator('.exam-passage').innerText()).length > 200, 'Shared passage is visible');
      assert.equal(await page.locator('.exam-text-table td').count(), 4, 'Source table is rendered');
      failNextSave = true;
      await page.locator('[data-choice="1"]').click();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent.includes('保存失败'));
      await page.reload();
      await page.locator('[data-choice="1"][aria-pressed="true"]').waitFor();
      await page.waitForFunction(() => document.querySelector('#exam-save-status').textContent === '已保存');
      assert.equal(attempts.get(a.id).answers[reading.id], 1, 'Failed save draft recovers on reload');
      await page.locator('[data-question="pending"]').click();
      await page.locator('.exam-review-notice').waitFor();
      await page.locator('[data-choice="2"]').click();
      await page.locator('[data-question="legacy"]').click();
      assert.equal(await page.locator('.exam-original').getAttribute('open'), null, 'Old image-only questions no longer expand full PDF pages by default');
      assert.equal(await page.locator('.exam-scan').isVisible(), false);
      assert.match(await page.locator('#exam-question').innerText(), /尚无文字内容/);
      await page.locator('.exam-original summary').click();
      await page.waitForFunction(() => document.querySelector('.exam-scan')?.naturalWidth > 0);
      assert.equal(await page.locator('.exam-text-option').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No viewport overflow');
      await page.locator('#exam-submit').click();
      await page.locator('#modal-ok').click();
      await page.locator('.exam-result').waitFor();
      assert.match(await page.locator('.exam-score').innerText(), /\/\s*3/);
      assert.match(await page.locator('.exam-result').innerText(), /待核对 1 题不计分/);
      assert.equal(await page.locator('.review-pending').count(), 1);
      await page.locator('[data-review="pending"]').click();
      assert.equal(await page.locator('.exam-verdict').innerText(), '待核对 · 不计分');
      await page.locator('#exam-wrong-only').check();
      assert.equal(await page.locator('.review-pending').count(), 0, 'Pending item excluded from wrong filter');
      await page.locator('#exam-wrong-only').uncheck();
      await page.locator('[data-review="' + first.id + '"]').click();
      assert.match(await page.locator('.exam-explanation').innerText(), /FIXTURE_EXPLANATION/);
      assert.match(await page.locator('.exam-source-note').innerText(), /FIXTURE_SOURCE_NOTE/);
      assert.ok((await page.locator('#exam-review-question .exam-scan').first().getAttribute('src')).endsWith('?attempt=' + a.id));
      await page.screenshot({ path: path.join(output, 'result-' + width + '.png'), fullPage: true });
      await page.getByRole('link', { name: '‹ 返回个人考试', exact: true }).click();
      await page.locator('[data-start][data-section="listening"][data-mode="practice"]').click();
      await page.locator('#exam-audio').waitFor();
      const listenAttempt = [...attempts.values()].find(attempt => attempt.section_id === 'listening');
      assert.ok((await page.locator('#exam-audio').getAttribute('src')).endsWith('?attempt=' + listenAttempt.id));
      await page.waitForFunction(() => document.querySelector('#exam-audio').duration > 0);
      assert.doesNotMatch(await page.locator('#app').innerText(), /FIXTURE_TRANSCRIPT/);
      const before = await page.locator('#exam-next').boundingBox();
      await page.locator('#exam-next').click();
      const after = await page.locator('#exam-next').boundingBox();
      assert.ok(Math.abs(before.y - after.y) <= 2 && after.y + after.height <= 900, 'Listening navigation stays visible');
      await page.locator('[data-choice="1"]').click();
      await page.locator('#exam-exit').click();
      await page.locator('[data-resume][data-section="listening"]').waitFor();
      assert.equal(await page.locator('body > .exam-answer-tools').count(), 0, 'Leaving listening removes controls');
      await page.locator('[data-resume][data-section="listening"]').click();
      await page.locator('[data-choice="1"][aria-pressed="true"]').waitFor();
      assert.match(await page.locator('#exam-question h2').innerText(), /第 2 题/);
      await page.locator('#exam-submit').click();
      await page.locator('#modal-ok').click();
      await page.locator('.exam-result').waitFor();
      assert.match(await page.locator('.exam-explanation').innerText(), /FIXTURE_TRANSCRIPT/);
      const allPending = { ...clone(a), id: 'all-pending-' + width, status: 'submitted', all_pending: true };
      attempts.set(allPending.id, allPending);
      await page.goto(base + '/#/exams/result?attempt=' + allPending.id);
      await page.locator('.exam-result').waitFor();
      assert.match(await page.locator('.exam-result').innerText(), /本次暂无可计分题目/);
      assert.doesNotMatch(await page.locator('.exam-result').innerText(), /NaN|Infinity/);
      await page.locator('#exam-wrong-only').check();
      assert.equal(await page.locator('[data-review]').count(), 0);
      assert.match(await page.locator('#exam-review-question').innerText(), /没有已判分/);
      assert.ok(requests.some(r => r.path === '/api/private-exams/' + fixture.id && r.search === '?attempt=' + a.id), 'Pack request is pinned');
      assert.deepEqual(errors, []);
      await page.goto(base + '/#/exams?level=N1&year=2019&month=7');
      await page.locator('[data-start][data-section="language"][data-mode="practice"]').click();
      await page.locator('#exam-question .exam-text-option').first().waitFor();
      assert.match(await page.locator('#exam-question').innerText(), /猛烈に腹が立った/);
      assert.equal(await page.locator('.exam-scan').first().isVisible(), false);
      await page.screenshot({ path: path.join(output, 'n1-2019-07-text-' + width + '.png'), fullPage: true });
      console.log('PASS ' + width + 'px: N5-N1 -> year -> month, one chosen history, text-first/collapsed scans, Unicode underline, shared reading/table, failed save/resume, immutable old records, withheld grading, post-submit explanations and listening controls');
      await context.close();
    }
    const swContext = await browser.newContext({ serviceWorkers: 'allow' });
    const swPage = await swContext.newPage();
    await swContext.addInitScript(() => sessionStorage.setItem('yuyu_sw_reloaded', '1'));
    await swPage.goto(base + '/preview-exam');
    await swPage.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/api/app-shell/worker'));
    const cached = await swPage.evaluate(async () => ({
      keys: await caches.keys(),
      textScript: !!await caches.match('/exams.js?v=1.5.1'),
      shell: !!await caches.match('/index.html')
    }));
    assert.ok(cached.keys.includes('yuyu-v33-exam-catalog') && cached.textScript && cached.shell,
      'Worker served from API path caches root versioned assets, despite /sw.js being 403');
    const reloaded = swPage.waitForEvent('framenavigated', { predicate: frame => frame === swPage.mainFrame() });
    workerGeneration++;
    await swPage.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await reloaded;
    await swPage.locator('[data-level="N1"]').waitFor();
    await swContext.setOffline(true);
    await swPage.reload();
    assert.equal(await swPage.evaluate(() => window.APP_VERSION), '1.5.1', 'Fresh shell and scripts still load offline');
    await swContext.close();
    console.log('PASS real service worker: /sw.js 403, API worker root scope, versioned shell cache, reload after another update in the same tab, offline shell');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
