/* Personal original-paper exams. Packs and answer keys are served only to their owner. */
(function () {
  'use strict';
  var run = null;
  var stamp = 0;
  function query(name) { return new URLSearchParams((location.hash.split('?')[1] || '')).get(name); }
  function assetUrl(exam, path, attempt) {
    return '/api/private-exams/' + encodeURIComponent(exam) + '/assets/' + path +
      (attempt ? '?attempt=' + encodeURIComponent(attempt) : '');
  }
  function images(exam, assets, attempt) {
    return (assets || []).map(function (path) {
      var url = assetUrl(exam, path, attempt);
      return '<button type="button" class="exam-open-image" data-full-image="' + esc(url) +
        '" aria-label="放大查看试卷原图"><img class="exam-scan" src="' + esc(url) +
        '" alt="试卷原图 ' + esc(path) + '" loading="lazy"></button>';
    }).join('');
  }
  function fail(message) {
    app.innerHTML = '<div class="exam-empty glass"><h2>个人考试</h2><p>' + esc(message) +
      '</p><a class="btn btn-ghost" href="#/home">返回探索</a></div>';
  }
  function session() { return api('/private-exams/media-session', 'POST'); }
  function modeName(mode) { return mode === 'timed' ? '计时考试' : '自由练习'; }
  function fragmentHtml(fragment) {
    var chars = Array.from(fragment.text || ''), marks = (fragment.annotations || []).filter(function (a) {
      return a.kind === 'underline' && Number.isInteger(a.start) && Number.isInteger(a.end) &&
        a.start >= 0 && a.end <= chars.length && a.end > a.start && chars.slice(a.start, a.end).join('') === a.quote;
    });
    var underlined = chars.map(function (_, i) { return marks.some(function (a) { return a.start <= i && i < a.end; }); });
    var text = chars.map(function (c, i) {
      return (underlined[i] && !underlined[i - 1] ? '<u>' : '') + esc(c) +
        (underlined[i] && !underlined[i + 1] ? '</u>' : '');
    }).join('');
    var table = (fragment.table_rows || []).length ? '<table class="exam-text-table">' + fragment.table_rows.map(function (row) {
      return '<tr>' + row.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</table>' : '';
    return '<div class="exam-text" lang="ja">' + text + '</div>' + table;
  }
  function fragmentsHtml(fragments) { return (fragments || []).map(fragmentHtml).join(''); }
  function textQuestion(pack, q) {
    if (!q.stem_fragments && !q.options) return '';
    var materials = (pack.materials || []).filter(function (m) { return (q.material_ids || []).indexOf(m.id) >= 0; });
    return materials.map(function (m) { return '<section class="exam-passage"><h3>共用阅读材料</h3>' + fragmentsHtml(m.fragments) + '</section>'; }).join('') +
      fragmentsHtml(q.stem_fragments) + (q.options || []).map(function (o) {
        return '<div class="exam-text-option"><b class="exam-option-index">' + esc(o.index) + '</b><div>' + fragmentsHtml(o.fragments) + '</div></div>';
      }).join('');
  }
  function sourceNotes(pack, q) {
    var materials = (pack.materials || []).filter(function (m) { return (q.material_ids || []).indexOf(m.id) >= 0; });
    var notes = (q.source_notes || []).concat.apply(q.source_notes || [], materials.map(function (m) { return m.source_notes || []; }));
    return notes.map(function (note) {
      var message = note.message || (note.printed ? '原资料印作「' + note.printed + '」，可能读法为「' + note.possible_editorial_reading + '」。' : '');
      return message ? '<p class="exam-source-note">原资料备注：' + esc(message) + ' 原文保留，建议仅供参考。</p>' : '';
    }).join('');
  }
  function sectionName(pack, section) {
    return pack.sections.find(function (s) { return s.id === section; }).title;
  }
  function examHeading() { return '<div class="exam-page-head"><h1 class="page-title">考试</h1><p class="page-sub">个人试卷与最近一次进度</p></div>'; }
  function startButtons(pack, section, restart) {
    return ['practice', 'timed'].map(function (mode) {
      return '<button class="btn btn-sm ' + (mode === 'timed' ? 'btn-primary' : 'btn-ghost') + '" data-start="' +
        esc(pack.id) + '" data-section="' + esc(section.id) + '" data-mode="' + mode + '" data-restart="' + !!restart + '">' +
        modeName(mode) + '</button>';
    }).join('');
  }
  async function catalog() {
    var ticket = ++stamp;
    app.innerHTML = examHeading() + loadingHtml('正在读取个人试卷…');
    try {
      await session();
      var data = await api('/private-exams');
      var key = 'yuyu_exam_selection:' + (localStorage.getItem('yuyu_username') || ''), selection = {};
      try { selection = JSON.parse(localStorage.getItem(key) || '{}'); } catch (ignore) {}
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) selection = {};
      var levels = Array.from(new Set(data.exams.map(function (p) { return p.level; }))).sort();
      if (levels.indexOf(selection.level) < 0) selection.level = levels[0];
      var years = Array.from(new Set(data.exams.filter(function (p) { return p.level === selection.level; }).map(function (p) { return p.year; }))).sort(function (a, b) { return b - a; });
      if (years.indexOf(selection.year) < 0) selection.year = years[0];
      var periods = data.exams.filter(function (p) { return p.level === selection.level && p.year === selection.year; }).sort(function (a, b) { return b.month - a.month; });
      if (!periods.some(function (p) { return p.month === selection.month; })) selection.month = periods.length ? periods[0].month : null;
      var selectedPacks = periods.filter(function (p) { return p.month === selection.month; });
      var histories = await Promise.all(selectedPacks.map(function (pack) { return api('/private-exams/' + pack.id + '/attempts'); }));
      if (ticket !== stamp || currentRoute() !== 'exams') return;
      app.innerHTML = examHeading() +
        '<div class="exam-intro"><span class="exam-eyebrow">JLPT · 个人题库</span>' +
        '<h2>选一套试卷，开始练习。</h2><p class="muted">原卷作答 · 保存进度 · 考后解析</p></div>' +
        (data.exams.length ? '<div class="exam-level-tabs" role="group" aria-label="选择级别">' + levels.map(function (level) {
          return '<button class="btn ' + (level === selection.level ? 'btn-primary' : 'btn-ghost') + '" data-level="' + esc(level) + '" aria-pressed="' + (level === selection.level) + '">' + esc(level) + '</button>';
        }).join('') + '</div><div class="exam-catalog-filters"><label>年份<select id="exam-year">' + years.map(function (year) {
          return '<option value="' + year + '"' + (year === selection.year ? ' selected' : '') + '>' + year + ' 年</option>';
        }).join('') + '</select></label><label>考期<select id="exam-period">' + periods.map(function (p) {
          return '<option value="' + p.month + '"' + (p.month === selection.month ? ' selected' : '') + '>' + p.month + ' 月</option>';
        }).join('') + '</select></label></div>' + selectedPacks.map(function (pack, packIndex) {
          var attempts = histories[packIndex].attempts;
          return '<section class="glass exam-pack"><div class="exam-pack-head"><span class="exam-level">' + esc(pack.level) +
            '</span><div><h3>' + esc(pack.title) + '</h3><p class="muted">个人上传资料 · 原卷版面</p></div></div>' +
            pack.sections.map(function (s) {
              var latest = attempts.find(function (a) { return a.section_id === s.id; });
              var active = latest && latest.status === 'active';
              var progress = !latest ? '' : active ? '上次' + modeName(latest.mode) + ' · 已答 ' + Object.keys(latest.answers).length + ' 题' :
                '上次已交卷 · ' + latest.score.correct + '/' + latest.score.total + ' 正确';
              return '<div class="exam-section"><div class="exam-section-copy"><b>' + esc(s.title) + '</b><p class="muted">' + s.question_count +
                ' 题 · 计时 ' + s.minutes + ' 分钟</p><p class="exam-section-progress">' + esc(progress) + '</p></div><div class="exam-section-buttons">' +
                '<div class="exam-actions">' + (active ? '<button class="btn btn-primary btn-sm" data-resume="' + esc(latest.id) +
                '" data-section="' + esc(s.id) + '">继续作答</button><button class="btn btn-ghost btn-sm" data-restart-menu="restart-' +
                esc(pack.id + '-' + s.id) + '" aria-expanded="false">重新开始</button>' : startButtons(pack, s, false)) + '</div>' +
                (active ? '<div class="exam-restart-options" id="restart-' + esc(pack.id + '-' + s.id) + '" hidden><p class="muted">选择重新开始的模式</p>' +
                  '<div class="exam-actions">' + startButtons(pack, s, true) + '</div></div>' : '') + '</div></div>';
            }).join('') + '<div class="exam-history">' + (attempts.length ? '<h4>最近一次进度</h4>' + attempts.map(function (a) {
              var text = sectionName(pack, a.section_id) + ' · ' + modeName(a.mode);
              var detail = a.status === 'submitted' ? a.score.correct + '/' + a.score.total + ' 正确 · 查看解析' : '继续作答';
              return '<a class="exam-history-row" href="#/exams/' + (a.status === 'submitted' ? 'result' : 'run') + '?attempt=' + a.id +
                '"><span><b>' + esc(text) + '</b><small class="muted">' + new Date(a.started_at * 1000).toLocaleString('zh-CN') +
                '</small></span><span>' + esc(detail) + ' ›</span></a>';
            }).join('') : '<p class="muted">尚无考试记录</p>') + '</div></section>';
        }).join('') : '<div class="exam-empty glass">还没有导入个人试卷。</div>');
      function select(value) {
        Object.assign(selection, value);
        try { localStorage.setItem(key, JSON.stringify(selection)); } catch (ignore) {}
        catalog();
      }
      app.querySelectorAll('[data-level]').forEach(function (button) { button.onclick = function () { select({level:button.dataset.level}); }; });
      if (document.getElementById('exam-year')) document.getElementById('exam-year').onchange = function (e) { select({year:Number(e.target.value)}); };
      if (document.getElementById('exam-period')) document.getElementById('exam-period').onchange = function (e) { select({month:Number(e.target.value)}); };
      app.querySelectorAll('[data-resume]').forEach(function (button) {
        button.onclick = function () { location.hash = '#/exams/run?attempt=' + button.dataset.resume; };
      });
      app.querySelectorAll('[data-restart-menu]').forEach(function (button) {
        button.onclick = function () {
          var menu = document.getElementById(button.dataset.restartMenu);
          menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden));
        };
      });
      app.querySelectorAll('[data-start]').forEach(function (button) {
        button.onclick = async function () {
          var restart = button.dataset.restart === 'true';
          if ((restart || button.dataset.mode === 'timed') && !await confirmModal(restart ? '重新开始本分区' : '开始计时考试',
            restart ? '将从第1题开始，最近进度切换为本次考试。' + (button.dataset.mode === 'timed' ? '开始后持续计时。' : '') :
              '开始后持续计时，退出页面也不会暂停。到时自动交卷。', restart ? '重新开始' : '开始考试')) return;
          button.disabled = true;
          try {
            var attempt = await api('/private-exams/' + button.dataset.start + '/attempts', 'POST',
              { section_id: button.dataset.section, mode: button.dataset.mode, restart: restart });
            location.hash = '#/exams/run?attempt=' + attempt.id;
          } catch (error) { toast(error.message); button.disabled = false; }
        };
      });
    } catch (error) { if (ticket === stamp) fail(error.message); }
  }
  function draftKey(state) {
    return 'yuyu_exam_draft:' + (localStorage.getItem('yuyu_username') || '') + ':' + state.attempt.id;
  }
  function zoomKey(state) { return 'yuyu_exam_zoom:' + (localStorage.getItem('yuyu_username') || '') + ':' + state.pack.id + ':' + state.attempt.section_id; }
  function zoomTools(value) {
    return '<div class="exam-scan-tools"><label for="exam-zoom">原卷缩放</label>' +
      '<input id="exam-zoom" type="range" min="50" max="400" step="5" value="' + value + '" aria-label="原卷缩放">' +
      '<label class="exam-zoom-number"><input id="exam-zoom-value" type="number" min="50" max="400" step="5" value="' + value +
      '" inputmode="numeric" aria-label="缩放百分比">%</label><button type="button" id="exam-zoom-fit" class="btn btn-ghost btn-sm">适应宽度</button></div>';
  }
  function keepDraft(state) {
    try {
      localStorage.setItem(draftKey(state), JSON.stringify({ answers: state.dirtyAnswers, marked: state.dirtyMarked,
        cursor: state.cursor, audio_position: state.audio ? state.audio.currentTime : state.attempt.audio_position }));
    } catch (error) { state.storageFailed = true; }
  }
  function saveLabel(text, failed) {
    var label = document.getElementById('exam-save-status');
    if (label) { label.textContent = text; label.classList.toggle('exam-error', !!failed); }
    var retry = document.getElementById('exam-retry-save');
    if (retry) retry.hidden = !failed;
  }
  function flush(state) {
    keepDraft(state);
    state.queue = state.queue.catch(function () {}).then(async function () {
      if (state.attempt.status !== 'active') return;
      var answers = Object.assign({}, state.dirtyAnswers), marked = Object.assign({}, state.dirtyMarked);
      var body = { answers: answers, marked: marked, cursor: state.cursor,
        audio_position: state.audio ? state.audio.currentTime : state.attempt.audio_position };
      if (run === state) saveLabel('正在保存…');
      try {
        var saved = await api('/private-exams/attempts/' + state.attempt.id, 'PUT', body);
        Object.keys(answers).forEach(function (key) { if (state.dirtyAnswers[key] === answers[key]) delete state.dirtyAnswers[key]; });
        Object.keys(marked).forEach(function (key) { if (state.dirtyMarked[key] === marked[key]) delete state.dirtyMarked[key]; });
        state.attempt.status = saved.status;
        keepDraft(state);
        if (run === state) {
          saveLabel(state.storageFailed ? '已保存到服务器' : '已保存');
          if (saved.status === 'submitted') location.hash = '#/exams/result?attempt=' + saved.id;
        }
      } catch (error) {
        if (run === state) saveLabel(state.storageFailed ? '保存失败，请保持页面并重试' : '保存失败，答案暂存在本机，请重试', true);
        throw error;
      }
    });
    return state.queue;
  }
  function updateProgress(state) {
    var answered = state.questions.filter(function (q) { return state.answers[q.id] != null; }).length;
    var node = document.getElementById('exam-progress');
    if (node) node.textContent = answered + ' / ' + state.questions.length + ' 已答';
    document.querySelectorAll('[data-question]').forEach(function (button) {
      var id = button.dataset.question;
      button.classList.toggle('is-current', id === state.cursor);
      button.classList.toggle('is-answered', state.answers[id] != null);
      button.classList.toggle('is-marked', !!state.marked[id]);
      button.setAttribute('aria-current', id === state.cursor ? 'true' : 'false');
    });
  }
  function renderQuestion(state) {
    if (run !== state) return;
    var previousTools = document.querySelector('body > .exam-answer-tools');
    if (previousTools) previousTools.remove();
    var index = state.questions.findIndex(function (q) { return q.id === state.cursor; });
    if (index < 0) { index = 0; state.cursor = state.questions[0].id; }
    var q = state.questions[index];
    var options = Array.from({ length: q.option_count }, function (_, i) { return i + 1; });
    var pane = document.getElementById('exam-question');
    pane.innerHTML = '<div class="exam-question-head"><div><span class="exam-eyebrow">' + esc(q.group_title) +
      '</span><h2>' + esc(q.label) + '</h2></div><button id="exam-mark" class="btn btn-ghost btn-sm" aria-pressed="' +
      !!state.marked[q.id] + '">' + (state.marked[q.id] ? '★ 已标记' : '☆ 稍后检查') + '</button></div>' +
      (q.instruction ? '<p class="exam-instruction" lang="ja">' + esc(q.instruction) + '</p>' : '') +
      (q.grading_status === 'withheld' ? '<p class="exam-review-notice">资料待核对，本题可以作答，暂不计分。' + esc(q.review_notice || '') + '</p>' : '') +
      textQuestion(state.pack, q) + (q.assets.length ? (q.stem_fragments ? '<details class="exam-original"><summary>原卷对照</summary>' : '') + zoomTools(state.zoom) +
        '<div class="exam-scan-scroll"><div id="exam-scans">' + images(state.pack.id, q.assets, state.attempt.id) + '</div></div><p class="exam-image-hint muted">点按原图可全屏放大查看</p>' :
        (q.stem_fragments && q.stem_fragments.length ? '' : '<div class="exam-listen-prompt">请听录音，在下方选择答案。<p class="muted">这一题型的题干与选项在录音中播放。</p></div>')) +
      (q.assets.length && q.stem_fragments ? '</details>' : '') +
      '<div class="exam-answer-tools"><fieldset class="exam-choices"><legend>' +
      (state.attempt.section_id === 'listening' ? esc(q.label) + ' · 选择答案' : '选择答案') + '</legend>' + options.map(function (option) {
        return '<button type="button" class="exam-choice' + (state.answers[q.id] === option ? ' selected' : '') +
          '" data-choice="' + option + '" aria-pressed="' + (state.answers[q.id] === option) + '">' + option + '</button>';
      }).join('') + '</fieldset><div class="exam-question-nav"><button id="exam-prev" class="btn btn-ghost" ' +
      (index === 0 ? 'disabled' : '') + '>上一题</button><button id="exam-clear" class="btn btn-ghost btn-sm">清除答案</button>' +
      '<button id="exam-next" class="btn btn-primary" ' + (index === state.questions.length - 1 ? 'disabled' : '') + '>下一题</button></div></div>';
    var zoom = document.getElementById('exam-zoom');
    if (zoom) {
      document.getElementById('exam-scans').style.width = state.zoom + '%';
      function applyZoom(value) {
        if (!Number.isFinite(Number(value)) || value === '') value = state.zoom;
        state.zoom = String(Math.min(400, Math.max(50, Math.round(Number(value) / 5) * 5)));
        zoom.value = state.zoom; document.getElementById('exam-zoom-value').value = state.zoom;
        document.getElementById('exam-scans').style.width = state.zoom + '%';
        try { localStorage.setItem(zoomKey(state), state.zoom); } catch (error) {}
      }
      zoom.oninput = function () { applyZoom(zoom.value); };
      document.getElementById('exam-zoom-value').onchange = function (event) { applyZoom(event.target.value); };
      document.getElementById('exam-zoom-fit').onclick = function () { applyZoom(100); };
    }
    pane.querySelectorAll('[data-choice]').forEach(function (button) {
      button.onclick = function () {
        var value = Number(button.dataset.choice);
        state.answers[q.id] = value; state.dirtyAnswers[q.id] = value;
        renderQuestion(state); flush(state).catch(function () {});
      };
    });
    document.getElementById('exam-clear').onclick = function () {
      delete state.answers[q.id]; state.dirtyAnswers[q.id] = null;
      renderQuestion(state); flush(state).catch(function () {});
    };
    document.getElementById('exam-mark').onclick = function () {
      state.marked[q.id] = !state.marked[q.id]; state.dirtyMarked[q.id] = state.marked[q.id];
      renderQuestion(state); flush(state).catch(function () {});
    };
    document.getElementById('exam-prev').onclick = function () { chooseQuestion(state, state.questions[index - 1].id); };
    document.getElementById('exam-next').onclick = function () { chooseQuestion(state, state.questions[index + 1].id); };
    updateProgress(state);
    // A glass card's backdrop-filter creates a fixed-position containing block.
    // Put the listening controls directly under body so they stay at the viewport edge.
    if (state.attempt.section_id === 'listening') document.body.appendChild(pane.querySelector('.exam-answer-tools'));
  }
  function chooseQuestion(state, id, fromSheet) {
    state.cursor = id; renderQuestion(state); flush(state).catch(function () {});
    if (state.attempt.section_id !== 'listening' || fromSheet) document.getElementById('exam-question').scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  function audioHtml(pack, position, attempt) {
    return '<div class="exam-audio glass"><div><b>听力原音</b><span class="muted">完整录音 · 自动保存播放位置</span></div>' +
      '<audio id="exam-audio" controls preload="metadata" src="/api/private-exams/' + encodeURIComponent(pack.id) +
      '/audio' + (attempt ? '?attempt=' + encodeURIComponent(attempt) : '') + '"></audio><p id="exam-audio-error" class="exam-error" hidden>音频暂时无法播放，请检查服务连接后重新打开。</p></div>';
  }
  async function startRun() {
    var ticket = ++stamp, id = query('attempt');
    app.innerHTML = loadingHtml('正在恢复考试…');
    try {
      await session();
      var attempt = await api('/private-exams/attempts/' + encodeURIComponent(id));
      if (ticket !== stamp || currentRoute() !== 'exams/run') return;
      if (attempt.status === 'submitted') { location.hash = '#/exams/result?attempt=' + id; return; }
      var pack = await api('/private-exams/' + attempt.exam_id + '?attempt=' + encodeURIComponent(id));
      if (ticket !== stamp || currentRoute() !== 'exams/run') return;
      var state = run = { pack: pack, attempt: attempt, questions: pack.questions.filter(function (q) { return q.section_id === attempt.section_id; }),
        answers: Object.assign({}, attempt.answers), marked: Object.assign({}, attempt.marked), cursor: attempt.cursor,
        dirtyAnswers: {}, dirtyMarked: {}, queue: Promise.resolve(), zoom: attempt.section_id === 'listening' ? '100' : innerWidth < 600 ? '200' : '100' };
      document.body.classList.toggle('exam-listening', attempt.section_id === 'listening');
      try {
        var storedZoom = Number(localStorage.getItem(zoomKey(state)));
        if (storedZoom >= 50 && storedZoom <= 400) state.zoom = String(storedZoom);
        var draft = JSON.parse(localStorage.getItem(draftKey(state)) || 'null');
        if (draft) {
          state.dirtyAnswers = draft.answers || {}; state.dirtyMarked = draft.marked || {};
          Object.assign(state.answers, state.dirtyAnswers); Object.assign(state.marked, state.dirtyMarked);
          state.cursor = draft.cursor || state.cursor;
          attempt.audio_position = draft.audio_position || attempt.audio_position;
        }
      } catch (error) { /* Server progress remains authoritative if local storage is unavailable. */ }
      app.innerHTML = '<div class="exam-top"><button id="exam-exit" class="btn btn-ghost btn-sm">‹ 试卷</button>' +
        '<div><b>' + esc(pack.title) + '</b><small>' + esc(sectionName(pack, attempt.section_id)) + '</small></div>' +
        '<span id="exam-clock" class="exam-clock"></span></div><div class="exam-status"><span id="exam-progress"></span>' +
        '<span id="exam-save-status" role="status">已恢复进度</span><button id="exam-retry-save" class="btn btn-ghost btn-sm" hidden>重试保存</button></div>' +
        (attempt.section_id === 'listening' ? audioHtml(pack, attempt.audio_position, id) : '') +
        '<div class="exam-workspace"><section id="exam-question" class="glass exam-question"></section>' +
        '<aside class="glass exam-sheet"><h3>答题卡</h3><p class="muted">实心为已答，★ 为待检查</p><div class="exam-grid">' +
        state.questions.map(function (q) { return '<button data-question="' + esc(q.id) + '" aria-label="跳到' + esc(q.label) + '">' + esc(q.short_label) + '</button>'; }).join('') +
        '</div><button id="exam-submit" class="btn btn-primary">交卷并批改</button><p class="exam-error" id="exam-submit-error" role="alert"></p></aside></div>';
      state.audio = document.getElementById('exam-audio');
      if (state.audio) {
        state.audio.onloadedmetadata = function () {
          if (Number.isFinite(state.audio.duration)) state.audio.currentTime = Math.min(attempt.audio_position, state.audio.duration);
        };
        state.audio.onerror = function () { document.getElementById('exam-audio-error').hidden = false; };
        var lastSave = Date.now();
        state.audio.ontimeupdate = function () {
          if (Date.now() - lastSave > 5000) { lastSave = Date.now(); flush(state).catch(function () {}); }
        };
        state.audio.onpause = function () { flush(state).catch(function () {}); };
      }
      document.querySelectorAll('[data-question]').forEach(function (button) {
        button.onclick = function () { chooseQuestion(state, button.dataset.question, true); };
      });
      document.getElementById('exam-retry-save').onclick = function () { flush(state).catch(function () {}); };
      document.getElementById('exam-exit').onclick = async function () {
        try { await flush(state); location.hash = '#/exams'; } catch (error) { toast('保存尚未成功，请重试后退出'); }
      };
      var submitting = false;
      async function submit(automatic) {
        if (submitting || run !== state) return;
        if (!automatic) {
          var remaining = state.questions.filter(function (q) { return state.answers[q.id] == null; }).length;
          if (!await confirmModal('交卷并批改', remaining ? '还有 ' + remaining + ' 题未作答。交卷后将显示参考答案与解析。' : '本分区已全部作答，交卷后查看结果。', '确认交卷')) return;
        }
        submitting = true;
        document.getElementById('exam-submit').disabled = true;
        try {
          await flush(state);
          await api('/private-exams/attempts/' + id + '/submit', 'POST');
          try { localStorage.removeItem(draftKey(state)); } catch (ignore) {}
          location.hash = '#/exams/result?attempt=' + id;
        } catch (error) {
          document.getElementById('exam-submit-error').textContent = '交卷未成功：' + error.message + '。请重试。';
          submitting = false; document.getElementById('exam-submit').disabled = false;
        }
      }
      document.getElementById('exam-submit').onclick = function () { submit(false); };
      var offset = attempt.server_now * 1000 - Date.now();
      function tick() {
        var clock = document.getElementById('exam-clock');
        if (!clock || run !== state) return;
        if (!attempt.deadline_at) { clock.textContent = '自由练习'; return; }
        var seconds = Math.max(0, Math.ceil(attempt.deadline_at - (Date.now() + offset) / 1000));
        clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        clock.classList.toggle('exam-error', seconds < 300);
        if (seconds === 0) submit(true);
      }
      renderQuestion(state); tick(); every(tick, 1000);
      if (Object.keys(state.dirtyAnswers).length || Object.keys(state.dirtyMarked).length) flush(state).catch(function () {});
    } catch (error) { if (ticket === stamp) fail(error.message); }
  }
  async function result() {
    var ticket = ++stamp, id = query('attempt');
    app.innerHTML = loadingHtml('正在读取考试结果…');
    try {
      await session();
      var attempt = await api('/private-exams/attempts/' + encodeURIComponent(id));
      if (ticket !== stamp || currentRoute() !== 'exams/result') return;
      if (attempt.status !== 'submitted') { location.hash = '#/exams/run?attempt=' + id; return; }
      var pack = await api('/private-exams/' + attempt.exam_id + '?attempt=' + encodeURIComponent(id));
      if (ticket !== stamp || currentRoute() !== 'exams/result') return;
      var score = attempt.score;
      app.innerHTML = '<a class="back-link" href="#/exams">‹ 返回个人考试</a><div class="glass exam-result"><span class="exam-eyebrow">' +
        esc(pack.title) + '</span><h2>' + esc(sectionName(pack, attempt.section_id)) + '</h2><div class="exam-score">' + score.correct +
        '<small> / ' + score.total + '</small></div><p>' + (score.accuracy == null ? '本次暂无可计分题目' : '正确率 ' + score.accuracy + '%') + ' · 未答 ' + (score.unanswered == null ? score.total - score.answered : score.unanswered) +
        ' 题' + (score.excluded ? ' · 待核对 ' + score.excluded + ' 题不计分' : '') + '</p><p class="muted">按上传资料中的参考答案批改；这里展示练习正确率。</p></div>' +
        (attempt.section_id === 'listening' ? audioHtml(pack, attempt.audio_position, id) : '') +
        '<div class="exam-review-head"><h3>试题与解析</h3><label><input id="exam-wrong-only" type="checkbox"> 只看错题和未答</label></div>' +
        '<div class="exam-grid exam-review-grid" id="exam-review-grid"></div><section id="exam-review-question" class="glass exam-question"></section>';
      var selected = null;
      function show(q) {
        selected = q.id;
        document.getElementById('exam-review-question').innerHTML = '<div class="exam-question-head"><h3>' + esc(q.label) + ' · ' + esc(q.group_title) +
          '</h3><span class="exam-verdict ' + (q.is_graded === false ? 'pending' : q.is_correct ? 'correct' : 'wrong') + '">' + (q.is_graded === false ? '待核对 · 不计分' : q.is_correct ? '答对' : q.selected == null ? '未作答' : '答错') +
          '</span></div><p>你的答案：' + (q.selected == null ? '未答' : q.selected) + '　参考答案：<b>' + (q.correct == null ? '待核对' : q.correct) + '</b></p>' +
          (q.review_notice ? '<p class="exam-review-notice">' + esc(q.review_notice) + '</p>' : '') + textQuestion(pack, q) +
          '<div class="exam-scan-scroll"><div>' + images(pack.id, q.assets, id) + '</div></div><details class="exam-explanation" open><summary>解析 / 听力原文</summary>' +
          fragmentsHtml(q.explanation_fragments) + fragmentsHtml(q.transcript_fragments) +
          sourceNotes(pack, q) +
          ((q.explanation_pages || []).length ? '<p class="muted">对应上传资料第 ' + q.explanation_pages.join('、') + ' 页；点按原图可全屏放大查看。</p>' : '') +
          images(pack.id, q.explanation_assets || (q.explanation_pages || []).map(function (page) { return 'answers/' + String(page).padStart(2, '0') + '.webp'; }), id) + '</details>';
        document.querySelectorAll('[data-review]').forEach(function (b) { b.classList.toggle('is-current', b.dataset.review === q.id); });
      }
      function draw() {
        var onlyWrong = document.getElementById('exam-wrong-only').checked;
        var questions = attempt.review.filter(function (q) { return !onlyWrong || (q.is_graded !== false && !q.is_correct); });
        document.getElementById('exam-review-grid').innerHTML = questions.map(function (q) {
          return '<button data-review="' + esc(q.id) + '" class="' + (q.is_graded === false ? 'review-pending' : q.is_correct ? 'review-correct' : 'review-wrong') +
            '" aria-label="查看' + esc(q.label) + '">' + esc(q.short_label) + '</button>';
        }).join('');
        document.querySelectorAll('[data-review]').forEach(function (button) {
          button.onclick = function () { show(questions.find(function (q) { return q.id === button.dataset.review; })); };
        });
        if (!questions.length) document.getElementById('exam-review-question').innerHTML = '<p>没有已判分的错题或未答题。</p>';
        else show(questions.find(function (q) { return q.id === selected; }) || questions[0]);
      }
      document.getElementById('exam-wrong-only').onchange = draw;
      var audio = document.getElementById('exam-audio');
      if (audio) {
        audio.onloadedmetadata = function () { if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(attempt.audio_position, audio.duration); };
        audio.onerror = function () { document.getElementById('exam-audio-error').hidden = false; };
      }
      draw();
    } catch (error) { if (ticket === stamp) fail(error.message); }
  }
  window.privateExamCleanup = function () {
    stamp++;
    document.body.classList.remove('exam-listening');
    var tools = document.querySelector('body > .exam-answer-tools');
    if (tools) tools.remove();
    if (run) { keepDraft(run); run = null; }
    var audio = document.getElementById('exam-audio');
    if (audio) { audio.onpause = null; audio.pause(); }
    var viewer = document.querySelector('.exam-image-viewer');
    if (viewer) { viewer.close(); viewer.remove(); }
  };
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-full-image]');
    if (!button) return;
    var viewer = document.createElement('dialog');
    viewer.className = 'exam-image-viewer';
    viewer.setAttribute('aria-label', '试卷原图');
    viewer.innerHTML = '<div class="exam-viewer-bar"><b>原卷清晰图</b><label>缩放 <select aria-label="原图缩放">' +
      '<option value="100">适应屏幕</option><option value="200">200%</option><option value="300">300%</option></select></label>' +
      '<button type="button" class="btn btn-ghost btn-sm">关闭</button></div><p class="muted">可上下、左右拖动阅读；按 Esc 关闭</p>' +
      '<div class="exam-image-scroll"><img src="' + esc(button.dataset.fullImage) + '" alt="放大的试卷原图"></div>';
    document.body.appendChild(viewer);
    viewer.querySelector('select').onchange = function (event) { viewer.querySelector('img').style.width = event.target.value + '%'; };
    viewer.querySelector('button').onclick = function () { viewer.close(); };
    viewer.addEventListener('close', function () { viewer.remove(); button.focus(); });
    viewer.showModal();
  });
  window.registerPrivateExams = function () {
    routes.exams = catalog; routes['exams/run'] = startRun; routes['exams/result'] = result;
  };
})();
