import { chromium } from 'playwright';

import assert from 'node:assert/strict';



const browser = await chromium.launch({headless:true,args:['--use-gl=swiftshader']});

try {

 for (const mobile of [false,true]) {

  const page = await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});

  const errors=[]; page.on('pageerror',e=>errors.push(e.message));

  await page.goto('http://127.0.0.1:4185/demo/?lang=de');

  await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.stage?.levels?.size);

  await page.evaluate(()=>{

   const a=document.querySelector('hometwin-panel');a.stage.stop();a.$('onboard').hidden=true;

   const l=a.plan.levels[0],r=l.rooms.find(r=>r.kind==='room');r.area_id='test_area';

   const testHass={...a.hass,states:{...a.hass.states},entities:{...a.hass.entities}}; a._hass=testHass; Object.defineProperty(a,'hass',{get:()=>testHass,set:()=>{}});

   for(const [id,state,attributes] of [

    ['light.unplaced','on',{friendly_name:'Leselicht ohne 3D-Modell',brightness:100,supported_color_modes:['brightness']}],

    ['cover.unplaced','open',{friendly_name:'Fensterrollladen',supported_features:15,current_position:80}],

    ['sensor.test_temp','22.3',{friendly_name:'Raumtemperatur',device_class:'temperature',unit_of_measurement:'°C'}],

    ['scene.test_room','scening',{friendly_name:'Gemütlicher Abend'}],

    ['automation.test_room','on',{friendly_name:'Licht bei Bewegung',last_triggered:'2026-10-18T20:00:00Z'}],

    ['automation.other_room','on',{friendly_name:'Andere Etage'}]]) {

     a.hass.states[id]={entity_id:id,state,attributes};a.hass.entities[id]={entity_id:id,area_id:id==='automation.other_room'?'other':'test_area'};

   }

   window.testRoom={id:r.id,level:l.id};window.testPlan=JSON.stringify(a.plan);window.calls=[];

   a.call=async(d,s,data)=>{window.calls.push({d,s,data});};

   a.setFocus(r.id,l.id);a.stage.stop();a.renderView();a.stage.tick();

  });

  assert(await page.locator('[data-more="light.unplaced"]').isVisible());

  assert((await page.locator('#summary').innerText()).includes('Lichter an'));

  assert.equal(await page.locator('[data-more="light.unplaced"]').count(),1);

  await page.locator('[data-control="light.toggle"][data-id="light.unplaced"]').click();

  assert.deepEqual(await page.evaluate(()=>window.calls.pop()),{d:'light',s:'toggle',data:{entity_id:'light.unplaced'}});

  await page.locator('[data-category=covers]').click();

  assert.equal(await page.locator('[data-more="light.unplaced"]').count(),0);

  await page.locator('[data-control="cover.stop_cover"][data-id="cover.unplaced"]').click();

  assert.equal(await page.evaluate(()=>window.calls.pop().s),'stop_cover');

  await page.locator('[data-room-tab=automations]').click();

  assert(await page.locator('[data-automation="automation.test_room"]').isVisible());

  assert.equal(await page.locator('[data-automation="automation.other_room"]').count(),0);

  await page.locator('[data-automation="automation.test_room"]').click();

  assert.deepEqual(await page.evaluate(()=>window.calls.pop()),{d:'automation',s:'turn_off',data:{entity_id:'automation.test_room',stop_actions:false}});

  await page.locator('[data-room-tab=scenes]').click();

  await page.locator('[data-scene="scene.test_room"]').click();

  assert.equal(await page.evaluate(()=>window.calls.pop().d),'scene');

  await page.locator('[data-room-tab=devices]').click();

  await page.locator('[data-category=lights]').click();

  await page.locator('[data-more="light.unplaced"]').click();

  assert(await page.locator('#dB').isVisible());

  assert.equal(await page.locator('#vp').getAttribute('data-sheet'),'full');

  await page.locator('#dBack').click();

  await page.locator('#roomCollapse').click();

  assert.equal(await page.locator('#vp').getAttribute('data-sheet'),'peek');

  assert(await page.locator('#summary').isVisible());

  assert(!(await page.locator('#tileArea').isVisible()));

  await page.locator('#roomCollapse').click();

  assert(await page.locator('#tileArea').isVisible());

  if(mobile){

   await page.locator('#sheetGrip').tap();

   assert.equal(await page.locator('#vp').getAttribute('data-sheet'),'full');

  }

  await page.evaluate(()=>{const a=document.querySelector('hometwin-panel');a.stage.rise=null;a.stage.tick();});

  await page.screenshot({path:'.preview/room-controls-'+(mobile?'mobile':'desktop')+'.png'});

  assert.equal(await page.evaluate(()=>JSON.stringify(document.querySelector('hometwin-panel').plan)===window.testPlan),true);

  assert.deepEqual(errors,[]);

  await page.close();

 }

 console.log('PASS desktop/mobile room controls, registry entities, filters, explicit actions, details, sheet and unchanged plan');

} finally {await browser.close();}

