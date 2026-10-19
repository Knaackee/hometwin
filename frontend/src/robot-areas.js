import { ROBOT_PREVIEW_ENABLED } from './features.js';
import { esc } from './panel.js';
import { t } from './i18n.js';
import { roomFills, roomLabels, floorWalls } from './robot-floor-view.js';
import { openRobotCalibration } from './robot-calibration.js';
import { newId } from './plan.js';
import { inside, validArea, validWorkArea, outlines, rings, cleaningZones, mapTransform } from './robot-geometry.js';

const colors={work:'#6db5ff',exclude:'#ff7878',boundary:'#91d49b',line:'#ffce7c'};
const fresh=()=>({version:1,areas:[],profiles:[]});
export class RobotAreas {
  constructor(app) { this.app=app; this.root=app.$('robotAreas'); }
  async open() {
    if (!ROBOT_PREVIEW_ENABLED) return;
    if(!this.app.isAdmin())return;
    if(!this.app.plan.levels.some(l=>l.rooms.some(r=>r.kind!=='void')))return this.app.toast(t('robots.needsFloor'));
    this.data=structuredClone(this.app.plan.site.robotAreas||fresh());this.baseline=JSON.stringify(this.app.plan.site.robotAreas||fresh());
    this.scope=this.app.plan.levels.find(l=>l.id===this.app.activeLevelId&&l.rooms.some(r=>r.kind!=='void'))?.id||this.app.plan.levels.find(l=>l.rooms.some(r=>r.kind!=='void')).id;this.selected=null;this.roomId=null;this.roomIds=new Set();this.selection={parts:[],exclusions:[]};this.multi=false;this.subtract=false;this.editing=null;this.profileId=null;this.points=[];this.tool='select';this.calOpen=false;this.bounds=null;this.robots=[];this.message='';this.confirmation=null;
    this.phase='list';this.overview=true;this.root.hidden=false;this.render();this.root.querySelector('[data-action=close]').focus();const session=this.data;
    try {const res=await this.app.hass.callWS({type:'hometwin/robots/list'});if(this.data!==session||this.root.hidden)return;this.robots=res.robots;}
    catch{this.message=t('robots.loadError');}
    if(this.data===session&&!this.root.hidden){this.render();}
  }
  dirty(){return JSON.stringify(this.data)!==this.baseline||this.selection.parts.length>0||this.selection.exclusions.length>0||this.points.length>0;}
  close(){if(this.sending)return;if(this.dirty()&&!confirm(t('robots.discard')))return;this.root.hidden=true;this.data=null;}
  get area(){return this.data.areas.find(a=>a.id===this.selected);}
  get profile(){return this.data.profiles.find(p=>p.id===this.profileId&&p.scope===this.scope);}
  changed(){this.confirmation=null;this.message='';}
  save(){
    if(this.selection.parts.length||this.selection.exclusions.length||this.points.length){this.message=t('robots.applyFirst');return this.render();}
    if(JSON.stringify(this.app.plan.site.robotAreas||fresh())!==this.baseline){this.message=t('robots.conflict');return this.render();}
    if([...this.data.areas,...this.data.profiles].some(a=>a.scope!=='site'&&!this.app.plan.levels.some(l=>l.id===a.scope))){this.message=t('robots.conflict');return this.render();}
    if(this.data.areas.some(a=>!validWorkArea(a))){this.message=t('robots.invalidArea');return this.render();}
    this.app.pushUndo();this.app.plan.site.robotAreas=structuredClone(this.data);this.app.markDirty({settle:false});this.baseline=JSON.stringify(this.data);this.message=t('robots.saved');this.phase='list';this.overview=true;this.render();(this.root.querySelector('[data-action=new]')||this.root.querySelector('#robotNext'))?.focus();
  }
  chooseRobot(entityId){
    let p=this.data.profiles.find(p=>p.scope===this.scope&&p.entity_id===entityId);
    if(!p&&entityId){p={id:newId('robot'),scope:this.scope,entity_id:entityId,map_name:this.scopeName(this.scope),pairs:Array.from({length:3},()=>({home:[null,null],robot:[null,null]}))};this.data.profiles.push(p);}
    this.profileId=p?.id||null;this.changed();
  }
  chooseDefaultRobot(){
    const existing=this.data.profiles.filter(p=>p.scope===this.scope);
    if(existing.length===1){this.profileId=existing[0].id;return;}
    const eligible=this.robots.filter(r=>r.zone_cleaning&&this.scope!=='site');
    if(!existing.length&&eligible.length===1)this.chooseRobot(eligible[0].entity_id);
  }
  nextStep(){
    if(!this.profile?.entity_id)return 'chooseRobot';
    if(!this.robots.find(r=>r.entity_id===this.profile.entity_id)?.zone_cleaning)return 'unsupported';
    if(!this.area)return 'chooseArea';
    try{mapTransform(this.profile.pairs);}catch{return 'align';}
    if(this.dirty())return 'saveFirst';
    try{cleaningZones(this.area,this.profile,this.data.areas);}catch(e){return e.message;}
    return 'ready';
  }
  stepText(step){return t(`robots.${['chooseRobot','chooseArea','align','saveFirst','ready','unsupported'].includes(step)?'flow':'error'}.${step}`);}
  scopeName(id){return id==='site'?t('robots.site'):this.app.plan.levels.find(l=>l.id===id)?.name||id;}
  render(){
    if(!this.data||this.root.hidden)return;
    const a=this.area,p=this.profile,step=this.nextStep(),profiles=this.data.profiles.filter(p=>p.scope===this.scope);
    const field=(label,id,value,type='text')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value??'')}" ${type==='number'?'step="any"':''}></div>`;
    this.root.innerHTML=`<style>
      .robot-list{padding:20px;overflow:auto;flex:1}.robot-item{padding:16px 0;border-bottom:1px solid var(--line)}.robot-item details{display:inline-block;margin-left:12px}.robot-dialog{width:min(1280px,98vw);height:min(880px,96vh);display:flex;flex-direction:column;background:var(--panel-solid,#141c28);border:1px solid var(--line);border-radius:16px;overflow:hidden;color:var(--fg)}
      .robot-dialog header,.robot-dialog footer{display:flex;gap:10px;align-items:center;padding:14px;border-bottom:1px solid var(--line);flex-wrap:wrap}.robot-dialog h2{margin:0;font-size:18px}.robot-dialog header button:last-child{margin-left:auto}
      .robot-overview .robot-editing{display:none}.robot-progress{padding:12px 16px;background:#202c3e}.robot-next{padding:12px;border-left:3px solid #85b9ff;margin-bottom:14px}.robot-next strong{display:block}.robot-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0;flex:1}.robot-map{display:flex;flex-direction:column;min-height:0;padding:12px}.robot-map .actions{flex-wrap:wrap;gap:6px}.robot-map button[aria-pressed="true"]{background:#355d8b;border-color:#85b9ff;color:#fff}.robot-map svg{width:100%;flex:1;min-height:240px;background:#0c1420;touch-action:none;margin-top:10px;border-radius:10px}.robot-map svg:focus{outline:2px solid var(--edit)}
      .robot-settings{overflow:auto;padding:16px;border-left:1px solid var(--line)}.robot-dialog select,.robot-dialog input[type="text"],.robot-dialog input[type="number"]{background:#202c3e;color:inherit;border:1px solid #45536a;border-radius:6px;padding:8px;font:inherit}.robot-settings>label{display:block;margin-top:12px}.robot-settings h3{margin:18px 0 8px}.robot-settings .field{margin:8px 0}.robot-settings .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.robot-settings input,.robot-settings select{max-width:100%;width:100%;box-sizing:border-box}.robot-dialog .hint{line-height:1.5}.robot-dialog footer{border-top:1px solid var(--line);border-bottom:0}.robot-dialog footer .msg{flex:1;min-width:160px}.robot-room{fill:#25354a;cursor:pointer;outline:none}.robot-room:hover,.robot-room:focus{fill:#3c536e}.robot-room.selected{fill:#416a91}.robot-room-label{fill:#fff;paint-order:stroke;stroke:#142033;stroke-width:.06;pointer-events:none}.robot-map .legend{font-size:12px;color:#bdcadb;margin:8px 0}.robot-dialog [data-vertex]{cursor:grab}.robot-dialog [data-area]{cursor:move}.robot-cal{margin-top:10px}.robot-cal summary{cursor:pointer}.robot-cal table{width:100%;font-size:11px}.robot-cal input{min-width:0;width:65px;padding:5px}.robot-confirm{padding:12px;border:1px solid #ffce7c;border-radius:8px}.robot-confirm pre{white-space:pre-wrap}
      @media(max-width:700px){.robot-dialog{height:98dvh;width:100vw;border-radius:0}.robot-layout{display:block;overflow:auto}.robot-map{height:auto}.robot-map svg{flex:none;height:300px}.robot-settings{overflow:visible;border-left:0}.robot-dialog h2{font-size:16px}}
    </style><section class="robot-dialog ${this.overview?'robot-overview':''}" role="dialog" aria-modal="true" aria-label="${t('robots.title')}">
      <header><h2>${t('robots.title')}</h2><button class="btn" data-action="close" aria-label="${t('robots.close')}">×</button></header>
      ${this.phase==='list'?`<div class="robot-list"><button class="btn primary" data-action="new">${t('robots.simple.new')}</button><p class="hint">${t('robots.simple.intro')}</p>${this.data.areas.map(area=>{const assigned=this.data.profiles.find(p=>p.id===area.profile_id)||this.legacyProfile(area);return `<article class="robot-item"><strong>${esc(area.name)}</strong><p>${esc(this.scopeName(area.scope))} · ${esc(assigned?this.app.nameOf(assigned.entity_id):t('robots.chooseDevice'))}</p><button class="btn" data-edit="${esc(area.id)}">${t('robots.simple.edit')}</button> <button class="btn primary" data-clean="${esc(area.id)}" ${area.kind!=='work'?'disabled':''}>${t('robots.simple.clean')}</button> <details><summary>${t('robots.simple.more')}</summary><button class="btn danger" data-delete="${esc(area.id)}">${t('robots.delete')}</button></details></article>`;}).join('')||`<p>${t('robots.simple.empty')}</p>`}</div>`:`
      <div class="robot-progress">${t(this.phase==='draw'?'robots.simple.draw':this.phase==='details'?'robots.simple.details':'robots.preview')}</div>
      <div class="robot-layout"><div class="robot-map"><strong>${esc(this.scopeName(this.scope))}</strong>
      ${this.phase==='draw'?`<p class="hint">${t('robots.drawingHint')}</p><div class="actions">${['select','rect','poly'].map(k=>`<button class="btn small" data-tool="${k}" aria-pressed="${this.tool===k}">${t(`robots.tool.${k}`)}</button>`).join('')}<button class="btn small" data-action="multi" aria-pressed="${this.multi}">${t('robots.multi')}</button><button class="btn small" data-action="subtract" aria-pressed="${this.subtract}">${t('robots.subtract')}</button><button class="btn small" data-action="finish" ${this.points.length<2?'disabled':''}>${t('robots.finish')}</button><button class="btn small" data-action="cancel">${t('robots.cancelDrawing')}</button><button class="btn small" data-action="clearSelection">${t('robots.clearSelection')}</button></div>`:''}
      <svg id="robotMap" tabindex="0" role="group" aria-label="${t('robots.mapLabel')}"></svg></div>
      <aside class="robot-settings">
      ${this.phase==='draw'?`<h3>${t('robots.simple.newArea')}</h3><p>${t('robots.selectionCount',{number:this.roomIds.size})}</p>`:this.phase==='details'?`${field(t('robots.name'),'robotDraftName',this.draftName||t('robots.newArea'))}<label for="robotDirectEntity">${t('robots.device')}</label><select id="robotDirectEntity"><option value="">${t('robots.chooseDevice')}</option>${this.robots.filter(r=>r.domain===(this.scope==='site'?'lawn_mower':'vacuum')).map(r=>`<option value="${esc(r.entity_id)}" ${this.draftEntity===r.entity_id?'selected':''}>${esc(r.name)}</option>`).join('')}${this.draftEntity&&!this.robots.some(r=>r.entity_id===this.draftEntity)?`<option selected value="${esc(this.draftEntity)}">${esc(this.draftEntity)} — ${t('robots.unavailable')}</option>`:''}</select>`:`<div id="robotNext" tabindex="-1"><h3>${esc(a?.name||'')}</h3><p>${this.stepText(step)}</p><button class="btn primary" data-action="next">${t(step==='align'?'robots.flow.alignButton':step==='saveFirst'?'robots.save':'robots.preview')}</button></div>
        <details class="robot-advanced"><summary>${t('robots.flow.advanced')}</summary><button class="btn" data-action="align" ${!p||this.scope==='site'?'disabled':''}>${t('robots.flow.alignButton')}</button><h3>${t('robots.profiles')}</h3><select id="robotProfile" aria-label="${t('robots.profiles')}"><option value="">${t('robots.chooseProfile')}</option>${profiles.map(p=>`<option value="${p.id}" ${p.id===this.profileId?'selected':''}>${esc(p.map_name||p.entity_id||t('robots.newProfile'))}</option>`).join('')}</select><button class="btn small" data-action="addProfile">${t('robots.addProfile')}</button>
        ${p?`<label for="robotEntity">${t('robots.device')}</label><select id="robotEntity"><option value="">${t('robots.chooseDevice')}</option>${this.robots.filter(r=>r.domain===(this.scope==='site'?'lawn_mower':'vacuum')).map(r=>`<option value="${esc(r.entity_id)}" ${p.entity_id===r.entity_id?'selected':''}>${esc(r.name)} (${esc(r.entity_id)})</option>`).join('')}${p.entity_id&&!this.robots.some(r=>r.entity_id===p.entity_id)?`<option selected value="${esc(p.entity_id)}">${esc(p.entity_id)} — ${t('robots.unavailable')}</option>`:''}</select>
          ${field(t('robots.mapName'),'robotMapName',p.map_name)}<p class="hint">${t('robots.floorHint')}</p><p class="hint">${this.robots.find(r=>r.entity_id===p.entity_id)?.zone_cleaning?t('robots.zoneSupport'):t('robots.unsupported')}</p>
          ${this.scope!=='site'?`<details class="robot-cal" ${this.calOpen?'open':''}><summary>${t('robots.calibration')}</summary><p class="hint">${t('robots.calibrationHint')}</p><table><thead><tr><th>x m</th><th>z m</th><th>X mm</th><th>Y mm</th></tr></thead><tbody>${p.pairs.map((pair,i)=>`<tr>${['home','robot'].flatMap(frame=>[0,1].map(j=>`<td><input type="number" step="any" data-pair="${i},${frame},${j}" value="${pair[frame][j]??''}" aria-label="${t('robots.point',{number:i+1})} ${frame} ${j===0?'X':'Y'}"></td>`)).join('')}</tr>`).join('')}</tbody></table></details>`:''}
          <button class="btn small danger" data-action="deleteProfile">${t('robots.removeProfile')}</button>`:''}
        </details>${this.confirmation?`<div class="robot-confirm"><strong>${t('robots.confirmTitle')}</strong><p>${esc(this.confirmation.entity_id)} · ${esc(this.scopeName(this.scope))} · ${esc(p.map_name)}</p><pre>${JSON.stringify(this.confirmation.zones)}</pre><p class="hint">${t('robots.confirmHint')}</p><label class="chk"><input type="checkbox" id="robotConfirm" style="width:auto">${t('robots.confirmFloor')}</label><button class="btn primary" data-action="send" disabled>${t('robots.start')}</button></div>`:''}`}
      </aside></div>`}
      <footer><span class="msg" role="status">${esc(this.message)}</span>${this.phase==='draw'?`<button class="btn" data-action="backList">${t('robots.simple.cancel')}</button><button class="btn primary" data-action="details" ${!this.selection.parts.length||this.points.length?'disabled':''}>${t('robots.simple.continue')}</button>`:this.phase==='details'?`<button class="btn" data-action="backDraw">${t('robots.simple.back')}</button><button class="btn primary" data-action="storeArea" ${!this.draftEntity?'disabled':''}>${t('robots.simple.save')}</button>`:this.phase==='clean'?`<button class="btn" data-action="backList">${t('robots.simple.back')}</button>`:''}</footer></section>`;
    this.wire();this.draw();
  }
  wire(){
    const R=this.root;
    const details=R.querySelector('.robot-cal');if(details)details.ontoggle=()=>{this.calOpen=details.open;};
    R.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'&&e.target.tagName!=='svg')this.close();if(e.key==='Tab'){const f=[...R.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,svg')].filter(x=>x.getClientRects().length),first=f[0],last=f.at(-1);if(e.shiftKey&&e.target===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&e.target===last){e.preventDefault();first.focus();}}};
    R.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>this.action(b.dataset.action));
    R.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{this.tool=b.dataset.tool;this.points=[];this.render();});
    if(R.querySelector('#robotDirectEntity'))R.querySelector('#robotDirectEntity').onchange=e=>{this.draftEntity=e.target.value;this.render();};
    if(R.querySelector('#robotDraftName'))R.querySelector('#robotDraftName').onchange=e=>{this.draftName=e.target.value;};
    if(R.querySelector('#robotScope'))R.querySelector('#robotScope').onchange=e=>{if((this.selection.parts.length||this.points.length)&&!confirm(t('robots.discard'))){e.target.value=this.scope;return;}this.resetSelection();this.scope=e.target.value;this.selected=null;this.roomId=null;this.profileId=null;this.points=[];this.bounds=null;this.confirmation=null;this.chooseDefaultRobot();this.render();};
    if(R.querySelector('#robotArea'))R.querySelector('#robotArea').onchange=e=>{this.selected=e.target.value;this.confirmation=null;this.render();};
    const room=R.querySelector('#robotRoom');if(room)room.onchange=e=>this.selectRoom(e.target.value);
    if(R.querySelector('#robotProfile'))R.querySelector('#robotProfile').onchange=e=>{this.profileId=e.target.value;this.confirmation=null;this.render();};
    for(const [id,object,key] of [['robotAreaName',this.area,'name'],['robotKind',this.area,'kind'],['robotEntity',this.profile,'entity_id'],['robotMapName',this.profile,'map_name']]){
      const input=R.querySelector(`#${id}`);if(input)input.onchange=()=>{object[key]=input.value;this.changed();this.render();};
    }
    R.querySelectorAll('[data-pair]').forEach(input=>input.onchange=()=>{const[i,frame,j]=input.dataset.pair.split(',');this.profile.pairs[i][frame][j]=input.value===''?null:Number(input.value);this.changed();this.render();});
    R.querySelector('#robotConfirm')?.addEventListener('change',e=>R.querySelector('[data-action="send"]').disabled=!e.target.checked);
    R.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>this.beginArea(b.dataset.edit));
    R.querySelectorAll('[data-clean]').forEach(b=>b.onclick=()=>{const a=this.data.areas.find(a=>a.id===b.dataset.clean);this.scope=a.scope;this.selected=a.id;this.profileId=a.profile_id||this.legacyProfile(a)?.id;this.phase='clean';this.overview=true;this.bounds=null;this.render();});
    R.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(!confirm(t('robots.simple.deleteConfirm')))return;this.data.areas=this.data.areas.filter(a=>a.id!==b.dataset.delete);this.save();});
    const svg=R.querySelector('svg');if(!svg)return;
    svg.onpointerdown=e=>this.down(e);svg.onpointermove=e=>this.move(e);svg.onpointerup=e=>this.up(e);svg.onpointercancel=()=>{if(this.drag){Object.assign(this.area,this.drag.original);this.drag=null;this.draw();}};
    svg.onkeydown=e=>{if(this.sending||this.overview)return;if(e.target.dataset.room&&['Enter',' '].includes(e.key)){e.preventDefault();this.selectRoom(e.target.dataset.room,e.shiftKey||e.ctrlKey||e.metaKey||this.multi);return;}if(e.key==='Escape'){this.points=[];this.drag=null;this.render();}else if(this.area&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const d=e.shiftKey ? .5 : e.ctrlKey ? .01 : .05,dx=e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,dz=e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0;this.translateArea(this.area,dx,dz);this.changed();this.render();this.root.querySelector('svg').focus();}};
  }
  legacyProfile(area){const matches=this.data.profiles.filter(p=>p.scope===area.scope);return matches.length===1?matches[0]:null;}
  beginArea(id){
    const a=this.data.areas.find(a=>a.id===id);this.resetSelection();this.selected=null;this.confirmation=null;this.bounds=null;this.tool='select';this.phase='draw';this.overview=false;
    this.editing=a?.id||null;this.draftEntity='';
    if(a){this.scope=a.scope;this.selection={parts:outlines(a).map((p,i)=>({points:structuredClone(p),roomId:a.roomRefs?.[i]})),exclusions:structuredClone(a.exclusions||[])};this.roomIds=new Set((a.roomRefs||[]).filter(Boolean));this.draftName=a.name;this.draftEntity=(this.data.profiles.find(p=>p.id===a.profile_id)||this.legacyProfile(a))?.entity_id||'';}
    this.render();
  }
  resetSelection(){this.selection={parts:[],exclusions:[]};this.roomIds=new Set();this.roomId=null;this.editing=null;this.draftName='';this.points=[];this.subtract=false;}
  selectRoom(id,append=false){
    const room=this.rooms().find(r=>r.id===id);if(!room)return;
    if(!append){this.selection={parts:[],exclusions:[]};this.roomIds=new Set();this.points=[];}
    if(this.roomIds.has(id)){this.roomIds.delete(id);this.selection.parts=this.selection.parts.filter(p=>p.roomId!==id);}
    else{this.roomIds.add(id);this.selection.parts.push({roomId:id,points:structuredClone(room.points)});}
    this.roomId=id;this.selected=null;this.changed();this.render();this.root.querySelector(`[data-room="${CSS.escape(id)}"]`)?.focus();
  }
  translateArea(area,dx,dz){const move=points=>points.map(([x,z])=>[x+dx,z+dz]);if(area.parts){area.parts=area.parts.map(move);area.roomRefs=area.parts.map(()=>null);area.exclusions=(area.exclusions||[]).map(move);}else area.points=move(area.points);}
  rooms(){return this.app.plan.levels.filter(l=>this.scope==='site'?l.id===this.app.plan.levels[0]?.id:l.id===this.scope).flatMap(l=>l.rooms.filter(r=>r.kind!=='void'));}
  draw(){
    const svg=this.root.querySelector('svg');if(!svg)return;
    const areas=this.data.areas.filter(a=>a.scope===this.scope&&this.phase==='clean'&&a.id===this.selected),rooms=this.rooms();
    if(!this.bounds){const pts=[...rooms.flatMap(a=>a.points),...areas.flatMap(a=>rings(a).flat()),...this.selection.parts.flatMap(p=>p.points),...this.selection.exclusions.flat()];const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);const x=(xs.length?Math.min(...xs):0)-1,z=(zs.length?Math.min(...zs):0)-1;this.bounds=[x,z,Math.max(6,(xs.length?Math.max(...xs):4)-x+1),Math.max(6,(zs.length?Math.max(...zs):4)-z+1)];}
    svg.setAttribute('viewBox',this.bounds.join(' '));
    const poly=(points)=>points.map(p=>p.join(',')).join(' ');
    svg.innerHTML=roomFills(rooms,this.roomIds)+areas.map((a,i)=>this.areaSvg(a,`area-${i}`,a.id===this.selected)).join('')+this.areaSvg({parts:this.selection.parts.map(p=>p.points),exclusions:this.selection.exclusions,kind:'work'},'draft',true)+floorWalls(this.app.plan.levels.find(l=>l.id===(this.scope==='site'?this.app.plan.levels[0]?.id:this.scope)))+roomLabels(rooms,Math.max(this.bounds[2]/Math.max(1,svg.clientWidth),this.bounds[3]/Math.max(1,svg.clientHeight))*13)+(this.area&&!this.area.parts?this.area.points.map((p,i)=>`<circle data-vertex="${i}" cx="${p[0]}" cy="${p[1]}" r=".16" fill="#fff" stroke="#6db5ff" stroke-width=".05"/>`).join(''):'')+`<polyline points="${poly(this.points)}" fill="none" stroke="#fff" stroke-width=".08"/>`+this.points.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r=".12" fill="#fff"/>`).join('');
    const finish=this.root.querySelector('[data-action="finish"]');if(finish)finish.disabled=this.points.length<2;
  }
  areaSvg(area,id,selected){
    const poly=points=>points.map(p=>p.join(',')).join(' '),color=colors[area.kind],attr=area.id?`data-area="${area.id}"`:'pointer-events="none"',parts=outlines(area);
    if(area.kind==='line')return `<polyline ${attr} points="${poly(area.points)}" fill="none" stroke="${color}" stroke-width=".06"/>`;
    if(!parts.length)return '';
    const [x,y,w,h]=this.bounds;
    return `<defs><mask id="robot-mask-${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>${parts.map(p=>`<polygon points="${poly(p)}" fill="white"/>`).join('')}${(area.exclusions||[]).map(p=>`<polygon points="${poly(p)}" fill="black"/>`).join('')}</mask></defs><g mask="url(#robot-mask-${id})" ${attr}>${parts.map(p=>`<polygon points="${poly(p)}" ${attr} fill="${color}" fill-opacity=".35" stroke="${color}" stroke-width="${selected?.12:.06}"/>`).join('')}</g>${(area.exclusions||[]).map(p=>`<polygon points="${poly(p)}" fill="none" pointer-events="none" stroke="#ff7878" stroke-dasharray=".12 .08" stroke-width=".05"/>`).join('')}`;
  }
  coordinate(e){const svg=this.root.querySelector('svg'),p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());return [Math.round(p.x*20)/20,Math.round(p.y*20)/20];}
  down(e){
    if(this.sending||this.overview||e.button!==0)return;const p=this.coordinate(e),svg=e.currentTarget;
    if(this.tool!=='select'){
      this.points.push(p);if(this.tool==='rect'&&this.points.length===2){const[a,b]=this.points;this.points=[[Math.min(a[0],b[0]),Math.min(a[1],b[1])],[Math.max(a[0],b[0]),Math.min(a[1],b[1])],[Math.max(a[0],b[0]),Math.max(a[1],b[1])],[Math.min(a[0],b[0]),Math.max(a[1],b[1])]];this.finish();}else this.draw();return;
    }
    if((e.shiftKey||e.ctrlKey||e.metaKey||this.multi)&&this.scope!=='site'){const room=this.rooms().find(r=>inside(p,r.points));if(room){this.selectRoom(room.id,true);return;}}
    if(e.target.dataset.room){this.selectRoom(e.target.dataset.room,e.shiftKey||e.ctrlKey||e.metaKey||this.multi);return;}
    const vertex=e.target.dataset.vertex, id=e.target.dataset.area;
    if(id){this.selected=id;this.roomId=null;}
    if(this.area&&(id||vertex!==undefined)){this.drag={start:p,original:structuredClone(this.area),vertex:vertex===undefined?null:Number(vertex)};svg.setPointerCapture(e.pointerId);svg.focus();this.draw();}
  }
  move(e){if(!this.drag)return;const p=this.coordinate(e),d=this.drag;Object.assign(this.area,structuredClone(d.original));if(d.vertex===null)this.translateArea(this.area,p[0]-d.start[0],p[1]-d.start[1]);else this.area.points[d.vertex]=[d.original.points[d.vertex][0]+p[0]-d.start[0],d.original.points[d.vertex][1]+p[1]-d.start[1]];this.draw();}
  up(){if(!this.drag)return;if(!validWorkArea(this.area)){Object.assign(this.area,this.drag.original);this.message=t('robots.invalidArea');}else this.changed();this.drag=null;this.render();this.root.querySelector('svg').focus();}
  finish(){
    if(!validArea(this.points,this.tool==='line')){this.message=t('robots.invalidArea');return this.render();}
    if(this.tool==='line'){const a={id:newId('zone'),scope:this.scope,name:t('robots.newArea'),kind:'line',points:structuredClone(this.points)};this.data.areas.push(a);this.selected=a.id;}
    else if(this.subtract)this.selection.exclusions.push(structuredClone(this.points));
    else this.selection.parts.push({points:structuredClone(this.points)});
    this.points=[];this.tool='select';this.changed();this.render();
  }
  async action(action){
    if(this.sending)return;
    if(action==='new'){this.beginArea();return;}
    if(action==='details'){if(!this.selection.parts.length||this.points.length)return;this.phase='details';this.overview=true;this.render();return;}
    if(action==='backDraw'){this.phase='draw';this.overview=false;this.render();return;}
    if(action==='backList'){if(this.dirty()&&!confirm(t('robots.discard')))return;this.data=structuredClone(this.app.plan.site.robotAreas||fresh());this.resetSelection();this.phase='list';this.overview=true;this.confirmation=null;this.message='';this.render();return;}
    if(action==='storeArea'){
      if(!this.draftEntity||!this.selection.parts.length||this.points.length)return;
      if(JSON.stringify(this.app.plan.site.robotAreas||fresh())!==this.baseline){this.message=t('robots.conflict');this.render();return;}
      this.chooseRobot(this.draftEntity);const old=this.data.areas.find(a=>a.id===this.editing);
      const area={...old,id:this.editing||newId('zone'),scope:this.scope,name:this.draftName?.trim()||t('robots.newArea'),kind:old?.kind||'work',profile_id:this.profileId,parts:this.selection.parts.map(p=>structuredClone(p.points)),roomRefs:this.selection.parts.map(p=>p.roomId||null),exclusions:structuredClone(this.selection.exclusions)};
      if(!validWorkArea(area)){this.message=t('robots.invalidArea');this.render();return;}
      delete area.points;this.data.areas=this.data.areas.filter(a=>a.id!==area.id);this.data.areas.push(area);this.resetSelection();this.selected=area.id;this.save();return;
    }
    if(action==='align')return openRobotCalibration(this);
    if(action==='editFlow'){this.overview=false;this.render();return;}
    if(action==='next'){
      const step=this.nextStep();
      if(step==='align')return openRobotCalibration(this);
      if(step==='ready')return this.action('preview');
      if(step==='saveFirst')return this.save();
      if(step==='chooseRobot'){this.beginArea(this.selected);this.phase='details';this.overview=true;this.render();return;}
      if(step==='chooseArea'){this.overview=false;this.render();return this.root.querySelector('#robotArea').focus();}
      this.message=this.stepText(step);this.overview=false;this.render();return;
    }
    if(action==='close')return this.close();if(action==='save')return this.save();if(action==='finish')return this.finish();
    if(action==='cancel'){this.points=[];this.tool='select';}
    if(action==='fit')this.bounds=null;
    if(action==='in'){const b=this.bounds;if(b[2]>2&&b[3]>2)this.bounds=[b[0]+b[2]/6,b[1]+b[3]/6,b[2]/1.5,b[3]/1.5];}
    if(action==='out'){const b=this.bounds;this.bounds=[b[0]-b[2]/4,b[1]-b[3]/4,b[2]*1.5,b[3]*1.5];}
    if(action==='deleteArea'){this.data.areas=this.data.areas.filter(a=>a.id!==this.selected);this.selected=null;this.changed();}
    if(action==='multi')this.multi=!this.multi;
    if(action==='subtract'){this.subtract=!this.subtract;this.tool='rect';this.points=[];}
    if(action==='clearSelection'){this.selection={parts:[],exclusions:[]};this.roomIds=new Set();this.roomId=null;this.points=[];this.selected=null;this.changed();}
    if(action==='editArea'&&this.area&&this.area.kind!=='line'){if(this.selection.parts.length&&!confirm(t('robots.discard')))return;const a=this.area;this.resetSelection();this.selection={parts:outlines(a).map((p,i)=>({points:structuredClone(p),roomId:a.roomRefs?.[i]||undefined})),exclusions:structuredClone(a.exclusions||[])};this.roomIds=new Set((a.roomRefs||[]).filter(Boolean));this.editing=a.id;this.draftName=a.name;this.selected=null;this.changed();}
    if(action==='room'||action==='applySelection'){
      if(!this.selection.parts.length||this.points.length)return;
      const area={id:this.editing||newId('zone'),scope:this.scope,name:this.draftName?.trim()||t('robots.newArea'),kind:this.data.areas.find(a=>a.id===this.editing)?.kind||'work',parts:this.selection.parts.map(p=>structuredClone(p.points)),roomRefs:this.selection.parts.map(p=>p.roomId||null),exclusions:structuredClone(this.selection.exclusions)};
      if(!validWorkArea(area)){this.message=t('robots.invalidArea');return this.render();}
      this.data.areas=this.data.areas.filter(a=>a.id!==area.id);this.data.areas.push(area);this.resetSelection();this.selected=area.id;this.changed();
    }
    if(action==='addProfile'){const p={id:newId('robot'),scope:this.scope,entity_id:'',map_name:'',pairs:Array.from({length:3},()=>({home:[null,null],robot:[null,null]}))};this.data.profiles.push(p);this.profileId=p.id;this.changed();}
    if(action==='deleteProfile'){this.data.profiles=this.data.profiles.filter(p=>p.id!==this.profileId);this.profileId=null;this.changed();}
    if(action==='preview'){
      try{if(this.dirty())throw Error('saveFirst');if(!this.robots.find(r=>r.entity_id===this.profile?.entity_id)?.zone_cleaning)throw Error('unsupported');this.confirmation={entity_id:this.profile.entity_id,zones:cleaningZones(this.area,this.profile,this.data.areas),repeats:1,confirmed:true};this.message='';}
      catch(e){this.message=t(`robots.error.${e.message}`);}
    }
    if(action==='send'){
      if(!this.confirmation||!this.root.querySelector('#robotConfirm')?.checked)return;
      if(this.dirty()||JSON.stringify(this.app.plan.site.robotAreas||fresh())!==this.baseline){this.message=t('robots.conflict');this.confirmation=null;return this.render();}
      this.sending=true;this.root.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
      try{await this.app.hass.callWS({type:'hometwin/robots/clean_zone',...this.confirmation});this.message=t('robots.sent');}
      catch{this.message=t('robots.sendFailed');}
      finally{this.sending=false;this.confirmation=null;}
    }
    this.render();
  }
}
