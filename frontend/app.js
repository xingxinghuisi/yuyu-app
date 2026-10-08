/* ============================================================
   语屿 Kotoba · app.js
   纯原生 JS（无构建）。分段组织：
     0. 基础工具        1. 主题切换       2. 樱花粒子
     3. 日语 TTS        4. API 封装       5. 路由
     6. 页面：登录      7. 页面：首页     8. 页面：学习（含书架/斩词分流）
     8b. 随堂小测      9. 页面：复习    10. 页面：模考   11. 页面：统计
    12. 页面：我的
   ============================================================ */
'use strict';

/* ================= 0. 基础工具 ================= */

var $ = function (sel, el) { return (el || document).querySelector(sel); };
var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

/* HTML 转义（防 XSS） */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* furigana 记号解析：{漢字|読み} -> <ruby>漢字<rt>読み</rt></ruby> */
function furiganaToRuby(text) {
  if (!text) return '';
  return esc(text).replace(/\{([^}|]+)\|([^}]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>');
}

/* 词面：kanji 优先，无 kanji 显示 kana */
function wordFace(w) { return w.kanji || w.kana; }

/* 带注音的词面 HTML */
function wordFaceRuby(w) {
  if (w.kanji) return '<ruby>' + esc(w.kanji) + '<rt>' + esc(w.kana) + '</rt></ruby>';
  return esc(w.kana);
}

/* 数组洗牌 */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* 轻提示 */
var toastTimer = null;
function toast(msg, ms) {
  var el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 2200);
}

/* 二次确认弹窗 -> Promise<boolean> */
function confirmModal(title, desc, okText) {
  return new Promise(function (resolve) {
    var m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-desc').textContent = desc;
    $('#modal-ok').textContent = okText || '确认';
    m.classList.remove('hidden');
    var done = function (v) {
      m.classList.add('hidden');
      $('#modal-ok').onclick = $('#modal-cancel').onclick = m.onclick = null;
      resolve(v);
    };
    $('#modal-ok').onclick = function () { done(true); };
    $('#modal-cancel').onclick = function () { done(false); };
    m.onclick = function (e) { if (e.target === m) done(false); };
  });
}

/* 全局 SVG 渐变定义（进度环 / 火焰 / 完成页复用，注入一次） */
function injectSvgDefs() {
  if ($('#svg-defs-global')) return;
  var div = document.createElement('div');
  div.className = 'svg-defs';
  div.id = 'svg-defs-global';
  div.innerHTML =
    '<svg width="0" height="0" aria-hidden="true"><defs>' +
    '<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#E03E2D"/><stop offset="1" stop-color="#B3271B"/></linearGradient>' +
    '<linearGradient id="flameGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#FFB03A"/><stop offset="1" stop-color="#E03E2D"/></linearGradient>' +
    '</defs></svg>';
  document.body.appendChild(div);
}

/* 火焰 SVG（streak 数字旁，CSS/SVG 绘制，非 emoji） */
var FLAME_SVG = '<svg class="flame" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 23c-4.97 0-9-3.58-9-8 0-2.52 1.34-4.9 2.83-6.5.3-.33.62-.63.92-.92C8.5 5.7 10 4 10 2c3 2 4.5 4.5 5 7 .5-1 1-2.5 1-4 2.5 2 5 5.5 5 10 0 4.42-4.03 8-9 8z"/></svg>';

/* 樱花 SVG（空状态 / 完成页插画，CSS+SVG 绘制） */
function sakuraArt(size) {
  var s = size || 110;
  var petals = '';
  for (var i = 0; i < 5; i++) {
    petals += '<ellipse cx="50" cy="30" rx="13" ry="19" transform="rotate(' + (i * 72) + ' 50 50)"/>';
  }
  return '<svg class="finish-sakura" width="' + s + '" height="' + s + '" viewBox="0 0 100 100" aria-hidden="true">' +
    '<g fill="#F6C9D4">' + petals + '</g>' +
    '<circle cx="50" cy="50" r="7" fill="#E03E2D"/>' +
    '<circle cx="50" cy="50" r="3" fill="#C6A15B"/></svg>';
}

/* 喇叭 SVG */
var SPEAKER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>';

/* ================= 1. 主题切换 ================= */
var THEME_KEY = 'yuyu_theme';
function getTheme() { return localStorage.getItem(THEME_KEY) || 'auto'; }
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}
function initTheme() {
  applyTheme(getTheme());
  $('#theme-toggle').addEventListener('click', function () {
    var cur = getTheme();
    // light -> dark -> auto -> light 循环
    var next = cur === 'light' ? 'dark' : (cur === 'dark' ? 'auto' : 'light');
    applyTheme(next);
    toast(next === 'auto' ? '已跟随系统外观' : (next === 'dark' ? '已切换深色模式' : '已切换浅色模式'));
  });
}

/* ================= 1b. 学习语言 ================= */
var LANG_KEY = 'yuyu_lang';
function userLang() { return localStorage.getItem(LANG_KEY) || 'zh'; }
/* 登录 / 启动 / 语言切换后，把后端 lang 同步到本地 */
function syncLang() {
  if (!getToken()) return;
  api('/auth/me').then(function (me) {
    if (me && (me.lang === 'zh' || me.lang === 'en')) localStorage.setItem(LANG_KEY, me.lang);
  }).catch(function () { /* 忽略同步失败 */ });
}
/* 机翻 badge：中文释义为机器翻译且当前语言为中文时，低调标注（诚实原则） */
function mtBadge(w) {
  if (w && w.zh_source === 'mt' && userLang() === 'zh' && !w.meaning_is_en_fallback) {
    return '<span class="badge-mt">机翻待校对</span>';
  }
  return '';
}

/* ================= 2. 樱花粒子 ================= */
/* 答对时全屏撒 24 片花瓣 */
function sakuraBurst(count) {
  var n = count || 24;
  var cv = $('#sakura-canvas');
  var ctx = cv.getContext('2d');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  var colors = ['#F6C9D4', '#F2A9BC', '#FBDCE4', '#EF8FA8'];
  var petals = [];
  for (var i = 0; i < n; i++) {
    petals.push({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * 0.35,
      w: 7 + Math.random() * 8,
      h: 5 + Math.random() * 6,
      vy: 1.6 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
      sway: 0.6 + Math.random() * 1.4,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.12,
      color: colors[i % colors.length]
    });
  }
  var start = performance.now();
  var DURATION = 3000;
  function frame(now) {
    var t = now - start;
    ctx.clearRect(0, 0, cv.width, cv.height);
    var alive = false;
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y += p.vy;
      p.x += Math.sin(t / 420 + p.phase) * p.sway;
      p.rot += p.vr;
      if (p.y < cv.height + 30) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - t / DURATION);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (alive && t < DURATION) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  }
  requestAnimationFrame(frame);
}

function vibrate(ms) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch (e) { /* 忽略不支持的环境 */ }
}

/* 答对庆祝：樱花 + 震动 */
function celebrate() {
  sakuraBurst(24);
  vibrate(30);
}

/* 登录页常驻缓飘樱花（与 sakuraBurst 共用全屏画布，低速低透明度） */
var ambientOn = false;
function startAmbientPetals() {
  if (ambientOn) return;
  ambientOn = true;
  var cv = $('#sakura-canvas');
  if (!cv) { ambientOn = false; return; }
  var ctx = cv.getContext('2d');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  var colors = ['#F6C9D4', '#F2A9BC', '#FBDCE4'];
  function mk(anyY) {
    return {
      x: Math.random() * cv.width,
      y: anyY ? Math.random() * cv.height : -20 - Math.random() * 40,
      s: 4 + Math.random() * 6,
      vy: 0.35 + Math.random() * 0.75,
      phase: Math.random() * Math.PI * 2,
      sway: 0.4 + Math.random() * 0.9,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.03,
      color: colors[(Math.random() * colors.length) | 0],
      alpha: 0.35 + Math.random() * 0.4
    };
  }
  var petals = [];
  for (var i = 0; i < 18; i++) petals.push(mk(true));
  var last = performance.now();
  function frame(now) {
    if (!ambientOn) return;
    var dt = Math.min(50, now - last); last = now;
    var k = dt / 16.7;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y += p.vy * k;
      p.x += Math.sin(now / 1600 + p.phase) * p.sway * k;
      p.rot += p.vr * k;
      if (p.y > cv.height + 24) petals[i] = p = mk(false);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function stopAmbientPetals() {
  ambientOn = false;
  var cv = $('#sakura-canvas');
  if (cv) { try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } catch (e) {} }
}

/* ================= 3. 日语 TTS ================= */
function speak(text) {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) { /* 忽略 */ }
}

/* ================= 4. API 封装 ================= */
var TOKEN_KEY = 'yuyu_token';
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('yuyu_username');
  location.hash = '#/login';
}

