/* Original layered SVG scenery. No image, external font, WebGL or build step. */
'use strict';
var mapLoadId = 0;
var mapVoyageBook = null;
var MAP_PLACES = [
  { x: 392, y: 866, scale: 1.15, labelX: 68, labelY: 88, nodeX: 488, nodeY: 854 },
  { x: 205, y: 657, scale: .98, labelX: 23, labelY: 68, nodeX: 259, nodeY: 655 },
  { x: 486, y: 461, scale: .96, labelX: 75, labelY: 49, nodeX: 560, nodeY: 460 },
  { x: 254, y: 282, scale: .82, labelX: 27, labelY: 30, nodeX: 300, nodeY: 284 },
  { x: 474, y: 132, scale: .69, labelX: 75, labelY: 15, nodeX: 525, nodeY: 135 }
];
function mapIcon(name) {
  var paths = {
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5zM12 1v2M12 21v2"/>',
    lock: '<rect x="6" y="10" width="12" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    book: '<path d="M12 5v15M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    leaf: '<path d="M20 3C8 1 2 8 7 14s14 3 13-11ZM5 21 16 9M11 14v7"/>',
    star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z"/>',
    flag: '<path d="M5 22V3c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.compass) + '</svg>';
}
function mapScenery() {
  var s = '<svg class="archipelago-art" viewBox="0 0 720 1020" fill="none" aria-hidden="true"><defs>' +
    '<linearGradient id="map-sea" x2=".3" y2="1"><stop stop-color="#82cedc"/><stop offset=".4" stop-color="#228cac"/><stop offset="1" stop-color="#0c4c7b"/></linearGradient>' +
    '<linearGradient id="map-rock" x2=".8" y2="1"><stop stop-color="#9cbdbe"/><stop offset=".42" stop-color="#597a92"/><stop offset="1" stop-color="#294c72"/></linearGradient>' +
    '<linearGradient id="map-grass" x2=".4" y2="1"><stop stop-color="#c9dca1"/><stop offset=".6" stop-color="#7eae80"/><stop offset="1" stop-color="#447868"/></linearGradient>' +
    '<linearGradient id="map-snow" x2=".7" y2="1"><stop stop-color="#fff9ef"/><stop offset=".6" stop-color="#c6dfe8"/><stop offset="1" stop-color="#8faac7"/></linearGradient>' +
    '<linearGradient id="map-fuji" x2="1" y2=".6"><stop stop-color="#b7cfdf"/><stop offset=".45" stop-color="#5e7da5"/><stop offset="1" stop-color="#324e77"/></linearGradient>' +
    '<radialGradient id="map-lagoon"><stop stop-color="#83efe0"/><stop offset="1" stop-color="#4cc7ce" stop-opacity="0"/></radialGradient>' +
    '<pattern id="map-ripples" width="104" height="67" patternUnits="userSpaceOnUse"><path d="M8 16q10-3 21 0m23 34q16-4 31 0M-8 51h13m82-39h14" stroke="#d4f5f0" stroke-width="1.2" opacity=".25"/></pattern>' +
    '<symbol id="map-pine" viewBox="-24 -80 48 90"><path d="M-3-45h6V8h-6" fill="#856c61"/><path d="m0-78-18 29h9l-15 24h14L-24-4h48L10-25h14L9-49h9Z" fill="#245f62"/><path d="m0-78-9 29h5l-8 24h7L-12-4H0Z" fill="#559078"/></symbol>' +
    '<symbol id="map-blossom" viewBox="-40 -90 80 100"><path d="M-4 4 0-56l5 9 1 51M0-25l-20-20m23 8 17-19" stroke="#8a6065" stroke-width="6"/><g fill="#e99eb5"><circle cx="-20" cy="-51" r="17"/><circle cx="19" cy="-55" r="17"/><circle cy="-68" r="21"/><circle cy="-43" r="24"/></g><g fill="#ffd9df"><circle cx="-21" cy="-57" r="12"/><circle cx="-4" cy="-72" r="16"/><circle cx="18" cy="-59" r="13"/><circle cx="3" cy="-47" r="16"/></g><g fill="#fff0e9"><circle cx="-10" cy="-73" r="4"/><circle cx="13" cy="-53" r="4"/><circle cx="-22" cy="-52" r="3"/><circle cx="2" cy="-35" r="3"/></g></symbol>' +
    '<symbol id="map-maple" viewBox="-35 -88 70 98"><path d="M-3 6V-60h6V6" fill="#806156"/><path d="m0-84 9 16 15-4-2 15 13 11-16 7 3 16-19-4L0-9l-9-18-19 5 4-18-12-9 17-9-2-14 15 5Z" fill="#e67c52"/><path d="m0-84 9 16 15-4-2 15-15 9-7 20-9-17-12-13-2-14 15 5Z" fill="#ffc078"/></symbol>' +
    '<symbol id="map-torii" viewBox="-60 -100 120 120"><path d="m-37-68-4 78h11l4-78m52 0 4 78h11l-4-78" fill="#bd493c"/><path d="M-48-80h96v11h-96m8 19h80v8h-80" fill="#ed7654"/><path d="M-58-91Q0-74 58-91l-5 12Q0-67-53-79Z" fill="#304958"/><path d="M-10-67h20v20h-20" fill="#d8a755"/></symbol>' +
    '<symbol id="map-shrine" viewBox="-70 -100 140 120"><path d="M-49-51h98V9h-98" fill="#e89168"/><path d="M-40-47h80V6h-80" fill="#ffe0a5"/><path d="M-9-41H9V6H-9m-31-38h13v22h-13m54-22h13v22H27" fill="#956252"/><path d="M-48-51v62m96-62v62M-20-51v60m40-60v60" stroke="#bc5145" stroke-width="5"/><path d="M-68-50Q-28-54 0-88 28-54 68-50L54-39Q0-42-54-39Z" fill="#344d62"/><path d="M-67-50Q-28-54 0-88 28-54 67-50M-51-45H51" stroke="#97b0b7" stroke-width="3"/><path d="M-55 12H55m-61 6H61" stroke="#e5c79c" stroke-width="6"/></symbol>' +
    '<symbol id="map-lantern" viewBox="-10 -34 20 40"><path d="M-2-23h4V5h-4" fill="#a09075"/><path d="M-8-25h16L0-32Z" fill="#49656d"/><rect x="-6" y="-24" width="12" height="11" rx="2" fill="#ffe5a4"/><path d="M-8-12H8" stroke="#998267" stroke-width="3"/></symbol>' +
    '<symbol id="map-cloud" viewBox="0 0 220 70"><path d="M14 59C-8 49 8 29 36 34 28 5 66-6 91 16 102-9 141 0 147 24 183 11 205 30 193 44 225 40 230 62 200 64H14Z" fill="#f0fbf7"/></symbol>' +
    '</defs><rect width="720" height="1020" fill="url(#map-sea)"/><rect width="720" height="1020" fill="url(#map-ripples)"/>' +
    '<ellipse cx="20" cy="80" rx="410" ry="180" fill="#ffe3b1" opacity=".18"/><path d="M0 70 90 21 160 65 209 45 278 89 0 130M520 45l70-40 130 69v62Z" fill="#afdae1" opacity=".5"/>';
  // Little rock stacks, reflections and shoals give the sea depth without filters.
  [[63,213,1],[665,301,.8],[71,480,1.1],[645,700,1],[81,897,.7],[630,980,.8]].forEach(function (p) {
    s += '<g transform="translate(' + p[0] + ' ' + p[1] + ') scale(' + p[2] + ')"><ellipse cy="14" rx="35" ry="12" fill="#6cdad6" opacity=".45"/><path d="m-18 5 8-43 14-15 11 50 12 18Z" fill="url(#map-rock)"/><path d="m-10-38 14-15-2 42-11 12Z" fill="#c3d6d0"/><path d="M-34 14q34 17 66 0" stroke="#c6f8ed" stroke-width="3"/></g>';
  });
  // The path is built from separate stepping stones, with a gold navigation thread.
  var route = [[488,854],[451,810],[391,776],[323,742],[259,655],[310,614],[389,581],[464,543],[560,460],[501,416],[435,383],[365,349],[300,284],[350,243],[411,209],[473,176],[525,135]];
  s += '<path d="M' + route.map(function(p){return p.join(' ');}).join(' L') + '" stroke="#f6d9a4" stroke-width="5" stroke-dasharray="3 12" opacity=".85"/>';
  route.forEach(function (p, i) {
    if (i % 4 === 0) return;
    s += '<g><path d="M' + (p[0]-17) + ' ' + p[1] + 'v12q17 15 34 0v-12" fill="#7697a0"/><ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="23" ry="10" fill="#f1d9ad" stroke="#fff4cc" stroke-width="2"/><ellipse cx="' + p[0] + '" cy="' + (p[1]-1) + '" rx="16" ry="6" fill="#d8b27b"/><path d="M' + (p[0]-10) + ' ' + (p[1]-1) + 'h20" stroke="#ffeac3" stroke-width="2"/></g>';
  });
  // Far islands first. All scenery and controls share the same coordinate system.
  [4,3,2,1,0].forEach(function (i) {
    var p = MAP_PLACES[i];
    s += '<g class="map-land map-land-' + i + '" transform="translate(' + p.x + ' ' + p.y + ') scale(' + p.scale + ')">';
    s += '<ellipse cy="65" rx="182" ry="64" fill="url(#map-lagoon)"/><path d="M-142 6C-126-31-76-44-20-39 55-56 125-23 143 8L127 78 91 103 44 83 7 109-44 86-92 98-136 61Z" fill="url(#map-rock)"/>';
    s += '<path d="m-128 12 9 57 18 19 7-70m36 3-5 62 19-5 9-63m66 6 11 60 18-10-8-59m44-1-9 68 19-24 8-47" stroke="#c5d4c5" stroke-width="6" opacity=".4"/>';
    s += '<path d="M-142 6C-126-31-76-44-20-39 55-56 125-23 143 8 138 32 91 55 44 43 3 65-29 40-66 48-105 39-132 31-142 6Z" fill="#ecddbc"/>';
    s += '<path d="M-128 1C-97-27-68-29-18-28 59-44 113-18 128 7 113 30 72 39 41 31-3 49-28 28-61 36-94 30-117 24-128 1Z" fill="' + (i===4 ? 'url(#map-snow)' : 'url(#map-grass)') + '"/>';
    s += '<path d="M-151 61q-15 32 13 34m-3 2q31 15 61 7m131 8q53 7 90-26m-8 15 19-7" stroke="#d9fff6" stroke-width="3" opacity=".8"/>';
    // Waterfalls: translucent ribbons, no expensive turbulence or blur.
    s += '<g class="map-waterfall"><path d="M-85 36q12 21 7 56l13 4q-5-39-7-60M80 35q-2 36 11 62l10-6q-13-31-9-61" fill="#a7edf0" opacity=".8"/><path d="M-78 41v45m166-47 9 45" stroke="#f0fffa" stroke-width="3"/></g>';
    function use(id,x,y,w,h) { return '<use href="#map-' + id + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>'; }
    if (i === 2 || i === 4) {
      s += '<path d="m-110-13 94-153 37-15L128-1Z" fill="url(#map-fuji)"/><path d="m-54-105 38-61 37-15 48 74-27-12-9 17-20-17-16 19-15-12Z" fill="url(#map-snow)"/><path d="m21-179-8 60 19 50L47-9m-63-155-9 69-39 70" stroke="#e6f1ef" stroke-width="3" opacity=".4"/>';
      s += '<ellipse cx="20" cy="18" rx="48" ry="14" fill="#68d5cf" stroke="#e5eac4" stroke-width="4"/>';
    }
    [[-117,-60,38,76],[-80,-79,40,80],[72,-65,38,76],[100,-41,30,60],[-15,-40,28,56]].forEach(function(t) {
      s += use(i===0 ? 'blossom' : (i===3 ? 'maple' : 'pine'),t[0],t[1],t[2],t[3]);
    });
    s += '<path d="M-14 38q-58-10-28-39" stroke="#f3deb5" stroke-width="13"/><path d="M-14 38q-58-10-28-39" stroke="#bda885" stroke-width="1.5" stroke-dasharray="2 5"/>';
    if (i===1) s += use('shrine',-77,-94,116,100) + use('torii',-23,-100,104,104);
    else if (i===3 || i===4) {
      s += use('shrine',-65,-105,104,89) + use('shrine',-58,-145,90,77) + use('shrine',-45,-176,65,56);
    } else s += use('shrine',-54,-85,100,86);
    if (i===0) {
      s += '<path d="M-87 32q46-48 91-3" stroke="#b94d4a" stroke-width="8"/><path d="M-87 23q46-48 91-3" stroke="#f2ad88" stroke-width="3"/>';
      [[-149,-20,63,78],[64,-28,61,76],[-95,10,54,68],[21,-47,58,73],[-120,-102,60,75],[54,-106,58,73]].forEach(function(t){s+=use('blossom',t[0],t[1],t[2],t[3]);});
    }
    s += use('lantern',-25,0,15,30) + use('lantern',52,6,15,30) + '</g>';
  });
  s += '<g class="map-boat" transform="translate(624 790)"><ellipse cy="28" rx="45" ry="7" fill="#c7f4ee" opacity=".45"/><path d="m-35 8 65-4-14 23h-30Z" fill="#724d4d"/><path d="M-3-64V12" stroke="#e6c894" stroke-width="4"/><path d="M-7-61Q-44-30-31-3H-7Z" fill="#fff1ce"/><path d="M1-57Q27-30 22-4H1Z" fill="#f8d5b4"/><circle cx="9" cy="-24" r="5" fill="#c76353"/></g>';
  [[-40,340,210,.65],[555,555,220,.5],[-70,760,190,.45],[85,62,160,.5],[585,80,160,.45]].forEach(function(p,i) {
    s += '<use class="map-cloud cloud-' + i + '" href="#map-cloud" x="' + p[0] + '" y="' + p[1] + '" width="' + p[2] + '" height="70" opacity="' + p[3] + '"/>';
  });
  s += '<g stroke="#f4fffa" stroke-width="4" stroke-linecap="round"><path d="m86 563 17 13 20-15m440-213 13 10 16-12m-76 372 16 11 16-13"/></g>';
  s += '<g class="map-petals" fill="#fbd6df">';
  [[100,800],[600,885],[570,963],[164,957],[340,840],[54,620],[611,408],[311,93]].forEach(function(p,i){ s += '<ellipse cx="'+p[0]+'" cy="'+p[1]+'" rx="5" ry="10" transform="rotate('+(i*37)+' '+p.join(' ')+')"/>'; });
  return s + '</g></svg>';
}
function mapTraveler() {
  return '<svg viewBox="0 0 80 116" aria-hidden="true"><ellipse cx="40" cy="109" rx="23" ry="5" fill="#193b59" opacity=".25"/><g class="traveler-bob"><path d="m26 84 7 22h9l-3-25m8 0 6 23h9L56 78" fill="#5a4559"/><path d="m27 103 15 2v7H25m28-9 12 2v7H52" fill="#744b48"/><path d="M23 42q-9 17-7 34l20 9 25-14-4-28Z" fill="#65453e"/><path d="m30 51-12 25 12 8 26-3-1-30" fill="#fff1da"/><path d="m29 74-8 19 38-2-7-19" fill="#637b9c"/><path d="m53 54 12 15 10-6" stroke="#ffe0c0" stroke-width="7" stroke-linecap="round"/><rect x="27" y="56" width="22" height="27" rx="6" fill="#b97f58" stroke="#6c4c42" stroke-width="2"/><path d="M31 63h14m-7-7v27" stroke="#e5ba83" stroke-width="2"/><ellipse cx="40" cy="36" rx="16" ry="20" fill="#ffe0c0"/><path d="M23 43V27q18-19 34 3v18l-8-9-2-14-19 18Z" fill="#684439"/><ellipse cx="38" cy="23" rx="32" ry="10" fill="#d1a46c" transform="rotate(-13 38 23)"/><path d="M18 24q-4-27 22-24 17 2 19 15" fill="#efd09c"/><path d="M18 19q20 5 37-8" stroke="#b96562" stroke-width="5"/><path d="m16 21-9 10 12-3" fill="#d47c7c"/></g></svg>';
}
function mapMotionReduced() {
  return localStorage.getItem('yuyu_map_motion') === 'reduce' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !!(navigator.connection && navigator.connection.saveData) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
}
function updateMapMotion() {
  document.body.classList.toggle('map-reduced', !!mapMotionReduced());
  var button = $('#map-motion');
  if (button) { button.setAttribute('aria-pressed', String(!!mapMotionReduced())); button.textContent = mapMotionReduced() ? '静谧模式 · 开' : '静谧模式'; }
}
function renderArchipelago() {
  var loadId = ++mapLoadId;
  app.innerHTML = '<div class="map-loading" role="status">' + mapIcon('compass') + '<p>展开你的日语海图…</p></div>';
  updateMapMotion();
  Promise.all([api('/home/summary'), api('/books'), api('/island').catch(function(){return null;}), api('/starred?per_page=1').catch(function(){return null;})]).then(function(res) {
    if (loadId !== mapLoadId || currentRoute() !== 'home') return;
    if (!Array.isArray(res[1])) throw new Error('词书进度暂不可用');
    var summary = res[0], model = KotobaMapModel.build(res[1]);
    var active = model.active, selected = active, islandStats = res[2];
    var descriptions = ['はじめの一歩', 'つながる会話', '広がる表現の海', '言葉が彩る世界', 'もっと広い世界へ'];
    var goal = summary.daily_goal || 30, learned = summary.today_learned || 0;
    var labels = '', nodes = '';
    model.islands.forEach(function(island,i) {
      var p = MAP_PLACES[i], state = island.complete ? 'complete' : (island.locked ? 'locked' : 'open');
      labels += '<button type="button" class="map-island-label ' + state + '" data-island="' + i + '" style="--x:' + p.labelX + '%;--y:' + p.labelY + '%" aria-pressed="' + (island===active) + '" aria-label="' + island.level + ' ' + island.name + '，' + (island.locked ? '待解锁，可查看详情' : '已学 ' + island.studied + ' / ' + island.total + ' 词') + '"><span class="island-seal">' + mapIcon(island.complete?'check':island.locked?'lock':'flag') + '</span><span><strong>' + island.level + ' ' + island.name + '</strong><small lang="ja">' + descriptions[i] + '</small></span></button>';
      nodes += '<button type="button" class="map-node ' + state + (island===active?' current':'') + '" data-node="' + i + '" style="--x:' + (p.nodeX/7.2) + '%;--y:' + (p.nodeY/10.2) + '%" aria-label="查看' + island.name + '航段进度">' + mapIcon(island.complete?'check':island.locked?'lock':'star') + '</button>';
    });
    var p = MAP_PLACES[model.islands.indexOf(active)];
    app.innerHTML = '<div class="voyage-layout"><header class="voyage-intro"><div class="map-eyebrow">A LITTLE EVERY DAY, AN ISLAND OF YOUR OWN</div><h1 class="map-brand">语屿<span class="brand-flower">✿</span></h1><div class="map-wordmark">K O T O B A</div><p class="map-tagline">每天十五分钟，<br>筑一座日语之岛。</p><div class="map-welcome">' + esc(greeting()) + '，旅人。<span>今天，想去哪个岛屿？</span></div><div class="map-daily map-glass"><button id="map-checkin" class="daily-streak" ' + (summary.checked_in_today?'disabled':'') + '>' + FLAME_SVG + '<span><small>连续打卡</small><b>' + (summary.streak||0) + '<em> 天</em></b><small id="map-checkin-text">' + (summary.checked_in_today?'今日已打卡':'轻触打卡') + '</small></span></button><a href="#/study" class="daily-goal"><span><small>今日目标</small><b>' + learned + '<em> / ' + goal + ' 词</em></b></span><span class="daily-ring" style="--progress:' + Math.min(100,learned/goal*100) + '%">' + mapIcon('leaf') + '</span></a></div><div class="map-desktop-note"><span>01 — 05</span><p>从樱花初绽的近海，<br>到白雪覆盖的远方。</p><div class="map-legend"><span><i class="gold"></i>已完成</span><span><i class="coral"></i>当前</span><span><i></i>待解锁</span></div></div></header>' +
      '<section class="voyage-world" aria-label="日语学习群岛地图"><div class="map-world-caption"><span>' + mapIcon('compass') + ' 日语群岛 · 航海图</span><button id="map-locate" title="回到当前岛屿">定位旅人 ↗</button></div><div class="map-stage">' + mapScenery() + '<div class="map-controls">' + nodes + labels + '</div><button id="map-traveler" class="map-traveler" style="--x:'+(p.nodeX/7.2)+'%;--y:'+(p.nodeY/10.2)+'%" aria-label="旅人，查看当前学习航段">' + mapTraveler() + '</button><span class="map-sea-name" lang="ja">ことばの海</span><span class="map-north">N<br>✧</span></div><div class="map-world-footer"><span>一词一石，一步一屿。</span><button id="map-motion" aria-pressed="false">静谧模式</button></div></section>' +
      '<aside class="voyage-log"><section id="map-course" class="map-course map-glass" aria-label="岛屿学习详情"></section><div class="map-shortcuts"><a href="#/review" class="map-glass">' + mapIcon('leaf') + '<span><b>温习旧知</b><small>' + (summary.review_due||0) + ' 词待复习</small></span>' + mapIcon('arrow') + '</a><a href="#/starred" class="map-glass">' + mapIcon('star') + '<span><b>口袋里的词</b><small>' + (res[3] ? res[3].total + ' 个收藏' : '打开生词本') + '</small></span>' + mapIcon('arrow') + '</a></div><a href="#/quiz" class="map-exam">检验这段旅程 · 模拟考试 ' + mapIcon('arrow') + '</a><a href="#/me" class="map-growth">' + mapIcon('compass') + (islandStats ? '我的养成岛 · Lv.'+islandStats.level+' '+esc(islandStats.level_name) : '我的学习设置与统计') + ' ↗</a><p class="map-progress-note">地图按词书已学词数推进，每 30 词为一航段。<br>已学不等于掌握，记得回来复习。</p></aside></div>';
    function selectIsland(island, focus) {
      selected = island;
      var index = model.islands.indexOf(island);
      $$('[data-island]').forEach(function(b){b.setAttribute('aria-pressed',String(Number(b.dataset.island)===index));});
      var status = island.complete ? '这座岛的词书已学完' : island.locked ? '远方的岛屿，等你启航' : '你的下一步，正闪闪发光';
      var chapterInfo = island.available ? (island.complete ? '全部航段完成' : '第 ' + island.chapter + ' 航段') : '词书暂未就绪';
      $('#map-course').innerHTML = '<div class="course-kicker">' + mapIcon(island.locked?'lock':'book') + '<span>'+(island===active?'当前旅程':'岛屿手记')+'</span><span class="course-level">'+island.level+'</span></div><h2>'+island.name+'</h2><p lang="ja">'+descriptions[index]+'</p><div class="course-chapter"><b>'+chapterInfo+'</b><span>'+island.completedChapters+' / '+island.chapters+' 航段</span></div><div class="map-progress" role="progressbar" aria-label="'+island.name+'已学词数" aria-valuenow="'+island.studied+'" aria-valuemin="0" aria-valuemax="'+(island.total||1)+'"><i style="width:'+island.percent+'%"></i></div><div class="course-count"><span>已学 '+island.studied+' / '+island.total+' 词</span><span>'+island.percent+'%</span></div><p class="course-status">'+status+'</p>' + (island.locked ? '<p class="course-lock-note">完成前一岛可沿海图解锁；也可从书架自由选级学习。</p><a href="#/study" class="map-cta secondary">去书架选级 '+mapIcon('arrow')+'</a>' : '<button id="map-start" class="map-cta" '+(!island.available?'disabled':'')+'>'+(island.complete?'去复习巩固':'继续学习 · 第 '+island.chapter+' 航段')+mapIcon('arrow')+'</button>') + '<a class="course-shelf" href="#/study">查看全部词书 ↗</a>';
      var start = $('#map-start');
      if (start) start.onclick = function() {
        if (island.complete) { location.hash='#/review'; return; }
        mapVoyageBook = island.book;
        location.hash='#/voyage';
      };
      if (focus) {
        var course = $('#map-course'); course.setAttribute('tabindex','-1'); course.focus({preventScroll:true});
        course.scrollIntoView({block:'nearest',behavior:mapMotionReduced()?'auto':'smooth'});
      }
    }
    $$('[data-island], [data-node]').forEach(function(b) {b.onclick=function(){selectIsland(model.islands[Number(b.dataset.island || b.dataset.node)],true);};});
    $('#map-traveler').onclick=function(){selectIsland(active,true);};
    $('#map-locate').onclick=function(){selectIsland(active,false);$('#map-traveler').scrollIntoView({block:'center',behavior:mapMotionReduced()?'auto':'smooth'});$('#map-traveler').focus({preventScroll:true});};
    $('#map-motion').onclick=function(){ localStorage.setItem('yuyu_map_motion',mapMotionReduced()?'auto':'reduce');updateMapMotion(); if(mapMotionReduced() && localStorage.getItem('yuyu_map_motion')==='auto') toast('已按系统或设备偏好减少动态效果');};
    $('#map-checkin').onclick=function(){
      var button=this;button.disabled=true;$('#map-checkin-text').textContent='打卡中…';
      api('/checkin','POST').then(function(r){
        if(currentRoute()!=='home'||loadId!==mapLoadId)return;
        summary.checked_in_today=true;summary.streak=r.streak;
        $('.daily-streak b').innerHTML=r.streak+'<em> 天</em>';$('#map-checkin-text').textContent='今日已打卡';
        celebrate();toast('打卡成功，连续 '+r.streak+' 天');
        showPoster({streak:r.streak,todayLearned:learned,totalWords:islandStats?islandStats.total_words:0,islandLevel:islandStats?islandStats.level:1});
      }).catch(function(e){if(currentRoute()!=='home'||loadId!==mapLoadId)return;button.disabled=false;$('#map-checkin-text').textContent='重试打卡';toast(e.message);});
    };
    selectIsland(selected,false);updateMapMotion();
  }).catch(function(err){
    if(loadId!==mapLoadId||currentRoute()!=='home')return;
    app.innerHTML='<div class="map-loading map-error" role="alert">'+mapIcon('compass')+'<h2>海图暂时没有展开</h2><p>'+esc(err.message)+'</p><button id="map-retry" class="map-cta">重新加载</button><a href="#/study">前往书架</a></div>';
    $('#map-retry').onclick=renderArchipelago;
  });
}
