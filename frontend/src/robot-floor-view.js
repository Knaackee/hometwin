// Use the same wall cuts and door orientation as the 3D house.
import { wallSegments, doorSwingVector, EXT_T, INT_T } from './house.js';
import { labelPoint } from './geometry.js';
import { esc } from './panel.js';
import { t } from './i18n.js';

const coords = points => points.map(p => p.join(',')).join(' ');
export function roomFills(rooms, selected) {
  return rooms.map(r => `<polygon data-room="${esc(r.id)}" points="${coords(r.points)}" class="robot-room ${(selected instanceof Set?selected.has(r.id):selected===r.id)?'selected':''}" role="button" tabindex="0" aria-pressed="${(selected instanceof Set?selected.has(r.id):selected===r.id)}" aria-label="${esc(r.name)}"><title>${esc(r.name)}</title></polygon>`).join('');
}
export function roomLabels(rooms, size) {
  return rooms.map(r => {const [x,z]=labelPoint(r.points);return `<text class="robot-room-label" x="${x}" y="${z}" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${esc(r.name)}</text>`;}).join('');
}
export function floorWalls(level) {
  if(!level)return '';
  const segs=wallSegments(level),symbols=new Map();
  const walls=segs.map(s=>{
    const point=v=>[s.l.ux*v+s.l.nx*s.l.off,s.l.uz*v+s.l.nz*s.l.off];
    const a=point(s.a),b=point(s.b),o=s.opening;
    if(o)symbols.set(o.id,{o,s});
    if(o&&['door','open','garage'].includes(o.type))return '';
    return `<line data-wall x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${o?.type==='window'?'#82c9ff':'#b4c0d0'}" stroke-width="${s.kind==='exterior'?EXT_T:INT_T}"/>`;
  }).join('');
  const openings=[...symbols.values()].map(({o,s})=>{
    if(!['door','open','garage'].includes(o.type))return '';
    const w=Math.hypot(o.to[0]-o.from[0],o.to[1]-o.from[1]);if(w<.05)return '';
    const title=t(o.type==='door'?'robots.door':o.type==='open'?'robots.passage':'robots.garage');
    let shape=`<line x1="${o.from[0]}" y1="${o.from[1]}" x2="${o.to[0]}" y2="${o.to[1]}" stroke="#82e0bb" stroke-width=".06" stroke-dasharray=".12 .1"/>`;
    if(o.type==='door'){
      const h=o.hinge==='to'?o.to:o.from,end=o.hinge==='to'?o.from:o.to,n=doorSwingVector(o,s.l,s.side);
      const arc=Array.from({length:17},(_,i)=>{const angle=i*Math.PI/32;return [h[0]+Math.cos(angle)*(end[0]-h[0])+Math.sin(angle)*w*n[0],h[1]+Math.cos(angle)*(end[1]-h[1])+Math.sin(angle)*w*n[1]];});
      shape+=`<polyline points="${coords([...arc,h])}" fill="none" stroke="#dce8f5" stroke-width=".045"/>`;
    }
    return `<g data-opening="${esc(o.id)}" data-opening-type="${esc(o.type)}"><title>${title}</title>${shape}</g>`;
  }).join('');
  return `<g class="robot-walls" pointer-events="none">${walls}${openings}</g>`;
}
