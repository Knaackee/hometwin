import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4185/demo/';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
 for (const mobile of [false,true]) {
  const page = await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
  await page.evaluate(()=>{
   const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');a.setLevel(a.plan.levels[0].id);window.original=JSON.stringify(a.plan);
   const cv=document.createElement('canvas');cv.width=600;cv.height=400;const g=cv.getContext('2d');g.fillStyle='#152332';g.fillRect(0,0,600,400);g.fillStyle='#69a0cd';g.fillRect(50,50,300,250);g.fillStyle='#c494ce';g.fillRect(350,50,200,250);g.lineWidth=5;g.strokeStyle='#fff';g.strokeRect(50,50,500,250);window.mapImage=cv.toDataURL('image/png');
   const h=a.hass; Object.defineProperty(a, 'hass', {get:()=>h,set:v=>{h.states=v.states;}});
   const ws=h.callWS;h.callWS=async m=>{
    if(m.type==='hometwin/vacuum/maps')return {maps:[{entity_id:'camera.test_map',name:'Vacuum map'}]};
    if(m.type==='hometwin/vacuum/map'){if(window.failMap)throw Error('offline');return {entity_id:m.entity_id,image:window.mapImage};}
    return ws(m);
   };
   a.wizard.open({levelId:a.activeLevelId,vacuum:true});
  });
  const panel=page.locator('hometwin-panel');
  await panel.locator('[data-vacuum="list"]').click();await panel.locator('[data-vacuum="load"]').click();
  await page.waitForFunction(()=>document.querySelector('hometwin-panel').wizard.st.mapEntity==='camera.test_map');
  assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.original));
  // Calibrate then recognise. Capture the actual AI request contract.
  await page.evaluate(async()=>{
   const w=document.querySelector('hometwin-panel').wizard;await w.next();await w.next();
   w.st.mpp=.02;w.ai={configured:true,model:'test'};
   w.runJob=async req=>{window.request=req;return {mpp:req.mpp,scale_source:'measured',rooms:[{name:'Mapped room',kind:'room',points:[[1,1],[7,1],[7,6],[1,6]]},{name:'Second',kind:'room',points:[[7,1],[11,1],[11,6],[7,6]]}],openings:[],stairs:[]};};
   await w.detect();
  });
  assert.match(await page.evaluate(()=>window.request.hints),/robot vacuum cleaning map/);
  assert.equal(await page.evaluate(()=>window.request.options.openings),false);
  assert.equal(await panel.locator('[name="wzMode"]').count(),0,'no destructive replace on robot maps');
  assert.equal(await panel.locator('[data-map-room]').first().inputValue(),'','refresh defaults to no geometry edits');
  await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.tick();a.wizard.root.querySelector('.wz-apply').scrollIntoView();});
  await page.screenshot({path:`.preview/vacuum-review-${mobile?'mobile':'desktop'}.png`});
  // Apply template only; all other plan data is preserved.
  await panel.locator('[data-wz="next"]').click();
  await page.waitForFunction(()=>document.querySelector('hometwin-panel').wizard.root.hidden);
  const first=await page.evaluate(()=>{
   const a=document.querySelector('hometwin-panel'),before=JSON.parse(window.original),after=structuredClone(a.plan);const u=after.levels[0].underlay;after.levels[0].underlay=before.levels[0].underlay;window.first=JSON.stringify(a.plan);return {equal:JSON.stringify(before)===JSON.stringify(after),u};
  });
  if (!first.equal) console.log(await page.evaluate(()=>{const a=JSON.parse(window.original), b=JSON.parse(window.first); const out=[];const diff=(x,y,path)=>{if(JSON.stringify(x)===JSON.stringify(y))return;if(x&&y&&typeof x==='object'&&typeof y==='object'){for(const k of new Set([...Object.keys(x),...Object.keys(y)]))diff(x[k],y[k],`${path}.${k}`);}else out.push({path,before:x,after:y});};delete a.levels[0].underlay;delete b.levels[0].underlay;diff(a,b,'plan');return out;}));
  assert.ok(first.equal,'template refresh preserves entire house');assert.equal(first.u.vacuum.entity_id,'camera.test_map');assert.match(first.u.imageId,/^map/);
  // Refresh entry remains available after import; failure changes nothing.
  await panel.locator('[data-act="vacuumRefresh"]').click();
  await page.waitForFunction(()=>!document.querySelector('hometwin-panel').wizard.st.mapLoading);
  await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.wizard.close();window.failMap=true;a.wizard.open({levelId:a.activeLevelId,vacuum:true});});
  await panel.locator('[role="alert"]').waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.first));
  // Explicit geometry update preserves the existing ID, metadata and all other objects.
  await page.evaluate(async()=>{
   window.failMap=false;const a=document.querySelector('hometwin-panel');a.wizard.close();a.wizard.open({levelId:a.activeLevelId,vacuum:true});
  });
  await page.waitForFunction(()=>document.querySelector('hometwin-panel').wizard.st.mapEntity==='camera.test_map'&&!document.querySelector('hometwin-panel').wizard.st.mapLoading);
  await page.evaluate(async()=>{const w=document.querySelector('hometwin-panel').wizard;await w.next();await w.next();w.st.mpp=.02;w.ai={configured:true};await w.detect();});
  const roomId=await page.evaluate(()=>document.querySelector('hometwin-panel').plan.levels[0].rooms[0].id);
  await panel.locator('[data-map-room]').first().selectOption(roomId);
  await panel.locator('[data-map-room]').nth(1).selectOption(roomId);
  await panel.locator('[data-wz="next"]').click();
  assert.match(await panel.locator('#wzMsg').innerText(),/at most once/);
  assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.first));
  await panel.locator('[data-map-room]').nth(1).selectOption('');
  await panel.locator('[data-wz="next"]').click();await page.waitForFunction(()=>document.querySelector('hometwin-panel').wizard.root.hidden);
  assert.ok(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel'),old=JSON.parse(window.first),now=structuredClone(a.plan);window.updated=JSON.stringify(a.plan);now.levels[0].underlay=old.levels[0].underlay;const changed=JSON.stringify(now.levels[0].rooms[0].points)!==JSON.stringify(old.levels[0].rooms[0].points);now.levels[0].rooms[0].points=old.levels[0].rooms[0].points;return changed&&JSON.stringify(now)===JSON.stringify(old);}));
  // Undo restores both geometry and the old image reference; redo restores the update.
  await page.evaluate(()=>document.querySelector('hometwin-panel').undo());
  assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.first));
  await page.evaluate(()=>document.querySelector('hometwin-panel').redo());
  assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.updated));
  if (!mobile) {
   // Fresh floor import, stale review, failed upload, and closed-session response.
   await page.evaluate(async()=>{const a=document.querySelector('hometwin-panel'),w=a.wizard;w.open({levelId:'__new',vacuum:true});const c=document.createElement('canvas');c.width=600;c.height=400;w.st.src=c;w.st.img=c;w.st.mpp=.02;w.st.opts.refine=false;w.useResult({mpp:.02,scale_source:'measured',rooms:[{name:'New garage',kind:'garage',points:[[0,0],[4,0],[4,3],[0,3]]}],openings:[],stairs:[]});window.beforeNew=JSON.stringify(a.plan);});
   assert.equal(await panel.locator('[data-map-room]').first().inputValue(),'__add');
   await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');window.savedFetch=a.hass.fetchWithAuth;a.hass.fetchWithAuth=async()=>new Response(null,{status:500});});
   await panel.locator('[data-wz="next"]').click();
   assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.beforeNew));
   await page.evaluate(()=>{document.querySelector('hometwin-panel').hass.fetchWithAuth=window.savedFetch;});
   await panel.locator('[data-wz="next"]').click();await page.waitForFunction(()=>document.querySelector('hometwin-panel').wizard.root.hidden);
   assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').plan.levels.at(-1).rooms[0].kind),'garage');
   await page.evaluate(async()=>{const a=document.querySelector('hometwin-panel'),w=a.wizard;w.open({levelId:a.activeLevelId,vacuum:true});w.st.img=document.createElement('canvas');w.st.img.width=100;w.st.img.height=100;w.st.mpp=.02;w.useResult({mpp:.02,scale_source:'measured',rooms:[{name:'Preview',kind:'room',points:[[0,0],[2,0],[2,2],[0,2]]}],openings:[],stairs:[]});a.plan.levels.at(-1).name='External edit';window.external=JSON.stringify(a.plan);await w.apply();});
   assert.match(await panel.locator('#wzMsg').innerText(),/changed during/);
   assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)),await page.evaluate(()=>window.external));
   assert.ok(await page.evaluate(async()=>{const a=document.querySelector('hometwin-panel'),w=a.wizard;w.close();w.open();const ws=a.hass.callWS;let resolve;a.hass.callWS=async m=>m.with_image?new Promise(r=>resolve=r):ws(m);w.pending={id:'old'};const pending=w.resumeJob();w.close();w.open();const current=w.st;resolve({job:{id:'old',source:'vacuum',image:window.mapImage,result:{rooms:[]}}});await pending;a.hass.callWS=ws;return w.st===current&&!w.st.src&&!w.st.vacuum;}),'late resume does not overwrite reopened wizard');
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS vacuum source/load, scale, AI hints, safe refresh, offline, explicit mapping, duplicate guard, preserved objects, undo/redo, desktop/mobile');
}finally{await browser.close();}