/* api(path, method, body)：同源 /api，自动带 token，401 跳登录 */
function api(path, method, body) {
  method = method || 'GET';
  var headers = { 'Content-Type': 'application/json' };
  var token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var opts = { method: method, headers: headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch('/api' + path, opts).then(function (res) {
    if (res.status === 401) { logout(); throw new Error('未登录或登录已过期'); }
    if (!res.ok) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        throw new Error(data.detail || data.message || ('请求失败(' + res.status + ')'));
      });
    }
    if (res.status === 204) return null;
    return res.json();
  });
}

/* ================= 5. 路由 ================= */
var app = $('#app');
var activeTimers = [];
function clearTimers() {
  activeTimers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
  activeTimers = [];
}
function later(fn, ms) {
  var t = setTimeout(fn, ms);
  activeTimers.push(t);
  return t;
}
function every(fn, ms) {
  var t = setInterval(fn, ms);
  activeTimers.push(t);
  return t;
}

/* 路由名（不含 #/ 前缀） */
function currentRoute() {
  var m = (location.hash || '').match(/^#\/([a-z]+)/);
  return m ? m[1] : null;
}

var routes = {}; // 下方各页面注册

function setChrome(route) {
  var authed = !!getToken();
  var inApp = authed && route !== 'login';
  $('#topbar').classList.toggle('hidden', !inApp);
  $('#tabbar').classList.toggle('hidden', !inApp);
  if (inApp) {
    $$('.tab').forEach(function (t) {
      var tabs = (t.getAttribute('data-tabs') || '').split(',');
      t.classList.toggle('active', tabs.indexOf(route) !== -1);
    });
  }
}

function navigate() {
  var r = currentRoute();
  var authed = !!getToken();
  if (!routes[r]) r = authed ? 'home' : 'login';       // 未知 hash -> 404 处理
  if (r !== 'login' && !authed) r = 'login';           // 未登录守卫
  if (r === 'login' && authed) r = 'home';            // 已登录不再看登录页
  if (currentRoute() !== r) { location.hash = '#/' + r; return; }
  clearTimers();
  stopAmbientPetals(); // 离开登录页即停止缓飘樱花
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  window.scrollTo(0, 0);
  setChrome(r);
  routes[r]();
}

function loadingHtml(text) {
  return '<div class="loading"><div class="spin"></div>' + esc(text || '加载中…') + '</div>';
}

/* ================= 6. 页面：登录 ================= */
function renderLogin() {
  app.innerHTML =
    '<div class="login-scape">' +
      '<div class="aurora" aria-hidden="true"></div>' +
      '<div class="login-wrap">' +
        '<div class="logo-hero">' +
          '<div class="logo-icon">屿</div>' +
          '<h1>语屿</h1>' +
          '<div class="slogan">每天十五分钟，筑一座日语之岛。</div>' +
        '</div>' +
        '<div class="glass auth-card" id="auth-card">' +
          '<div class="auth-tabs">' +
            '<button class="auth-tab active" data-mode="login">登录</button>' +
            '<button class="auth-tab" data-mode="register">注册</button>' +
          '</div>' +
          '<form id="auth-form" novalidate>' +
            '<div class="field" id="f-username">' +
              '<label for="in-username">用户名</label>' +
              '<input id="in-username" type="text" autocomplete="username" maxlength="20" placeholder="3-20 位字母 / 数字 / 下划线">' +
              '<div class="hint">仅支持字母、数字、下划线，3–20 位</div>' +
              '<div class="error hidden"></div>' +
            '</div>' +
            '<div class="field" id="f-password">' +
              '<label for="in-password">密码</label>' +
              '<input id="in-password" type="password" autocomplete="current-password" placeholder="至少 8 位，含字母和数字">' +
              '<div class="hint">至少 8 位，且同时包含字母和数字</div>' +
              '<div class="error hidden"></div>' +
            '</div>' +
            '<button type="submit" class="btn btn-primary" id="auth-submit">登录</button>' +
          '</form>' +
        '</div>' +
        '<div class="login-foot">KOTOBA · 和风日语背词</div>' +
      '</div>' +
    '</div>';

  startAmbientPetals();

  var mode = 'login';
  var tabs = $$('.auth-tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      mode = tab.getAttribute('data-mode');
      tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
      $('#auth-submit').textContent = mode === 'login' ? '登录' : '注册';
      $('#in-password').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    });
  });

  function setErr(fieldId, msg) {
    var f = $('#' + fieldId);
    var e = $('.error', f);
    if (msg) { e.textContent = msg; e.classList.remove('hidden'); f.classList.add('invalid'); }
    else { e.classList.add('hidden'); f.classList.remove('invalid'); }
    return !msg;
  }

  $('#auth-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = $('#in-username').value.trim();
    var password = $('#in-password').value;
    var ok = true;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      ok = setErr('f-username', '用户名需为 3–20 位字母、数字或下划线') && ok;
    } else setErr('f-username', '');
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) {
      ok = setErr('f-password', '密码至少 8 位，且需同时包含字母和数字') && ok;
    } else setErr('f-password', '');
    if (!ok) return;

    var btn = $('#auth-submit');
    btn.disabled = true;
    btn.textContent = mode === 'login' ? '登录中…' : '注册中…';
    api(mode === 'login' ? '/auth/login' : '/auth/register', 'POST', { username: username, password: password })
      .then(function (data) {
        localStorage.setItem(TOKEN_KEY, data.token || data.access_token);
        localStorage.setItem('yuyu_username', (data.user && data.user.username) || username);
        syncLang();
        if (mode === 'register') {
          // 注册成功：SVG 对勾描画 + 欢迎语，1.2s 后自动进首页
          $('#auth-card').innerHTML =
            '<div class="auth-success">' +
              '<svg class="check-draw" viewBox="0 0 72 72" aria-hidden="true">' +
                '<circle class="ck-circle" cx="36" cy="36" r="32"/>' +
                '<path class="ck-path" d="M23 37.5l9 9 17-20"/>' +
              '</svg>' +
              '<h3>欢迎来到语屿！</h3>' +
              '<p>正在为你铺好第一块砖…</p>' +
            '</div>';
          vibrate(30);
          sakuraBurst(30);
          setTimeout(function () { location.hash = '#/home'; }, 1200);
        } else {
          // 登录成功：按钮变对勾 + 涟漪扩散，短暂停留后进首页
          btn.classList.add('btn-success');
          btn.innerHTML = '<svg class="check-mini" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M4 12.5l5 5L20 6.5"/></svg> 登录成功';
          vibrate(30);
          setTimeout(function () { location.hash = '#/home'; }, 800);
        }
      })
      .catch(function (err) {
        var msg = err.message || '请求失败，请检查网络与后端服务';
        if (mode === 'login' && msg === '未登录或登录已过期') msg = '用户名或密码错误';
        toast(msg);
        var card = $('#auth-card');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        btn.disabled = false;
        btn.textContent = mode === 'login' ? '登录' : '注册';
      });
  });
}
routes['login'] = renderLogin;

/* ================= 7. 页面：首页 ================= */
function greeting() {
  var h = new Date().getHours();
  if (h >= 5 && h < 12) return '上午好';
  if (h >= 12 && h < 18) return '下午好';
  return '晚上好';
}

