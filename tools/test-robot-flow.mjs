import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4185/demo/?lang=de');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.robotAreas);
 await page.evaluate(async()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');const l=a.plan.levels[0];l.rooms=[{id:'room',name:'Wohnzimmer',kind:'room',points:[[0,0],[4,0],[4,4],[0,4]]}];l.openings=[];a.activeLevelId=l.id;window.floorBefore=JSON.stringify(a.plan.levels);
 const h=a.hass;Object.defineProperty(a,'hass',{get:()=>h,set:v=>{h.states={...v.states,'camera.test_map':h.states['camera.test_map']};}});window.calls=[];window.mapFailure=false;
 h.states['camera.test_map']={state:'idle',attributes:{friendly_name:'Wall-E Karte',calibration_points:[{map:{x:0,y:0},vacuum:{x:10000,y:10000}},{map:{x:500,y:0},vacuum:{x:15000,y:10000}},{map:{x:0,y:500},vacuum:{x:10000,y:15000}}]}};
 const canvas=document.createElement('canvas');canvas.width=canvas.height=500;const g=canvas.getContext('2d');g.fillStyle='#152a3f';g.fillRect(0,0,500,500);g.strokeStyle='#85b9ff';g.lineWidth=4;g.strokeRect(0,0,400,400);const png=canvas.toDataURL();
 const original=h.callWS;h.callWS=async m=>{if(m.type==='hometwin/robots/list')return {robots:[{entity_id:'vacuum.test',name:'Wall-E',domain:'vacuum',zone_cleaning:true}]};if(m.type==='hometwin/vacuum/maps')return {maps:[{entity_id:'camera.test_map',name:'Wall-E Karte'}]};if(m.type==='hometwin/vacuum/map'){if(window.mapFailure)throw Error('offline');return {image:png};}if(m.type==='hometwin/robots/clean_zone'){window.calls.push(m);return {};}return original(m);};await a.robotAreas.open();});
 const p=page.locator('hometwin-panel').locator('#robotAreas');assert.equal(await p.locator('#robotDirectEntity').inputValue(),'vacuum.test');
 await p.locator('[data-room=room]').click();await p.locator('#robotDraftName').fill('Wohnbereich');await p.locator('[data-action=applySelection]').click();await p.locator('[data-action=save]').click();
 assert(await p.locator('.robot-overview').isVisible());assert((await p.locator('#robotNext').textContent()).includes('ausrichten'));
 await p.locator('[data-action=next]').click();await p.locator('#alignLoad').click();await p.locator('#alignMap').waitFor();
 for(const [home,map] of [[[0,0],[0,0]],[[4,0],[400,0]],[[0,4],[0,400]]]){for(const [selector,point] of [['#alignHome',home],['#alignMap',map]]){await p.locator(selector).scrollIntoViewIfNeeded();const xy=await p.locator(selector).evaluate((svg,point)=>{const p=new DOMPoint(...point).matrixTransform(svg.getScreenCTM());return [p.x,p.y];},point);await page.mouse.click(xy[0]+.1,xy[1]+.1);}}
 await p.locator('#alignConfirm').check();assert(await p.locator('#alignApply').isEnabled());await p.locator('#alignApply').click();await p.locator('.robot-alignment').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.calls.length),0);
 await p.locator('[data-action=save]').click();
 assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan.levels)),await page.evaluate(()=>window.floorBefore));
 await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/robot-flow-'+(mobile?'mobile':'desktop')+'.png'});
 // A failed map fetch cannot replace a saved calibration or send a robot command.
 const before=await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').robotAreas.profile.pairs));
 await p.locator('.robot-advanced > summary').click();await p.locator('[data-action=align]').click();await page.evaluate(()=>window.mapFailure=true);await p.locator('#alignLoad').click();await p.getByText('Roboterkarte konnte nicht geladen werden.',{exact:false}).waitFor();await p.locator('#alignClose').click();
 assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').robotAreas.profile.pairs)),before);assert.equal(await page.evaluate(()=>window.calls.length),0);assert.deepEqual(errors,[]);await page.close();
}console.log('PASS guided robot selection, automatic assignment, saved overview, visual alignment, failure preservation, no commands and desktop/mobile');}finally{await browser.close();}
