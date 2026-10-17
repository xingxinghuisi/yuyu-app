/* Real Web Audio gain and full UI, with disposable local WAV/API fixtures. */
const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend');
const frames=32000,sampleRate=8000,wav=Buffer.alloc(44+frames*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/sampleRate)*2200),44+i*2);
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const send=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
  if(url.pathname==='/preview-volume')return send('text/html','<script>localStorage.setItem("yuyu_token","fixture");localStorage.setItem("yuyu_username","fixture");location.replace("/#/me/voice")</script>');
  if(url.pathname.startsWith('/api/audio/'))return send('audio/wav',wav);
  if(url.pathname.startsWith('/api/'))return send('application/json',JSON.stringify({username:'fixture',ui_lang:'zh'}));
  const file=path.resolve(frontend,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)));
  if(!file.startsWith(frontend+path.sep)||!fs.existsSync(file))return send('text/plain','missing',404);
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webp':'image/webp'};
  return send(types[path.extname(file)]||'application/octet-stream',fs.readFileSync(file));
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block',reducedMotion:'reduce'});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/preview-volume');await page.locator('#voice-settings-volume').waitFor();
      await page.locator('[data-voice-volume-toggle]').click();
      const slider=page.locator('#voice-volume-range');
      await slider.focus();await slider.press('ArrowLeft');
      assert.equal(await slider.inputValue(),'95');
      assert.equal(await page.locator('#voice-settings-volume').inputValue(),'95');
      await page.locator('[data-voice-volume-toggle]').click();
      await page.locator('#btn-voice-test').click();
      await page.waitForFunction(()=>_voiceSource && _voiceContext.state==='running' && _audioEl.readyState>=3 && !_audioEl.paused);
      await page.evaluate(()=>{
        _audioEl.loop=true;
        window.volumeAnalyser=_voiceContext.createAnalyser();volumeAnalyser.fftSize=2048;
        _voiceLimiter.connect(volumeAnalyser);
      });
      async function rms(){return page.evaluate(async()=>{
        let sum=0;
        for(let i=0;i<24;i++){
          await new Promise(requestAnimationFrame);
          if(i<8)continue; // Fill the analyser window and let the gain ramp settle.
          const buffer=new Float32Array(volumeAnalyser.fftSize);volumeAnalyser.getFloatTimeDomainData(buffer);
          sum+=Math.sqrt(buffer.reduce((v,n)=>v+n*n,0)/buffer.length);
        }
        return sum/16;
      });}
      const normal=await rms();assert.ok(normal>0.01,'The real recorded fixture produces a signal');
      await page.locator('[data-voice-volume-toggle]').click();await slider.focus();await slider.press('End');
      await page.waitForFunction(()=>_voiceGain.gain.value>1.99);
      const boosted=await rms();assert.ok(boosted/normal>1.9 && boosted/normal<2.3,`95% -> 200% signal ratio: normal=${normal}, boosted=${boosted}`);
      assert.equal(await slider.inputValue(),'200');assert.equal(await page.locator('#voice-settings-volume').inputValue(),'200');
      assert.equal(await page.evaluate(()=>localStorage.getItem('yuyu_voice_volume')),'2');
      const out=path.join(root,'data/voice-volume-preview');fs.mkdirSync(out,{recursive:true});
      await page.screenshot({path:path.join(out,'volume-'+width+'.png'),fullPage:true});
      await slider.press('Home');assert.equal(await page.evaluate(()=>_audioEl.muted),true);
      await page.locator('[data-voice-volume-toggle]').click();
      await page.reload();await page.locator('#voice-settings-volume').waitFor();
      assert.equal(await page.locator('#voice-settings-volume').inputValue(),'0','Mute survives a reload');
      await page.locator('#voice-settings-volume').focus();await page.locator('#voice-settings-volume').press('End');
      assert.equal(await page.locator('#voice-volume-range').inputValue(),'200');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}px: actual audio signal gain ${(boosted/normal).toFixed(2)}x, live volume, mute/reload, shared controls and persistence`);
      await context.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;server.close();});
