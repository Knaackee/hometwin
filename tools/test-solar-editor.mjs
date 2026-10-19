import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4185/demo/?lang=de');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.plan.site.roof={...a.plan.site.roof,type:'hip',rect:{cx:5,cz:4,length:18,width:14,rot:0},pitch:40};a.plan.site.roofItems=[];a.plan.site.solar=[{id:'testpv',plane:2,rows:2,cols:3,portrait:true,offset:[0,0]}];a.stage.layout();a.setMode('edit');a.setLevel('roof');a.editor.select({type:'solar',id:'testpv'});});
 const root=page.locator('hometwin-panel');await root.locator('#pvPattern').fill('6,4,2');await root.locator('[data-act="pvGenerate"]').click();
 const data=()=>page.evaluate(()=>structuredClone(document.querySelector('hometwin-panel').plan.site.solar[0]));
 assert.equal((await data()).modules.length,12);
 await root.locator('#pvModule').selectOption({value:'11'});const orig=(await data()).modules[11];
 await root.locator('#pvMu').fill('100');await root.locator('#pvMu').press('Tab');assert.equal((await data()).modules[11].u,100);await root.locator('#pvMu').fill(String(orig.u));await root.locator('#pvMu').press('Tab');
 await root.locator('#pvMu').fill(String(orig.u+.01));await root.locator('#pvMu').press('Tab'); // overlap or edge may reject; no invalid placement
 await root.locator('[data-act="pvRemove"]').click();assert.equal((await data()).modules.length,11);
 await root.locator('[data-act="pvAdd"]').click();assert.equal((await data()).modules.length,12);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.editor.select({type:'roof',id:'roof'});});
 await root.locator('#rfGutters').check();
 assert.equal(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');let n=0;for(const o of a.stage.levels.values())o.roof?.local?.traverse(m=>{if(m.userData.gutter)n++;});return n;}),4);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.editor.select({type:'solar',id:'testpv'});a.stage.rise=null;a.stage.layout();const roof=[...a.stage.levels.values()].find(o=>o.roof?.planes?.length).roof;const f=roof.planes[2].frame;roof.local.updateWorldMatrix(true,false);const center=roof.local.localToWorld(f.origin.clone().addScaledVector(f.v,3));const normal=f.n.clone().transformDirection(roof.local.matrixWorld);a.stage.tween=null;a.stage.controls.target.copy(center);a.stage.camera.position.copy(center).addScaledVector(normal,20);a.stage.camera.position.y+=8;a.stage.controls.update();a.stage.tick();});
 await root.locator('#pvMode').selectOption('module');
 const drag=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');const roof=[...a.stage.levels.values()].find(o=>o.roof?.panels?.length).roof;const mesh=roof.panels.find(m=>m.userData.solar==='testpv'&&m.userData.solarModule===10);const start=mesh.getWorldPosition(mesh.position.clone());const f=roof.planes[2].frame;const end=start.clone().addScaledVector(f.v.clone().transformDirection(roof.local.matrixWorld),.3);const r=a.stage.canvas.getBoundingClientRect();const px=p=>{p.project(a.stage.camera);return [r.left+(p.x+1)*r.width/2,r.top+(1-p.y)*r.height/2];};return {start:px(start),end:px(end)};});
 await page.screenshot({path:".preview/solar-drag-before.png"});const beforeDrag=(await data()).modules[10];await page.mouse.move(...drag.start);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('hometwin-panel').editor.drag?.solar);await page.evaluate(()=>{window.dragRoof=document.querySelector('hometwin-panel').editor.drag.solarContext.roof;});await page.mouse.move(...drag.end,{steps:8});await page.mouse.move(...drag.start,{steps:8});await page.mouse.move(...drag.end,{steps:8});assert(await page.evaluate(()=>document.querySelector('hometwin-panel').editor.drag?.solarContext.roof===window.dragRoof),'continuous drag retains roof and active gesture');await page.waitForFunction(()=>document.querySelector('hometwin-panel').editor.drag?.undo);await page.mouse.up();
 assert.notDeepEqual((await data()).modules[10],beforeDrag,'scene drag moves individual module');

 await root.locator('[data-act="pvDetach"]').click();assert.equal(typeof (await data()).modules[10].row,'string','detached module gets independent row identity');
 await root.locator('#pvPattern').fill('6,4,2');await root.locator('[data-act="pvGenerate"]').click();
 await root.locator('#pvMode').selectOption('field');await page.evaluate(()=>document.querySelector('hometwin-panel').stage.canvas.focus());
 const fieldBefore=await data();await page.keyboard.press('ArrowRight');const fieldAfter=await data();
 assert(fieldAfter.modules.every((m,i)=>Math.abs(m.u-fieldBefore.modules[i].u-.05)<1e-6),'keyboard moves whole field');
 await root.locator('#pvModule').selectOption({value:'7'});await root.locator('#pvMode').selectOption('row');await page.evaluate(()=>document.querySelector('hometwin-panel').stage.canvas.focus());
 const rowBefore=await data();await page.keyboard.press('Control+ArrowUp');const rowAfter=await data();
 assert(rowAfter.modules.every((m,i)=>Math.abs(m.v-rowBefore.modules[i].v-(m.row===1?.01:0))<1e-6),'keyboard moves selected row only');
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.editor.solarMode='module';a.editor.solarIndex=10;a.stage.tick();});
 const handle=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel'),st=a.stage,g=st.transform,arrow=g.children.find(x=>x.userData.axis==='z');const point=arrow.cone.localToWorld(arrow.position.clone().set(0,-.5,0)),end=point.clone().addScaledVector(g.userData.axes.z,.15),r=st.canvas.getBoundingClientRect(),px=p=>{p.project(st.camera);return [r.left+(p.x+1)*r.width/2,r.top+(1-p.y)*r.height/2];};return {start:px(point),end:px(end),camera:st.camera.position.toArray()};});
 const handleBefore=await data();await page.mouse.move(...handle.start);await page.mouse.down();
 assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').editor.drag?.transform),true,'arrow starts constrained drag');
 await page.mouse.move(...handle.end,{steps:4});await page.mouse.up();assert.notDeepEqual((await data()).modules[10],handleBefore.modules[10]);
 assert.deepEqual(await page.evaluate(()=>document.querySelector('hometwin-panel').stage.camera.position.toArray()),handle.camera,'object drag leaves camera unchanged');

 const repair=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.editor.solarMode='field';for(const m of a.plan.site.solar[0].modules)m.u+=2;a.stage.layout();a.stage.tick();const g=a.stage.transform,arrow=g.children.find(x=>x.userData.axis==='x'),p=arrow.cone.localToWorld(arrow.position.clone().set(0,-.5,0)),end=p.clone().addScaledVector(g.userData.axes.x,-.3),r=a.stage.canvas.getBoundingClientRect(),px=q=>{q.project(a.stage.camera);return [r.left+(q.x+1)*r.width/2,r.top+(1-q.y)*r.height/2];};return {start:px(p),end:px(end)};});
 const repairBefore=await data();await page.screenshot({path:'.preview/repair-field-before.png'});await page.mouse.move(...repair.start);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('hometwin-panel').editor.drag?.transform);await page.mouse.move(...repair.end,{steps:8});await page.mouse.up();
 assert((await data()).modules.every((m,i)=>m.u<repairBefore.modules[i].u),'mouse moves entire previously invalid field toward roof');
 await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/solar-hip.png'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.setMode('view');a.stage.tick();});await page.screenshot({path:'.preview/solar-hip-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS hip tree 12 modules, edge rejection, add/remove, 4 gutters, desktop/mobile render');
}finally{await browser.close();}