function renderHome() {
  app.innerHTML = loadingHtml('正在眺望你的岛屿…');
  api('/home/summary').then(function (d) {
    var username = d.username || localStorage.getItem('yuyu_username') || '';
    var learned = d.today_learned || 0;
    var goal = d.daily_goal || 30;
    var due = d.review_due || 0;
    var streak = d.streak || 0;
    var checked = !!d.checked_in_today;
    var pct = Math.min(1, goal > 0 ? learned / goal : 0);
    var C = 2 * Math.PI * 48;

    app.innerHTML =
      '<div class="greet"><h2>' + esc(greeting()) + '，' + esc(username) + '</h2>' +
      '<p>今天也要为小岛添一块砖。</p></div>' +

      '<div class="glass progress-ring-card">' +
        '<div class="ring-wrap">' +
          '<svg width="110" height="110" viewBox="0 0 110 110">' +
            '<circle class="ring-bg" cx="55" cy="55" r="48" fill="none" stroke-width="10"/>' +
            '<circle class="ring-fg" cx="55" cy="55" r="48" fill="none" stroke-width="10" ' +
              'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"/>' +
          '</svg>' +
          '<div class="ring-center"><b>' + learned + '</b><span>/ ' + goal + ' 今日已学</span></div>' +
        '</div>' +
        '<div><h3>今日进度</h3><p class="muted" style="font-size:13px;margin:6px 0 0">每天十五分钟，<br>筑一座日语之岛。</p></div>' +
      '</div>' +

      '<div class="task-grid">' +
        '<div class="glass task-card" id="go-study">' +
          '<div class="num">' + learned + '<span class="muted" style="font-size:14px">/' + goal + '</span></div>' +
          '<div class="label">新词</div><div class="go">去学习 →</div>' +
        '</div>' +
        '<div class="glass task-card" id="go-review">' +
          '<div class="num">' + due + '</div>' +
          '<div class="label">待复习</div><div class="go">去复习 →</div>' +
        '</div>' +
      '</div>' +

      '<div class="glass checkin-card">' +
        '<div class="streak">' + FLAME_SVG + '<b>' + streak + '</b><span>天连续打卡</span></div>' +
        (checked
          ? '<button class="btn btn-ghost" disabled style="width:100%">今日已打卡</button>'
          : '<button class="btn btn-primary" id="btn-checkin">打卡今日学习</button>') +
      '</div>';

    // 进度环动画
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var fg = $('.ring-fg');
        if (fg) fg.style.strokeDashoffset = (C * (1 - pct)).toFixed(1);
      });
    });

    $('#go-study').addEventListener('click', function () { location.hash = '#/study'; });
    $('#go-review').addEventListener('click', function () { location.hash = '#/review'; });
    var cb = $('#btn-checkin');
    if (cb) cb.addEventListener('click', function () {
      cb.disabled = true; cb.textContent = '打卡中…';
      api('/checkin', 'POST').then(function (r) {
        celebrate();
        toast('打卡成功，连续 ' + (r.streak != null ? r.streak : streak + 1) + ' 天');
        renderHome();
      }).catch(function (err) {
        toast(err.message || '打卡失败');
        cb.disabled = false; cb.textContent = '打卡今日学习';
      });
    });
  }).catch(function (err) {
    app.innerHTML = '<div class="loading">加载失败：' + esc(err.message) +
      '<br><br><button class="btn btn-ghost" onclick="location.reload()">重试</button></div>';
  });
}
routes['home'] = renderHome;

/* ================= 8. 页面：学习 ================= */
/* v0.3: 零输入题型 —— 砍掉 spelling 打字题；listening 改为听音选义 */
var STUDY_TYPES = ['choice_ja', 'choice_zh', 'listening'];
var TYPE_LABEL = {
  choice_ja: '看词选义',
  choice_zh: '看义选词',
  listening: '听音选义'
};

var ST = null; // 学习会话状态

/* 书架：学习方式上下文（选书弹窗写入，plan 调用使用；默认 N5/seq） */
var StudyCtx = { level: 'N5', order: 'seq' };
var SHELF_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

/* #/study 入口：书架 */
function renderStudy() {
  app.innerHTML = loadingHtml('正在取书…');
  api('/books').then(function (books) {
    renderShelf(Array.isArray(books) ? books : []);
  }).catch(function () {
    renderShelf(null); // 接口不可用时优雅降级：仍可按级别进入学习
  });
}

/* 书架渲染：N5–N1 竖排玻璃书脊卡片（level、x/总数、进度条） */
function renderShelf(books) {
  var byLevel = {};
  (books || []).forEach(function (b) { if (b && b.level) byLevel[b.level] = b; });
  var hasData = !!books;
  var cards = SHELF_LEVELS.map(function (lv) {
    var b = byLevel[lv] || {};
    var pct = 0;
    if (typeof b.progress === 'number') pct = b.progress;
    else if (b.total > 0) pct = (b.studied || 0) / b.total;
    pct = Math.max(0, Math.min(1, pct));
    var countTxt = hasData
      ? ((b.studied != null ? b.studied : 0) + ' / ' + (b.total != null ? b.total : '—'))
      : '— / —';
    return '<button class="book glass' + (StudyCtx.level === lv ? ' current' : '') + '" data-lv="' + lv + '">' +
      '<span class="book-lv">' + lv + '</span>' +
      '<span class="book-count">' + esc(countTxt) + '</span>' +
      '<span class="vbar"><i style="height:' + Math.round(pct * 100) + '%"></i></span>' +
      '<span class="book-pct">' + Math.round(pct * 100) + '%</span>' +
    '</button>';
  }).join('');

  app.innerHTML =
    '<h2 class="page-title">书架</h2>' +
    '<p class="page-sub">选一本书，开始今日的筑岛之旅。</p>' +
    '<div class="shelf">' + cards + '</div>' +
    '<div class="shelf-note muted">顺序学习按假名稳步推进 · 打乱顺序随机出词</div>';

  if (!hasData) toast('书架数据暂不可用，可直接选书开始');
  $$('.book').forEach(function (el) {
    el.addEventListener('click', function () {
      var lv = el.getAttribute('data-lv');
      vibrate(10);
      chooseOrder(lv).then(function (order) {
        if (!order) return;
        StudyCtx.level = lv;
        StudyCtx.order = order;
        startStudyFlow();
      });
    });
  });
}

/* 选书弹窗：[顺序学习] [打乱顺序] */
function chooseOrder(lv) {
  return new Promise(function (resolve) {
    var m = $('#modal');
    var acts = $('.modal-actions');
    var orig = acts.innerHTML; // 恢复 confirmModal 的默认按钮
    $('#modal-title').textContent = lv + ' · 怎么学？';
    $('#modal-desc').textContent = '顺序学习按假名顺序稳步推进；打乱顺序随机出词，更具挑战。';
    acts.innerHTML = '<button class="btn btn-indigo" id="m-seq">顺序学习</button>' +
      '<button class="btn btn-primary" id="m-shuffle">打乱顺序</button>';
    m.classList.remove('hidden');
    var done = function (v) {
      m.classList.add('hidden');
      acts.innerHTML = orig;
      $('#modal-ok').onclick = $('#modal-cancel').onclick = m.onclick = null;
      resolve(v);
    };
    $('#m-seq').onclick = function () { done('seq'); };
    $('#m-shuffle').onclick = function () { done('shuffle'); };
    m.onclick = function (e) { if (e.target === m) done(null); };
  });
}

/* 按 StudyCtx 拉取学习计划，进入背词流 */
function startStudyFlow() {
  app.innerHTML = loadingHtml('正在准备今日新词…');
  api('/study/plan', 'POST', { level: StudyCtx.level, order: StudyCtx.order }).then(function (d) {
    var words = d.words || [];
    if (!words.length) {
      app.innerHTML = '<div class="empty-state">' + sakuraArt(110) +
        '<h3>' + esc(StudyCtx.level) + ' 今日新词已学完</h3><p>换本书看看，或去复习巩固一下吧。</p>' +
        '<br><a href="#/review" class="btn btn-primary" style="text-decoration:none">去复习</a>' +
        '<div style="height:10px"></div>' +
        '<button class="btn btn-ghost" id="back-shelf">返回书架</button></div>';
      $('#back-shelf').addEventListener('click', renderStudy);
      return;
    }
    ST = {
      words: words,
      idx: 0,
      typeIdx: 0,
      phase: 'question', // question -> example -> next
      answered: false,
      correct: false,
      goal: d.daily_goal || 30,
      baseLearned: d.today_learned || 0,
      peer: true,  // 斩词分流：每词先过"认识吗"预检
      counted: 0,  // 本轮已产生 grade 的新词数
      batch: []    // 当前待小测的词 id
    };
    renderStudyWord();
  }).catch(function (err) {
    app.innerHTML = '<div class="loading">加载失败：' + esc(err.message) +
      '<br><br><button class="btn btn-ghost" onclick="location.hash=\'#/home\'">返回首页</button></div>';
  });
}

/* 背词流进度条（背词 / 斩词预检共用） */
function studyProgressHtml(extra) {
  return '<div class="quiz-progress"><div class="bar"><i style="width:' +
    Math.round(ST.idx / ST.words.length * 100) + '%"></i></div>' +
    '<div class="txt">' + (ST.idx + 1) + ' / ' + ST.words.length + (extra ? ' · ' + extra : '') + '</div></div>';
}

/* 斩词分流 v0.3：展示卡片 → 心里回想 → 点"翻卡" → 三档自评（认识/模糊/不认识）。
   认识 = grade 5 (FSRS Easy) 直接毕业；模糊/不认识 → 进入题型学习（由题目作答产生 grade）。 */
