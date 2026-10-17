import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

const base=process.env.HOMETWIN_TEST_URL||'http://127.0.0.1:4173/demo/';
mkdirSync('.preview',{recursive:true});
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];
try {
  for (const lang of ['en','de']) {
    const context=await browser.newContext({locale:lang==='en'?'de-DE':'en-US',viewport:{width:1440,height:1000}});
    const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
    await page.goto(base+(lang==='de'?'?lang=de':''));
    await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(()=>document.querySelector('hometwin-panel').stage.stop());
    const app=page.locator('hometwin-panel');
    assert.equal(await app.getAttribute('lang'),lang);
    assert.equal(await app.locator('#mEdit').innerText(),lang==='en'?'Edit':'Bearbeiten');
    await page.locator('[data-ob=demo]').click();
    await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());
    await page.screenshot({path:`.preview/localization-${lang}-view.png`});
    await app.locator('#mEdit').click();
    await page.locator('[data-ltab=insert]').click();
    await app.locator('#libSearch').fill('Xbox');
    await page.locator('[data-asset="f:lib:manufacturers/microsoft/media/xbox-wireless-controller-robot-white"]').click();
    await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());
    await page.screenshot({path:`.preview/localization-${lang}-editor.png`});
    const preserved=await page.evaluate(()=>{
      const p=document.querySelector('hometwin-panel');p.plan.levels[0].rooms[0].name='Meine persönliche Küche';
      const before=JSON.stringify(p.plan);p.panel={config:{ui_language:p.lang==='en'?'de':'en'}};
      return before===JSON.stringify(p.plan);
    });
    assert(preserved,'Language change must not rewrite plan data');
    assert.equal(await app.locator('#mEdit').innerText(),lang==='en'?'Bearbeiten':'Edit');
    await page.evaluate(language=>{const p=document.querySelector('hometwin-panel');p.panel={config:{ui_language:language}};p.wizard.open();},lang);
    await page.waitForTimeout(200);
    assert((await app.locator('#wizard').innerText()).includes(lang==='en'?'Floor':'Bauplan'));
    await page.screenshot({path:`.preview/localization-${lang}-wizard.png`});
    await page.evaluate(async()=>{const p=document.querySelector('hometwin-panel');p.wizard.close();await p.save();});
    await page.reload();await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
    assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').plan.levels[0].rooms[0].name),'Meine persönliche Küche');
    await context.close();
    console.log(`PASS ${lang}: default/explicit language, editor insertion, live switch, wizard, saved user names`);
  }
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
  await page.evaluate(()=>document.querySelector('hometwin-panel').stage.stop());
  await page.locator('[data-ob=demo]').click();await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());
  await page.screenshot({path:'.preview/localization-en-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS mobile and no page errors');await context.close();
}finally{await browser.close();}
