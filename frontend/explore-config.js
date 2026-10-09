/* ============================================================
   语屿 Kotoba · explore-config.js
   探索页（群岛海图）配置。换背景图 / 改坐标 / 改文案 / 改假数据只动这个文件。
   必须在 explore-map.js 和 app.js 之前加载（见 index.html）。
   ============================================================ */
'use strict';

var EXPLORE_CONFIG = {
  /* ---------- 背景地图 ----------
     单张无 UI 文字的竖图（ChatGPT 生成，941×1672 ≈ 9:16，原图在 tools/source/）。
     排版：宽度 = 屏幕宽，高度按 w/h 等比（不拉伸、不裁切），底边贴屏幕底；
     图片比屏幕矮时，上方空出的部分用天空延展图 sky（取原图顶部 6% 的天空镜像拉伸而成）补满，至少留 minTop 给 HUD；
     图片（+minTop）比屏幕高时页面可竖向滚动，并自动滚到当前岛。
     所有叠层都放在一个与图片同宽高比的容器里，坐标 = 相对图片的百分比，任何屏幕尺寸都对得上。
     webp 可选：提供时 <picture> 优先加载 webp，回退 jpg。 */
  background: {
    tiles: [
      { src: 'assets/explore/map-bg.jpg', webp: 'assets/explore/map-bg.webp', w: 941, h: 1672 }
    ],
    sky: 'assets/explore/map-sky.jpg',
    minTop: 112,                 // 图片上方至少留给 HUD 的高度（px，另加安全区）
    skyColor: '#5a8ed6',         // 天空延展层底色（取自图片顶边附近）
    deepColor: '#d5929c'         // 页面兜底色（图片底边是樱花前景）
  },

  /* ---------- 岛屿 / 站点 ----------
     顺序：从下到上（N5 → N1）。坐标均为相对背景图的百分比：
       x / y   —— 站点（当前岛 = 红色发光圆台 + 旅人；其余岛 = 小圆环，状态图标在名牌上，同设计稿）
       px / py —— 名牌锚点（名牌左边缘的垂直中点）。不填则按 plate 放在站点左/右侧。
     sub 可用 \n 换行。accent：名牌上岛名的颜色（可选）。 */
  islands: [
    { level: 'N5', name: '樱花岛', sub: 'はじめの一歩',   bookId: 'level-n5', x: 50.6, y: 63.6, px: 63.5, py: 64.6 },
    { level: 'N4', name: '鸟居岛', sub: 'つなげる会話',   bookId: 'level-n4', x: 30.5, y: 47.6, px: 33, py: 51.6 },
    { level: 'N3', name: '富士岛', sub: '広がる表現の海', bookId: 'level-n3', x: 70,   y: 37.2, px: 64, py: 45.4 },
    { level: 'N2', name: '红叶岛', sub: '言葉が彩る世界', bookId: 'level-n2', x: 48,   y: 23.6, px: 59, py: 28.2, accent: '#C8322A' },
    { level: 'N1', name: '雪见岛', sub: '雪の向こうに、\nもっと広い世界へ', bookId: 'level-n1', x: 73, y: 16.2, px: 64, py: 20.2 }
  ],

  /* 背景图已画好踏石链：不再叠 SVG 虚线（换成没画路径的背景时可打开） */
  showPath: false,

  /* ---------- 氛围动效（prefers-reduced-motion 时全部关闭） ----------
     sparkles：海面闪光点（相对背景图百分比，尽量选在开阔海面上）；gulls：滑翔海鸥的高度（%）与时长（秒） */
  ambience: {
    sparkles: [[9, 31], [6, 57.5], [91, 51], [84, 56.5], [94, 33.5], [57, 51], [74, 53.5], [12, 37], [90, 75], [79, 79], [16, 82], [35, 33], [86, 66], [62, 85]],
    gulls: [{ y: 30, dur: 26, delay: 0, size: 1 }, { y: 55, dur: 34, delay: -14, size: .8 }],
    clouds: true
  },

  /* ---------- 进度规则（与旧版探索页 / 书架保持一致） ---------- */
  unlockThreshold: 0.8,   // 上一座岛词书进度 ≥ 80% 解锁下一座
  doneThreshold: 0.95,    // 本岛进度 ≥ 95% 视为「已通关」（金环 ✓）
  wordsPerLesson: 20,     // 后端没有「课」的概念：每 20 个词算 1 课（旧版 renderExplore 同口径）

  /* ---------- 课程标题（后端暂无，按需补充；没有就显示词书名） ----------
     lessonTitles[level][n-1] = 第 n 课的标题 */
  lessonTitles: {
    N5: ['あいさつ', 'すうじ', 'はじめまして', 'じこしょうかい', 'かぞく', 'まいにち', 'たべもの', 'かいもの']
  },

  /* ---------- XP ----------
     后端还没有 XP 接口：先写死展示（与旧版探索页一致）。接入后在 explore-map.js 的 buildModel() 里替换。 */
  xp: 320,

  /* ---------- 假数据 ----------
     useMockFallback=true：接口失败/无数据时用下面的 mock 顶上（开发、预览用）。
     生产环境建议 false：接口失败时显示「—」，不展示假的打卡天数。 */
  useMockFallback: false,
  mock: {
    streak: 12,
    goal: { done: 15, total: 15, unit: '分钟' },
    statuses: { N5: 'current', N4: 'done', N3: 'locked', N2: 'locked', N1: 'locked' },
    progress: { N5: { lessonsDone: 8, lessonsTotal: 20 } },
    currentLesson: { no: 3, title: 'はじめまして' }
  }
};
