import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({args:['--use-gl=swiftshader']});
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({viewport: mobile ? {width:390,height:844} : {width:1440,height:900}, isMobile:mobile, hasTouch:mobile});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:4185/demo/?lang=en');
    await page.waitForFunction(()=>document.querySelector('hometwin-panel')?.stage?.levels?.size);
    await page.evaluate(()=>{
      const app=document.querySelector('hometwin-panel'); app.stage.stop(); app.$('onboard').hidden=true;
      const room=id=>({id,name:id,kind:'room',surface:'oak',points:[[-4,-4],[4,-4],[4,4],[-4,4]]});
      const level=(id,elevation)=>({id,name:id,elevation,height:2.6,slab:.25,rooms:[room(id+'-room')],openings:[],furniture:[],devices:[]});
      const plan=structuredClone(app.plan); plan.levels=[level('Lower',0),level('Upper',2.85)];
      plan.site.roof={...plan.site.roof,type:'flat',rect:{cx:0,cz:0,length:8,width:8,rot:0}}; plan.site.roofs=[];plan.site.solar=[];
      plan.levels[0].furniture=[{id:'test-stair',type:'stairs',pos:[0,0],width:1.2,depth:3.2,height:2.85,rot:0}];
      app.setPlan(plan);app.setMode('edit');app.activeLevelId='Lower';app.setLevel('Lower',false);
      app.markDirty({settle:false}); clearTimeout(app._saveT);
      app.editor.select({type:'furniture',id:'test-stair',level:'Lower'});
      app.stage.rise=null;app.stage.frame('Lower',true);app.stage.tick();
    });
    await page.screenshot({path:`.preview/stairs-inspector-${mobile?'mobile':'desktop'}.png`});
    await page.locator('[data-act="stEditOpening"]').click();
    assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').sel.id),'void_test-stair');
    await page.evaluate(()=>{
      const a=document.querySelector('hometwin-panel');a.plan.levels[1].rooms.find(r=>r.stair==='test-stair').points[0][0]-=.2;
      a.markDirty({settle:false});clearTimeout(a._saveT);
    });
    await page.locator('[data-act="stAutoOpening"]').click();
    assert.equal(await page.evaluate(()=>document.querySelector('hometwin-panel').plan.levels[0].furniture[0].openingMode),'auto');
    const result=await page.evaluate(()=>{
      const app=document.querySelector('hometwin-panel'), stage=app.stage;
      app.setMode('view');app.setLevel('Lower',false);stage.enterWalk(app.plan.levels[0],[0,1.85]);stage.stop();stage.walk.yaw=0;
      const original=JSON.stringify(app.plan), heights=[];
      stage.walk.keys.add('w');
      for(let i=0;i<65;i++){stage.walkStep(.05);heights.push(stage.persp.position.y);}
      stage.walk.keys.clear();
      const upper={level:stage.walk.levelId,z:stage.walk.z,y:stage.persp.position.y};
      stage.walk.keys.add('s');
      for(let i=0;i<65;i++)stage.walkStep(.05);
      stage.walk.keys.clear();stage.tick();
      const lower=stage.walk.levelId;
      app.levelSel='all';app.xray=true;stage.layout();
      app.levelSel='all';app.explode=true;app.xray=true;stage.layout();
      const roof=stage.levels.get('Upper').roof;
      let roofGhosted=false;roof?.group.traverse(o=>{if(o.userData?.origMat)roofGhosted=true;});
      const visibleCeilings=[];for(const [id,o] of stage.levels){o.house.group.traverse(m=>{if(m.userData?.blocker)visibleCeilings.push([id,m.material.colorWrite]);});}
      app.walkLevel(1);stage.walkStep(0);const manualUp=stage.persp.position.y;
      app.walkLevel(-1);stage.walkStep(0);const manualDown=stage.persp.position.y;
      return {upper,lower,manualUp,manualDown,heights,unchanged:original===JSON.stringify(app.plan),visible:[...stage.levels.values()].filter(x=>x.group.visible).length,roof:!!roof,roofGhosted,visibleCeilings};
    });
    assert.equal(result.upper.level,'Upper');assert.equal(result.lower,'Lower');assert(result.unchanged);
    assert(result.visible>=2);assert(Math.max(...result.heights)>4);
    assert(result.roof);assert.equal(result.roofGhosted,false);assert(result.visibleCeilings.length>=2);assert(result.visibleCeilings.every(([,colorWrite])=>colorWrite!==false));
    assert(Math.abs(result.manualUp-result.manualDown-2.85)<1e-6,'manual floor buttons reset stair elevation');
    assert(Math.max(...result.heights.slice(1).map((h,i)=>Math.abs(h-result.heights[i])))<.3,'no height teleport');
    await page.screenshot({path:`.preview/stairs-walk-${mobile?'mobile':'desktop'}.png`});
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS desktop/mobile stair inspector, continuous up/down traversal, visible levels and unchanged plan');
} finally { await browser.close(); }
