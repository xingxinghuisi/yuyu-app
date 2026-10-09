/* Learning map controls. Layered scenery is provided by map-art.js. */
'use strict';
var mapLoadId = 0;
var mapVoyageBook = null;
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
      nodes += '<button type="button" class="map-node ' + state + (island===active?' current':'') + '" data-node="' + i + '" style="--x:' + p.nodeX + '%;--y:' + p.nodeY + '%" aria-label="查看' + island.name + '航段进度">' + mapIcon(island.complete?'check':island.locked?'lock':'star') + '</button>';
    });
    var p = MAP_PLACES[model.islands.indexOf(active)];
    // v1.3 一屏群岛：HUD + 群岛（flex:1）+ 课程条，零滚动；岛屿详情进底部抽屉
    app.innerHTML = '<div class="voyage-layout onescreen">'
      + '<header class="voyage-intro compact"><div class="os-brand"><h1>语屿 <span>KOTOBA</span></h1><p>每天十五分钟，筑一座日语之岛。</p></div>'
      + '<div class="os-hud"><div class="os-stat"><span>\U0001F525</span><div><b>' + (summary.streak||0) + '天</b><i>连续打卡</i></div></div>'
      + '<div class="os-stat"><span>\U0001F3AF</span><div><b>' + learned + '/' + goal + '</b><i>今日目标</i></div></div></div></header>'
      + '<section class="voyage-world" aria-label="日语学习群岛地图"><div class="map-stage onescreen-stage">' + mapScenery()
      + '<div class="map-controls">' + nodes + labels + '</div>'
      + '<button id="map-traveler" class="map-traveler" style="--x:' + p.travelX + '%;--y:' + p.travelY + '%" aria-label="旅人，查看当前学习航段">' + mapTraveler() + '</button>'
      + '</div></section>'
      + '<div class="course-bar map-glass"><div class="cb-info"><b>' + active.level + ' ' + active.name + ' · 第 ' + active.chapter + ' 航段</b>'
      + '<span>已学 ' + active.studied + ' / ' + active.total + ' 词</span><div class="map-progress"><i style="width:' + active.percent + '%"></i></div></div>'
      + '<button class="cb-go" id="course-go">继续 →</button></div>'
      + '</div>'
      + '<div class="scrim" id="sheet-scrim"></div>'
      + '<div class="sheet" id="island-sheet" role="dialog" aria-modal="true" aria-label="岛屿手记"><div class="grabber"></div><div class="sheet-body" id="sheet-body"></div></div>';
    function startIsland(island) {
      if (!island.available || island.locked) return;
      if (island.complete) { location.hash='#/review'; return; }
      mapVoyageBook = island.book;
      location.hash='#/voyage';
    }
    // v1.3: 底部课程条 → 继续当前岛学习
    $('#course-go').onclick = function(){ startIsland(active); };
    // v1.3: 底部抽屉 — 岛屿手记
    function openSheet(island) {
      var index = model.islands.indexOf(island);
      var status = island.complete ? '这座岛的词书已学完' : island.locked ? '远方的岛屿，等你启航' : '你的下一步，正闪闪发光';
      var chapterInfo = island.available ? (island.complete ? '全部航段完成' : '第 ' + island.chapter + ' 航段') : '词书暂未就绪';
      $('#sheet-body').innerHTML = '<div class="course-kicker">' + mapIcon(island.locked?'lock':'book') + '<span>'+(island===active?'当前旅程':'岛屿手记')+'</span><span class="course-level">'+island.level+'</span></div>'
        + '<h2>'+island.name+'</h2><p lang="ja">'+descriptions[index]+'</p>'
        + '<div class="course-chapter"><b>'+chapterInfo+'</b><span>'+island.completedChapters+' / '+island.chapters+' 航段</span></div>'
        + '<div class="map-progress" role="progressbar" aria-label="'+island.name+'已学词数" aria-valuenow="'+island.studied+'" aria-valuemin="0" aria-valuemax="'+(island.total||1)+'"><i style="width:'+island.percent+'%"></i></div>'
        + '<div class="course-count"><span>已学 '+island.studied+' / '+island.total+' 词</span><span>'+island.percent+'%</span></div>'
        + '<p class="course-status">'+status+'</p>'
        + (island.locked
          ? '<p class="course-lock-note">完成前一岛可沿海图解锁；也可从书架自由选级学习。</p><a href="#/study" class="map-cta secondary">去书架选级 '+mapIcon('arrow')+'</a>'
          : '<button id="map-start" class="map-cta" '+(!island.available?'disabled':'')+'>'+(island.complete?'去复习巩固':'继续学习 · 第 '+island.chapter+' 航段')+mapIcon('arrow')+'</button>')
        + '<a class="course-shelf" href="#/study">查看全部词书 ↗</a>'
        + '<div class="map-shortcuts"><a href="#/review" class="map-glass">' + mapIcon('leaf') + '<span><b>温习旧知</b><small>' + (summary.review_due||0) + ' 词待复习</small></span>' + mapIcon('arrow') + '</a>'
        + '<a href="#/starred" class="map-glass">' + mapIcon('star') + '<span><b>口袋里的词</b><small>' + (res[3] ? res[3].total + ' 个收藏' : '打开生词本') + '</small></span>' + mapIcon('arrow') + '</a></div>'
        + '<a href="#/quiz" class="map-exam">检验这段旅程 · 模拟考试 ' + mapIcon('arrow') + '</a>';
      var start = $('#map-start');
      if (start) start.onclick = function(){ closeSheet(); startIsland(island); };
      $('#island-sheet').classList.add('show');
      $('#sheet-scrim').classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeSheet() {
      $('#island-sheet').classList.remove('show');
      $('#sheet-scrim').classList.remove('show');
      document.body.style.overflow = '';
    }
    function selectIsland(island) {
      selected = island;
      var index = model.islands.indexOf(island);
      $$('[data-island]').forEach(function(b){b.setAttribute('aria-pressed',String(Number(b.dataset.island)===index));});
      openSheet(island);
    }
    $$('[data-island], [data-node]').forEach(function(b) {b.onclick=function(){selectIsland(model.islands[Number(b.dataset.island || b.dataset.node)]);};});
    $$('[data-scenery]').forEach(function(b){b.onclick=function(){selectIsland(model.islands[Number(b.dataset.scenery)]);};});
    $('#map-traveler').onclick=function(){selectIsland(active);};
    $('#sheet-scrim').onclick=closeSheet;
    // 下滑关闭抽屉
    (function(){
      var sheet = $('#island-sheet'), startY = 0;
      sheet.addEventListener('touchstart', function(e){ startY = e.touches[0].clientY; }, {passive:true});
      sheet.addEventListener('touchend', function(e){
        if (e.changedTouches[0].clientY - startY > 80) closeSheet();
      }, {passive:true});
    })();
    updateMapMotion();
  }).catch(function(err){
    if(loadId!==mapLoadId||currentRoute()!=='home')return;
    app.innerHTML='<div class="map-loading map-error" role="alert">'+mapIcon('compass')+'<h2>海图暂时没有展开</h2><p>'+esc(err.message)+'</p><button id="map-retry" class="map-cta">重新加载</button><a href="#/study">前往书架</a></div>';
    $('#map-retry').onclick=renderArchipelago;
  });
}
