import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.preview', {recursive:true});
const out='.preview/';
const b=await chromium.launch({args:['--use-gl=swiftshader']});
for(const mobile of [false,true]){
 const page=await b.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/');
 await page.waitForFunction(()=>document.querySelector('hometwin-landing')?.ready);
 await page.evaluate(()=>document.querySelector('hometwin-landing').stage.stop());
 await page.waitForTimeout(1800); // Initial 250ms delay plus 1400ms wall-rise animation.
 await page.evaluate(()=>document.querySelector('hometwin-landing').stage.tick());
 await page.screenshot({path:out+'complete-hero-'+(mobile?'mobile':'desktop')+'.png'});
 for(const id of ['how','features','floorplan','library','contribute','install','roadmap','faq'])assert.equal(await page.locator('#'+id).count(),1);
 await page.locator('#library').scrollIntoViewIfNeeded();
 const catalog=await (await page.request.get(new URL('library/index.json',page.url()).href)).json();
 const total=catalog.items.length;
 await page.waitForFunction(count=>document.querySelectorAll('.obj').length===count,total);
 await page.locator('#q').fill('Xbox');assert.equal(await page.locator('.obj').count(),1);
 await page.locator('#q').fill('zzz-unmatched');assert.equal(await page.locator('.obj').count(),0);
 await page.locator('#q').fill('');
 await page.locator('[data-c="lighting"]').click();assert.equal(await page.locator('.obj').count(),catalog.items.filter(i=>i.category.split('/')[0]==='lighting').length);
 await page.locator('[data-c=""]').click();assert.equal(await page.locator('.obj').count(),total);
 // Force decoding all lazy images before the full-page evidence capture.
 await page.evaluate(async()=>{
   const images=[...document.images];images.forEach(i=>i.loading='eager');
   await Promise.all(images.map(i=>i.decode()));
 });
 await page.screenshot({path:out+'complete-library-'+(mobile?'mobile':'desktop')+'.png'});
 await page.getByText('Do I need AI?',{exact:true}).click();
 assert.equal(await page.locator('details[open]').count(),1);
 const missing=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href').slice(1)).filter(id=>id&&!document.getElementById(id)));
 assert.deepEqual(missing,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:out+'complete-page-'+(mobile?'mobile':'desktop')+'.png',fullPage:true});
 console.log(mobile?'mobile':'desktop',`PASS all original sections, ${total} objects, search, category filter, images, anchors, FAQ, no runtime errors`);
 await page.close();
}
await b.close();
