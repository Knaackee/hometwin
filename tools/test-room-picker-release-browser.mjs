import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({args:['--use-gl=swiftshader']});
try {
 for (const mobile of [false,true]) for (const language of ['en','de']) {
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:4185/demo/?lang=${language}`);
  await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
  const fixture=await page.evaluate(()=>{
   const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;
   const level=a.plan.levels[0],room=level.rooms.find(r=>r.kind==='room');room.area_id='picker_test';
   a._hass={...a.hass,states:{...a.hass.states,'light.picker_test':{state:'on',attributes:{friendly_name:'Test lamp'}}},entities:{...a.hass.entities,'light.picker_test':{area_id:'picker_test'}},areas:{...a.hass.areas,picker_test:{name:room.name,icon:'mdi:sofa'}}};
   a.setLevel(level.id,false);a.renderRoomSel();a.stage.tick();
   return {room:room.id,level:level.id,name:room.name};
  });
  assert.equal(await page.locator('#roomSel').count(),0);
  const trigger=page.locator('.room-picker-trigger');await trigger.click();
  const option=page.locator(`[data-room-option="${fixture.room}"]`);
  assert.match(await option.innerText(),language==='de'?/Lichter an/:/lights on/i);
  await page.locator('.room-picker-search').fill(fixture.name);
  await page.evaluate(()=>document.querySelector('hometwin-panel').renderRoomSel());
  assert.equal(await page.locator('.room-picker-search').inputValue(),fixture.name);
  await page.screenshot({path:`.preview/room-picker-${language}-${mobile?'mobile':'desktop'}.png`});
  await option.click();
  assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').focusRoom),fixture.room);
  await trigger.press('ArrowDown');await page.locator('[data-room-option=""]').press('Enter');
  assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').levelSel),fixture.level);
  await page.locator('#tSun').click();await page.locator('#releaseNotesOpen').click();
  const dialog=page.locator('dialog.release-notes');await dialog.waitFor({state:'visible'});
  assert.match(await dialog.innerText(),/0\.7\.0/);
  assert(!/robot|vacuum/i.test(await dialog.innerText()));
  await dialog.locator('summary').first().click();
  assert.equal(await dialog.locator('details[open]').count(),1);
  await page.screenshot({path:`.preview/release-notes-${language}-${mobile?'mobile':'desktop'}.png`});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').shadowRoot.activeElement.id),'releaseNotesOpen');
  const auto=await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');localStorage.removeItem('hometwin.releaseNotes.seenVersion');const first=a.releaseNotes.maybeShow();a.releaseNotes.close();const second=a.releaseNotes.maybeShow();return {first,second};});
  assert.deepEqual(auto,{first:true,second:false});assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS room picker and release notes: EN/DE desktop/mobile, selection, live status, focus, history, upgrade tracking');
}finally{await browser.close();}

