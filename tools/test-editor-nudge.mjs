import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
mkdirSync('.preview', { recursive: true });
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto((process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4185/demo/') + '?lang=de');
 await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit'); const l=a.plan.levels.find(l=>l.devices.length);a.setLevel(l.id);a.editor.select({id:l.devices[0].id,type:'device',level:l.id});window.testSelection={...a.sel};a.stage.canvas.focus();});
 const state=()=>page.evaluate(()=>{const a=document.querySelector('hometwin-panel');const l=a.plan.levels.find(l=>l.id===window.testSelection.level);const i=l.devices.find(i=>i.id===window.testSelection.id);return {pos:[...i.pos],undo:a.undoStack.length,elevation:i.elevation};});
 for(const [key,amount] of [['ArrowRight',.05],['Shift+ArrowRight',.5],['Control+ArrowRight',.01]]) {
  const a=await state();await page.keyboard.press(key);const b=await state(); assert(Math.abs(Math.hypot(b.pos[0]-a.pos[0],b.pos[1]-a.pos[1])-amount)<.000002,key);assert.equal(b.undo,a.undo+1);
 }
 const before=await state();await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowUp');await page.keyboard.up('ArrowUp');const after=await state();assert.equal(after.undo,before.undo+1);await page.keyboard.press('Control+z');assert.deepEqual((await state()).pos,before.pos);
 await page.evaluate(()=>document.querySelector('hometwin-panel').editor.select(window.testSelection));
 await page.locator('hometwin-panel').locator('#iX').focus();const a=await state();await page.keyboard.press('ArrowRight');assert.deepEqual((await state()).pos,a.pos);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.canvas.focus();const l=a.plan.levels.find(l=>l.id===window.testSelection.level);l.devices.find(i=>i.id===window.testSelection.id).locked=true;});const locked=await state();await page.keyboard.press('ArrowRight');assert.deepEqual(await state(),locked);

 const groupBefore=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');const l=a.plan.levels.find(l=>l.id===window.testSelection.level);l.devices.find(i=>i.id===window.testSelection.id).locked=false;const second=l.devices.find(i=>i.id!==window.testSelection.id && !i.locked);a.editor.select({id:second.id,type:'device',level:l.id},{add:true});window.testGroup=a.editor.selection().map(s=>s.id);a.editor.setView2d(true);a.stage.canvas.focus();return l.devices.filter(i=>window.testGroup.includes(i.id)).map(i=>[...i.pos]);});
 await page.keyboard.press('ArrowRight');
 const groupAfter=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');return a.plan.levels.find(l=>l.id===window.testSelection.level).devices.filter(i=>window.testGroup.includes(i.id)).map(i=>[...i.pos]);});
 assert.equal(groupAfter.length,2);for(let i=0;i<2;i++){assert(Math.abs(groupAfter[i][0]-groupBefore[i][0]-.05)<.000002);assert(Math.abs(groupAfter[i][1]-groupBefore[i][1])<.000002);}
 await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/keyboard-placement.png'});

 const heightDrag=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.exitTopView();const L=a.plan.levels.find(l=>l.furniture.length),item=L.furniture.find(f=>!f.locked);a.setLevel(L.id);a.editor.select({type:'furniture',id:item.id,level:L.id});a.stage.tween=null;a.stage.tick();const st=a.stage,g=st.transform,arrow=g.children.find(x=>x.userData.axis==='y'),p=arrow.cone.localToWorld(arrow.position.clone().set(0,-.5,0)),end=p.clone();end.y+=.3;const r=st.canvas.getBoundingClientRect(),px=q=>{q.project(st.camera);return [r.left+(q.x+1)*r.width/2,r.top+(1-q.y)*r.height/2];};window.heightItem={id:item.id,level:L.id};return {start:px(p),end:px(end),height:st.itemElevation(L.id,'furniture',item.id)};});
 await page.mouse.move(...heightDrag.start);await page.mouse.down();await page.waitForFunction(()=>document.querySelector('hometwin-panel').editor.drag?.transform);
 await page.mouse.move(...heightDrag.end,{steps:4});await page.mouse.up();
 const heightAfter=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel'),i=a.plan.levels.find(l=>l.id===heightItem.level).furniture.find(i=>i.id===heightItem.id);return {height:i.elevation,auto:i.autoElevation};});
 assert(Math.abs(heightAfter.height-heightDrag.height-.3)<.051,'height handle raises furniture');assert.equal(heightAfter.auto,false);
 await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/transform-height.png'});
 console.log('PASS: 5/50/1 cm, held key single undo, undo restores position, input focus and locked object protection');
}finally{await browser.close();}
