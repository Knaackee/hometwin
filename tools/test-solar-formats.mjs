import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4185/demo/?lang=de');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');a.plan.site.roof={...a.plan.site.roof,type:'hip',rect:{cx:5,cz:4,length:18,width:14,rot:0},pitch:40};a.plan.site.roofItems=[];a.plan.site.solar=[{id:'formats',plane:2,modules:[{u:0,v:2,portrait:true,row:0},{u:1.2,v:2,portrait:true,row:0},{u:0,v:4,portrait:true,row:1}]}];a.setLevel('roof');a.stage.rise=null;a.stage.tween=null;a.stage.layout();a.editor.expanded.add('roof:roof');a.editor.renderLeft();});
 const root=page.locator('hometwin-panel'),data=()=>page.evaluate(()=>structuredClone(document.querySelector('hometwin-panel').plan.site.solar[0]));
 await root.locator('[data-pick="solar"][data-id="formats"]').click();const before=await data();await page.keyboard.press('ArrowRight');assert.equal((await data()).modules[0].u,before.modules[0].u+.05,'tree selection immediately responds to keyboard');
 await root.locator('#pvFormat').selectOption('2');assert((await data()).modules.every(m=>m.width===1.134&&m.length===1.762));
 await root.locator('#pvOrientation').selectOption('landscape');assert((await data()).modules.every(m=>m.portrait===false));
 await root.locator('#pvMode').selectOption('row');await root.locator('#pvModule').selectOption({value:'0'});await root.locator('#pvFormat').selectOption('3');assert.equal((await data()).modules[0].length,1.961);assert.equal((await data()).modules[2].length,1.762);
 await root.locator('#pvMode').selectOption('module');await root.locator('#pvWidth').fill('1.05');await root.locator('#pvWidth').press('Tab');assert.equal((await data()).modules[0].width,1.05);assert.equal((await data()).modules[1].width,1.134);
 await root.locator('#pvMu').fill('100');await root.locator('#pvMu').press('Tab');assert.equal((await data()).modules[0].u,100,'manual overhang accepted');assert(await root.locator('[role="status"]').filter({hasText:'Module überlappen'}).count());
 await root.locator('#pvMu').fill('0');await root.locator('#pvMu').press('Tab');
 const saved=await data();await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.setPlan(JSON.parse(JSON.stringify(a.plan)));a.editor.select({type:'solar',id:'formats'});a.stage.rise=null;a.stage.tween=null;a.stage.tick();});assert.deepEqual(await data(),saved,'plan reload preserves dimensions and orientation');
 const sizes=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel'),r=[...a.stage.levels.values()].find(o=>o.roof?.panels?.length).roof;return r.panels.filter(m=>m.userData.solar==='formats').map(m=>[m.geometry.parameters.width,m.geometry.parameters.depth]);});assert.deepEqual(sizes[0],[1.961,1.05]);
 await root.locator('[data-pick="solar"][data-id="formats"]').click();await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/pv-formats.png'});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.setMode('view');a.stage.tick();});await page.screenshot({path:'.preview/pv-formats-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS tree keyboard, field/row/module formats, orientation, custom dimensions, advisory overhang, reload and rendered geometry');
}finally{await browser.close();}
