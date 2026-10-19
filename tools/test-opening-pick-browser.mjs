import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4185/demo/?lang=en');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.stage?.levels?.size);
 const target=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');const l=a.plan.levels[0];l.rooms=[{id:'r',name:'Test room',kind:'room',points:[[0,0],[5,0],[5,4],[0,4]]}];l.openings=[{id:'d',type:'door',from:[2,0],to:[3,0],head:2.1}];l.furniture=[];l.devices=[];a.plan.levels=[l];a.plan.site.roofs=[];a.plan.site.solar=[];a.plan.site.roofItems=[];a.stage.rebuildAll();a.stage.rise=null;a.stage.layout();a.stage.tween=null;a.stage.controls.target.set(2.5,1.1,0);a.stage.persp.position.set(2.5,2,-8);a.stage.controls.update();a.stage.tick();const [x,y]=a.stage.project(2.5,a.stage.displayY(l)+1,0);const r=a.stage.canvas.getBoundingClientRect();return {x:x+r.left,y:y+r.top};});
 await page.mouse.move(target.x,target.y);await page.waitForTimeout(100);
 let state=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');return {tip:a.$('tip').textContent,hidden:a.$('tip').hidden,helpers:a.stage.hoverHelpers.length};});
 assert.equal(state.hidden,false);assert.match(state.tip,/Door/);assert.match(state.tip,/Test room/);assert.equal(state.helpers,1);
 await page.mouse.click(target.x,target.y);
 assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').sel?.id),'d');
 await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/opening-hover.png'});
 await page.mouse.move(5,5);assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').stage.hoverHelpers.length),0);assert.deepEqual(errors,[]);
 console.log('PASS actual mouse hover tooltip/outline and click agree for unlinked door; leave clears');
} finally {await browser.close();}
