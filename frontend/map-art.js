/* Anime environment layers are independent images, never one flattened map. */
'use strict';
var MAP_SCENE_HEIGHT = 1400;
var MAP_PLACES = [
  { labelX: 33, labelY: 79, nodeX: 360, nodeY: 1035 },
  { labelX: 25, labelY: 60, nodeX: 255, nodeY: 915 },
  { labelX: 77, labelY: 48, nodeX: 570, nodeY: 760 },
  { labelX: 60, labelY: 34, nodeX: 370, nodeY: 555 },
  { labelX: 77, labelY: 22, nodeX: 510, nodeY: 385 }
];
function mapScenery() {
  var lowDetail = !!(navigator.connection && navigator.connection.saveData) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  var route = [[360,1035],[328,1006],[291,966],[255,915],[308,885],[367,854],
    [429,822],[501,791],[570,760],[530,712],[485,662],[429,604],
    [370,555],[405,511],[441,469],[476,427],[510,385]];
  var stones = route.filter(function(p,i){return [0,3,8,12,16].indexOf(i)<0;}).map(function(p,i){
    return '<g transform="translate('+p.join(' ')+')"><ellipse cy="10" rx="27" ry="13" fill="#102d54" opacity=".4"/>' +
      '<path d="M-22 0v9q22 17 44 0V0" fill="#be8a4f"/><ellipse rx="26" ry="12" fill="#ffdda0" stroke="#fff2cb" stroke-width="2"/>' +
      '<ellipse cy="-1" rx="20" ry="8" fill="#eeb867" stroke="#fff0ba" stroke-width="1.5"/><path d="m-5-1 5-3 5 3-5 3z" fill="#fff7d3"/></g>';
  }).join('');
  var lands = [
    {name:'snow',level:'N1',x:39,y:9,w:59,h:25},
    {name:'maple',level:'N2',x:4,y:22,w:78,h:28},
    {name:'fuji',level:'N3',x:37,y:36,w:68,h:30},
    {name:'torii',level:'N4',x:-7,y:51,w:76,h:30},
    {name:'sakura',level:'N5',x:-5,y:67,w:87,h:30}
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
    '<div class="ocean-glitter"></div>' + islands + '<svg class="anime-route" viewBox="0 0 720 1400">' +
    '<path d="M'+route.map(function(p){return p.join(' ');}).join(' L')+'" fill="none" stroke="#fff1b5" stroke-width="3" stroke-dasharray="2 13" opacity=".7"/>'+stones+'</svg>' +
    '<div class="anime-mist mist-far"></div><div class="anime-mist mist-near"></div>' +
    '<svg class="anime-birds" viewBox="0 0 720 1400" fill="none" stroke="#fff8ed" stroke-width="4" stroke-linecap="round"><path d="m62 472 28 15 29-21m462 332 16 12 20-15M70 1050l28 12 28-19"/></svg>'+
    '<div class="anime-petals"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>'+targets;
}
function mapTraveler() {
  return '<img class="traveler-bob" src="assets/anime/traveler.webp" width="340" height="540" alt="" decoding="async" draggable="false">';
}
