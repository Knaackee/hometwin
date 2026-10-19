import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 for(const mobile of [false,true]){
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4185/demo/?lang=de');
  await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.robotAreas);
  await page.evaluate(async()=>{
   const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;a.setMode('edit');
   const l=a.plan.levels[0];l.rooms=[{id:'left',name:'Wohnen',kind:'room',points:[[0,0],[4,0],[4,4],[0,4]]},{id:'right',name:'Küche',kind:'room',points:[[4,0],[8,0],[8,4],[4,4]]}];
   l.openings=[{id:'door-test',type:'door',from:[4,1],to:[4,2],hinge:'to',swing:-1},{id:'pass-test',type:'open',from:[4,3],to:[4,3.8]},{id:'window-test',type:'window',from:[1,0],to:[2,0]}];
   a.activeLevelId=l.id;window.floorBefore=JSON.stringify(a.plan.levels);window.floorId=l.id;
   const h=a.hass;Object.defineProperty(a,'hass',{get:()=>h,set:v=>{h.states=v.states;}});const ws=h.callWS;
   h.callWS=m=>m.type==='hometwin/robots/list'?Promise.resolve({robots:[]}):ws(m);
   await a.robotAreas.open();
  });
  const p=page.locator('hometwin-panel').locator('#robotAreas');
  assert.equal(await p.locator('[data-opening-type="door"]').count(),1);
  assert.equal(await p.locator('[data-opening-type="open"]').count(),1);
  assert.equal(await p.locator('.robot-room-label').count(),2);
  // The shared wall is cut at both real openings, never at the window.
  const segments=await p.locator('[data-wall]').evaluateAll(nodes=>nodes.map(n=>['x1','y1','x2','y2'].map(k=>Number(n.getAttribute(k)))));
  const shared=segments.filter(s=>s[0]===4&&s[2]===4);assert(Math.abs(shared.reduce((n,s)=>n+Math.abs(s[3]-s[1]),0)-2.2)<.001);
  const left=p.locator('[data-room="left"]');await left.click();assert.equal(await p.locator('#robotRoom').inputValue(),'left');assert.equal(await left.getAttribute('aria-pressed'),'true');
  await p.locator('#robotRoom').selectOption('right');assert.equal(await p.locator('[data-room="right"]').getAttribute('aria-pressed'),'true');
  await left.focus();await page.keyboard.press('Enter');assert.equal(await p.locator('#robotRoom').inputValue(),'left');
  await p.locator('#robotDraftName').fill('Wohnen');await p.locator('[data-action="room"]').click();assert.equal(await p.locator('#robotAreaName').inputValue(),'Wohnen');
  await p.locator('[data-action="deleteArea"]').click();
  // Compose two rooms, toggle membership, cut a hole, then reopen the saved composite.
  await left.click();
  const right=p.locator('[data-room="right"]');
  if(mobile){await p.locator('[data-action=multi]').click();await right.click();}
  else await right.click({modifiers:['Shift']});
  assert.equal(await p.locator('.robot-room.selected').count(),2);
  await right.click({modifiers:mobile?[]:['Control']});assert.equal(await p.locator('.robot-room.selected').count(),1);
  await right.click({modifiers:mobile?[]:['Control']});assert.equal(await p.locator('.robot-room.selected').count(),2);
  await p.locator('[data-action=subtract]').click();
  for(const xy of [[1,1],[2,2]]){const pos=await p.locator('svg').evaluate((svg,xy)=>{const p=new DOMPoint(...xy).matrixTransform(svg.getScreenCTM());return [p.x,p.y];},xy);await page.mouse.click(...pos);}
  await p.locator('#robotDraftName').fill('Ground floor');await p.locator('[data-action=applySelection]').click();
  assert.deepEqual(await page.evaluate(()=>{const a=document.querySelector('hometwin-panel').robotAreas.area;return [a.parts.length,a.exclusions.length,a.name];}),[2,1,'Ground floor']);
  await p.locator('[data-action=save]').click();
  await p.locator('[data-action=close]').click();await page.evaluate(()=>document.querySelector('hometwin-panel').robotAreas.open());
  const areaId=await page.evaluate(()=>document.querySelector('hometwin-panel').robotAreas.data.areas[0].id);
  await p.locator('#robotArea').selectOption(areaId);await p.locator('[data-action=editArea]').click();
  assert.equal(await p.locator('.robot-room.selected').count(),2);
  await right.click({modifiers:['Control']});assert.equal(await p.locator('.robot-room.selected').count(),1);
  await right.click({modifiers:['Control']});assert.equal(await p.locator('.robot-room.selected').count(),2);
  await p.locator('[data-tool=rect]').click();
  for(const xy of [[8.1,1],[8.6,2]]){const pos=await p.locator('svg').evaluate((svg,xy)=>{const p=new DOMPoint(...xy).matrixTransform(svg.getScreenCTM());return [p.x,p.y];},xy);await page.mouse.click(...pos);}
  await p.locator('[data-action=applySelection]').click();
  assert.deepEqual(await page.evaluate(()=>{const r=document.querySelector('hometwin-panel').robotAreas;return [r.data.areas.length,r.area.parts.length,r.area.exclusions.length];}),[1,3,1]);
  await p.locator('#robotScope').scrollIntoViewIfNeeded();
  await page.evaluate(()=>document.querySelector('hometwin-panel').stage.tick());await page.screenshot({path:'.preview/robot-composite-'+(mobile?'mobile':'desktop')+'.png'});
  await p.locator('[data-action=deleteArea]').click();
  // Draw an explicit work polygon spanning both rooms through the doorway.
  await p.locator('[data-tool="poly"]').click();
  for(const xy of [[2,1],[6,1],[6,2],[2,2]]){
   const screen=await p.locator('svg').evaluate((svg,xy)=>{const p=new DOMPoint(...xy).matrixTransform(svg.getScreenCTM());return [p.x,p.y];},xy);
   await page.mouse.click(...screen);
  }
  await p.locator('[data-action="finish"]').click();
  await p.locator('[data-action=applySelection]').click();
  const pts=await page.evaluate(()=>document.querySelector('hometwin-panel').robotAreas.area.parts[0]);assert.deepEqual(pts,[[2,1],[6,1],[6,2],[2,2]]);
  await p.locator('[data-action="save"]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan.levels)),await page.evaluate(()=>window.floorBefore));
  await p.locator('#robotScope').scrollIntoViewIfNeeded();
  await page.screenshot({path:'.preview/robot-rooms-'+(mobile?'mobile':'desktop')+'.png'});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: door/passages cut shared walls, room names, mouse/keyboard selection, room copy, multi-room polygon and preserved floors (desktop/mobile)');
}finally{await browser.close();}
