const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function worker(overrides={}) {
  const handlers={};
  const context={URL,Promise,self:{location:{origin:'https://kotoba.test'},addEventListener:(event,fn)=>handlers[event]=fn},...overrides};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve('frontend/sw.js'),'utf8'),context);
  return {handlers,context};
}
test('authenticated API GETs and writes always use the network, never SW cache',()=>{
  const {handlers}=worker();let intercepted=false;
  for(const [method,url] of [['GET','https://kotoba.test/api/home/summary'],['GET','https://kotoba.test/api/books'],['GET','https://kotoba.test/api/review/due'],['POST','https://kotoba.test/api/study/answer']]) {
    handlers.fetch({request:{method,url},respondWith:()=>intercepted=true});
  }
  assert.equal(intercepted,false);
});
test('the offline shell list contains existing map resources',()=>{
  const {context}=worker();
  for(const file of ['map-model.js','map.js','map.css']) {
    assert.ok(context.ASSETS.includes('./'+file));assert.ok(fs.existsSync(path.join('frontend',file)));
  }
});
test('cached shell resources can render while the network is unavailable',async()=>{
  const hit={cached:true};const {handlers}=worker({caches:{match:async()=>hit}});
  let response;handlers.fetch({request:{method:'GET',url:'https://kotoba.test/map.js'},respondWith:p=>response=p});
  assert.equal(await response,hit);
});
test('an uncached navigation falls back to the saved HTML shell offline',async()=>{
  const shell={html:true};const {handlers}=worker({caches:{match:async key=>key==='./index.html'?shell:undefined},fetch:async()=>{throw Error('offline');}});
  let response;handlers.fetch({request:{method:'GET',url:'https://kotoba.test/',mode:'navigate'},respondWith:p=>response=p});
  assert.equal(await response,shell);
});
