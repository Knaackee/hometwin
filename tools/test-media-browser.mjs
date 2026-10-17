import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 for(const lang of ['en','de']) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4173/demo/?showcase=media&lang=${lang}`);
  await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
  await page.evaluate(()=>document.querySelector('hometwin-panel').stage.stop());
  await page.locator('[data-ob=demo]').click();
  const before=await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(document.querySelector('hometwin-panel').hass.states).filter(([id])=>id.startsWith('light.')))));
  await page.evaluate(async()=>{const p=document.querySelector('hometwin-panel');await p.previewScene(Object.keys(p.hass.states).find(k=>k.startsWith('scene.')));p.stage.tick();});
  assert.equal(await page.locator('#scenePrev').isVisible(),true);
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(document.querySelector('hometwin-panel').hass.states).filter(([id])=>id.startsWith('light.'))))),before,'Preview must not operate devices');
  await page.locator('[data-sp=end]').click();
  await page.evaluate(()=>{const p=document.querySelector('hometwin-panel');p.setMode('edit');p.setLevel('eg');p.stage.tween=null;p.stage.rise=null;});
  for(const kind of ['tv','frame','speaker','washer','fireplace']) {
   const found=await page.evaluate(kind=>{const p=document.querySelector('hometwin-panel'),L=p.plan.levels.find(l=>l.devices.some(d=>d.kind===kind)),d=L.devices.find(d=>d.kind===kind);p.editor.select({type:'device',level:L.id,id:d.id});p.stage.tick();return !!p.stage.levels.get(L.id).dev.get(d.id);},kind);
   assert(found);
   assert(!/\b(?:media|editor|data)\.[a-zA-Z]/.test(await page.locator('#insp').innerText()));
   if(kind==='tv') {await page.locator('#iStyle').selectOption('curved');assert(await page.locator('#iCurve').isVisible());await page.locator('#iStyle').selectOption('projector');}
   if(kind==='frame') {await page.locator('#frSrc').selectOption('upload');await page.locator('#frFile').setInputFiles({name:'art.png',mimeType:'image/png',buffer:Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=40;const g=c.getContext('2d');g.fillStyle='red';g.fillRect(0,0,40,40);return c.toDataURL().split(',')[1];}),'base64')});await page.waitForFunction(()=>document.querySelector('hometwin-panel').plan.levels.some(l=>l.devices.some(d=>d.artV)));}
  }
  const bound=await page.evaluate(()=>{const p=document.querySelector('hometwin-panel'),L=p.plan.levels[0];const f={id:'media-screen-test',type:'lib:generic/media/tv/curved-tv-55',pos:[2,2],entity_id:'media_player.wohnzimmer_tv'};L.furniture.push(f);const obj=p.stage.addFurniture(L.id,f);p.stage.tick();let found=false;obj.traverse(m=>{if(m.userData.role==='screen'&&m.material.map?.isCanvasTexture)found=true;});p.stage.removeFurniture(L.id,f.id);L.furniture.pop();return found;});
  assert(bound,'Library screen must bind live media content');
  await page.evaluate(()=>{const p=document.querySelector('hometwin-panel');p.setMode('view');p.setLevel('eg');p.setFocus('wohnen');p.stage.tween=null;p.stage.rise=null;p.stage.frameRoom(p.plan.levels[0],p.plan.levels[0].rooms.find(r=>r.id==='wohnen'));const tw=p.stage.tween;if(tw){p.stage.controls.target.copy(tw.tt);p.stage.persp.position.copy(tw.tp);p.stage.tween=null;}p.stage.tick();});
  await page.screenshot({path:`.preview/media-integrated-${lang}.png`});
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS media UI ${lang}: scene preview, device inspectors, styles, upload, rendering`);
 }
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});const page=await context.newPage();
 await page.goto('http://127.0.0.1:4173/demo/?showcase=media');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);await page.evaluate(()=>document.querySelector('hometwin-panel').stage.stop());await page.locator('[data-ob=demo]').click();await page.evaluate(()=>{const p=document.querySelector('hometwin-panel');p.setLevel('eg');p.stage.tick();});await page.screenshot({path:'.preview/media-integrated-mobile.png'});await context.close();
}finally{await browser.close();}
