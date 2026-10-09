/* Anime environment layers are independent images, never one flattened map. */
/* v1.3: 一屏群岛 — 所有坐标均为相对 .map-stage 的百分比，不再使用 1400px 场景 */
'use strict';
var MAP_SCENE_HEIGHT = 100;
var MAP_PLACES = [
  { labelX: 60, labelY: 94, nodeX: 60, nodeY: 84, travelX: 60, travelY: 84 },
  { labelX: 36, labelY: 75, nodeX: 36, nodeY: 65, travelX: 36, travelY: 65 },
  { labelX: 64, labelY: 57, nodeX: 64, nodeY: 47, travelX: 64, travelY: 47 },
  { labelX: 37, labelY: 39, nodeX: 37, nodeY: 29, travelX: 37, travelY: 29 },
  { labelX: 62, labelY: 21, nodeX: 62, nodeY: 11, travelX: 62, travelY: 11 }
];
function mapScenery() {
  var lowDetail = !!(navigator.connection && navigator.connection.saveData) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  // v1.3: 一屏群岛，不再绘制蜿蜒踏石路线
  var lands = [
    {name:'snow',level:'N1',x:44,y:0,w:36,h:24},
    {name:'maple',level:'N2',x:17,y:16,w:40,h:26},
    {name:'fuji',level:'N3',x:45,y:34,w:38,h:26},
    {name:'torii',level:'N4',x:16,y:52,w:40,h:26},
    {name:'sakura',level:'N5',x:39,y:70,w:42,h:28}
  ];
  var islands = lands.map(function(i){
    return '<img class="anime-island art-'+i.name+'" src="assets/anime/'+i.name+(lowDetail?'-small':'')+'.webp" ' +
      (lowDetail?'':'srcset="assets/anime/'+i.name+'-small.webp 560w, assets/anime/'+i.name+'.webp 1120w" ') +
      'sizes="(max-width: 700px) 85vw, 640px" width="1120" height="900" alt="" decoding="async" fetchpriority="'+(i.name==='sakura'?'high':'auto')+'" draggable="false" ' +
      'style="left:'+i.x+'%;top:'+i.y+'%;width:'+i.w+'%;height:'+i.h+'%">';
  }).join('');
  var targets = '<div class="anime-land-controls">'+lands.map(function(i,index){
    return '<button class="anime-land-hit" type="button" tabindex="-1" data-scenery="'+(4-index)+'" aria-label="查看 '+i.level+' 岛屿详情" style="left:'+i.x+'%;top:'+i.y+'%;width:'+i.w+'%;height:'+i.h+'%"></button>';
  }).join('')+'</div>';
  return '<div class="anime-environment" aria-hidden="true"><img class="anime-ocean" src="assets/anime/sea'+(lowDetail?'-small':'')+'.webp" ' +
    (lowDetail?'':'srcset="assets/anime/sea-small.webp 720w, assets/anime/sea.webp 1440w" ') + 'sizes="(max-width:700px) 100vw, 760px" width="1440" height="2560" alt="" fetchpriority="high" decoding="async">' +
    '<div class="ocean-glitter"></div>' + islands +
    '<div class="anime-mist mist-far"></div><div class="anime-mist mist-near"></div>' +
    '<div class="anime-petals"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>'+targets;
}
function mapTraveler() {
  return '<img class="traveler-bob" src="assets/anime/traveler.webp" width="340" height="540" alt="" decoding="async" draggable="false">';
}
