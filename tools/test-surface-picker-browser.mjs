import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({args:['--use-gl=swiftshader']});
try {
  for (const mobile of [false,true]) {
    const page = await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:4185/demo/?lang=${mobile?'de':'en'}`);
    await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.stage?.levels?.size);
    await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');a.setLevel('eg');a.editor.select({type:'room',id:'wohnen',level:'eg'});a.stage.stop();a.stage.tick();});
    assert.ok(await page.locator('[data-surface]').count() >= 8);
    const room = () => page.evaluate(()=>document.querySelector('hometwin-panel').plan.levels[0].rooms.find(r=>r.id==='wohnen'));
    const before=await room();assert.equal(before.surfaceSpec,undefined);
    await page.locator('[data-surface="tile"]').click();
    assert.equal((await room()).surfaceSpec.id,'tile');
    await page.locator('#floorRotation').fill('90');await page.locator('#floorRotation').press('Tab');
    await page.locator('#floorwidth').fill('0.45');await page.locator('#floorwidth').press('Tab');
    await page.locator('#floorColor').fill('#aabbcc');await page.locator('#floorColor').dispatchEvent('change');
    assert.deepEqual((await room()).surfaceOptions,{rotation:90,width:.45,color:'#aabbcc'});
    await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.tick();});
    await page.locator('[data-surface="tile"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:`.preview/floor-palette-${mobile?'mobile':'desktop'}.png`});
    // Round-trip the complete saved plan; custom floors must not need a catalogue fetch.
    await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.setPlan(JSON.parse(JSON.stringify(a.plan)));a.editor.select({type:'room',id:'wohnen',level:'eg'});a.stage.stop();});
    assert.equal((await room()).surfaceOptions.width,.45);
    await page.locator('[data-surface-reset]').click();assert.equal((await room()).surfaceOptions,undefined);
    await page.locator('[data-surface-legacy]').click();assert.equal((await room()).surfaceSpec,undefined);
    assert.equal((await room()).surface,before.surface);assert.deepEqual((await room()).points,before.points);
    await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.undo();a.stage.stop();});
    assert.equal((await room()).surfaceSpec.id,'tile');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS flooring picker EN/DE desktop/mobile, overrides, snapshot round-trip, reset, legacy restoration, undo');
} finally {await browser.close();}
