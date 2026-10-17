import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.preview', {recursive:true});
const out='.preview/';
const browser=await chromium.launch({args:['--use-gl=swiftshader']});
for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
 await page.goto(process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/');
 await page.waitForFunction(()=>document.querySelector('hometwin-landing')?.ready);
 await page.locator('#house').scrollIntoViewIfNeeded();
 await page.evaluate(()=>document.querySelector('hometwin-landing').stage.stop());
 await page.waitForTimeout(1800); // Initial 250ms delay plus 1400ms wall-rise animation.
 await page.evaluate(()=>document.querySelector('hometwin-landing').stage.tick());
 assert.equal(await page.evaluate(()=>document.querySelector('hometwin-landing').hass.states['sensor.pv_leistung'].state),'0.00');
 if(mobile){
   assert.equal(await page.locator('#liveHouse').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
   await page.getByRole('button',{name:'Tap to explore the house'}).tap();
   assert.equal(await page.locator('#liveHouse').evaluate(e=>getComputedStyle(e).pointerEvents),'auto');
 }
 const target=await page.evaluate(()=>{
   const el=document.querySelector('hometwin-landing'),s=el.stage,r=s.canvas.getBoundingClientRect();
   for(const e of s.levels.get(el.levelSel).dev.values()){
     if(!e.dev.entity_id?.startsWith('light.'))continue;
     const v=e.hit.getWorldPosition(e.hit.position.clone()).project(s.camera);
     const x=r.left+(v.x+1)*r.width/2,y=r.top+(1-v.y)*r.height/2;
     if(y<0||y>innerHeight)continue;
     const pick=s.pick({clientX:x,clientY:y});
     if(pick?.id===e.dev.id)return {x,y,id:e.dev.entity_id,before:el.hass.states[e.dev.entity_id].state};
   }
 });
 assert.ok(target,'A visible lamp must be clickable');
 await page.mouse.click(target.x,target.y);
 await page.waitForFunction(({id,before})=>document.querySelector('hometwin-landing').hass.states[id].state!==before,target);
 await page.getByRole('button',{name:'All off',exact:true}).click();
 await page.waitForFunction(()=>Object.entries(document.querySelector('hometwin-landing').hass.states).filter(([id])=>id.startsWith('light.')).every(([,s])=>s.state==='off'));
 await page.getByRole('button',{name:'Evening',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('hometwin-landing').hass.states['light.wohnzimmer_stehlampe'].state==='on');
 await page.getByRole('button',{name:'Movie night',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('hometwin-landing').hass.states['light.wohnzimmer_stehlampe'].attributes.brightness===50);
 await page.getByRole('button',{name:'Evening',exact:true}).click();
 if(mobile)await page.getByRole('button',{name:'Done exploring'}).click();
 await page.locator('#house').scrollIntoViewIfNeeded();
 await page.evaluate(()=>{const s=document.querySelector('hometwin-landing').stage;s.stop();s.tick();});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:out+(mobile?'interactive-mobile':'interactive-desktop')+'.png'});
 await page.locator('footer').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>!document.querySelector('hometwin-landing').stage.running);
 await page.locator('#house').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('hometwin-landing').stage.running);
 console.log(mobile?'mobile':'desktop','PASS: canvas lamp click, all scenes, night solar, viewport, visibility pause/resume');
 await page.close();
}
await browser.close();
