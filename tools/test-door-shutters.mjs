import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:4185/demo/?lang=de');
 await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.plan);
 await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit'); const l=a.plan.levels[0]; const o=l.openings.find(o=>o.type==='window');o.type='door';delete o.cover; const oldStates=a.states.bind(a);const testState={entity_id:'cover.kind_1_1',state:'closed',attributes:{friendly_name:'Rolladen Ost',current_position:0}};a.states=()=>({...oldStates(),'cover.kind_1_1':testState});a.setLevel(l.id);window.testOpening={id:o.id,type:'opening',level:l.id};a.stage.rebuildLevel(l.id);a.editor.select(window.testOpening);});
 const root=page.locator('hometwin-panel');await root.locator('#oSearch').fill('Kind 1');
 assert.equal(await root.locator('#oC option[value="cover.kind_1_1"]').evaluate(o=>o.hidden),false);
 assert.equal(await root.locator('#oC option[value="cover.wohnzimmer_west"]').evaluate(o=>o.hidden),true);
 await root.locator('#oC').selectOption('cover.kind_1_1');await root.locator('#oGlazed').check();assert(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');return a.stage.levels.get(window.testOpening.level).house.doors[window.testOpening.id].hinge.children.some(c=>c.material?.transparent);}));
 assert.equal(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');const w=a.stage.levels.get(window.testOpening.level).house.windows[window.testOpening.id];return !!w?.shutter}),true);
 assert(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.clock.getDelta=()=>0.05;for(let i=0;i<40;i++)a.stage.tick();return a.stage.levels.get(window.testOpening.level).house.windows[window.testOpening.id].shutter.scale.y>.98;}));
 await root.locator('#oInv').check();assert.equal(await root.locator('#oC').inputValue?.() ?? await root.locator('#oC').evaluate(e=>e.value),'cover.kind_1_1');
 assert.equal(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');return JSON.parse(JSON.stringify(a.plan)).levels[0].openings.find(o=>o.id===window.testOpening.id).coverInvert}),true);
 assert(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');for(let i=0;i<40;i++)a.stage.tick();return a.stage.levels.get(window.testOpening.level).house.windows[window.testOpening.id].shutter.scale.y<.03;}));
 await page.screenshot({path:'.preview/door-shutter.png'});
 await page.setViewportSize({width:390,height:844}); await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.setMode('view');a.stage.tick();});await page.screenshot({path:'.preview/door-shutter-mobile.png'});
 console.log('PASS door cover assignment, normalized search, shutter mesh, invert persistence, desktop/mobile render');
} finally {await browser.close();}