function renderPeerCard() {
  var w = ST.words[ST.idx];
  ST.peerFlipped = false;
  ST.peerDone = false;
  app.innerHTML = studyProgressHtml('斩词预检') +
    '<div id="word-card-zone">' + wordCardHtml(w, false) + '</div>' +
    '<div class="glass peer-ask" id="peer-ask">' +
      '<div class="peer-q">在心里回想它的意思</div>' +
      '<div class="peer-btns"><button class="btn btn-primary" id="peer-flip">翻卡看看</button></div>' +
    '</div>';
  bindWordCard(w, 'peer');

  $('#peer-flip').addEventListener('click', function () {
    if (ST.peerFlipped) return;
    ST.peerFlipped = true;
    $('#word-card-zone').innerHTML = wordCardHtml(w, true); // 揭晓释义
    bindWordCard(w, 'peer');
    $('#peer-ask').innerHTML =
      '<div class="peer-q">回想起来了吗？</div>' +
      '<div class="peer-btns three">' +
        '<button class="btn btn-primary" id="peer-know">认识</button>' +
        '<button class="btn btn-ghost" id="peer-fuzzy">模糊</button>' +
        '<button class="btn btn-ghost" id="peer-unknown">不认识</button>' +
      '</div>';
    $('#peer-know').addEventListener('click', function () {
      if (ST.peerDone) return; ST.peerDone = true;
      peerGraduate(w);
    });
    $('#peer-fuzzy').addEventListener('click', peerEnterLearn);
    $('#peer-unknown').addEventListener('click', peerEnterLearn);
  });
}

/* 认识：直接毕业 */
function peerGraduate(w) {
  api('/study/answer', 'POST', { word_id: w.id, grade: 5 }).catch(function () { /* 离线也继续 */ });
  sakuraBurst(18);
  vibrate(25);
  toast('斩！');
  ST.counted++;
  ST.batch.push(w.id);
  later(function () {
    ST.idx++; ST.typeIdx++; ST.peer = true;
    if (maybeMiniQuiz()) return;
    renderStudyWord();
  }, 500);
}

/* 模糊 / 不认识：进入题型学习 */
function peerEnterLearn() {
  ST.peer = false;
  renderStudyWord();
}

/* 每累计学完 5 个新词（grade 参与过即算），自动弹 3 题快闪小测（v0.3） */
function maybeMiniQuiz() {
  if (ST.counted > 0 && ST.counted % 5 === 0 && ST.batch.length) {
    var ids = ST.batch.slice();
    ST.batch = [];
    startMiniQuiz(ids);
    return true;
  }
  return false;
}

/* 从词池中为当前词挑选 n 个干扰项 */
function distractors(pool, word, n, kind) {
  var others = shuffle(pool.filter(function (w) { return w.id !== word.id; }));
  var out = [];
  var seen = {};
  function keyOf(w) { return kind === 'meaning' ? w.display_meaning : wordFace(w); }
  seen[keyOf(word)] = true;
  for (var i = 0; i < others.length && out.length < n; i++) {
    var k = keyOf(others[i]);
    if (!seen[k]) { seen[k] = true; out.push(others[i]); }
  }
  return out;
}

/* 单词大卡（不含释义，供答题前展示） */
function wordCardHtml(w, showMeaning) {
  var badge = (showMeaning && w.meaning_is_en_fallback)
    ? '<span class="badge-en">英文暂代</span>' : '';
  return '<div class="glass word-card" id="word-card">' +
    (w.pos ? '<div><span class="word-pos">' + esc(w.pos) + '</span></div>' : '') +
    '<div class="word-kanji">' + wordFaceRuby(w) + '</div>' +
    (w.romaji ? '<div class="word-romaji">' + esc(w.romaji) + '</div>' : '') +
    (showMeaning
      ? '<div style="margin-top:12px;font-size:17px">' + esc(w.display_meaning) + badge + mtBadge(w) + '</div>'
      : '') +
    '<div><button class="speaker-btn" id="btn-speak" aria-label="朗读">' + SPEAKER_SVG + '</button></div>' +
  '</div>';
}

/* 答题前遮罩卡：看义选词 / 听发音选词时先隐藏单词，凭记忆作答 */
var EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M17.94 17.94A10.5 10.5 0 0 1 12 19.5c-5 0-9.27-3-11-7.5a17.6 17.6 0 0 1 4.06-4.94M9.9 4.24A10.5 10.5 0 0 1 12 4.5c5 0 9.27 3 11 7.5a17.7 17.7 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><path d="M2 2l20 20"/></svg>';
function maskedCardHtml() {
  return '<div class="glass word-mask" id="word-card">' +
    '<div class="mask-icon">' + EYE_OFF_SVG + '</div>' +
    '<p>凭记忆作答<br>答完后揭晓单词</p>' +
  '</div>';
}

/* 例句区 */
function exampleHtml(w) {
  var ex = (w.examples && w.examples[0]) || null;
  if (!ex) return '';
  // 展示语言由后端按用户 lang 算好（display_sentence），前端不再做语言判断
  var sent = ex.display_sentence || ex.zh || ex.en || '';
  return '<div class="glass example-box">' +
    '<div class="ex-label">例句 EXAMPLE</div>' +
    '<div class="ex-ja">' + furiganaToRuby(ex.furigana || ex.ja) + '</div>' +
    '<div class="ex-zh">' + esc(sent) + '</div>' +
  '</div>';
}

/* 题目区 HTML（study 与 quiz 复用）
   v0.3: 看词选义 / 听音选义 → 4 个中文释义选项；看义选词 → 4 个单词选项；无打字题 */
function questionHtml(type, w, pool, q) {
  if (type === 'choice_ja' || type === 'listening') {
    var opts = distractors(pool, w, 3, 'meaning');
    var items = shuffle([{ w: w, ok: true }].concat(opts.map(function (o) { return { w: o, ok: false }; })));
    var stem = type === 'listening'
      ? '<div class="question-stem" style="text-align:center">听发音，选出正确的意思<br>' +
        '<button class="speaker-btn" id="btn-replay" aria-label="重播发音">' + SPEAKER_SVG + '</button></div>'
      : '<div class="question-stem muted">' + TYPE_LABEL[type] + '</div>';
    return stem + '<div class="options">' + items.map(function (it) {
      return '<button class="option glass" data-ok="' + (it.ok ? 1 : 0) + '">' + esc(it.w.display_meaning) + '</button>';
    }).join('') + '</div>';
  }
  if (type === 'choice_zh') {
    var opts2 = distractors(pool, w, 3, 'word');
    var items2 = shuffle([{ w: w, ok: true }].concat(opts2.map(function (o) { return { w: o, ok: false }; })));
    var head = '<div class="question-stem jp" style="font-size:19px;text-align:center">「' + esc(w.display_meaning) + '」</div>';
    return head + '<div class="options">' + items2.map(function (it) {
      return '<button class="option glass" data-ok="' + (it.ok ? 1 : 0) + '"><span class="jp">' +
        esc(wordFace(it.w)) + '</span>' +
        (it.w.kana && it.w.kanji ? ' <span class="muted" style="font-size:13px">' + esc(it.w.kana) + '</span>' : '') +
        '</button>';
    }).join('') + '</div>';
  }
  return '';
}

function renderStudyWord() {
  var w = ST.words[ST.idx];
  if (!w) { renderStudyDone(); return; }
  if (ST.peer) { renderPeerCard(); return; } // 斩词分流：先过"认识吗"预检
  var type = STUDY_TYPES[ST.typeIdx % STUDY_TYPES.length];
  ST.type = type; ST.answered = false; ST.correct = false; ST.phase = 'question';

  var progress = studyProgressHtml(TYPE_LABEL[type]);

  // 看义选词 / 听发音选词：答题前隐藏单词卡，凭记忆作答
  var hideWord = (type === 'choice_zh' || type === 'listening');

  app.innerHTML = progress +
    '<div id="word-card-zone">' + (hideWord ? maskedCardHtml() : wordCardHtml(w, false)) + '</div>' +
    '<div id="q-zone">' + questionHtml(type, w, ST.words) + '</div>' +
    '<div id="fb-zone"></div>' +
    '<div id="ex-zone" class="hidden">' + exampleHtml(w) +
      '<div style="margin-top:16px"><button class="btn btn-primary next-btn" id="btn-next">' +
      (ST.idx === ST.words.length - 1 ? '完成今日学习' : '下一个') + '</button></div>' +
      '<div style="margin-top:10px"><button class="btn btn-ghost" id="btn-detail" style="width:100%">查看详解 · 音形义用记</button></div>' +
    '</div>';

  bindWordCard(w, type);
  bindQuestion(w, type, false);
}

function bindWordCard(w, type) {
  var b = $('#btn-speak');
  if (b) b.addEventListener('click', function () {
    b.classList.add('playing');
    speak(w.kana);
    setTimeout(function () { b.classList.remove('playing'); }, 1200);
  });
  var rp = $('#btn-replay');
  if (rp) rp.addEventListener('click', function () { speak(w.kana); });
  if (type === 'listening') later(function () { speak(w.kana); }, 600); // 自动朗读
}

/* 作答绑定；isQuiz 为 true 时走 quiz 流程（v0.3：纯选择题，无打字） */
function bindQuestion(w, type, isQuiz, qid) {
  $$('#q-zone .option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (ST && ST.answered && !isQuiz) return;
      if (isQuiz && QZ.answered) return;
      var good = btn.getAttribute('data-ok') === '1';
      if (isQuiz) gradeQuizChoice(qid, good, btn, w);
      else gradeStudyChoice(w, good, btn);
    });
  });
}

