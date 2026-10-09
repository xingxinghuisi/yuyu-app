/* The map is a view of existing book progress, never a second progress store. */
(function (root) {
  'use strict';
  var names = ['樱花岛', '鸟居岛', '富士岛', '红叶岛', '雪见岛'];
  function build(books) {
    var levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
    var islands = levels.map(function (level, i) {
      var b = books.find(function (book) { return book.id === 'level-' + level.toLowerCase(); });
      var total = b ? Math.max(0, Number(b.total) || 0) : 0;
      var studied = b ? Math.min(total, Math.max(0, Number(b.studied) || 0)) : 0;
      var complete = total > 0 && studied >= total;
      return { level: level, name: names[i], book: b, total: total, studied: studied,
        complete: complete, chapters: Math.ceil(total / 30),
        chapter: total ? Math.min(Math.floor(studied / 30) + 1, Math.ceil(total / 30)) : 0,
        completedChapters: complete ? Math.ceil(total / 30) : Math.floor(studied / 30),
        percent: total ? Math.round(studied / total * 100) : 0 };
    });
    var previousComplete = true;
    islands.forEach(function (island) {
      // Shelf progress is preserved, but cannot skip the ordered map journey.
      island.locked = !previousComplete;
      island.available = !!island.book && island.total > 0;
      previousComplete = previousComplete && island.complete;
    });
    var active = islands.find(function (island) { return !island.complete && !island.locked; }) || islands[4];
    return { islands: islands, active: active };
  }
  root.KotobaMapModel = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.KotobaMapModel;
})(typeof window !== 'undefined' ? window : globalThis);
