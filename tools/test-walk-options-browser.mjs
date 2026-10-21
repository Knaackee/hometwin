import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readWalkOptions } from '../frontend/src/walk-options.js';

assert.deepEqual(readWalkOptions('test',{getItem:()=>null}),{walls:false,gravity:false});
assert.deepEqual(readWalkOptions('test',{getItem:()=>'{bad'}),{walls:false,gravity:false});
assert.deepEqual(readWalkOptions('test',{getItem:()=>'{"walls":true,"gravity":"true"}'}),{walls:true,gravity:false});
const browser=await chromium.launch({args:['--use-gl=swiftshader']});
try {
  for(const mobile of [false,true]) {
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
    await page.goto(`http://127.0.0.1:4185/demo/?lang=${mobile?'de':'en'}`);
    await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.stage?.levels?.size);
    await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.startWalk();a.stage.stop();a.stage.tick();});
    assert.equal(await page.locator('#whBody').isVisible(),false);
    await page.screenshot({path:`.preview/walk-menu-${mobile?'mobile':'desktop'}.png`});
    await page.locator('.wh-details summary').click();
    assert.equal(await page.locator('#whBody').isVisible(),true);
    await page.locator('#whBody').fill('1.82');await page.locator('#whBody').press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').stage.walk.body),1.82);
    await page.screenshot({path:`.preview/walk-menu-settings-${mobile?'mobile':'desktop'}.png`});
    await page.locator('.wh-details summary').click();
    const walls=page.locator('[data-walk-option="walls"]'),gravity=page.locator('[data-walk-option="gravity"]');
    assert.equal((await walls.getAttribute('aria-pressed'))==='true',false);assert.equal((await gravity.getAttribute('aria-pressed'))==='true',false);
    await walls.click();await gravity.click();
    assert.equal(await page.locator('[data-flight="1"]').isDisabled(),true);
    assert.deepEqual(await page.evaluate(()=>document.querySelector('hometwin-panel').walkOptions),{walls:true,gravity:true});
    await gravity.click();assert.equal((await walls.getAttribute('aria-pressed'))==='true',true);
    const saved=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');return JSON.parse(localStorage.getItem(`hometwin.walk.${a.walkSettings.userId}`));});
    assert.deepEqual(saved,{walls:true,gravity:false});
    const tracking=await page.evaluate(()=>{
      const a=document.querySelector('hometwin-panel'),w=a.stage.walk,L=a.plan.levels.find(l=>l.id===w.levelId);
      const p=[w.x,w.z];L.rooms=[{id:'track-a',name:'Room A',kind:'room',points:[[p[0]-1,p[1]-1],[p[0]+1,p[1]-1],[p[0]+1,p[1]+1],[p[0]-1,p[1]+1]]}];
      a.syncWalkRoom(L,w);const inside=a.focusRoom;a.renderView();const title=a.$('vpTitle').textContent;
      a.syncWalkRoom(L,{...w,x:p[0]+20});const outside=a.focusRoom;
      a.syncWalkRoom(L,w);return {inside,outside,title};
    });
    assert.deepEqual(tracking,{inside:'track-a',outside:null,title:'Room A'});
    await page.screenshot({path:`.preview/walk-options-${mobile?'mobile':'desktop'}.png`});
    await page.close();
  }
  console.log('PASS defaults, malformed settings, independent switches, storage, flight controls, desktop/mobile');
} finally {await browser.close();}
