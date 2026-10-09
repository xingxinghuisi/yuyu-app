/* Learning map controls. Layered scenery is provided by map-art.js. */
'use strict';
var mapLoadId = 0;
var mapVoyageBook = null;
var mapSheetCleanup = null;
function dismissArchipelagoSheet() {
  if (mapSheetCleanup) { mapSheetCleanup();mapSheetCleanup=null; }
}
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
  dismissArchipelagoSheet();
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
      var p = MAP_PLACES[i], state = island.locked ? 'locked' : (island.complete ? 'complete' : 'open');
      labels += '<button type="button" class="map-island-label ' + state + '" data-island="' + i + '" style="--x:' + p.labelX + '%;--y:' + p.labelY + '%" aria-pressed="' + (island===active) + '" aria-label="' + island.level + ' ' + island.name + '，' + (island.locked ? '待解锁，可查看详情' : '已学 ' + island.studied + ' / ' + island.total + ' 词') + '"><span class="island-seal">' + mapIcon(island.locked?'lock':island.complete?'check':'flag') + '</span><span><strong>' + island.level + ' ' + island.name + '</strong><small lang="ja">' + descriptions[i] + '</small></span></button>';
      nodes += '<button type="button" class="map-node ' + state + (island===active?' current':'') + '" data-node="' + i + '" style="--x:' + (p.nodeX/7.2) + '%;--y:' + (p.nodeY/(MAP_SCENE_HEIGHT/100)) + '%" aria-label="查看' + island.name + '航段进度">' + mapIcon(island.locked?'lock':island.complete?'check':'star') + '</button>';
    });
    var p = MAP_PLACES[model.islands.indexOf(active)];
    app.innerHTML = '<div class="voyage-layout"><header class="voyage-intro"><div class="map-eyebrow">A LITTLE EVERY DAY, AN ISLAND OF YOUR OWN</div><h1 class="map-brand">语屿<span class="brand-flower">✿</span></h1><div class="map-wordmark">K O T O B A</div><p class="map-tagline">每天十五分钟，<br>筑一座日语之岛。</p><div class="map-welcome">' + esc(greeting()) + '，旅人。<span>今天，想去哪个岛屿？</span></div><div class="map-daily map-glass"><button id="map-checkin" class="daily-streak" ' + (summary.checked_in_today?'disabled':'') + '>' + FLAME_SVG + '<span><small>连续打卡</small><b>' + (summary.streak||0) + '<em> 天</em></b><small id="map-checkin-text">' + (summary.checked_in_today?'今日已打卡':'轻触打卡') + '</small></span></button><a href="#/study" class="daily-goal"><span><small>今日目标</small><b>' + learned + '<em> / ' + goal + ' 词</em></b></span><span class="daily-ring" style="--progress:' + Math.min(100,learned/goal*100) + '%">' + mapIcon('leaf') + '</span></a></div><div class="map-desktop-note"><span>01 — 05</span><p>从樱花初绽的近海，<br>到白雪覆盖的远方。</p><div class="map-legend"><span><i class="gold"></i>已完成</span><span><i class="coral"></i>当前</span><span><i></i>待解锁</span></div></div></header>' +
      '<section class="voyage-world" aria-label="日语学习群岛地图"><div class="map-world-caption"><span>' + mapIcon('compass') + ' 日语群岛 · 航海图</span><button id="map-locate" title="回到当前岛屿">定位旅人 ↗</button></div><div class="map-stage">' + mapScenery() + '<div class="map-controls">' + nodes + labels + '</div><button id="map-traveler" class="map-traveler" style="--x:'+(p.nodeX/7.2)+'%;--y:'+(p.nodeY/(MAP_SCENE_HEIGHT/100))+'%" aria-label="旅人，查看当前学习航段">' + mapTraveler() + '</button><button id="map-quick-course" class="anime-quick-course map-glass" aria-label="继续当前岛屿的学习"></button><span class="map-sea-name" lang="ja">ことばの海</span><span class="map-north">N<br>✧</span></div><div class="map-world-footer"><span>一词一石，一步一屿。</span><button id="map-motion" aria-pressed="false">静谧模式</button></div></section>' +
      '<div class="anime-progress-strip map-glass">' + mapIcon('book') + '<div><b>' + active.level + ' ' + active.name + '</b><small>' + active.studied + ' / ' + active.total + ' 词</small><div class="map-progress"><i style="width:' + active.percent + '%"></i></div></div><a href="#/review">' + (summary.review_due||0) + ' 词待复习 ↗</a></div></div><dialog id="map-sheet" class="map-sheet" aria-labelledby="map-island-title"><div class="map-sheet-bar"><span class="map-sheet-grip" aria-hidden="true"></span><button id="map-sheet-close" class="map-sheet-close" type="button" aria-label="关闭岛屿详情">×</button></div><div class="map-sheet-scroll"><section id="map-course" class="map-course" tabindex="-1" aria-label="岛屿学习详情"></section><div class="map-shortcuts"><a href="#/review" class="map-glass">' + mapIcon('leaf') + '<span><b>温习旧知</b><small>' + (summary.review_due||0) + ' 词待复习</small></span>' + mapIcon('arrow') + '</a><a href="#/starred" class="map-glass">' + mapIcon('star') + '<span><b>口袋里的词</b><small>' + (res[3] ? res[3].total + ' 个收藏' : '打开生词本') + '</small></span>' + mapIcon('arrow') + '</a></div><a href="#/quiz" class="map-exam">检验这段旅程 · 模拟考试 ' + mapIcon('arrow') + '</a><a href="#/me" class="map-growth">' + mapIcon('compass') + (islandStats ? '我的养成岛 · Lv.'+islandStats.level+' '+esc(islandStats.level_name) : '我的学习设置与统计') + ' ↗</a><p class="map-progress-note">地图按词书已学词数推进，每 30 词为一航段。<br>已学不等于掌握，记得回来复习。</p></div></dialog>';
    var sheet = $('#map-sheet'), sheetTimer = null, sheetScrollY = 0;
    function finishClose() {
      clearTimeout(sheetTimer);sheetTimer=null;
      var wasOpen=sheet.open;
      if (sheet.open) sheet.close();
      sheet.classList.remove('closing');
      document.documentElement.classList.remove('map-sheet-open');
      if (wasOpen && sheet.isConnected && currentRoute()==='home') window.scrollTo(0,sheetScrollY);
      $$('[aria-controls="map-sheet"]').forEach(function(b){b.setAttribute('aria-expanded','false');});
    }
    function closeSheet() {
      if (!sheet.open || sheet.classList.contains('closing')) return;
      if (mapMotionReduced()) { finishClose();return; }
      sheet.classList.add('closing');
      sheetTimer=setTimeout(finishClose,220);
    }
    function openSheet() {
      if (!sheet.open) sheetScrollY=window.scrollY;
      clearTimeout(sheetTimer);sheetTimer=null;sheet.classList.remove('closing');
      document.documentElement.classList.add('map-sheet-open');
      if (!sheet.open) sheet.showModal();
      $('.map-sheet-scroll').scrollTop=0;
      $('#map-course').focus({preventScroll:true});
      window.scrollTo(0,sheetScrollY);
      var index=model.islands.indexOf(selected);
      $$('[data-island], [data-node], [data-scenery]').forEach(function(b){
        b.setAttribute('aria-expanded',String(Number(b.dataset.island || b.dataset.node || b.dataset.scenery)===index));
      });
    }
    mapSheetCleanup=finishClose;
    $('#map-sheet-close').onclick=closeSheet;
    sheet.addEventListener('cancel',function(e){e.preventDefault();closeSheet();});
    sheet.addEventListener('click',function(e){
      var box=sheet.getBoundingClientRect();
      if (e.target===sheet && (e.clientX<box.left || e.clientX>box.right || e.clientY<box.top || e.clientY>box.bottom)) closeSheet();
    });
    $$('[data-island], [data-node], [data-scenery], #map-traveler').forEach(function(b){
      b.setAttribute('aria-controls','map-sheet');b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');
    });
    function startIsland(island) {
      if (!island.available || island.locked) return;
      if (island.complete) { location.hash='#/review'; return; }
      mapVoyageBook = island.book;
      location.hash='#/voyage';
    }
    $('#map-quick-course').innerHTML = '<span><small>当前旅程 · '+active.level+'</small><b>'+(active.complete?'温习旧知':'第 '+active.chapter+' 航段')+'</b><em>'+descriptions[model.islands.indexOf(active)]+'</em></span>'+mapIcon('arrow');
    $('#map-quick-course').disabled = !active.available;
    $('#map-quick-course').onclick = function(){startIsland(active);};
    function selectIsland(island, focus) {
      selected = island;
      var index = model.islands.indexOf(island);
      $$('[data-island]').forEach(function(b){b.setAttribute('aria-pressed',String(Number(b.dataset.island)===index));});
      var status = island.locked ? '依次完成前序岛屿后解锁' : island.complete ? '这座岛的词书已学完' : '你的下一步，正闪闪发光';
      var chapterInfo = island.available ? (island.complete ? '全部航段完成' : '第 ' + island.chapter + ' 航段') : '词书暂未就绪';
      $('#map-course').innerHTML = '<div class="course-kicker">' + mapIcon(island.locked?'lock':'book') + '<span>'+(island===active?'当前旅程':'岛屿手记')+'</span><span class="course-level">'+island.level+'</span></div><h2 id="map-island-title">'+island.name+'</h2><p lang="ja">'+descriptions[index]+'</p><div class="course-chapter"><b>'+chapterInfo+'</b><span>'+island.completedChapters+' / '+island.chapters+' 航段</span></div><div class="map-progress" role="progressbar" aria-label="'+island.name+'已学词数" aria-valuenow="'+island.studied+'" aria-valuemin="0" aria-valuemax="'+(island.total||1)+'"><i style="width:'+island.percent+'%"></i></div><div class="course-count"><span>已学 '+island.studied+' / '+island.total+' 词</span><span>'+island.percent+'%</span></div><p class="course-status">'+status+'</p>' + (island.locked ? '<p class="course-lock-note">海图按 N5 → N4 → N3 → N2 → N1 依次解锁，须完成所有前序岛屿。已学记录会保留，也可从书架自由选级学习。</p><a href="#/study" class="map-cta secondary">去书架选级 '+mapIcon('arrow')+'</a>' : '<button id="map-start" class="map-cta" '+(!island.available?'disabled':'')+'>'+(island.complete?'去复习巩固':'继续学习 · 第 '+island.chapter+' 航段')+mapIcon('arrow')+'</button>') + '<a class="course-shelf" href="#/study">查看全部词书 ↗</a>';
      var start = $('#map-start');
      if (start) start.onclick = function(){startIsland(island);};
      if (focus) {
        openSheet();
      }
    }
    $$('[data-island], [data-node]').forEach(function(b) {b.onclick=function(){selectIsland(model.islands[Number(b.dataset.island || b.dataset.node)],true);};});
    $$('[data-scenery]').forEach(function(b){b.onclick=function(){selectIsland(model.islands[Number(b.dataset.scenery)],true);};});
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