/* ---- study 作答 ---- */
function lockOptions() {
  $$('#q-zone .option').forEach(function (b) { b.disabled = true; });
}

function studyFeedback(ok, w) {
  ST.answered = true; ST.correct = ok;
  var grade = ok ? 5 : 2;
  api('/study/answer', 'POST', { word_id: w.id, grade: grade }).catch(function () { /* 离线也继续 */ });
  if (ok) {
    celebrate();
    toast('答对了');
  } else {
    var card = $('#word-card');
    if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
    $('#fb-zone').innerHTML = '<div class="answer-reveal">正确答案：<b class="jp">' +
      (ST.type === 'choice_ja' ? esc(w.display_meaning) : esc(wordFace(w)) + '（' + esc(w.kana) + '）') +
      '</b></div>';
  }
  $('#ex-zone').classList.remove('hidden');
  // 揭晓：单词卡补上释义（含之前被遮罩的情况）
  var zone = $('#word-card-zone');
  if (zone) {
    zone.innerHTML = wordCardHtml(w, true);
    var b = $('#btn-speak');
    if (b) b.addEventListener('click', function () { speak(w.kana); });
  }
  $('#btn-next').addEventListener('click', function () {
    ST.counted++;
    ST.batch.push(w.id);
    ST.idx++; ST.typeIdx++; ST.peer = true;
    if (maybeMiniQuiz()) return; // 每 5 词快闪小测
    renderStudyWord();
  });
  var db = $('#btn-detail');
  if (db) db.addEventListener('click', function () { openWordDetail(w.id); });
  var nz = $('#ex-zone');
  if (nz) nz.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function gradeStudyChoice(w, good, btn) {
  lockOptions();
  if (good) btn.classList.add('correct');
  else {
    btn.classList.add('wrong');
    var right = $('.option[data-ok="1"]', $('#q-zone'));
    if (right) right.classList.add('correct');
  }
  studyFeedback(good, w);
}

/* ================= 8b. 随堂小测（背词流每 5 词，简化版 quiz UI） ================= */
var MQ = null; // 随堂小测会话

/* quiz 题目题干 + 选项 HTML（模考 / 随堂小测复用） */
function quizQBody(q) {
  var type = q.type;
  var body = '';
  if (type === 'choice_ja') {
    var pw = q.prompt.word || '';
    body = '<div class="question-stem jp" style="font-size:24px;font-weight:700;text-align:center">' + esc(pw) + '</div>' +
      '<div class="options">' + (q.options || []).map(function (o, i) {
        return '<button class="option glass" data-i="' + i + '">' + esc(qOptText(o, 'meaning')) + '</button>';
      }).join('') + '</div>';
  } else if (type === 'choice_zh') {
    body = '<div class="question-stem" style="font-size:19px;text-align:center">「' + esc(q.prompt.meaning || '') + '」</div>' +
      '<div class="options">' + (q.options || []).map(function (o, i) {
        return '<button class="option glass" data-i="' + i + '"><span class="jp">' + esc(qOptText(o, 'word')) + '</span></button>';
      }).join('') + '</div>';
  } else if (type === 'listening') {
    // v0.3 听音选义：只听发音，从 4 个中文释义中选择
    body = '<div class="question-stem" style="text-align:center">听发音，选出正确的意思<br>' +
      '<button class="speaker-btn" id="btn-replay" aria-label="重播发音">' + SPEAKER_SVG + '</button></div>' +
      '<div class="options">' + (q.options || []).map(function (o, i) {
        return '<button class="option glass" data-i="' + i + '">' + esc(qOptText(o, 'meaning')) + '</button>';
      }).join('') + '</div>';
  }
  return body;
}

/* 用刚学的 5 个词出 3 题快闪小测（v0.3） */
function startMiniQuiz(wordIds) {
  app.innerHTML = loadingHtml('正在出 3 道小测题…');
  api('/quiz/start', 'POST', { word_ids: wordIds, count: 3 }).then(function (d) {
    var qs = d.questions || [];
    if (!qs.length) { toast('暂无小测题目，继续学习'); renderStudyWord(); return; }
    MQ = { questions: qs, idx: 0, answers: [], answered: false };
    renderMiniQ();
  }).catch(function (err) {
    toast(err.message || '小测加载失败，继续学习');
    renderStudyWord();
  });
}

function renderMiniQ() {
  var q = MQ.questions[MQ.idx];
  MQ.answered = false;
  var total = MQ.questions.length;
  app.innerHTML =
    '<div class="mini-quiz-head"><span class="mini-quiz-tag">随堂小测</span>' +
    '<div class="quiz-progress"><div class="bar"><i style="width:' + Math.round(MQ.idx / total * 100) + '%"></i></div>' +
    '<div class="txt">第 ' + (MQ.idx + 1) + ' / ' + total + ' 题 · ' + (TYPE_LABEL[q.type] || '') + '</div></div></div>' +
    quizQBody(q) +
    '<div id="fb-zone"></div>' +
    '<div id="q-next" class="hidden" style="margin-top:16px"><button class="btn btn-primary" id="btn-mq-next">' +
    (MQ.idx === total - 1 ? '交卷' : '下一题') + '</button></div>';
  bindMiniQ(q);
  $('#btn-mq-next').addEventListener('click', function () {
    if (MQ.idx === MQ.questions.length - 1) submitMiniQuiz();
    else { MQ.idx++; renderMiniQ(); }
  });
}

function bindMiniQ(q) {
  var type = q.type;
  var kana = q.prompt && q.prompt.kana;
  if (type === 'listening' && kana) later(function () { speak(kana); }, 500);
  var rp = $('#btn-replay');
  if (rp && kana) rp.addEventListener('click', function () { speak(kana); });
  $$('.option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (MQ.answered) return;
      MQ.answered = true;
      var i = parseInt(btn.getAttribute('data-i'), 10);
      MQ.answers.push({ qid: q.qid, answer: String((q.options || [])[i]) });
      btn.classList.add('selected');
      $$('.option').forEach(function (b) { b.disabled = true; });
      $('#q-next').classList.remove('hidden');
    });
  });
}

function submitMiniQuiz() {
  app.innerHTML = loadingHtml('正在批改小测…');
  api('/quiz/submit', 'POST', { qid_answers: MQ.answers }).then(function (r) {
    var score = r.score || 0;
    var total = r.total || MQ.questions.length;
    var wrongIds = r.wrong || [];
    // 错词回炉：逐个 POST /api/study/answer {grade: 0}
    var chain = Promise.resolve();
    wrongIds.forEach(function (wid) {
      chain = chain.then(function () {
        return api('/study/answer', 'POST', { word_id: wid, grade: 0 }).catch(function () {});
      });
    });
    chain.then(function () { renderMiniResult(score, total, wrongIds.length); });
  }).catch(function (err) {
    toast(err.message || '交卷失败，继续学习');
    renderStudyWord();
  });
}

function renderMiniResult(score, total, wrongCount) {
  if (score === total) celebrate(); else { sakuraBurst(12); vibrate(20); }
  app.innerHTML =
    '<div class="finish-wrap">' + sakuraArt(110) +
    '<h2>小测完成</h2>' +
    '<p style="font-size:18px;margin-bottom:10px">答对 <b style="color:var(--vermilion);font-size:30px">' + score + '</b> / ' + total + ' 题</p>' +
    (wrongCount
      ? '<p>答错的 ' + wrongCount + ' 个词已回炉，记得去复习巩固。</p>'
      : '<p>全部答对，完美通关！</p>') +
    '<button class="btn btn-primary" id="btn-mq-continue">继续学习</button></div>';
  $('#btn-mq-continue').addEventListener('click', function () { renderStudyWord(); });
}

function renderStudyDone() {
  celebrate();
  var goal = (ST && ST.goal) || 30;
  app.innerHTML = '<div class="finish-wrap">' + sakuraArt(120) +
    '<h2>今日 ' + goal + ' 词已学完</h2>' +
    '<p>小岛又长高了一点。去复习巩固一下吧。</p>' +
    '<a href="#/review" class="btn btn-primary" style="text-decoration:none;display:block">去复习</a>' +
    '<div style="height:12px"></div>' +
    '<button class="btn btn-ghost" id="done-shelf" style="width:100%">返回书架</button>' +
    '<div style="height:10px"></div>' +
    '<a href="#/home" class="btn btn-ghost" style="text-decoration:none;display:block">返回首页</a></div>';
  $('#done-shelf').addEventListener('click', renderStudy);
}
routes['study'] = renderStudy;

/* ================= 9. 页面：复习 ================= */
var RV = null;

