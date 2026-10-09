/* Run against an isolated local backend, never a production account/database.
   NODE_PATH=<Playwright installation> node tests/map-browser.cjs [base-url] */
const { chromium, request } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const IN_PROCESS = process.argv.includes('--in-process');
const BASE = IN_PROCESS ? 'http://kotoba.test' : (process.argv[2] || 'http://127.0.0.1:8000');
const OUT = path.resolve('data/map-preview');
function inProcessClient() {
  const {spawn}=require('node:child_process');
  const bridge=spawn(process.env.PYTHON || 'python',['-u','tests/api-bridge.py'],{stdio:['pipe','pipe','inherit']});
  const pending=new Map();let id=0;
  require('node:readline').createInterface({input:bridge.stdout}).on('line',line=>{
    const r=JSON.parse(line);const resolve=pending.get(r.id);pending.delete(r.id);resolve(r);
  });
  function send(method,url,options={}) { return new Promise(resolve=>{
    const key=++id;pending.set(key,resolve);bridge.stdin.write(JSON.stringify({id:key,method,path:url,headers:options.headers,data:options.data})+'\n');
  }); }
  function wrap(r) { return {status:()=>r.status,json:async()=>JSON.parse(Buffer.from(r.body,'base64').toString())}; }
  return {get:async(u,o)=>wrap(await send('GET',u,o)),post:async(u,o)=>wrap(await send('POST',u,o)),send,dispose:async()=>bridge.stdin.end()};
}
async function main() {
  fs.mkdirSync(OUT,{recursive:true});
  const client=IN_PROCESS ? inProcessClient() : await request.newContext({baseURL:BASE});
  const username='map_'+Date.now().toString(36), password='MapTest2026';
  let r=await client.post('/api/auth/register',{data:{username,password}});assert.equal(r.status(),201);
  r=await client.post('/api/auth/login',{data:{username,password}});const {token}=await r.json();assert.ok(token);
  const headers={Authorization:'Bearer '+token};
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1,serviceWorkers:IN_PROCESS?'block':'allow'});
  if(IN_PROCESS) await context.route('http://kotoba.test/**',async route=>{
    const req=route.request(), u=new URL(req.url());
    const response=await client.send(req.method(),u.pathname+u.search,{headers:await req.allHeaders(),data:req.postData()?JSON.parse(req.postData()):undefined});
    await route.fulfill({status:response.status,contentType:response.contentType,body:Buffer.from(response.body,'base64')});
  });
  await context.addInitScript(({token,username})=>{localStorage.setItem('yuyu_token',token);localStorage.setItem('yuyu_username',username);localStorage.setItem('yuyu_theme','light');},{token,username});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function closeSheet() {
    if(await page.locator('#map-sheet').isVisible()) {await page.locator('#map-sheet-close').click();await page.locator('#map-sheet').waitFor({state:'hidden'});}
  }
  try {
    await page.goto(BASE+'/#/home');await page.locator('.voyage-layout').waitFor();
    assert.equal(await page.locator('#map-sheet').isVisible(),false);
    assert.equal(await page.locator('.voyage-log').count(),0);
    assert.equal(await page.locator('[data-island]').count(),5);
    assert.equal(await page.locator('[data-island].locked').count(),4);
    await page.locator('.anime-environment img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
    await page.waitForFunction(()=>!document.querySelector('#app').classList.contains('page-enter'));
    await page.screenshot({path:path.join(OUT,'desktop.png'),fullPage:true});
    const maple = page.locator('[data-scenery="3"]');const mapleBox = await maple.boundingBox();
    await maple.click({position:{x:mapleBox.width*.3,y:mapleBox.height*.6}});
    assert.match(await page.locator('#map-course').innerText(),/红叶岛/);
    await closeSheet();
    await page.locator('[data-island="2"]').click();
    assert.match(await page.locator('#map-course').innerText(),/富士岛/);
    assert.match(await page.locator('#map-course').innerText(),/从书架自由选级/);
    await page.keyboard.press('Escape');await page.locator('#map-sheet').waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-island="2"]').evaluate(el=>el===document.activeElement),true);
    await page.locator('#map-traveler').click();
    await page.locator('#map-start').click();await page.locator('#btn-know').waitFor();
    assert.equal(new URL(page.url()).hash,'#/voyage');
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('map-sheet-open')),false);
    assert.equal(await page.evaluate(()=>StudyCtx.bookId),'level-n5');
    await page.locator('#btn-know').click();
    await page.waitForFunction(()=>ST && ST.done===1);
    await page.goto(BASE+'/#/home');await page.locator('.voyage-layout').waitFor();
    assert.match(await page.locator('.course-count').textContent(),/已学 1 \//);
    const books=await (await client.get('/api/books',{headers})).json();
    assert.equal(books.find(b=>b.id==='level-n5').studied,1);
    console.log('PASS island selection, locks, original study flow, persisted real progress');

    // Real higher-level study must not move the ordered map frontier.
    const highPlan=await (await client.post('/api/study/plan',{headers,data:{book_id:'level-n1'}})).json();
    const highAnswer=await client.post('/api/study/answer',{headers,data:{word_id:highPlan.words[0].id,grade:5}});
    assert.equal(highAnswer.status(),200);
    await page.reload();await page.locator('.voyage-layout').waitFor();
    assert.equal(await page.locator('[data-island].locked').count(),4);
    assert.equal(await page.locator('[data-node="0"]').evaluate(el=>el.classList.contains('current')),true);
    assert.match(await page.locator('#map-quick-course').innerText(),/N5/);
    const travelerY=await page.locator('#map-traveler').evaluate(el=>el.getBoundingClientRect().bottom);
    const startNodeY=await page.locator('[data-node="0"]').evaluate(el=>el.getBoundingClientRect().top);
    assert.ok(Math.abs(travelerY-startNodeY)<30,'traveler stays beside N5 node');
    await page.locator('[data-island="4"]').click();
    assert.equal(await page.locator('#map-start').count(),0);
    assert.match(await page.locator('.course-count').innerText(),/已学 1 \//);
    await closeSheet();
    const latestBooks=await (await client.get('/api/books',{headers})).json();
    await context.route('**/api/books',route=>route.fulfill({json:latestBooks.map(b=>b.id==='level-n1'?{...b,studied:b.total}:b)}));
    await page.reload();await page.locator('.voyage-layout').waitFor();
    assert.equal(await page.locator('[data-island="4"].locked').count(),1);
    assert.equal(await page.locator('[data-node="4"].complete').count(),0);
    await context.unroute('**/api/books');
    await page.reload();await page.locator('.voyage-layout').waitFor();
    console.log('PASS real N1 study preserved; N5 traveler/course remain current; out-of-order completion stays visibly locked');

    await page.locator('#map-checkin').click();await page.locator('.poster-overlay').waitFor();
    assert.equal((await (await client.get('/api/home/summary',{headers})).json()).checked_in_today,true);
    await page.locator('#poster-close').click();
    await page.goto(BASE+'/#/home');await page.locator('.voyage-layout').waitFor();
    assert.equal(await page.locator('#map-checkin').isDisabled(),true);
    await page.locator('#map-motion').click();assert.equal(await page.locator('#map-motion').getAttribute('aria-pressed'),'true');
    await page.reload();await page.locator('.voyage-layout').waitFor();assert.equal(await page.locator('#map-motion').getAttribute('aria-pressed'),'true');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.traveler-bob').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{localStorage.setItem('yuyu_map_motion','auto');updateMapMotion();});
    console.log('PASS check-in, existing poster, reduced-motion persistence/system preference');

    const navSizes={};
    async function navSize() {
      return page.locator('#tabbar').evaluate(el=>{
        const rect=el.getBoundingClientRect(), css=getComputedStyle(el);
        return {width:rect.width,height:rect.height,x:rect.x,bottom:innerHeight-rect.bottom,radius:css.borderRadius,
          items:[...el.querySelectorAll('.tab')].map(tab=>{
            const b=tab.getBoundingClientRect(),icon=tab.querySelector('svg').getBoundingClientRect();
            return {width:b.width,height:b.height,iconWidth:icon.width,iconHeight:icon.height};
          })};
      });
    }
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      navSizes[width]=await navSize();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow at '+width+' '+JSON.stringify(await page.locator('body *').evaluateAll(els=>els.map(el=>({tag:el.tagName,cls:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(b=>b.right>innerWidth+1&&b.tag!=='svg'&&typeof b.cls==='string').slice(0,12))));
      if(width<=390) assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'explore fits viewport');
      for (const kind of ['island','node']) for (let i=0;i<5;i++) {
        const target=page.locator('[data-'+kind+'="'+i+'"]');
        await target.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));const before=await page.evaluate(()=>scrollY);
        await target.click();await page.locator('#map-sheet').waitFor();
        assert.equal(await page.evaluate(()=>scrollY),before,'drawer does not scroll the map '+width+' '+kind+' '+i);
        assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('map-sheet-open')),true);
        assert.match(await page.locator('#map-course').innerText(),new RegExp(['樱花岛','鸟居岛','富士岛','红叶岛','雪见岛'][i]));
        await page.mouse.click(5,5);await page.locator('#map-sheet').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>scrollY),before,'dismiss preserves map position');
      }
      await page.locator('#map-traveler').click();
      if(width===390) {await page.locator('#map-sheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await page.screenshot({path:path.join(OUT,'sakura-drawer.png')});}
      await closeSheet();
      for(const target of ['map-island-label','map-node']) {
        const boxes=await page.locator('.'+target).evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return{x:b.x,right:b.right,width:b.width,height:b.height};}));
        assert.ok(boxes.every(b=>b.x>=0&&b.right<=width+1&&b.width>=40&&b.height>=40),'hit area at '+width+' '+target);
      }
      if(width===390) { await page.locator('#map-quick-course').click();await page.locator('#btn-know').waitFor();assert.equal(await page.evaluate(()=>StudyCtx.bookId),'level-n5');await page.goto(BASE+'/#/home');await page.locator('.voyage-layout').waitFor();await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))));await page.waitForFunction(()=>!document.querySelector('#app').classList.contains('page-enter'));await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(OUT,'mobile.png'),fullPage:true}); }
      if(width===1440) { await page.waitForFunction(()=>!document.querySelector('#app').classList.contains('page-enter'));await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(OUT,'desktop.png'),fullPage:true}); }
    }
    console.log('PASS bottom drawer for all islands/nodes at 320/390/768/1440; backdrop/Escape/close button; focus restored; no map scrolling; compact mobile home');

    await page.goto(BASE+'/#/study');await page.locator('.book').first().waitFor();
    await page.locator('.book').first().click();await page.locator('#m-shuffle').click();await page.locator('#btn-know').waitFor();
    assert.equal(await page.evaluate(()=>StudyCtx.order),'shuffle');
    await page.goto(BASE+'/#/review');await page.waitForFunction(()=>!document.querySelector('.skeleton'));
    assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('map-home')),false);
    await page.goto(BASE+'/#/quiz');await page.locator('#btn-quiz-start').waitFor();
    await page.goto(BASE+'/#/me');await page.locator('a[href="#/me/study"]').waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>!document.querySelector('#app').classList.contains('page-enter'));
    await page.screenshot({path:path.join(OUT,'profile-glass.png')});
    console.log('PASS original shelf/shuffle, review, quiz and profile routes');

    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      assert.deepEqual(await navSize(),navSizes[width],'home/profile navigation geometry matches at '+width);
    }
    await page.setViewportSize({width:390,height:844});
    console.log('PASS identical navigation width/height/position/radius/button/icon sizes on home and profile at 320/390/768/1440');

    // Warm SW must cache the new shell and never authenticated API responses.
    await page.goto(BASE+'/#/home');await page.locator('.voyage-layout').waitFor();
    if(!IN_PROCESS) {
    await page.evaluate(()=>navigator.serviceWorker.ready);
    const cached=await page.evaluate(async()=>{const c=await caches.open('yuyu-v24-unified-navigation');return (await c.keys()).map(r=>new URL(r.url).pathname);});
    assert.ok(cached.includes('/map.js')&&cached.includes('/map-model.js')&&cached.includes('/map.css'));
    assert.ok(!cached.some(p=>p.startsWith('/api')));
    await context.setOffline(true);await page.reload();await page.locator('#map-retry').waitFor();
    assert.match(await page.locator('.map-error').innerText(),/海图暂时没有展开/);
    await context.setOffline(false);await page.locator('#map-retry').click();await page.locator('.voyage-layout').waitFor();
    console.log('PASS PWA shell offline, fresh API data, offline error and retry');
    } else {
      await context.route('**/api/books',route=>route.abort());
      await page.reload();await page.locator('#map-retry').waitFor();
      await context.unroute('**/api/books');await page.locator('#map-retry').click();await page.locator('.voyage-layout').waitFor();
      console.log('PASS required API failure and retry; SW network/offline test requires real HTTP transport');
    }
    // Slow home requests must not paint over another route.
    await context.route('**/api/books',async route=>{await new Promise(resolve=>setTimeout(resolve,1000));await route.fallback();});
    await page.evaluate(()=>{location.hash='#/me';});await page.waitForTimeout(100);
    await page.evaluate(()=>{location.hash='#/home';});await page.waitForTimeout(100);
    await page.evaluate(()=>{location.hash='#/quiz';});await page.waitForTimeout(1600);
    assert.equal(await page.locator('.voyage-layout').count(),0);
    await context.unroute('**/api/books');
    assert.deepEqual(errors,[]);
    console.log('PASS route race, no browser runtime errors');
    await context.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2}));
    await page.goto(BASE+'/#/home');await page.reload();await page.locator('.voyage-layout').waitFor();
    assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('map-reduced')),true);
    assert.equal(await page.locator('.anime-environment img').evaluateAll(imgs=>imgs.every(img=>img.src.endsWith('-small.webp')&&!img.srcset)),true);
    await page.waitForFunction(()=>!document.querySelector('#app').classList.contains('page-enter'));
    await page.screenshot({path:path.join(OUT,'mobile-low-detail.png')});
    console.log('PASS low-end device selects small art and disables effects');
    fs.writeFileSync(path.join(OUT,'session.json'),JSON.stringify({username,token}));
    console.log('Screenshots: '+OUT);
  } catch(e) {
    await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true});
    console.error('PAGE:',await page.locator('body').innerText());console.error('ERRORS:',errors);
    throw e;
  } finally { await browser.close();await client.dispose(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
