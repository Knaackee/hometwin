import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 for (const mobile of [false,true]) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/demo/');
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);await page.evaluate(()=>document.querySelector('hometwin-panel').stage.stop());};
  await ready();
  assert.equal(await page.locator('[data-language=en]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-language=de] img').evaluate(img=>img.decode());
  assert(await page.locator('[data-language=de] img').evaluate(img=>img.naturalWidth>0&&img.src.startsWith('data:image/svg+xml')));
  await page.locator('[data-language=de]').click();
  await page.waitForFunction(()=>document.querySelector('hometwin-panel').lang==='de');
  assert.equal(await page.locator('[data-language=de]').getAttribute('aria-pressed'),'true');
  await page.reload();await ready();
  assert.equal(await page.locator('hometwin-panel').getAttribute('lang'),'de');
  await page.locator('[data-language=en]').click();
  await page.waitForFunction(()=>document.querySelector('hometwin-panel').lang==='en');
  await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());
  await page.screenshot({path:`.preview/welcome-language-${mobile?'mobile':'desktop'}.png`});
  // Saving failure keeps the previous language and allows retry.
  await page.evaluate(()=>{const p=document.querySelector('hometwin-panel');const ws=p.hass.callWS;p.hass.callWS=msg=>msg.type==='hometwin/language/set'?Promise.reject(new Error('offline')):ws(msg);});
  await page.locator('[data-language=de]').click();
  await page.waitForFunction(()=>!document.querySelector('hometwin-panel').shadowRoot.querySelector('[data-language=de]').disabled);
  assert.equal(await page.locator('hometwin-panel').getAttribute('lang'),'en');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: local flags, language switch, reload persistence, failure retry, desktop/mobile');
} finally { await browser.close(); }

