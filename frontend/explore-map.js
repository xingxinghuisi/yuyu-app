/* ============================================================
   语屿 Kotoba · explore-map.js —— v1.2 探索页「群岛海图」
   竖向滚动海图：N5 樱花岛在最下，向上滚动依次到 N1 雪见岛。
   · 背景：explore-config.js 中的 tiles（一张或多张竖图叠放）
   · 叠层：按百分比坐标放置 站点圆环 / 岛屿名牌 / 踏石虚线 / 旅人
   · 数据：/api/home/summary（打卡、今日目标）+ /api/books（各级词书进度 → 岛屿状态）
   依赖 app.js 的全局函数（调用时才取用，所以本文件可以在 app.js 之前加载）：
     app, api, esc, toast, vibrate, startAmbientPetals, StudyCtx
   app.js 中只需：routes['explore'] = window.renderExploreMap || renderExplore;
   ============================================================ */
'use strict';

(function (global) {
  var SVGNS = 'http://www.w3.org/2000/svg';
  var renderSeq = 0;

  function C() { return global.EXPLORE_CONFIG; }
  function escHtml(s) {
    if (typeof global.esc === 'function') return global.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function reduceMotion() {
    try { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function say(msg) { if (typeof global.toast === 'function') global.toast(msg); }
  function buzz(ms) { if (typeof global.vibrate === 'function') global.vibrate(ms); }

  /* ---------------- 图标 ---------------- */
  var ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h2v18H6z"/><path d="M8 4h10l-2.5 4L18 12H8z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><defs><linearGradient id="xm-fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#E03E2D"/><stop offset=".6" stop-color="#FF8A3D"/><stop offset="1" stop-color="#FFD36B"/></linearGradient></defs><path fill="url(#xm-fl)" d="M12 2.5c.6 3-1.2 4.6-2.6 6.2C8 10.3 7 11.8 7 14a5 5 0 0 0 10 0c0-2.4-1.3-3.9-2.2-5 .1 1.4-.4 2.6-1.4 3.2.4-3.6-.6-7.4-1.4-9.7z"/><path fill="#FFE7A3" d="M12 12.2c.2 1.3-.6 2-1.1 2.7-.4.5-.6 1-.6 1.6a1.7 1.7 0 0 0 3.4 0c0-.9-.6-1.6-.9-2 0 .5-.2.9-.6 1.1.2-1.3-.1-2.5-.2-3.4z"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path fill="#FFD36B" stroke="#C6A15B" stroke-width="1" stroke-linejoin="round" d="M3.5 8l4.3 3.6L12 5l4.2 6.6L20.5 8 19 18H5z"/><rect x="5" y="18.4" width="14" height="2.2" rx="1" fill="#C6A15B"/></svg>',
    book: '<svg viewBox="0 0 48 36"><path fill="#FBF3E2" stroke="#B48A4A" stroke-width="1.4" d="M24 7C18 3 9 3 3 5v26c6-2 15-2 21 2 6-4 15-4 21-2V5c-6-2-15-2-21 2z"/><path fill="none" stroke="#B48A4A" stroke-width="1.4" d="M24 7v26"/><path fill="none" stroke="#D9C29A" stroke-width="1.1" d="M8 11c4-1 8-1 12 1M8 16c4-1 8-1 12 1M8 21c4-1 8-1 12 1M28 12c4-2 8-2 12-1M28 17c4-2 8-2 12-1M28 22c4-2 8-2 12-1"/></svg>',
    scroll: '<svg viewBox="0 0 44 40"><path fill="#F3E2BF" stroke="#A07A40" stroke-width="1.3" d="M8 6h28v26H8z"/><rect x="3" y="3" width="6" height="34" rx="3" fill="#C99A55" stroke="#8C6430" stroke-width="1.2"/><rect x="35" y="3" width="6" height="34" rx="3" fill="#C99A55" stroke="#8C6430" stroke-width="1.2"/><path fill="none" stroke="#B4884E" stroke-width="1.2" stroke-dasharray="3 2" d="M13 13c5 2 8-3 12 0s5 6 7 4M14 24c4-2 6 2 10 0"/><circle cx="31" cy="15" r="2" fill="#E03E2D"/></svg>',
    gem: '<svg viewBox="0 0 24 24"><defs><linearGradient id="xm-gm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#BFE6FF"/><stop offset="1" stop-color="#5B8BEA"/></linearGradient></defs><path fill="url(#xm-gm)" stroke="#EAF6FF" stroke-width=".8" stroke-linejoin="round" d="M12 2.5l7.5 7L12 21.5 4.5 9.5z"/><path fill="#fff" opacity=".55" d="M12 2.5l-3 7h6z"/></svg>',
    blossom: '<svg viewBox="0 0 24 24"><g fill="#F7B6C8"><circle cx="12" cy="6.5" r="4"/><circle cx="17.2" cy="10.3" r="4"/><circle cx="15.2" cy="16.5" r="4"/><circle cx="8.8" cy="16.5" r="4"/><circle cx="6.8" cy="10.3" r="4"/></g><circle cx="12" cy="12" r="2.4" fill="#E8708F"/></svg>',
    petal: '<svg viewBox="0 0 60 40"><g fill="#F6C9D4"><ellipse cx="14" cy="22" rx="7" ry="5" transform="rotate(-30 14 22)"/><ellipse cx="26" cy="12" rx="6" ry="4.4" transform="rotate(20 26 12)" fill="#F2A9BC"/><ellipse cx="40" cy="20" rx="7" ry="5" transform="rotate(10 40 20)"/><ellipse cx="50" cy="9" rx="5" ry="3.6" fill="#FBDCE4"/></g><path d="M4 34C18 26 30 18 58 4" stroke="#6E4A3A" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>'
  };

  /* 旅人（草帽 + 背包的小人），纯 SVG，无外部资源 */
  var TRAVELER_SVG =
    '<svg viewBox="0 0 48 64" aria-hidden="true">' +
      '<rect x="8" y="27" width="11" height="15" rx="4" fill="#8C5A3C"/>' +                       // 背包
      '<path d="M18 47l-3 12M28 47l3 12" stroke="#3B2A2A" stroke-width="4" stroke-linecap="round"/>' + // 腿
      '<path d="M15 31c0-4 4-7 9-7s9 3 9 7l1 17H14z" fill="#E8EEF5"/>' +                         // 上衣
      '<path d="M14 40h20l1 8H13z" fill="#E03E2D"/>' +                                            // 裙
      '<path d="M15 31c-3 3-4 7-4 10" stroke="#F3D3BF" stroke-width="3.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M33 31c3 2 5 5 6 8" stroke="#F3D3BF" stroke-width="3.4" stroke-linecap="round" fill="none"/>' +
      '<circle cx="24" cy="17" r="8" fill="#F6DCCB"/>' +                                          // 脸
      '<path d="M16 17c0-6 4-9 8-9s8 3 8 9c-2-2-4-4-8-4s-6 2-8 4z" fill="#4A2E25"/>' +             // 头发
      '<path d="M31 18c2 3 2 7 0 10" stroke="#4A2E25" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<ellipse cx="24" cy="10" rx="15" ry="3.6" fill="#D9A55B"/>' +                              // 帽檐
      '<path d="M17 10c0-5 3-7 7-7s7 2 7 7z" fill="#E4B66C"/>' +                                  // 帽顶
      '<path d="M17 9h14" stroke="#B3271B" stroke-width="2"/>' +                                  // 帽带
      '<circle cx="21" cy="18" r="1" fill="#3B2A2A"/><circle cx="27" cy="18" r="1" fill="#3B2A2A"/>' +
    '</svg>';

  /* ---------------- 数据 → 视图模型 ---------------- */
  function buildModel(summary, books) {
    var cfg = C();
    var useMock = !!cfg.useMockFallback;
    var M = cfg.mock || {};
    var wpl = cfg.wordsPerLesson || 20;
    var byLevel = {};
    var wantId = {};
    cfg.islands.forEach(function (d) { wantId[d.level] = d.bookId; });
    (Array.isArray(books) ? books : []).forEach(function (b) {
      if (!b || (b.category || 'level') !== 'level' || !b.level) return;
      // 同级可能有多本（如 level-n3 与 adv-n3）：优先配置里的 bookId，否则取第一本
      var cur = byLevel[b.level];
      if (!cur || (b.id === wantId[b.level] && cur.id !== wantId[b.level])) byLevel[b.level] = b;
    });
    var hasBooks = Object.keys(byLevel).length > 0;

    var islands = cfg.islands.map(function (d) {
      var b = byLevel[d.level] || null;
      var total = b ? (b.total || 0) : 0;
      var studied = b ? (b.studied || 0) : 0;
      var lt = Math.max(1, Math.ceil(total / wpl));
      return {
        level: d.level, name: d.name, sub: d.sub, x: d.x, y: d.y, plate: d.plate || 'right',
        px: d.px, py: d.py, accent: d.accent || '',
        bookId: (b && b.id) || d.bookId, bookName: (b && b.name) || (d.level + ' ' + d.name),
        progress: b ? (b.progress || 0) : 0, studied: studied, total: total,
        lessonsTotal: total ? lt : 0, lessonsDone: total ? Math.min(lt, Math.floor(studied / wpl)) : 0,
        status: 'locked'
      };
    });

    var source = 'live';
    if (hasBooks) {
      // 与旧版一致：N5 默认解锁；上一级 ≥ unlockThreshold 解锁下一级；≥ doneThreshold 通关
      var foundCurrent = false;
      islands.forEach(function (is, i) {
        var unlocked = i === 0 || islands[i - 1].progress >= cfg.unlockThreshold;
        if (!unlocked) is.status = 'locked';
        else if (is.progress >= cfg.doneThreshold) is.status = 'done';
        else if (!foundCurrent) { is.status = 'current'; foundCurrent = true; }
        else is.status = 'open';
      });
    } else if (useMock) {
      source = 'mock';
      islands.forEach(function (is) {
        is.status = (M.statuses && M.statuses[is.level]) || 'locked';
        var mp = M.progress && M.progress[is.level];
        if (mp) { is.lessonsDone = mp.lessonsDone; is.lessonsTotal = mp.lessonsTotal; }
      });
    } else {
      source = 'empty';
      islands[0].status = 'current';
    }

    // 旅人所在站：current；若全部通关则停在最高的已解锁岛
    var current = null;
    islands.forEach(function (is) { if (!current && is.status === 'current') current = is; });
    if (!current) {
      for (var k = islands.length - 1; k >= 0; k--) {
        if (islands[k].status !== 'locked') { current = islands[k]; break; }
      }
    }
    if (!current) current = islands[0];

    var lesson;
    if (source === 'mock' && M.currentLesson) {
      lesson = { no: M.currentLesson.no, title: M.currentLesson.title };
    } else {
      var no = Math.max(1, Math.min(current.lessonsDone + 1, current.lessonsTotal || 1));
      var titles = (cfg.lessonTitles && cfg.lessonTitles[current.level]) || [];
      lesson = { no: no, title: titles[no - 1] || current.bookName };
    }

    var streak = summary ? (summary.streak || 0) : (useMock ? M.streak : null);
    var goal = summary
      ? { done: summary.today_learned || 0, total: summary.daily_goal || 30, unit: '词' }
      : (useMock && M.goal ? M.goal : null);

    return { islands: islands, current: current, lesson: lesson, streak: streak, goal: goal,
             xp: cfg.xp, source: source };
  }

  /* ---------------- HTML 片段 ---------------- */
  function tilesHtml() {
    var tiles = C().background.tiles || [];
    return '<div class="xm-tiles">' + tiles.map(function (t) {
      var img = '<img class="xm-tile" src="' + escHtml(t.src) + '" alt="" width="' + t.w + '" height="' + t.h + '" ' +
        'style="aspect-ratio:' + t.w + ' / ' + t.h + '" draggable="false" decoding="async">';
      return t.webp ? '<picture><source type="image/webp" srcset="' + escHtml(t.webp) + '">' + img + '</picture>' : img;
    }).join('') + '</div>';
  }

  function hudHtml(m) {
    var streakTxt = m.streak == null ? '—' : m.streak;
    var g = m.goal;
    var pct = g && g.total > 0 ? Math.min(1, g.done / g.total) : 0;
    var R = 11, CIRC = 2 * Math.PI * R;
    return '' +
      '<header class="xm-hud">' +
        '<div class="xm-brand">' +
          '<h1 class="xm-logo">语屿<span class="xm-logo-petal" aria-hidden="true">' + ICON.blossom + '</span></h1>' +
          '<div class="xm-latin">KOTOBA</div>' +
          '<p class="xm-slogan">每天十五分钟，<br>筑一座日语之岛。</p>' +
        '</div>' +
        '<div class="xm-glass xm-stats">' +
          '<div class="xm-stat" aria-label="连续打卡 ' + streakTxt + ' 天">' +
            '<span class="xm-stat-ico">' + ICON.flame + '</span>' +
            '<span class="xm-stat-txt"><i>连续打卡</i><b>' + streakTxt + '<small> 天</small></b></span>' +
          '</div>' +
          '<span class="xm-stat-sep"></span>' +
          '<div class="xm-stat" aria-label="今日目标">' +
            '<span class="xm-stat-ico">' + ICON.crown + '</span>' +
            '<span class="xm-stat-txt"><i>今日目标</i><b>' + (g ? (g.done > 999 ? '999+' : g.done) + '<small>/' + g.total + ' ' + escHtml(g.unit) + '</small>' : '—') + '</b></span>' +
            '<svg class="xm-ring" viewBox="0 0 30 30" aria-hidden="true">' +
              '<circle cx="15" cy="15" r="' + R + '" class="xm-ring-bg"/>' +
              '<circle cx="15" cy="15" r="' + R + '" class="xm-ring-fg" stroke-dasharray="' + CIRC.toFixed(2) + '" ' +
                'stroke-dashoffset="' + (CIRC * (1 - pct)).toFixed(2) + '" transform="rotate(-90 15 15)"/>' +
            '</svg>' +
          '</div>' +
        '</div>' +
      '</header>';
  }

  function overlaysHtml(m) {
    var STATUS_TXT = { done: '已通关', current: '进行中', open: '已解锁', locked: '未解锁' };
    return m.islands.map(function (is) {
      var label = is.level + ' ' + is.name + ' · ' + STATUS_TXT[is.status];
      var spos = 'left:' + is.x + '%;top:' + is.y + '%';
      var hasAnchor = typeof is.px === 'number' && typeof is.py === 'number';
      var ppos = hasAnchor ? 'left:' + is.px + '%;top:' + is.py + '%' : spos;
      var side = hasAnchor ? 'anchor' : is.plate;
      var sub = String(is.sub || '').split('\n').map(escHtml).join('<br>');
      return '' +
        '<button type="button" class="xm-station is-' + is.status + '" style="' + spos + '" data-level="' + is.level + '" aria-label="' + escHtml(label) + '">' +
          '<span class="xm-pad"></span>' +
          (is.status === 'current' ? '<span class="xm-pulse"></span><span class="xm-pulse d2"></span>' : '') +
        '</button>' +
        '<button type="button" class="xm-plate is-' + is.status + ' side-' + side + '" style="' + ppos + '" data-level="' + is.level + '" tabindex="-1" aria-hidden="true">' +
          '<span class="xm-plate-ico">' + (is.status === 'locked' ? ICON.lock : ICON.check) + '</span>' +
          '<span class="xm-plate-txt"><b' + (is.accent ? ' style="color:' + escHtml(is.accent) + '"' : '') + '>' +
            '<em>' + is.level + '</em> ' + escHtml(is.name) + '</b><i lang="ja">' + sub + '</i></span>' +
        '</button>';
    }).join('') +
    '<div class="xm-traveler" style="left:' + m.current.x + '%;top:' + m.current.y + '%" aria-hidden="true">' +
      '<span class="xm-traveler-shadow"></span><span class="xm-traveler-body">' + TRAVELER_SVG + '</span>' +
    '</div>';
  }

  /* 氛围层：海面闪光、滑翔海鸥、飘过的薄云（减少动态时由 CSS 隐藏） */
  function ambienceHtml() {
    var A = C().ambience || {};
    var GULL = '<svg viewBox="0 0 40 16"><path d="M1 9c6-6 12-6 19 2 7-8 13-8 19-2-6-2-12-1-19 5C13 8 7 7 1 9z" fill="#fff"/></svg>';
    var h = '<div class="xm-life" aria-hidden="true">';
    (A.sparkles || []).forEach(function (p, i) {
      h += '<span class="xm-spark" style="left:' + p[0] + '%;top:' + p[1] + '%;animation-delay:' + (-(i * 0.73) % 4).toFixed(2) + 's"></span>';
    });
    (A.gulls || []).forEach(function (g) {
      h += '<span class="xm-gull" style="top:' + g.y + '%;animation-duration:' + g.dur + 's;animation-delay:' + g.delay + 's;--s:' + (g.size || 1) + '"><span>' + GULL + '</span></span>';
    });
    if (A.clouds) h += '<span class="xm-cloud c1"></span><span class="xm-cloud c2"></span>';
    return h + '</div>';
  }

  function courseHtml(m) {
    return '<button type="button" class="xm-glass xm-course" id="xm-course" aria-label="继续当前课程">' +
      '<span class="xm-course-petal">' + ICON.petal + '</span>' +
      '<span class="xm-course-txt"><i>当前课程</i><b>第 ' + m.lesson.no + ' 课</b><em lang="ja">' + escHtml(m.lesson.title) + '</em></span>' +
      '<span class="xm-course-book">' + ICON.book + '</span>' +
      '<span class="xm-chev">' + ICON.chevron + '</span>' +
    '</button>';
  }

  function dockHtml(m) {
    var c = m.current;
    var pct = c.lessonsTotal > 0 ? Math.min(1, c.lessonsDone / c.lessonsTotal) : 0;
    return '<div class="xm-dock xm-glass">' +
      '<button type="button" class="xm-dock-main" id="xm-dock-main" aria-label="' + escHtml(c.level + ' ' + c.name + ' 进度') + '">' +
        '<span class="xm-dock-scroll">' + ICON.scroll + '</span>' +
        '<span class="xm-dock-body">' +
          '<span class="xm-dock-row"><b>' + c.level + ' ' + escHtml(c.name) + '</b>' +
            '<span class="xm-dock-count"><b>' + c.lessonsDone + '</b> / ' + c.lessonsTotal + ' 课</span></span>' +
          '<span class="xm-bar"><span class="xm-bar-fill" style="width:' + Math.round(pct * 100) + '%"></span></span>' +
        '</span>' +
      '</button>' +
      '<span class="xm-dock-sep"></span>' +
      '<a class="xm-dock-xp" href="#/me" aria-label="经验值">' + ICON.gem + '<b>' + m.xp + '</b><small>XP</small>' +
        '<span class="xm-chev">' + ICON.chevron + '</span></a>' +
    '</div>';
  }

  /* ---------------- 踏石虚线（SVG，按像素重画以保证虚线不变形） ---------------- */
  function drawPath(root, m) {
    var map = root.querySelector('.xm-map');
    var svg = root.querySelector('.xm-path');
    if (!map || !svg) return;
    if (!C().showPath) { svg.innerHTML = ''; return; }
    var W = map.clientWidth, H = map.clientHeight;
    if (!W || !H) return;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var pts = m.islands.map(function (is) { return [is.x / 100 * W, is.y / 100 * H]; });
    function seg(a, b) {
      // 竖向 S 形贝塞尔：控制点沿 y 方向拉开
      var dy = (b[1] - a[1]) * 0.5;
      return 'C' + a[0].toFixed(1) + ' ' + (a[1] + dy).toFixed(1) + ',' + b[0].toFixed(1) + ' ' + (b[1] - dy).toFixed(1) + ',' + b[0].toFixed(1) + ' ' + b[1].toFixed(1);
    }
    var curIdx = m.islands.indexOf(m.current);
    var all = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    var walked = all;
    for (var i = 1; i < pts.length; i++) {
      var s = seg(pts[i - 1], pts[i]);
      all += s;
      if (i <= curIdx) walked += s;
    }
    svg.innerHTML =
      '<path class="xm-path-glow" d="' + all + '"/>' +
      '<path class="xm-path-stones" d="' + all + '"/>' +
      (curIdx > 0 ? '<path class="xm-path-walked" d="' + walked + '"/>' : '');
  }

  /* ---------------- 交互 ---------------- */
  function shake(el) {
    el.classList.remove('xm-shake');
    void el.offsetWidth;
    el.classList.add('xm-shake');
    setTimeout(function () { el.classList.remove('xm-shake'); }, 600);
  }

  function prevIsland(m, is) {
    var i = m.islands.indexOf(is);
    return i > 0 ? m.islands[i - 1] : null;
  }

  /* 进入该岛的学习：复用书架的 StudyCtx + startStudyFlow（app.js renderStudy 识别 autoStart） */
  function goStudy(is) {
    buzz(10);
    if (typeof global.StudyCtx === 'object' && global.StudyCtx) {
      global.StudyCtx.bookId = is.bookId;
      global.StudyCtx.bookName = is.bookName;
      global.StudyCtx.order = 'seq';
      global.StudyCtx.autoStart = true;
    }
    location.hash = '#/study';
  }

  function onStationTap(root, m, level) {
    var is = null;
    m.islands.forEach(function (x) { if (x.level === level) is = x; });
    if (!is) return;
    if (is.status === 'locked') {
      root.querySelectorAll('[data-level="' + level + '"]').forEach(shake);
      buzz([12, 40, 12]);
      var p = prevIsland(m, is);
      say('「' + is.name + '」尚未解锁' + (p ? '，先把 ' + p.level + ' ' + p.name + ' 推进到 ' + Math.round(C().unlockThreshold * 100) + '% 吧' : ''));
      return;
    }
    goStudy(is);
  }

  function scrollToCurrent(root, m, smooth) {
    var map = root.querySelector('.xm-map');
    if (!map) return;
    var rect = map.getBoundingClientRect();
    var y = rect.top + (global.scrollY || global.pageYOffset || 0) + rect.height * m.current.y / 100;
    var top = Math.max(0, y - global.innerHeight * 0.56);
    try { global.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'auto' }); }
    catch (e) { global.scrollTo(0, top); }
  }

  /* ---------------- 主渲染 ---------------- */
  function renderExploreMap() {
    var cfg = C();
    var host = global.app || document.getElementById('app');
    if (!cfg || !host) return;
    var seq = ++renderSeq;

    // 先画背景地图（不等接口），叠层在数据回来后补上
    var bg = cfg.background;
    host.innerHTML =
      '<div class="xm" id="xm-root" style="--xm-sky:' + bg.skyColor + ';--xm-deep:' + bg.deepColor + ';--xm-min-top:' + (bg.minTop || 0) + 'px">' +
        '<div class="xm-sky" aria-hidden="true"' + (bg.sky ? ' style="background-image:url(\'' + escHtml(bg.sky) + '\')"' : '') + '></div>' +
        '<div class="xm-map">' + tilesHtml() +
          (reduceMotion() ? '' : ambienceHtml()) +
          '<svg class="xm-path" aria-hidden="true"></svg>' +
          '<div class="xm-layer" id="xm-layer"></div>' +
        '</div>' +
        '<div class="xm-scrim-top"></div>' +
        '<div class="xm-fixed" id="xm-fixed"></div>' +
      '</div>';
    var root = host.querySelector('#xm-root');

    var getApi = typeof global.api === 'function' ? global.api : function () { return Promise.reject(new Error('no api')); };
    Promise.all([
      getApi('/home/summary').catch(function () { return null; }),
      getApi('/books').catch(function () { return null; })
    ]).then(function (res) {
      // 用户已离开探索页 / 重复渲染：放弃
      if (seq !== renderSeq || !document.body.contains(root)) return;
      var m = buildModel(res[0], res[1]);
      root.setAttribute('data-source', m.source);
      root.querySelector('#xm-layer').innerHTML = overlaysHtml(m);
      root.querySelector('#xm-fixed').innerHTML = hudHtml(m) + courseHtml(m) + dockHtml(m);

      drawPath(root, m);
      var onResize = function () {
        if (!document.body.contains(root)) { global.removeEventListener('resize', onResize); return; }
        drawPath(root, m);
      };
      global.addEventListener('resize', onResize);

      root.querySelectorAll('.xm-station, .xm-plate').forEach(function (el) {
        el.addEventListener('click', function () { onStationTap(root, m, el.getAttribute('data-level')); });
      });
      root.querySelector('#xm-course').addEventListener('click', function () { goStudy(m.current); });
      root.querySelector('#xm-dock-main').addEventListener('click', function () { location.hash = '#/study'; });

      // 自动滚动到当前岛（首帧瞬移，避免先看到顶部再滑下来）
      requestAnimationFrame(function () { scrollToCurrent(root, m, false); });
      if (!reduceMotion() && typeof global.startAmbientPetals === 'function') global.startAmbientPetals();
    });
  }

  global.renderExploreMap = renderExploreMap;
  global.ExploreMap = { render: renderExploreMap, buildModel: buildModel };
})(window);
