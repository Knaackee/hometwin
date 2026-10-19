import {esc} from './panel.js';
import {t} from './i18n.js';
import {mapTransform} from './robot-geometry.js';
import {roomFills,roomLabels,floorWalls} from './robot-floor-view.js';

// Image pixels are never robot coordinates. Only source-provided calibration can convert them.
export function pixelTransform(points){
  if(!Array.isArray(points)||points.length<3||points.length>4)throw Error('metadata');
  const pairs=points.map(p=>({a:[p?.map?.x,p?.map?.y],b:[p?.vacuum?.x,p?.vacuum?.y]}));
  if(pairs.some(p=>[...p.a,...p.b].some(v=>!Number.isFinite(v))))throw Error('metadata');
  const [p,q,r]=pairs,u=q.a.map((v,i)=>v-p.a[i]),v=r.a.map((v,i)=>v-p.a[i]),det=u[0]*v[1]-u[1]*v[0];
  if(Math.abs(det)<1e-6)throw Error('metadata');
  const transform=([x,y])=>{const s=((x-p.a[0])*v[1]-(y-p.a[1])*v[0])/det,f=(u[0]*(y-p.a[1])-u[1]*(x-p.a[0]))/det;return p.b.map((n,i)=>n+s*(q.b[i]-n)+f*(r.b[i]-n));};
  if(pairs.some(p=>Math.hypot(...transform(p.a).map((v,i)=>v-p.b[i]))>1))throw Error('metadata');
  return transform;
}
export async function openRobotCalibration(owner){
  const profile=owner.profile,session=owner.data;if(!profile)return;
  const overlay=document.createElement('section');overlay.className='robot-alignment';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',t('robots.align.title'));owner.root.append(overlay);
  let maps=[],image=null,source='',convert=null,pairs=[],pending=null,error='',loading=false,closed=false;
  const alive=()=>!closed&&owner.data===session&&!owner.root.hidden&&owner.profile===profile;
  const close=()=>{closed=true;overlay.remove();owner.root.querySelector('#robotNext')?.focus();};
  const markers=(frame)=>pairs.map((p,i)=>`<g pointer-events="none"><circle cx="${p[frame][0]}" cy="${p[frame][1]}" r="${frame==='home'?.12:6}" fill="#ffb35c"/><text x="${p[frame][0]}" y="${p[frame][1]}" font-size="${frame==='home'?.25:16}" fill="white">${i+1}</text></g>`).join('');
  function render(){
    if(!alive())return;
    const level=owner.app.plan.levels.find(l=>l.id===owner.scope),bounds=owner.bounds||[0,0,10,10];
    let outline='';if(pairs.length===3){try{const project=pixelTransform(pairs.map(p=>({map:{x:p.home[0],y:p.home[1]},vacuum:{x:p.pixel[0],y:p.pixel[1]}})));outline=(level?.rooms||[]).map(r=>`<polygon points="${r.points.map(p=>project(p).join(',')).join(' ')}" fill="#85b9ff" fill-opacity=".15" stroke="#ffb35c" stroke-width="2" pointer-events="none"/>`).join('');}catch{}}
    overlay.innerHTML=`<style>.robot-alignment{position:absolute;inset:2vh 2vw;background:var(--panel-solid,#141c28);z-index:10;padding:18px;overflow:auto;border:1px solid #85b9ff;border-radius:12px;color:var(--fg)}.robot-align-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.robot-align-grid svg{width:100%;height:380px;background:#0c1420;touch-action:none}.robot-alignment .actions{display:flex;flex-wrap:wrap;gap:8px}.robot-alignment select{max-width:100%}@media(max-width:700px){.robot-align-grid{grid-template-columns:1fr}.robot-align-grid svg{height:240px}}</style>
    <h2>${t('robots.align.title')}</h2><p>${t('robots.align.instructions')}</p><div class="actions"><select id="alignSource" aria-label="${t('robots.align.source')}"><option value="">${t('robots.align.source')}</option>${maps.map(m=>`<option value="${esc(m.entity_id)}" ${source===m.entity_id?'selected':''}>${esc(m.name)}</option>`).join('')}</select><button class="btn" id="alignLoad" ${!source||loading?'disabled':''}>${t('robots.align.load')}</button><button class="btn" id="alignClose">${t('robots.close')}</button></div>
    <p role="status">${esc(error||t(loading?'robots.align.loading':pairs.length===3?'robots.align.review':pending?'robots.align.pickMap':'robots.align.pickHome',{number:pairs.length+1}))}</p>
    <div class="robot-align-grid"><div><h3>${esc(owner.scopeName(owner.scope))}</h3><svg id="alignHome" viewBox="${bounds.join(' ')}" aria-label="${t('robots.align.home')}">${roomFills(level?.rooms||[],null)}${floorWalls(level)}${roomLabels(level?.rooms||[],.2)}${markers('home')}${pending?`<circle cx="${pending[0]}" cy="${pending[1]}" r=".15" fill="#ffb35c"/>`:''}</svg></div><div><h3>${t('robots.align.robot')}</h3>${image?`<svg id="alignMap" viewBox="0 0 ${image.width} ${image.height}" aria-label="${t('robots.align.robot')}"><image href="${image.src}" width="${image.width}" height="${image.height}"/>${outline}${markers('pixel')}</svg>`:`<p>${t('robots.align.noImage')}</p>`}</div></div>
    <p>${t('robots.align.confirmHint')}</p><label><input id="alignConfirm" type="checkbox">${t('robots.align.confirm')}</label><div class="actions"><button class="btn" id="alignUndo" ${!pairs.length&&!pending?'disabled':''}>${t('robots.align.undo')}</button><button class="btn primary" id="alignApply" disabled>${t('robots.align.apply')}</button></div>`;
    overlay.querySelector('#alignClose').onclick=close;
    overlay.querySelector('#alignSource').onchange=e=>{source=e.target.value;image=null;convert=null;pairs=[];pending=null;error='';render();};
    overlay.querySelector('#alignLoad').onclick=load;
    overlay.querySelector('#alignUndo').onclick=()=>{if(pending)pending=null;else pairs.pop();error='';render();};
    overlay.querySelector('#alignConfirm').onchange=e=>overlay.querySelector('#alignApply').disabled=!(e.target.checked&&pairs.length===3&&convert);
    overlay.querySelector('#alignApply').onclick=()=>{try{const anchors=pairs.map(p=>({home:p.home,robot:convert(p.pixel)}));mapTransform(anchors);profile.pairs=anchors;profile.map_entity=source;profile.map_name=owner.app.states()[source]?.attributes?.map_name||owner.scopeName(owner.scope);owner.changed();close();owner.render();}catch{error=t('robots.error.calibration');render();}};
    const coordinate=e=>{const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(e.currentTarget.getScreenCTM().inverse());return [p.x,p.y];};
    overlay.querySelector('#alignHome').onpointerdown=e=>{if(!convert||pairs.length===3)return;const xy=coordinate(e),corners=(level?.rooms||[]).flatMap(r=>r.points),nearest=corners.reduce((a,b)=>Math.hypot(b[0]-xy[0],b[1]-xy[1])<Math.hypot(a[0]-xy[0],a[1]-xy[1])?b:a,corners[0]||xy);pending=Math.hypot(nearest[0]-xy[0],nearest[1]-xy[1])<.3?[...nearest]:xy;render();};
    const map=overlay.querySelector('#alignMap');if(map)map.onpointerdown=e=>{if(!pending||!convert)return;const pixel=coordinate(e).map(Math.round);if(pixel[0]<0||pixel[1]<0||pixel[0]>image.width||pixel[1]>image.height)return;pairs.push({home:pending,pixel});pending=null;render();};
  }
  async function load(){loading=true;error='';image=null;convert=null;pairs=[];pending=null;render();try{
    const result=await owner.app.hass.callWS({type:'hometwin/vacuum/map',entity_id:source});if(!alive())return;
    if(!/^data:image\/(png|jpeg|webp);base64,/.test(result.image))throw Error('image');
    const transform=pixelTransform(owner.app.states()[source]?.attributes?.calibration_points);
    const img=new Image();img.src=result.image;await img.decode();if(!alive())return;
    image={src:result.image,width:img.naturalWidth,height:img.naturalHeight};convert=transform;
  }catch(e){error=t(e.message==='metadata'?'robots.align.metadata':'robots.align.failed');}finally{loading=false;render();}}
  overlay.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const f=[...overlay.querySelectorAll('button:not(:disabled),input,select')];if(e.shiftKey&&e.target===f[0]){e.preventDefault();f.at(-1).focus();}else if(!e.shiftKey&&e.target===f.at(-1)){e.preventDefault();f[0].focus();}}};
  render();overlay.querySelector('#alignClose').focus();loading=true;render();
  try{const result=await owner.app.hass.callWS({type:'hometwin/vacuum/maps'});if(!alive())return;maps=result.maps;if(maps.length===1)source=maps[0].entity_id;}catch{error=t('robots.align.failed');}finally{loading=false;render();}
}