function renderReview() {
  app.innerHTML = loadingHtml('正在查看复习计划…');
  api('/review/due').then(function (d) {
    var words = Array.isArray(d) ? d : (d.words || []);
    if (!words.length) {
      app.innerHTML = '<div class="empty-state">' + sakuraArt(110) +
        '<h3>今日已全部复习完</h3><p>小岛的地基很牢固，休息一下吧。</p></div>';
      return;
    }
    RV = { words: words, idx: 0, flipped: false };
    renderReviewCard();
  }).catch(function (err) {
    app.innerHTML = '<div class="loading">加载失败：' + esc(err.message) + '</div>';
  });
}

function renderReviewCard() {
  var w = RV.words[RV.idx];
  if (!w) {
    app.innerHTML = '<div class="finish-wrap">' + sakuraArt(120) +
      '<h2>复习完成</h2><p>记忆的小岛又稳固了一分。</p>' +
      '<a href="#/home" class="btn btn-primary" style="text-decoration:none;display:block">返回首页</a></div>';
    return;
  }
  RV.flipped = false;
  app.innerHTML =
    '<div class="quiz-progress"><div class="bar"><i style="width:' +
    Math.round(RV.idx / RV.words.length * 100) + '%"></i></div>' +
    '<div class="txt">' + (RV.idx + 1) + ' / ' + RV.words.length + '</div></div>' +
    '<div class="glass word-card" id="review-card">' +
      '<div class="word-kanji">' + wordFaceRuby(w) + '</div>' +
      (w.romaji ? '<div class="word-romaji">' + esc(w.romaji) + '</div>' : '') +
      '<div><button class="speaker-btn" id="btn-speak" aria-label="朗读">' + SPEAKER_SVG + '</button></div>' +
      '<div id="review-back" class="hidden" style="margin-top:14px;border-top:1px solid var(--glass-border);padding-top:16px">' +
        '<div style="font-size:17px">' + esc(w.display_meaning) +
        (w.meaning_is_en_fallback ? '<span class="badge-en">英文暂代</span>' : '') + mtBadge(w) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="review-actions" id="grade-btns">' +
      '<button class="btn grade-forgot" data-grade="0">忘记</button>' +
      '<button class="btn grade-fuzzy" data-grade="3">模糊</button>' +
      '<button class="btn grade-know" data-grade="5">认识</button>' +
    '</div>' +
    '<div id="review-next" class="hidden" style="margin-top:14px">' + exampleHtml(w) +
      '<div style="margin-top:16px"><button class="btn btn-primary" id="btn-rv-next">下一张</button></div>' +
      '<div style="margin-top:10px"><button class="btn btn-ghost" id="btn-detail" style="width:100%">查看详解 · 音形义用记</button></div>' +
    '</div>';

  $('#btn-speak').addEventListener('click', function () { speak(w.kana); });

  $$('#grade-btns .btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (RV.flipped) return;
      RV.flipped = true;
      var grade = parseInt(btn.getAttribute('data-grade'), 10);
      api('/review/answer', 'POST', { word_id: w.id, grade: grade }).catch(function () {});
      if (grade === 5) celebrate();
      $('#review-back').classList.remove('hidden');
      $('#grade-btns').classList.add('hidden');
      $('#review-next').classList.remove('hidden');
    });
  });
  $('#btn-rv-next').addEventListener('click', function () {
    RV.idx++;
    renderReviewCard();
  });
  var rdb = $('#btn-detail');
  if (rdb) rdb.addEventListener('click', function () { openWordDetail(w.id); });
}
routes['review'] = renderReview;

/* ================= 8c. 单词详解（v0.3「音·形·义·用·记」） ================= */
/* 全屏覆盖层呈现，不破坏当前学习/复习会话；无数据的模块直接隐藏，绝不编造 */
function openWordDetail(wordId) {
  var ov = document.createElement('div');
  ov.className = 'detail-overlay';
  ov.innerHTML = '<div class="detail-sheet">' + loadingHtml('正在取词条…') + '</div>';
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  function close() {
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    document.body.style.overflow = '';
  }
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  api('/vocab/' + encodeURIComponent(wordId)).then(function (w) {
    var secs = [];
    /* 音：发音按钮（Web Speech）；音调数据暂无，标注即将上线 */
    secs.push(
      '<section class="glass detail-sec">' +
      '<h3 class="detail-sec-title">音 <span class="detail-sec-en">PRONUNCIATION</span></h3>' +
      '<div class="detail-word">' + wordFaceRuby(w) + '</div>' +
      (w.romaji ? '<div class="word-romaji">' + esc(w.romaji) + '</div>' : '') +
      '<div style="margin-top:10px"><button class="speaker-btn" id="detail-speak" aria-label="朗读">' + SPEAKER_SVG + '</button>' +
      ' <span class="muted" style="font-size:12px">音调标注即将上线</span></div>' +
      '</section>'
    );
    /* 形：汉字拆解（kanji 表）；活用形无数据，不展示 */
    if (w.kanji_info && w.kanji_info.length) {
      secs.push(
        '<section class="glass detail-sec">' +
        '<h3 class="detail-sec-title">形 <span class="detail-sec-en">KANJI</span></h3>' +
        '<div class="kanji-grid">' + w.kanji_info.map(function (k) {
          return '<div class="kanji-card">' +
            '<div class="kanji-char">' + esc(k.character) + '</div>' +
            '<div class="muted" style="font-size:12px">' + (k.strokes != null ? k.strokes + '画' : '') + '</div>' +
            (k.onyomi && k.onyomi.length ? '<div class="kanji-read"><span class="muted">音読み</span> ' + esc(k.onyomi.join('・')) + '</div>' : '') +
            (k.kunyomi && k.kunyomi.length ? '<div class="kanji-read"><span class="muted">訓読み</span> ' + esc(k.kunyomi.join('・')) + '</div>' : '') +
            (k.meanings && k.meanings.length ? '<div class="kanji-meaning">' + esc(k.meanings.slice(0, 3).join('; ')) + '</div>' : '') +
          '</div>';
        }).join('') + '</div></section>'
      );
    }
    /* 义：词性 + 释义（中/英文分开展示，沿用机翻 badge） */
    var posHtml = '';
    if (w.pos) {
      var posArr = Array.isArray(w.pos) ? w.pos : [w.pos];
      if (posArr.length) posHtml = '<div>' + posArr.map(function (p) { return '<span class="word-pos">' + esc(p) + '</span>'; }).join(' ') + '</div>';
    }
    secs.push(
      '<section class="glass detail-sec">' +
      '<h3 class="detail-sec-title">义 <span class="detail-sec-en">MEANING</span></h3>' +
      posHtml +
      '<div class="detail-meaning">' + esc(w.display_meaning) +
      (w.meaning_is_en_fallback ? '<span class="badge-en">英文暂代</span>' : '') + mtBadge(w) + '</div>' +
      (w.meaning_zh && w.meaning_en && !w.meaning_is_en_fallback
        ? '<div class="detail-meaning-en muted">' + esc(w.meaning_en) + '</div>' : '') +
      '</section>'
    );
    /* 用：最多 3 条例句（日文+振假名+译文；中文译文暂无则用英文） */
    var exs = (w.examples || []).slice(0, 3);
    if (exs.length) {
      secs.push(
        '<section class="glass detail-sec">' +
        '<h3 class="detail-sec-title">用 <span class="detail-sec-en">EXAMPLES</span></h3>' +
        exs.map(function (e) {
          var sent = e.display_sentence || e.zh || e.en || '';
          return '<div class="detail-ex">' +
            '<div class="ex-ja">' + furiganaToRuby(e.furigana || e.ja) + '</div>' +
            (sent ? '<div class="ex-zh">' + esc(sent) + '</div>' : '') +
          '</div>';
        }).join('') + '</section>'
      );
    }
    /* 记：助记（暂无数据则隐藏） */
    if (w.mnemonic_zh) {
      secs.push(
        '<section class="glass detail-sec">' +
        '<h3 class="detail-sec-title">记 <span class="detail-sec-en">MNEMONIC</span></h3>' +
        '<div>' + esc(w.mnemonic_zh) + '</div></section>'
      );
    }
    var sheet = ov.querySelector('.detail-sheet');
    sheet.innerHTML = '<button class="detail-close" id="detail-close" aria-label="关闭">✕</button>' + secs.join('');
    $('#detail-speak').addEventListener('click', function () { speak(w.kana); });
    $('#detail-close').addEventListener('click', close);
  }).catch(function (err) {
    ov.querySelector('.detail-sheet').innerHTML =
      '<div class="glass detail-sec">加载失败：' + esc(err.message) +
      '<br><br><button class="btn btn-ghost" id="detail-close2">关闭</button></div>';
    $('#detail-close2').addEventListener('click', close);
  });
}

/* ================= 10. 页面：模考 ================= */
var QZ = null; // 模考会话
var QUIZ_SECONDS = 600; // 20 题建议 10 分钟

