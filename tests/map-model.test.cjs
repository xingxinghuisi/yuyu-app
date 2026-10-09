const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../frontend/map-model.js');
function books(counts = []) {
  return ['n5','n4','n3','n2','n1'].map((level,i) => ({id:'level-'+level,total:95,studied:counts[i]||0}));
}
test('a new learner starts at N5; future islands have explorable locked states', () => {
  const m=build(books()); assert.equal(m.active.level,'N5');
  assert.deepEqual(m.islands.map(i=>i.locked),[false,true,true,true,true]);
  assert.equal(m.active.chapter,1); assert.equal(m.active.chapters,4);
});
test('30-word milestones do not claim the short final chapter is complete', () => {
  const i=build(books([90])).active;
  assert.equal(i.chapter,4); assert.equal(i.completedChapters,3); assert.equal(i.complete,false);
});
test('a completed book unlocks the next island', () => {
  const m=build(books([95])); assert.equal(m.active.level,'N4');
  assert.equal(m.islands[0].completedChapters,4); assert.equal(m.islands[1].locked,false);
});
test('existing higher-level learning remains accessible without completing N5', () => {
  const m=build(books([3,0,36])); assert.equal(m.active.level,'N3');
  assert.equal(m.active.locked,false); assert.equal(m.active.chapter,2);
});
test('counts, rather than rounded API percentages, decide completion', () => {
  const b=books([94]); b[0].progress=1;
  assert.equal(build(b).islands[0].complete,false);
  assert.equal(build(b).islands[1].locked,true);
});
test('all-complete books select N1 without inventing another chapter', () => {
  const m=build(books([95,95,95,95,95]));
  assert.equal(m.active.level,'N1'); assert.equal(m.active.chapter,4);
  assert.ok(m.islands.every(i=>i.complete));
});
test('missing and empty books do not yield fake progress or a startable course', () => {
  const m=build([]); assert.equal(m.active.available,false);assert.equal(m.active.chapter,0);
  const b=books(); b[0].total=0; assert.equal(build(b).active.available,false);
});
