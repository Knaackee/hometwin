import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 for(const mobile of [false,true]) {
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4185/demo/?lang='+ (mobile?'de':'en'));
  await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.robotAreas);
  await page.evaluate(async()=>{
   const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');window.beforeHouse=JSON.stringify(a.plan);
   const h=a.hass;Object.defineProperty(a,'hass',{get:()=>h,set:v=>{h.states=v.states;}});const ws=h.callWS;window.calls=[];
   h.callWS=async m=>{if(m.type==='hometwin/robots/list')return {robots:[{entity_id:'vacuum.test',name:'Test Xiaomi',domain:'vacuum',zone_cleaning:true},{entity_id:'lawn_mower.test',name:'Mower',domain:'lawn_mower',zone_cleaning:false}]};if(m.type==='hometwin/robots/clean_zone'){window.calls.push(m);return {};}return ws(m);};
   a.editor.left='robots';a.editor.renderLeft();
  });
  await page.locator('hometwin-panel').locator('[data-robot-areas]').click();
  const p=page.locator('hometwin-panel').locator('#robotAreas');
  await p.locator('[data-tool="rect"]').click();
  const svg=p.locator('#robotMap'),box=await svg.boundingBox();
  await page.mouse.click(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.click(box.x+box.width*.55,box.y+box.height*.55);
  await p.locator('[data-action=applySelection]').click();
  assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').robotAreas.data.areas.length),1);
  await p.locator('.robot-advanced > summary').click();await p.locator('[data-action="addProfile"]').click();
  await p.locator('#robotDirectEntity').selectOption('vacuum.test');await p.locator('.robot-advanced > summary').click();
  await p.locator('#robotMapName').fill('Ground floor');await p.locator('#robotMapName').press('Tab');
  await page.evaluate(()=>{const r=document.querySelector('hometwin-panel').robotAreas;r.profile.pairs=[{home:[0,0],robot:[20000,20000]},{home:[5,0],robot:[25000,20000]},{home:[0,5],robot:[20000,25000]}];r.render();});
  await p.locator('[data-action="save"]').click();
  const unchanged=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel'),c=structuredClone(a.plan);delete c.site.robotAreas;return JSON.stringify(c)===window.beforeHouse;});assert(unchanged,'all house data preserved');
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await p.locator('[data-action="preview"]').click();
  assert(await p.locator('[data-action="send"]').isDisabled());
  // Editing after preview invalidates the command, and keyboard does not affect the scene.
  await p.locator('[data-action=editFlow]').click();await svg.focus();await page.keyboard.press('ArrowRight');assert.equal(await p.locator('[data-action="send"]').count(),0);
  assert(await p.locator('[data-action="preview"]').isDisabled());
  await p.locator('[data-action="save"]').click();await p.locator('[data-action="preview"]').click();
  await p.locator('#robotConfirm').check();
  await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/robot-areas-'+(mobile?'mobile':'desktop')+'.png'});
  await p.locator('[data-action="send"]').click();assert.equal(await page.evaluate(()=>window.calls.length),1);
  // Outside areas stay local, even with a device assigned.
  await p.locator('#robotScope').selectOption('site');await p.locator('.robot-advanced > summary').click();await p.locator('[data-action="addProfile"]').click();await p.locator('#robotDirectEntity').selectOption('lawn_mower.test');
  await p.locator('[data-action="save"]').click();assert.equal(await page.evaluate(()=>window.calls.length),1);
  await p.locator('[data-action="close"]').click();
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS: desktop/mobile drawing, assignments, preserved house, explicit mocked action and invalidated preview');
}finally{await browser.close();}