function renderQuiz() {
  // 设置页：级别选择 + 开始
  var levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
  var sel = QZ && QZ.level ? QZ.level : 'N5';
  app.innerHTML =
    '<h2 class="page-title">考试专区</h2>' +
    '<p class="page-sub">20 题 · 建议 10 分钟内完成</p>' +
    '<div class="glass panel" style="margin-top:16px">' +
      '<h3>选择级别</h3>' +
      '<div class="level-pills">' +
      levels.map(function (lv) {
        return '<button class="level-pill' + (lv === sel ? ' active' : '') + '" data-lv="' + lv + '">' + lv + '</button>';
      }).join('') +
      '</div>' +
      '<div class="muted" style="font-size:13px;margin-bottom:16px">题数固定 20 题，题型覆盖看词选义 / 看义选词 / 听音选义。</div>' +
      '<button class="btn btn-indigo" id="btn-quiz-start">开始模考</button>' +
    '</div>';

  var level = sel;
  $$('.level-pill').forEach(function (p) {
    p.addEventListener('click', function () {
      $$('.level-pill').forEach(function (x) { x.classList.remove('active'); });
      p.classList.add('active');
      level = p.getAttribute('data-lv');
    });
  });
  $('#btn-quiz-start').addEventListener('click', function () {
    startQuiz(level);
  });
}

function startQuiz(level) {
  app.innerHTML = loadingHtml('正在生成试卷…');
  api('/quiz/start', 'POST', { level: level, count: 20 }).then(function (d) {
    var qs = d.questions || [];
    if (!qs.length) { toast('暂无题目'); renderQuiz(); return; }
    QZ = {
      level: level,
      quiz_id: d.quiz_id,
      questions: qs,
      idx: 0,
      answers: [],
      left: QUIZ_SECONDS,
      answered: false,
      done: false
    };
    renderQuizQ();
    // 计时器：超时自动交卷
    every(function () {
      if (!QZ || QZ.done) return;
      QZ.left--;
      var t = $('#quiz-timer');
      if (t) {
        var mm = Math.floor(QZ.left / 60), ss = QZ.left % 60;
        t.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
        if (QZ.left <= 60) t.classList.add('danger');
      }
      if (QZ.left <= 0) { toast('时间到，自动交卷'); submitQuiz(); }
    }, 1000);
  }).catch(function (err) {
    toast(err.message || '开始模考失败');
    renderQuiz();
  });
}

/* quiz 选项取值兼容：字符串 / {word,meaning} / {kanji,kana} */
function qOptText(o, kind) {
  if (typeof o === 'string') return o;
  if (kind === 'meaning') return o.meaning || o.display_meaning || o.text || '';
  return o.word || (o.kanji || o.kana) || o.text || '';
}

/* quiz 题目渲染（题型渲染同 study，但由后端出题） */
function renderQuizQ() {
  var q = QZ.questions[QZ.idx];
  QZ.answered = false;
  var total = QZ.questions.length;
  var type = q.type;

  var head =
    '<div class="quiz-info"><span class="muted" style="font-size:13px">第 ' + (QZ.idx + 1) + ' / ' + total + ' 题 · ' +
    (TYPE_LABEL[type] || '') + '</span>' +
    '<span class="timer" id="quiz-timer">10:00</span></div>' +
    '<div class="quiz-progress"><div class="bar"><i style="width:' +
    Math.round(QZ.idx / total * 100) + '%"></i></div></div>';

  var body = quizQBody(q); // 题干 + 选项（与随堂小测复用同一渲染）

  app.innerHTML = head + '<div style="height:14px"></div>' + body + '<div id="fb-zone"></div>' +
    '<div id="q-next" class="hidden" style="margin-top:16px"><button class="btn btn-primary" id="btn-q-next">' +
    (QZ.idx === total - 1 ? '交卷' : '下一题') + '</button></div>';

  // 朗读题干 kana
  var kana = q.prompt.kana;
  if (kana && (type === 'listening')) later(function () { speak(kana); }, 500);
  var rp = $('#btn-replay');
  if (rp && kana) rp.addEventListener('click', function () { speak(kana); });

  $$('.option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (QZ.answered) return;
      QZ.answered = true;
      var i = parseInt(btn.getAttribute('data-i'), 10);
      // 记录答案（后端判分）；前端即时标出所选
      QZ.answers.push({ qid: q.qid, answer: String((q.options || [])[i]) });
      btn.classList.add('selected'); // 仅表示"已作答"，交卷后统一判分
      $$('.option').forEach(function (b) { b.disabled = true; });
      $('#q-next').classList.remove('hidden');
    });
  });
  $('#btn-q-next').addEventListener('click', function () {
    if (QZ.idx === QZ.questions.length - 1) submitQuiz();
    else { QZ.idx++; renderQuizQ(); }
  });
}

function gradeQuizChoice(qid, good, btn, w) { /* study 路径专用，quiz 走 renderQuizQ 内联 */ }

function submitQuiz() {
  if (!QZ || QZ.done) return;
  QZ.done = true;
  clearTimers();
  app.innerHTML = loadingHtml('正在批改试卷…');
  api('/quiz/submit', 'POST', { qid_answers: QZ.answers }).then(function (r) {
    renderQuizResult(r);
  }).catch(function (err) {
    toast(err.message || '交卷失败');
    renderQuiz();
  });
}

function renderQuizResult(r) {
  var score = r.score || 0, total = r.total || 20;
  var pct = total > 0 ? score / total : 0;
  var C = 2 * Math.PI * 54;
  var wrong = r.wrong || [];
  celebrate();

  app.innerHTML =
    '<div class="glass score-wrap">' +
      '<div class="ring-wrap" style="width:130px;height:130px;margin:0 auto">' +
        '<svg width="130" height="130" viewBox="0 0 130 130">' +
          '<circle class="ring-bg" cx="65" cy="65" r="54" fill="none" stroke-width="12"/>' +
          '<circle class="ring-fg" id="score-ring" cx="65" cy="65" r="54" fill="none" stroke-width="12" ' +
            'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"/>' +
        '</svg>' +
        '<div class="ring-center"><div class="score-num">' + score + '<small>/' + total + '</small></div></div>' +
      '</div>' +
      '<p class="muted" style="font-size:14px;margin:14px 0 0">' +
        (pct >= 0.9 ? '非常出色，小岛在发光。' : pct >= 0.6 ? '稳步前进，继续加油。' : '别灰心，错题是最好的砖。') + '</p>' +
    '</div>' +

    (wrong.length ?
      '<h3 style="margin:4px 2px 12px">错题本 <span class="muted" style="font-weight:400;font-size:13px">' + wrong.length + ' 题</span></h3>' +
      '<div class="wrong-list">' + wrong.map(function (it) {
        return '<div class="glass wrong-item"><div class="w">' + esc(it.word || '') +
          (it.kana ? ' <span class="muted" style="font-size:13px;font-weight:400">' + esc(it.kana) + '</span>' : '') +
          '</div><div class="m">' + esc(it.meaning || it.display_meaning || '') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="muted" style="font-size:13px;margin:14px 2px">错题已自动加入复习计划，记得去复习。</div>'
      : '<div class="glass panel" style="text-align:center">全部答对，完美通关。</div>') +

    '<div style="height:16px"></div>' +
    '<button class="btn btn-indigo" id="btn-quiz-again">再来一套</button>' +
    '<div style="height:10px"></div>' +
    '<a href="#/review" class="btn btn-ghost" style="text-decoration:none;display:block;text-align:center">去复习错题</a>' +
    '<div style="height:20px"></div>';

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var fg = $('#score-ring');
      if (fg) fg.style.strokeDashoffset = (C * (1 - pct)).toFixed(1);
    });
  });
  $('#btn-quiz-again').addEventListener('click', function () { renderQuiz(); });
}
routes['quiz'] = renderQuiz;

