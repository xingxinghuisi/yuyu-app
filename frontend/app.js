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

/* 前端版本号（我的页页脚展示；发版改前端文件时同步 bump） */
var APP_VERSION = '0.6.0';

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
/* 发音偏好：localStorage 持久化 */
function getVoicePref() {
  try {
    return {
      voice: localStorage.getItem('yuyu_voice') || '',
      rate: parseFloat(localStorage.getItem('yuyu_rate') || '0.8')
    };
  } catch (e) { return { voice: '', rate: 0.8 }; }
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    var pref = getVoicePref();
    u.rate = pref.rate || 0.8;
    if (pref.voice) {
      var vs = window.speechSynthesis.getVoices();
      for (var i = 0; i < vs.length; i++) {
        if (vs[i].voiceURI === pref.voice || vs[i].name === pref.voice) { u.voice = vs[i]; break; }
      }
    }
    window.speechSynthesis.speak(u);
  } catch (e) { /* 忽略 */ }
}
/* 初始化发音设置 UI（我的页） */
function initVoiceSettings() {
  var sel = $('#sel-voice'), range = $('#range-rate'), rval = $('#rate-val'), test = $('#btn-voice-test');
  if (!sel || !('speechSynthesis' in window)) return;
  var pref = getVoicePref();
  var fill = function () {
    var vs = window.speechSynthesis.getVoices().filter(function (v) {
      return (v.lang || '').toLowerCase().indexOf('ja') === 0;
    });
    sel.innerHTML = '<option value="">系统默认</option>' + vs.map(function (v) {
      var n = v.name + (v.lang ? ' (' + v.lang + ')' : '');
      return '<option value="' + esc(v.name) + '"' + (pref.voice === v.name || pref.voice === v.voiceURI ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  };
  fill();
  if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = fill;
  if (range) {
    range.value = pref.rate;
    if (rval) rval.textContent = 'x' + pref.rate.toFixed(1);
    range.addEventListener('input', function () {
      try { localStorage.setItem('yuyu_rate', range.value); } catch (e) {}
      if (rval) rval.textContent = 'x' + parseFloat(range.value).toFixed(1);
    });
  }
  sel.addEventListener('change', function () {
    try { localStorage.setItem('yuyu_voice', sel.value); } catch (e) {}
  });
  if (test) test.addEventListener('click', function () { speak('こんにちは、語屿です'); });
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

/* ---------------- 岛屿养成 ----------------
   和风小岛 SVG，随等级生长：
   Lv1 沙洲 → Lv2 小岛 → Lv3 绿岛 → Lv4 樱花岛 → Lv5 日语之岛 */
var __islandUid = 0;
function islandSvg(level) {
  level = Math.max(1, Math.min(5, level || 1));
  var uid = 'isl' + (++__islandUid);
  var W = 320, H = 190;
  var s = '';
  s += '<svg viewBox="0 0 ' + W + ' ' + H + '" class="island-svg" role="img" aria-label="我的岛屿">';
  s += '<defs>' +
    '<linearGradient id="' + uid + 'sky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#DCEBF3"/><stop offset="1" stop-color="#FDF8EE"/></linearGradient>' +
    '<linearGradient id="' + uid + 'sea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#A9D0E6"/><stop offset="1" stop-color="#7FB3D5"/></linearGradient>' +
    '<radialGradient id="' + uid + 'sand" cx="0.5" cy="0.4" r="0.8">' +
      '<stop offset="0" stop-color="#F7EACD"/><stop offset="1" stop-color="#EBD3A8"/></radialGradient>' +
    '</defs>';
  // 天空与海
  s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#' + uid + 'sky)"/>';
  if (level >= 5) {
    s += '<circle cx="268" cy="34" r="20" fill="#F6D38B" opacity="0.9"/>' +
         '<circle cx="268" cy="34" r="27" fill="#F6D38B" opacity="0.25"/>';
  }
  // 远山（Lv3+）
  if (level >= 3) {
    s += '<path d="M0 118 Q60 84 120 112 T320 106 L320 190 L0 190 Z" fill="#B9CFDD" opacity="0.55"/>';
  }
  // 海
  s += '<rect x="0" y="118" width="' + W + '" height="' + (H - 118) + '" fill="url(#' + uid + 'sea)"/>';
  // 波纹
  var waves = [[40, 138], [120, 150], [210, 140], [280, 154], [80, 168], [190, 172], [260, 130]];
  waves.forEach(function (w, i) {
    if (i > level + 3) return;
    s += '<path d="M' + (w[0] - 16) + ' ' + w[1] + ' q8 -6 16 0 t16 0" stroke="#FFFFFF" ' +
         'stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.65"/>';
  });
  // 岛体（随等级变大）
  var iw = [150, 190, 230, 260, 285][level - 1];
  var ih = [26, 34, 44, 54, 62][level - 1];
  var cx = W / 2, baseY = 148;
  s += '<ellipse cx="' + cx + '" cy="' + baseY + '" rx="' + (iw / 2) + '" ry="' + ih + '" fill="url(#' + uid + 'sand)"/>';
  s += '<ellipse cx="' + cx + '" cy="' + (baseY - ih + 6) + '" rx="' + (iw / 2 - 14) + '" ry="' + (ih - 8) + '" fill="#F7EACD" opacity="0.7"/>';
  var topY = baseY - ih * 2 + 10;
  // 绿丘（Lv2+）
  if (level >= 2) {
    var hw = [0, 120, 160, 190, 210][level - 1];
    s += '<ellipse cx="' + cx + '" cy="' + (baseY - 14) + '" rx="' + (hw / 2) + '" ry="30" fill="#8FB46A"/>';
    s += '<ellipse cx="' + (cx - 20) + '" cy="' + (baseY - 22) + '" rx="' + (hw / 2 - 30) + '" ry="22" fill="#A3C47E" opacity="0.8"/>';
  }
  function tree(x, y, r, sakura) {
    var t = '<rect x="' + (x - 3) + '" y="' + y + '" width="6" height="16" rx="2" fill="#8A6B4F"/>';
    var c1 = sakura ? '#F6C9D4' : '#7BA05B', c2 = sakura ? '#EFA8BC' : '#5E8447';
    t += '<circle cx="' + x + '" cy="' + (y - 8) + '" r="' + r + '" fill="' + c1 + '"/>';
    t += '<circle cx="' + (x - r * 0.5) + '" cy="' + (y - 14) + '" r="' + (r * 0.6) + '" fill="' + c2 + '" opacity="0.85"/>';
    if (sakura) {
      t += '<circle cx="' + (x + r * 0.4) + '" cy="' + (y - 4) + '" r="2.4" fill="#F9DEE6"/>' +
           '<circle cx="' + (x - r * 0.2) + '" cy="' + (y - 18) + '" r="2" fill="#F9DEE6"/>';
    }
    return t;
  }
  // 树（Lv2+ 普通树，Lv4+ 樱花）
  if (level >= 2) {
    var sakura = level >= 4;
    s += tree(cx - 52, baseY - 44, 17, sakura && level >= 4);
    s += tree(cx + 48, baseY - 40, 14, false);
  }
  if (level >= 3) s += tree(cx + 8, baseY - 52, 19, false);
  if (level >= 4) {
    s += tree(cx - 90, baseY - 36, 15, true);
    s += tree(cx + 92, baseY - 42, 18, true);
    // 飘落花瓣
    [[cx - 30, 60], [cx + 40, 48], [cx + 70, 78], [cx - 70, 84]].forEach(function (p) {
      s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="4" ry="2.6" fill="#F6C9D4" opacity="0.8" transform="rotate(24 ' + p[0] + ' ' + p[1] + ')"/>';
    });
  }
  // 鸟居（Lv4+）
  if (level >= 4) {
    var tx = cx - 8, ty = baseY - 46;
    s += '<rect x="' + (tx - 4) + '" y="' + ty + '" width="8" height="34" fill="#E03E2D"/>' +
         '<rect x="' + (tx + 26) + '" y="' + ty + '" width="8" height="34" fill="#E03E2D"/>' +
         '<rect x="' + (tx - 14) + '" y="' + (ty - 10) + '" width="62" height="9" rx="2" fill="#C93324"/>' +
         '<rect x="' + (tx - 6) + '" y="' + (ty + 6) + '" width="46" height="6" rx="2" fill="#C93324"/>';
  }
  // 小屋（Lv5）
  if (level >= 5) {
    var hx = cx + 52, hy = baseY - 40;
    s += '<rect x="' + (hx - 22) + '" y="' + hy + '" width="44" height="28" rx="2" fill="#F5EFE2"/>' +
         '<path d="M' + (hx - 28) + ' ' + hy + ' L' + hx + ' ' + (hy - 20) + ' L' + (hx + 28) + ' ' + hy + ' Z" fill="#5E6E7E"/>' +
         '<rect x="' + (hx - 7) + '" y="' + (hy + 10) + '" width="14" height="18" fill="#8A6B4F"/>' +
         tree(hx - 52, hy + 6, 16, true);
  }
  // 飞鸟
  if (level >= 2) {
    s += '<path d="M52 44 q7 -7 14 0 q7 -7 14 0" stroke="#5E6E7E" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7"/>';
  }
  if (level >= 4) {
    s += '<path d="M92 30 q6 -6 12 0 q6 -6 12 0" stroke="#5E6E7E" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>';
  }
  s += '</svg>';
  return s;
}

/* 岛屿卡片 HTML */
function islandCardHtml(isl) {
  var pct = Math.round((isl.progress || 0) * 100);
  var nextTxt = isl.is_max
    ? '已抵达最高等级 · 日语之岛建成！'
    : '距「' + esc(isl.next_level_name) + '」还差 ' +
      (isl.streak < isl.next_streak ? (isl.next_streak - isl.streak) + ' 天打卡' : '') +
      (isl.streak < isl.next_streak && isl.total_words < isl.next_words ? ' / ' : '') +
      (isl.total_words < isl.next_words ? (isl.next_words - isl.total_words) + ' 词' : '');
  return '<div class="glass island-card">' +
    '<div class="island-head"><h3>我的岛屿</h3>' +
    '<span class="island-lv">Lv.' + isl.level + ' · ' + esc(isl.level_name) + '</span></div>' +
    islandSvg(isl.level) +
    '<div class="island-progress"><div class="island-bar"><i style="width:' + pct + '%"></i></div>' +
    '<p class="muted island-next">' + esc(nextTxt) + '</p></div>' +
  '</div>';
}

function renderHome() {
  app.innerHTML = loadingHtml('正在眺望你的岛屿…');
  Promise.all([
    api('/home/summary'),
    api('/island').catch(function () { return null; })
  ]).then(function (res) {
    var d = res[0] || {};
    var isl = res[1];
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

      (isl ? islandCardHtml(isl) : '') +

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
        var newStreak = (r.streak != null ? r.streak : streak + 1);
        toast('打卡成功，连续 ' + newStreak + ' 天');
        // 拉岛屿与今日数据，生成打卡海报
        Promise.all([
          api('/island').catch(function () { return null; }),
          api('/home/summary').catch(function () { return null; })
        ]).then(function (res) {
          renderHome();
          showPoster({
            streak: newStreak,
            todayLearned: (res[1] && res[1].today_learned) || learned,
            totalWords: (res[0] && res[0].total_words) || 0,
            islandLevel: (res[0] && res[0].level) || 1,
            islandName: (res[0] && res[0].level_name) || '沙洲'
          });
        });
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
/* ---------------- 打卡海报 ----------------
   Canvas 绘制 750x1200 海报：日期、今日学词、连续打卡、岛屿等级、slogan */
function showPoster(d) {
  var ov = document.createElement('div');
  ov.className = 'poster-overlay';
  ov.innerHTML =
    '<div class="poster-box glass">' +
      '<canvas id="poster-canvas" width="750" height="1200"></canvas>' +
      '<div class="poster-actions">' +
        '<button class="btn btn-primary" id="poster-save">保存图片</button>' +
        '<button class="btn btn-ghost" id="poster-close">关闭</button>' +
      '</div>' +
      '<p class="muted poster-tip">也可以长按海报保存到相册</p>' +
    '</div>';
  document.body.appendChild(ov);
  drawPoster($('#poster-canvas'), d);
  $('#poster-close').addEventListener('click', function () { document.body.removeChild(ov); });
  ov.addEventListener('click', function (e) { if (e.target === ov) document.body.removeChild(ov); });
  $('#poster-save').addEventListener('click', function () {
    var a = document.createElement('a');
    a.download = '语屿打卡_' + new Date().toISOString().slice(0, 10) + '.png';
    a.href = $('#poster-canvas').toDataURL('image/png');
    a.click();
    toast('海报已保存');
  });
}

function drawPoster(cv, d) {
  var ctx = cv.getContext('2d');
  var W = 750, H = 1200;
  var F = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
  // 纸底
  var bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#FAF6EF'); bg.addColorStop(1, '#F0E5CF');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // 顶部朱红细线
  ctx.fillStyle = '#E03E2D'; ctx.fillRect(0, 0, W, 10);
  ctx.textAlign = 'center';
  // 品牌
  ctx.fillStyle = '#2B2B2B';
  ctx.font = '600 44px ' + F;
  ctx.fillText('语 屿', W / 2, 110);
  ctx.font = '400 26px ' + F;
  ctx.fillStyle = '#8A8A8A';
  ctx.fillText('K O T O B A', W / 2, 152);
  // 日期
  var now = new Date();
  var week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  ctx.font = '400 30px ' + F;
  ctx.fillStyle = '#8A8A8A';
  ctx.fillText(now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + week, W / 2, 210);
  // 主数字：连续打卡
  ctx.fillStyle = '#E03E2D';
  ctx.font = '800 150px ' + F;
  ctx.fillText(String(d.streak), W / 2, 380);
  ctx.fillStyle = '#2B2B2B';
  ctx.font = '500 40px ' + F;
  ctx.fillText('天连续打卡', W / 2, 445);
  // 三栏数据
  var stats = [
    [String(d.todayLearned), '今日学词'],
    [String(d.totalWords), '累计学词'],
    ['Lv.' + d.islandLevel, d.islandName],
  ];
  ctx.font = '700 52px ' + F;
  stats.forEach(function (st, i) {
    var x = W * (0.2 + i * 0.3);
    ctx.fillStyle = '#274C77';
    ctx.fillText(st[0], x, 560);
    ctx.fillStyle = '#8A8A8A';
    ctx.font = '400 28px ' + F;
    ctx.fillText(st[1], x, 605);
    ctx.font = '700 52px ' + F;
  });
  // 迷你岛屿
  drawMiniIsland(ctx, W / 2, 800, d.islandLevel);
  // slogan
  ctx.fillStyle = '#2B2B2B';
  ctx.font = '500 34px ' + F;
  ctx.fillText('每天十五分钟，筑一座日语之岛。', W / 2, 1010);
  // 底部
  ctx.fillStyle = '#B0A890';
  ctx.font = '400 26px ' + F;
  ctx.fillText('语屿 KOTOBA · 日语背词', W / 2, 1130);
  ctx.fillStyle = '#E03E2D'; ctx.fillRect(0, H - 10, W, 10);
}

function drawMiniIsland(ctx, cx, cy, level) {
  level = Math.max(1, Math.min(5, level || 1));
  // 海
  ctx.fillStyle = '#9CC8E0';
  ctx.beginPath(); ctx.ellipse(cx, cy + 40, 200, 46, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  [[-120, 30], [-40, 55], [60, 32], [130, 58]].forEach(function (w) {
    ctx.beginPath();
    ctx.moveTo(cx + w[0] - 26, cy + w[1]);
    ctx.quadraticCurveTo(cx + w[0], cy + w[1] - 12, cx + w[0] + 26, cy + w[1]);
    ctx.stroke();
  });
  // 沙岛
  ctx.fillStyle = '#F2E3C6';
  ctx.beginPath(); ctx.ellipse(cx, cy + 30, 120 + level * 12, 34, 0, 0, Math.PI * 2); ctx.fill();
  // 绿丘
  if (level >= 2) {
    ctx.fillStyle = '#8FB46A';
    ctx.beginPath(); ctx.ellipse(cx, cy + 8, 70 + level * 8, 30, 0, 0, Math.PI * 2); ctx.fill();
  }
  function miniTree(x, y, sakura) {
    ctx.fillStyle = '#8A6B4F'; ctx.fillRect(x - 4, y, 8, 22);
    ctx.fillStyle = sakura ? '#F6C9D4' : '#7BA05B';
    ctx.beginPath(); ctx.arc(x, y - 12, 26, 0, Math.PI * 2); ctx.fill();
    if (sakura) {
      ctx.fillStyle = '#EFA8BC';
      ctx.beginPath(); ctx.arc(x - 12, y - 20, 14, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (level >= 2) miniTree(cx - 50, cy - 6, level >= 4);
  if (level >= 3) miniTree(cx + 40, cy - 12, false);
  if (level >= 4) miniTree(cx + 95, cy, true);
  // 鸟居
  if (level >= 4) {
    ctx.fillStyle = '#E03E2D';
    ctx.fillRect(cx - 22, cy - 34, 10, 40);
    ctx.fillRect(cx + 12, cy - 34, 10, 40);
    ctx.fillRect(cx - 34, cy - 46, 68, 12);
  }
  // 小屋
  if (level >= 5) {
    ctx.fillStyle = '#F5EFE2'; ctx.fillRect(cx + 48, cy - 22, 56, 34);
    ctx.fillStyle = '#5E6E7E';
    ctx.beginPath();
    ctx.moveTo(cx + 42, cy - 22); ctx.lineTo(cx + 76, cy - 44); ctx.lineTo(cx + 110, cy - 22);
    ctx.closePath(); ctx.fill();
  }
}

routes['home'] = renderHome;

/* ================= 8. 页面：学习 ================= */
/* v0.3: 零输入题型 —— 砍掉 spelling 打字题；listening 改为听音选义 */
var TYPE_LABEL = {
  choice_ja: '看词选义',
  choice_zh: '看义选词',
  listening: '听音选义',
  sample: '官方样题'
};

var ST = null; // 学习会话状态

/* 书架：学习方式上下文（选书弹窗写入，plan 调用使用） */
var StudyCtx = { bookId: 'level-n5', bookName: 'N5 标准词', order: 'seq' };
var SHELF_CATS = [
  { key: 'level', title: '考级' },
  { key: 'freq', title: '高频' },
  { key: 'scene', title: '场景' },
  { key: 'textbook', title: '教材' },
];

/* #/study 入口：书架（顶部带今日 hub 条：进度/打卡/岛屿） */
function renderStudy() {
  app.innerHTML = loadingHtml('正在取书…');
  Promise.all([
    api('/books').catch(function () { return null; }),
    api('/home/summary').catch(function () { return null; }),
    api('/island').catch(function () { return null; })
  ]).then(function (res) {
    renderShelf(Array.isArray(res[0]) ? res[0] : null, res[1] || {}, res[2]);
  });
}

/* 书架顶部今日 hub 条 */
function hubStripHtml(d, isl) {
  var learned = d.today_learned || 0;
  var goal = d.daily_goal || 30;
  var streak = d.streak || 0;
  var checked = !!d.checked_in_today;
  var islTxt = isl ? ('我的岛屿 Lv.' + isl.level + ' · ' + isl.level_name) : '我的岛屿';
  return '<div class="glass hub-strip">' +
    '<div class="hub-today"><b>' + learned + '</b><span>/' + goal + ' 今日已学</span>' +
      '<span class="hub-streak">🔥' + streak + '天</span></div>' +
    '<div class="hub-actions">' +
      (checked
        ? '<span class="hub-checked">今日已打卡</span>'
        : '<button class="btn btn-primary btn-sm" id="hub-checkin">打卡</button>') +
      '<a class="hub-island" href="#/home">' + esc(islTxt) + ' →</a>' +
    '</div></div>';
}

/* 书架渲染：按维度分组的玻璃书卡（名称、x/总数、进度条） */
function renderShelf(books, summary, isl) {
  var hasData = !!books;
  var list = books || [
    { id: 'level-n5', name: 'N5', category: 'level', level: 'N5' },
    { id: 'level-n4', name: 'N4', category: 'level', level: 'N4' },
    { id: 'level-n3', name: 'N3', category: 'level', level: 'N3' },
    { id: 'level-n2', name: 'N2', category: 'level', level: 'N2' },
    { id: 'level-n1', name: 'N1', category: 'level', level: 'N1' },
  ];
  var groups = SHELF_CATS.map(function (c) {
    return { key: c.key, title: c.title,
             books: list.filter(function (b) { return (b.category || 'level') === c.key; }) };
  }).filter(function (g) { return g.books.length > 0; });

  function cardHtml(b) {
    var pct = 0;
    if (typeof b.progress === 'number') pct = b.progress;
    else if (b.total > 0) pct = (b.studied || 0) / b.total;
    pct = Math.max(0, Math.min(1, pct));
    var countTxt = hasData
      ? ((b.studied != null ? b.studied : 0) + ' / ' + (b.total != null ? b.total : '—'))
      : '— / —';
    return '<button class="book glass' + (StudyCtx.bookId === b.id ? ' current' : '') + '" data-bid="' + esc(b.id) + '" data-bname="' + esc(b.name) + '">' +
      '<div class="book-main">' +
        '<span class="book-lv">' + esc(b.name) + '</span>' +
        (b.description ? '<span class="book-desc">' + esc(b.description) + '</span>' : '') +
      '</div>' +
      '<div class="book-side">' +
        '<span class="book-count">' + esc(countTxt) + '</span>' +
        '<span class="book-bar"><i style="width:' + Math.round(pct * 100) + '%"></i></span>' +
        '<span class="book-pct">' + Math.round(pct * 100) + '%</span>' +
      '</div>' +
    '</button>';
  }

  var html = hubStripHtml(summary || {}, isl) +
    '<h2 class="page-title">书架</h2>' +
    '<p class="page-sub">选一本书，开始今日的筑岛之旅。</p>';
  groups.forEach(function (g) {
    html += '<h3 class="shelf-cat">' + esc(g.title) + '</h3>' +
      '<div class="shelf">' + g.books.map(cardHtml).join('') + '</div>';
  });
  html += '<div class="shelf-note muted">顺序学习按书内顺序稳步推进 · 打乱顺序随机出词</div>';
  app.innerHTML = html;

  if (!hasData) toast('书架数据暂不可用，可直接选书开始');
  var hcb = $('#hub-checkin');
  if (hcb) hcb.addEventListener('click', function () {
    hcb.disabled = true; hcb.textContent = '打卡中…';
    api('/checkin', 'POST').then(function (r) {
      celebrate();
      var newStreak = (r.streak != null ? r.streak : ((summary && summary.streak) || 0) + 1);
      toast('打卡成功，连续 ' + newStreak + ' 天');
      Promise.all([
        api('/island').catch(function () { return null; }),
        api('/home/summary').catch(function () { return null; })
      ]).then(function (res) {
        renderStudy();
        showPoster({
          streak: newStreak,
          todayLearned: (res[1] && res[1].today_learned) || 0,
          totalWords: (res[0] && res[0].total_words) || 0,
          islandLevel: (res[0] && res[0].level) || 1
        });
      });
    }).catch(function (err) {
      hcb.disabled = false; hcb.textContent = '打卡';
      toast((err && err.message) || '打卡失败，请稍后重试');
    });
  });
  $$('.book').forEach(function (el) {
    el.addEventListener('click', function () {
      var bid = el.getAttribute('data-bid');
      var bname = el.getAttribute('data-bname');
      vibrate(10);
      chooseOrder(bname).then(function (order) {
        if (!order) return;
        StudyCtx.bookId = bid;
        StudyCtx.bookName = bname;
        StudyCtx.order = order;
        startStudyFlow();
      });
    });
  });
}

/* 选书弹窗：[顺序学习] [打乱顺序] */
function chooseOrder(bookName) {
  return new Promise(function (resolve) {
    var m = $('#modal');
    var acts = $('.modal-actions');
    var orig = acts.innerHTML; // 恢复 confirmModal 的默认按钮
    $('#modal-title').textContent = bookName + ' · 怎么学？';
    $('#modal-desc').textContent = '顺序学习按书内顺序稳步推进；打乱顺序随机出词，更具挑战。';
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
  api('/study/plan', 'POST', { book_id: StudyCtx.bookId, order: StudyCtx.order }).then(function (d) {
    var words = d.words || [];
    if (!words.length) {
      app.innerHTML = '<div class="empty-state">' + sakuraArt(110) +
        '<h3>' + esc(StudyCtx.bookName || '本书') + ' 今日新词已学完</h3><p>换本书看看，或去复习巩固一下吧。</p>' +
        '<br><a href="#/review" class="btn btn-primary" style="text-decoration:none">去复习</a>' +
        '<div style="height:10px"></div>' +
        '<button class="btn btn-ghost" id="back-shelf">返回书架</button></div>';
      $('#back-shelf').addEventListener('click', renderStudy);
      return;
    }
    ST = {
      words: words,
      idx: 0,
      done: 0,       // 已评分词数（frontier）；idx < done 时为回看模式
      goal: d.daily_goal || 30,
      baseLearned: d.today_learned || 0,
      counted: 0,  // 本轮已产生 grade 的新词数
      batch: [],   // 当前待小测的词 id
      grades: {}   // word_id -> grade（本轮评分记录，回看展示用）
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

/* 例句译文：英语在前、中文在后（日语句由调用方单独渲染）；无中文时只显示英文，不留空行 */
function exTransHtml(ex) {
  var h = '';
  if (ex.en) h += '<div class="ex-en">' + esc(ex.en) + '</div>';
  if (ex.zh) h += '<div class="ex-zh">' + esc(ex.zh) + '</div>';
  if (!h) {
    var s = ex.display_sentence || '';
    if (s) h = '<div class="ex-zh">' + esc(s) + '</div>';
  }
  return h;
}
function exampleHtml(w) {
  var ex = (w.examples && w.examples[0]) || null;
  if (!ex) return '';
  return '<div class="glass example-box">' +
    '<div class="ex-label">例句 EXAMPLE</div>' +
    '<div class="ex-ja">' + furiganaToRuby(ex.furigana || ex.ja) + '</div>' +
    exTransHtml(ex) +
  '</div>';
}

/* 题目区 HTML（study 与 quiz 复用）
   v0.3: 看词选义 / 听音选义 → 4 个中文释义选项；看义选词 → 4 个单词选项；无打字题 */
/* v0.4.3 学习（新词）展示式：完整展示单词 → 认识/不认识二档自评。
   认识 = grade 4 (FSRS Good)；不认识 = grade 1 (FSRS Again)。
   顶部「← 上一词」可回看，回看仅展示不重复计分（FSRS 状态机不受影响）。 */
function renderStudyWord() {
  var w = ST.words[ST.idx];
  if (!w) { renderStudyDone(); return; }
  var history = ST.idx < ST.done; // 回看模式
  var graded = ST.grades[w.id];

  var nav = '<div class="study-nav">' +
    (ST.idx > 0
      ? '<button class="btn btn-ghost btn-sm" id="btn-back">← 上一词</button>'
      : '<span></span>') +
    '<button class="btn btn-ghost btn-sm" id="btn-exit">✕ 结束</button>' +
    '</div>';

  var actions;
  if (history) {
    actions =
      '<div class="study-graded">已记为：<b>' + (graded === 4 ? '✓ 认识' : '✗ 不认识') + '</b>' +
      '<span class="muted">（回看不重复计分）</span></div>' +
      '<button class="btn btn-primary" id="btn-fwd" style="width:100%">下一词 →</button>';
  } else {
    actions =
      '<div class="study-grade-btns">' +
        '<button class="btn btn-primary" id="btn-know">✓ 认识</button>' +
        '<button class="btn btn-ghost" id="btn-unknown">✗ 不认识</button>' +
      '</div>';
  }

  app.innerHTML = studyProgressHtml('学习 · 展示') + nav +
    '<div id="word-card-zone">' + wordCardHtml(w, true) + '</div>' +
    exampleHtml(w) +
    '<div style="margin-top:10px"><button class="btn btn-ghost" id="btn-detail" style="width:100%">查看详解 · 音形义用记</button></div>' +
    '<div id="study-actions" style="margin-top:16px">' + actions + '</div>';

  bindWordCard(w);
  var db = $('#btn-detail');
  if (db) db.addEventListener('click', function () { openWordDetail(w.id); });
  var bb = $('#btn-back');
  if (bb) bb.addEventListener('click', function () { if (ST.idx > 0) { ST.idx--; renderStudyWord(); } });
  var exb = $('#btn-exit');
  if (exb) exb.addEventListener('click', function () { ST = null; if (location.hash !== '#/study') location.hash = '#/study'; navigate(); });
  var fw = $('#btn-fwd');
  if (fw) fw.addEventListener('click', function () { ST.idx++; renderStudyWord(); });
  if (!history) {
    $('#btn-know').addEventListener('click', function () { studyGrade(w, true); });
    $('#btn-unknown').addEventListener('click', function () { studyGrade(w, false); });
  }
}

/* 新词评分：认识=4(Good) / 不认识=1(Again) */
var _studyGrading = false;
function studyGrade(w, know) {
  if (_studyGrading) return;
  _studyGrading = true;
  var grade = know ? 4 : 1;
  api('/study/answer', 'POST', { word_id: w.id, grade: grade }).catch(function () { /* 离线也继续 */ });
  if (know) { celebrate(); vibrate(20); toast('记住了！'); }
  else { toast('已记下，记得回来复习'); }
  ST.grades[w.id] = grade;
  ST.counted++; ST.batch.push(w.id);
  ST.idx++; ST.done++;
  later(function () {
    _studyGrading = false;
    if (maybeMiniQuiz()) return; // 每 5 词快闪小测
    renderStudyWord();
  }, know ? 450 : 300);
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
/* ---- study 作答 ---- */
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
  } else if (type === 'sample') {
    // v0.6 官方样题：题干 + 4 选项（JEES 免费样题）
    var sec = q.prompt.section === 'grammar' ? '〈文法〉' : '〈文字词汇〉';
    body = '<div class="question-stem jp" style="font-size:18px;line-height:1.8;text-align:left;white-space:pre-wrap">' +
      esc(sec + '\n' + (q.prompt.stem || '')) + '</div>' +
      '<div class="options">' + (q.options || []).map(function (o, i) {
        return '<button class="option glass" data-i="' + i + '"><span class="jp">' + esc(o) + '</span></button>';
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
    '<button class="btn btn-ghost btn-sm" id="btn-mq-exit">✕ 结束</button>' +
    '<div class="quiz-progress"><div class="bar"><i style="width:' + Math.round(MQ.idx / total * 100) + '%"></i></div>' +
    '<div class="txt">第 ' + (MQ.idx + 1) + ' / ' + total + ' 题 · ' + (TYPE_LABEL[q.type] || '') + '</div></div></div>' +
    quizQBody(q) +
    '<div id="fb-zone"></div>' +
    '<div id="q-next" class="hidden" style="margin-top:16px"><button class="btn btn-primary" id="btn-mq-next">' +
    (MQ.idx === total - 1 ? '交卷' : '下一题') + '</button></div>';
  bindMiniQ(q);
  var mqe = $('#btn-mq-exit');
  if (mqe) mqe.addEventListener('click', function () { MQ = null; renderStudyWord(); });
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
    // 错词回炉：逐个 POST /api/study/answer {grade: 0}（wrong 可能是 word_id 字符串或详情对象）
    var chain = Promise.resolve();
    wrongIds.forEach(function (x) {
      var wid = (typeof x === 'string') ? x : x.word_id;
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
    RV = { words: words, idx: 0, done: 0, flipped: false, grades: {} };
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
  var history = RV.idx < RV.done; // 回看模式：仅展示，不重复计分
  var graded = RV.grades[w.id];
  RV.flipped = false;

  var nav = '<div class="study-nav">' +
    (RV.idx > 0
      ? '<button class="btn btn-ghost btn-sm" id="btn-rv-back">← 上一词</button>'
      : '<span></span>') +
    '<button class="btn btn-ghost btn-sm" id="btn-rv-exit">✕ 结束</button>' +
    '</div>';

  var meaningBlock =
    '<div id="review-back" class="' + (history ? '' : 'hidden') + '" style="margin-top:14px;border-top:1px solid var(--glass-border);padding-top:16px">' +
      '<div style="font-size:17px">' + esc(w.display_meaning) +
      (w.meaning_is_en_fallback ? '<span class="badge-en">英文暂代</span>' : '') + mtBadge(w) + '</div>' +
    '</div>';

  var actions;
  if (history) {
    var glabel = graded === 5 ? '✓ 认识' : (graded === 3 ? '～ 模糊' : '✗ 忘记');
    actions =
      '<div class="study-graded">已记为：<b>' + glabel + '</b>' +
      '<span class="muted">（回看不重复计分）</span></div>' +
      '<button class="btn btn-primary" id="btn-rv-fwd" style="width:100%">下一张 →</button>';
  } else {
    actions =
      '<div class="review-actions" id="grade-btns">' +
        '<button class="btn grade-forgot" data-grade="0">忘记</button>' +
        '<button class="btn grade-fuzzy" data-grade="3">模糊</button>' +
        '<button class="btn grade-know" data-grade="5">认识</button>' +
      '</div>';
  }

  app.innerHTML =
    '<div class="quiz-progress"><div class="bar"><i style="width:' +
    Math.round(RV.idx / RV.words.length * 100) + '%"></i></div>' +
    '<div class="txt">' + (RV.idx + 1) + ' / ' + RV.words.length + ' · 复习翻牌</div></div>' + nav +
    '<div class="glass word-card" id="review-card">' +
      '<div class="word-kanji">' + wordFaceRuby(w) + '</div>' +
      (w.romaji ? '<div class="word-romaji">' + esc(w.romaji) + '</div>' : '') +
      '<div><button class="speaker-btn" id="btn-speak" aria-label="朗读">' + SPEAKER_SVG + '</button></div>' +
      meaningBlock +
    '</div>' +
    (history ? '<div style="margin-top:14px">' + exampleHtml(w) + '</div>' : '') +
    '<div id="rv-actions" style="margin-top:14px">' + actions + '</div>' +
    '<div style="margin-top:10px"><button class="btn btn-ghost" id="btn-detail" style="width:100%">查看详解 · 音形义用记</button></div>';

  $('#btn-speak').addEventListener('click', function () { speak(w.kana); });
  var rb = $('#btn-rv-back');
  if (rb) rb.addEventListener('click', function () { if (RV.idx > 0) { RV.idx--; renderReviewCard(); } });
  var rvex = $('#btn-rv-exit');
  if (rvex) rvex.addEventListener('click', function () { RV = null; if (location.hash !== '#/study') location.hash = '#/study'; navigate(); });
  var fw = $('#btn-rv-fwd');
  if (fw) fw.addEventListener('click', function () { RV.idx++; renderReviewCard(); });

  if (!history) {
    // 正常翻牌流程：先回想 → 点三档 → 揭晓释义+例句 → 下一张
    var nextHtml = exampleHtml(w) +
      '<div style="margin-top:16px"><button class="btn btn-primary" id="btn-rv-next">下一张</button></div>';
    $$('#grade-btns .btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (RV.flipped) return;
        RV.flipped = true;
        var grade = parseInt(btn.getAttribute('data-grade'), 10);
        api('/review/answer', 'POST', { word_id: w.id, grade: grade }).catch(function () {});
        RV.grades[w.id] = grade;
        RV.done++;
        if (grade === 5) celebrate();
        $('#review-back').classList.remove('hidden');
        $('#grade-btns').classList.add('hidden');
        $('#rv-actions').innerHTML = nextHtml;
        $('#btn-rv-next').addEventListener('click', function () {
          RV.idx++;
          renderReviewCard();
        });
      });
    });
  }
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
    /* 用：最多 3 条例句（日文+振假名+中英译文） */
    var exs = (w.examples || []).slice(0, 3);
    if (exs.length) {
      secs.push(
        '<section class="glass detail-sec">' +
        '<h3 class="detail-sec-title">用 <span class="detail-sec-en">EXAMPLES</span></h3>' +
        exs.map(function (e) {
          return '<div class="detail-ex">' +
            '<div class="ex-ja">' + furiganaToRuby(e.furigana || e.ja) + '</div>' +
            exTransHtml(e) +
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
var QUIZ_COUNTS = [20, 30, 50];
var QUIZ_SEC_PER_Q = 30; // 每题 30 秒

function renderQuiz() {
  // 设置页：模式 + 级别 + 题量选择 + 开始
  var levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
  var sel = QZ && QZ.level ? QZ.level : 'N5';
  var selCount = QZ && QZ.count ? QZ.count : 20;
  var selMode = QZ && QZ.mode ? QZ.mode : 'normal';
  var MODES = [
    { key: 'normal', name: '词汇模考', desc: '按级别随机出题' },
    { key: 'exam_freq', name: '真题高频', desc: '按 2010-2025 真题考频加权' },
    { key: 'jees_sample', name: '官方样题', desc: 'JEES 官网免费样题（文字词汇·文法）' },
  ];
  app.innerHTML =
    '<h2 class="page-title">模拟考试</h2>' +
    '<p class="page-sub">词汇专项 · 计时作答 · 交卷出成绩单</p>' +
    '<div class="glass panel" style="margin-top:16px">' +
      '<h3>选择模式</h3>' +
      '<div class="level-pills">' +
      MODES.map(function (m) {
        return '<button class="level-pill mode-pill' + (m.key === selMode ? ' active' : '') + '" data-m="' + m.key + '">' + m.name + '</button>';
      }).join('') +
      '</div>' +
      '<div class="muted" id="quiz-mode-desc" style="font-size:12px;margin:4px 0 12px"></div>' +
      '<h3>选择级别</h3>' +
      '<div class="level-pills">' +
      levels.map(function (lv) {
        return '<button class="level-pill' + (lv === sel ? ' active' : '') + '" data-lv="' + lv + '">' + lv + '</button>';
      }).join('') +
      '</div>' +
      '<h3 style="margin-top:18px">题量</h3>' +
      '<div class="level-pills">' +
      QUIZ_COUNTS.map(function (c) {
        return '<button class="level-pill count-pill' + (c === selCount ? ' active' : '') + '" data-c="' + c + '">' + c + ' 题</button>';
      }).join('') +
      '</div>' +
      '<div class="muted" id="quiz-desc" style="font-size:13px;margin-bottom:16px"></div>' +
      '<button class="btn btn-indigo" id="btn-quiz-start">开始模考</button>' +
    '</div>';

  var level = sel, count = selCount, mode = selMode;
  var descEl = null, modeDescEl = null;
  function paintDesc() {
    if (descEl) descEl.textContent = count + ' 题 · 限时 ' + Math.round(count * QUIZ_SEC_PER_Q / 60) + ' 分钟，题型覆盖看词选义 / 看义选词 / 听音选义。';
  }
  function paintModeDesc() {
    var m = null;
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === mode) m = MODES[i];
    if (modeDescEl && m) modeDescEl.textContent = m.desc;
  }
  $$('.level-pill[data-lv]').forEach(function (p) {
    p.addEventListener('click', function () {
      $$('.level-pill[data-lv]').forEach(function (x) { x.classList.remove('active'); });
      p.classList.add('active');
      level = p.getAttribute('data-lv');
    });
  });
  $$('.count-pill').forEach(function (p) {
    p.addEventListener('click', function () {
      $$('.count-pill').forEach(function (x) { x.classList.remove('active'); });
      p.classList.add('active');
      count = parseInt(p.getAttribute('data-c'), 10) || 20;
      paintDesc();
    });
  });
  descEl = $('#quiz-desc');
  modeDescEl = $('#quiz-mode-desc');
  paintDesc(); paintModeDesc();
  $$('.mode-pill').forEach(function (p) {
    p.addEventListener('click', function () {
      $$('.mode-pill').forEach(function (x) { x.classList.remove('active'); });
      p.classList.add('active');
      mode = p.getAttribute('data-m');
      paintModeDesc();
    });
  });
  $('#btn-quiz-start').addEventListener('click', function () {
    startQuiz(level, count, mode);
  });
}

function startQuiz(level, count, mode) {
  count = count || 20;
  mode = mode || 'normal';
  app.innerHTML = loadingHtml('正在生成试卷…');
  api('/quiz/start', 'POST', { level: level, count: count, mode: mode }).then(function (d) {
    var qs = d.questions || [];
    if (!qs.length) { toast('暂无题目'); renderQuiz(); return; }
    var seconds = qs.length * QUIZ_SEC_PER_Q;
    QZ = {
      level: level,
      count: qs.length,
      mode: mode,
      questions: qs,
      idx: 0,
      answers: [],
      left: seconds,
      totalSeconds: seconds,
      startedAt: Date.now(),
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
  var mm0 = Math.floor(QZ.left / 60), ss0 = QZ.left % 60;

  var head =
    '<div class="quiz-info"><span class="muted" style="font-size:13px">第 ' + (QZ.idx + 1) + ' / ' + total + ' 题 · ' +
    (TYPE_LABEL[type] || '') + '</span>' +
    '<span><button class="btn btn-ghost btn-sm" id="btn-q-exit" style="margin-right:8px">✕ 放弃</button>' +
    '<span class="timer" id="quiz-timer">' + (mm0 < 10 ? '0' : '') + mm0 + ':' + (ss0 < 10 ? '0' : '') + ss0 + '</span></span></div>' +
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
  var qex = $('#btn-q-exit');
  if (qex) qex.addEventListener('click', function () {
    confirmModal('放弃模考', '确定放弃本次模考吗？已作答的不计分。', '放弃').then(function (yes) {
      if (yes) { QZ = null; clearTimers(); renderQuiz(); }
    });
  });
}

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
  // 用时：以 QZ.startedAt 为准；若无则用倒计时反推
  var usedSec = 0;
  if (QZ && QZ.startedAt) usedSec = Math.max(0, Math.round((Date.now() - QZ.startedAt) / 1000));
  else if (QZ && QZ.totalSeconds != null) usedSec = Math.max(0, QZ.totalSeconds - (QZ.left || 0));
  var um = Math.floor(usedSec / 60), us = usedSec % 60;
  var timeTxt = (um > 0 ? um + '分' : '') + us + '秒';
  celebrate();

  var modeLabel = '';
  if (QZ && QZ.mode === 'jees_sample') modeLabel = ' · <span style="color:var(--vermilion)">官方样题</span>';
  else if (QZ && QZ.mode === 'exam_freq') modeLabel = ' · <span style="color:var(--vermilion)">真题高频</span>';

  app.innerHTML =
    '<div class="glass score-wrap">' +
    '<div class="muted" style="font-size:12px;margin-bottom:8px">' + esc(QZ.level || '') + ' 模考' + modeLabel + '</div>' +
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
      '<div class="score-meta"><span>正确率 ' + Math.round(pct * 100) + '%</span><span>·</span><span>用时 ' + timeTxt + '</span></div>' +
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

    '<div class="glass setting-card">' +
      '<h3>每日学习目标</h3>' +
      '<div class="goal-stepper">' +
        '<button class="btn btn-ghost" id="goal-minus" aria-label="减少">−</button>' +
        '<span class="goal-val"><b id="goal-num">30</b><span class="muted"> 词 / 天</span></span>' +
        '<button class="btn btn-ghost" id="goal-plus" aria-label="增加">＋</button>' +
      '</div>' +
      '<p class="muted seg-note">1–200 之间，首页今日进度环按此目标计算。</p>' +
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
      '<h3>发音设置</h3>' +
      '<div style="margin-bottom:10px"><label class="muted" style="font-size:13px">发音人</label>' +
      '<select id="sel-voice" class="input" style="width:100%;margin-top:4px"><option value="">系统默认</option></select></div>' +
      '<div><label class="muted" style="font-size:13px">语速 <span id="rate-val" class="muted"></span></label>' +
      '<input type="range" id="range-rate" min="0.5" max="1.2" step="0.1" value="0.8" style="width:100%">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px" class="muted"><span>慢</span><span>快</span></div></div>' +
      '<button class="btn btn-ghost btn-sm" id="btn-voice-test" style="margin-top:8px">试听</button>' +
    '</div>' +

    '<div class="glass about-card">' +
      '<h3>关于数据</h3>' +
      '词库来源：OpenJLPT、JMdict-EDICT，例句来自 Tatoeba。<br>' +
      '以上数据均以 CC BY-SA 4.0 协议共享，版权归各自贡献者所有。<br>' +
      '语屿 Kotoba · 每天十五分钟，筑一座日语之岛。<br>' +
      '<span class="muted">版本 v' + APP_VERSION + '</span> ' +
      '<button class="btn btn-ghost btn-sm" id="btn-check-update" style="margin-left:8px">检查更新</button>' +
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

  // 回显已绑定信息、语言偏好与每日目标
  api('/auth/me').then(function (me) {
    if (me.email) $('#in-email').value = me.email;
    if (me.phone) $('#in-phone').value = me.phone;
    if (me.username) localStorage.setItem('yuyu_username', me.username);
    if (me.lang === 'zh' || me.lang === 'en') {
      localStorage.setItem(LANG_KEY, me.lang);
      paintLangSeg(me.lang);
    }
    paintGoal(me.daily_goal || 30);
  }).catch(function () { /* 忽略回显失败 */ });

  // 每日学习目标步进器：PUT /api/auth/profile {daily_goal}
  var goalTimer = null;
  function paintGoal(v) {
    v = Math.max(1, Math.min(200, parseInt(v, 10) || 30));
    var el = $('#goal-num');
    if (el) el.textContent = v;
    return v;
  }
  function saveGoal(v) {
    v = paintGoal(v);
    if (goalTimer) clearTimeout(goalTimer);
    goalTimer = setTimeout(function () {
      api('/auth/profile', 'PUT', { daily_goal: v }).then(function () {
        toast('每日目标已设为 ' + v + ' 词');
      }).catch(function (err) {
        toast((err && err.message) || '保存失败');
      });
    }, 600);
  }
  var gm = $('#goal-minus'), gp = $('#goal-plus');
  if (gm) gm.addEventListener('click', function () {
    saveGoal((parseInt($('#goal-num').textContent, 10) || 30) - 1);
  });
  if (gp) gp.addEventListener('click', function () {
    saveGoal((parseInt($('#goal-num').textContent, 10) || 30) + 1);
  });

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
  initVoiceSettings();
  // 手动检查更新：强制刷新 SW，发现新版走热更新流程
  var cbu = $('#btn-check-update');
  if (cbu) cbu.addEventListener('click', function () {
    if (!('serviceWorker' in navigator)) { toast('当前浏览器不支持'); return; }
    cbu.disabled = true;
    cbu.textContent = '检查中…';
    var done = function (msg) { toast(msg); cbu.disabled = false; cbu.textContent = '检查更新'; };
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { done('未启用离线功能'); return; }
      var found = false;
      var onUpdate = function () { found = true; };
      reg.addEventListener('updatefound', onUpdate);
      reg.update().then(function () {
        setTimeout(function () {
          reg.removeEventListener('updatefound', onUpdate);
          // 若 3 秒内无新版，controllerchange 也不会触发，说明已是最新
          setTimeout(function () { if (!found) done('已是最新版本 v' + APP_VERSION); }, 3000);
        }, 500);
      }).catch(function () { done('检查失败，请稍后重试'); });
    }).catch(function () { done('检查失败，请稍后重试'); });
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
