import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4185/demo/');await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.stage?.running);
 await page.evaluate(()=>{window.panel=document.querySelector('hometwin-panel');panel.$('onboard').hidden=true;window.savedPlan=JSON.stringify(panel.plan);window.savedCamera=panel.stage.camera.position.toArray();panel.stage.tween=null;panel.stage.rise=null;panel.stage.stop();panel.stage.tick();});
 await page.evaluate(()=>{panel.remove();document.body.append(panel);});
 assert(await page.evaluate(()=>panel.stage.running),'reattached panel resumes');
 await page.evaluate(()=>{panel.style.display='none';panel.stage.resize();panel.style.display='';panel.stage.resume();});
 assert(await page.evaluate(()=>panel.stage.renderer.domElement.width>1),'hidden resize retains useful canvas size');
 await page.evaluate(()=>{panel.stage.renderer.forceContextLoss();});
 await page.waitForFunction(()=>panel.stage._contextLost===true&&!panel.stage.running);
 await page.evaluate(()=>panel.stage.renderer.forceContextRestore());
 await page.waitForFunction(()=>!panel.stage._contextLost&&panel.stage.running);
 await page.evaluate(()=>{panel.stage.stop();panel.stage.tick();});
 assert.equal(await page.evaluate(()=>JSON.stringify(panel.plan)),await page.evaluate(()=>savedPlan),'recovery preserves plan');
 assert(await page.evaluate(()=>panel.stage.renderer.info.render.calls>0),'restored context draws scene');
 await page.screenshot({path:'.preview/context-restored.png'});
 assert.deepEqual(errors,[]);console.log('PASS detach/reattach, hidden resize, real WebGL context loss/restore, plan preserved, scene rendered');
}finally{await browser.close();}