/* ================= 11. 页面：统计 ================= */
function renderStats() {
  app.innerHTML = loadingHtml('正在统计岛屿数据…');
  api('/stats/overview').then(function (d) {
    var streak = d.streak || 0;
    var learned = d.learned_count || 0;
    var mastered = d.mastered_count || 0;
    var today = d.today_learned || 0;

    /* 打卡热力图：近 60 天 */
    var cal = d.checkin_calendar || {};
    var days = [];
    var now = new Date();
    for (var i = 59; i >= 0; i--) {
      var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      var hit = cal[key] === true || (Array.isArray(cal) && cal.indexOf(key) !== -1);
      days.push({ key: key, hit: hit, future: i < 0 });
    }
    var heat = '<div class="heatmap">' + days.map(function (x) {
      return '<div class="day' + (x.hit ? ' hit' : '') + '" title="' + x.key + '"></div>';
    }).join('') + '</div>';

    /* words_by_level 横向条形图 */
    var wbl = d.words_by_level || {};
    var order = ['N5', 'N4', 'N3', 'N2', 'N1'];
    var maxLv = 1;
    order.forEach(function (lv) { if ((wbl[lv] || 0) > maxLv) maxLv = wbl[lv]; });
    var bars = '<div class="level-bars">' + order.map(function (lv) {
      var c = wbl[lv] || 0;
      return '<div class="level-row"><span class="lv">' + lv + '</span>' +
        '<div class="bar"><i data-w="' + Math.round(c / maxLv * 100) + '"></i></div>' +
        '<span class="cnt">' + c + '</span></div>';
    }).join('') + '</div>';

    /* week_activity 7 柱状图 */
    var wa = d.week_activity || [];
    var weekArr = Array.isArray(wa) ? wa : Object.keys(wa).map(function (k) { return { day: k, count: wa[k] }; });
    var maxW = 1;
    weekArr.forEach(function (x) { if ((x.count || 0) > maxW) maxW = x.count; });
    var weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    var cols = '<div class="week-chart">' + weekArr.slice(0, 7).map(function (x, i) {
      var h = Math.max(4, Math.round((x.count || 0) / maxW * 100));
      var label = x.day != null ? x.day : weekNames[i % 7];
      return '<div class="week-col"><span class="col-val">' + (x.count || 0) + '</span>' +
        '<div class="col-bar" data-h="' + h + '" style="height:4px"></div>' +
        '<span class="col-day">' + esc(String(label)) + '</span></div>';
    }).join('') + '</div>';

    app.innerHTML =
      '<h2 class="page-title">学习统计</h2><p class="page-sub">每一块砖都有记录。</p>' +
      '<div style="height:16px"></div>' +
      '<div class="stat-grid">' +
        '<div class="glass stat-card accent"><div class="num">' + streak + '</div><div class="label">连续打卡（天）</div></div>' +
        '<div class="glass stat-card"><div class="num">' + learned + '</div><div class="label">已学词数</div></div>' +
        '<div class="glass stat-card"><div class="num">' + mastered + '</div><div class="label">已掌握</div></div>' +
        '<div class="glass stat-card"><div class="num">' + today + '</div><div class="label">今日学习</div></div>' +
      '</div>' +
      '<div class="glass panel"><h3>打卡日历 · 近 60 天</h3>' + heat +
        '<div class="heatmap-legend"><span>○ 未打卡</span><span style="color:var(--vermilion)">● 已打卡</span></div></div>' +
      '<div class="glass panel"><h3>各级别词数</h3>' + bars + '</div>' +
      '<div class="glass panel"><h3>近 7 天学习量</h3>' + cols + '</div>';

    // 条形图 / 柱状图入场动画
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $$('.level-row .bar i').forEach(function (el) { el.style.width = el.getAttribute('data-w') + '%'; });
        $$('.week-col .col-bar').forEach(function (el) { el.style.height = el.getAttribute('data-h') + '%'; });
      });
    });
  }).catch(function (err) {
    app.innerHTML = '<div class="loading">加载失败：' + esc(err.message) + '</div>';
  });
}
routes['stats'] = renderStats;

/* ================= 12. 页面：我的 ================= */
function renderMe() {
  var username = localStorage.getItem('yuyu_username') || '';
  app.innerHTML =
    '<div class="profile-head">' +
      '<div class="avatar">' + esc((username || '屿').charAt(0).toUpperCase()) + '</div>' +
      '<div><h2>' + esc(username) + '</h2><p>正在筑岛的学习者</p></div>' +
    '</div>' +

    '<div class="glass pro-card">' +
      '<h3><span class="crown">♛</span> 语屿 Pro</h3>' +
      '<span class="pro-soon">即将上线</span>' +
      '<ul class="pro-perks">' +
        '<li>无限背词，不设每日上限</li>' +
        '<li>N5–N1 全词库畅学</li>' +
        '<li>完整模考与错题本</li>' +
        '<li>多端云同步</li>' +
      '</ul>' +
    '</div>' +

    '<div class="glass setting-card">' +
      '<h3>学习语言</h3>' +
      '<div class="seg" id="lang-seg">' +
        '<button data-lang="zh">中文</button>' +
        '<button data-lang="en">English</button>' +
      '</div>' +
      '<p class="muted seg-note">释义与例句将按所选语言展示，切换后自动刷新页面。</p>' +
    '</div>' +

    '<div class="glass bind-form">' +
      '<h3>绑定邮箱 / 手机</h3>' +
      '<div class="field" id="f-email">' +
        '<label for="in-email">邮箱</label>' +
        '<input id="in-email" type="email" autocomplete="email" placeholder="用于找回密码">' +
        '<div class="error hidden"></div>' +
      '</div>' +
      '<div class="field" id="f-phone">' +
        '<label for="in-phone">手机号</label>' +
        '<input id="in-phone" type="tel" autocomplete="tel" placeholder="11 位大陆手机号">' +
        '<div class="error hidden"></div>' +
      '</div>' +
      '<button class="btn btn-indigo" id="btn-bind">保存绑定</button>' +
    '</div>' +

    '<div class="glass about-card">' +
      '<h3>关于数据</h3>' +
      '词库来源：OpenJLPT、JMdict-EDICT，例句来自 Tatoeba。<br>' +
      '以上数据均以 CC BY-SA 4.0 协议共享，版权归各自贡献者所有。<br>' +
      '语屿 Kotoba · 每天十五分钟，筑一座日语之岛。' +
    '</div>' +

    '<div class="glass danger-zone">' +
      '<div class="list-row" id="row-logout"><span>退出登录</span><span class="chev">›</span></div>' +
      '<div class="list-row" id="row-delete"><span>注销账号</span><span class="chev">›</span></div>' +
    '</div>';

  function paintLangSeg(lang) {
    $$('#lang-seg button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
  }
  paintLangSeg(userLang());

  // 回显已绑定信息与语言偏好
  api('/auth/me').then(function (me) {
    if (me.email) $('#in-email').value = me.email;
    if (me.phone) $('#in-phone').value = me.phone;
    if (me.username) localStorage.setItem('yuyu_username', me.username);
    if (me.lang === 'zh' || me.lang === 'en') {
      localStorage.setItem(LANG_KEY, me.lang);
      paintLangSeg(me.lang);
    }
  }).catch(function () { /* 忽略回显失败 */ });

  // 语言切换：PUT /api/auth/profile {lang}，成功后刷新页面重拉数据
  $$('#lang-seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      var lang = b.getAttribute('data-lang');
      if (lang === userLang()) return;
      b.disabled = true;
      api('/auth/profile', 'PUT', { lang: lang }).then(function () {
        localStorage.setItem(LANG_KEY, lang);
        toast(lang === 'zh' ? '已切换为中文' : 'Switched to English');
        location.reload();
      }).catch(function (err) {
        toast(err.message || '切换失败');
        b.disabled = false;
      });
    });
  });

  function setErr(id, msg) {
    var f = $('#' + id), e = $('.error', f);
    if (msg) { e.textContent = msg; e.classList.remove('hidden'); f.classList.add('invalid'); }
    else { e.classList.add('hidden'); f.classList.remove('invalid'); }
  }

  $('#btn-bind').addEventListener('click', function () {
    var email = $('#in-email').value.trim();
    var phone = $('#in-phone').value.trim();
    var ok = true;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('f-email', '邮箱格式不正确'); ok = false; }
    else setErr('f-email', '');
    if (phone && !/^1\d{10}$/.test(phone)) { setErr('f-phone', '请输入 11 位大陆手机号'); ok = false; }
    else setErr('f-phone', '');
    if (!ok) return;
    var btn = $('#btn-bind');
    btn.disabled = true; btn.textContent = '保存中…';
    api('/auth/profile', 'PUT', { email: email || null, phone: phone || null }).then(function () {
      toast('绑定信息已保存');
    }).catch(function (err) {
      toast(err.message || '保存失败');
    }).then(function () {
      btn.disabled = false; btn.textContent = '保存绑定';
    });
  });

  $('#row-logout').addEventListener('click', function () {
    confirmModal('退出登录', '确定要退出当前账号吗？', '退出').then(function (yes) {
      if (yes) { toast('已退出登录'); logout(); }
    });
  });

  $('#row-delete').addEventListener('click', function () {
    confirmModal('注销账号', '注销后，你的学习记录、打卡与词库进度将被永久删除，且无法恢复。确定继续吗？', '确认注销')
      .then(function (yes) {
        if (!yes) return;
        api('/auth/account', 'DELETE').then(function () {
          toast('账号已注销');
          logout();
        }).catch(function (err) {
          toast(err.message || '注销失败，请稍后重试');
        });
      });
  });
}
routes['me'] = renderMe;

/* ================= 启动 ================= */
injectSvgDefs();
initTheme();
window.addEventListener('hashchange', navigate);
if (!location.hash) location.hash = '#/login';
navigate();
syncLang(); // 已登录时同步后端语言偏好
