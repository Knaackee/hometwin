import test from 'node:test';
import assert from 'node:assert/strict';

const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (_, key) => key === 'canvas' ? null : () => gradient, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const THREE = await import('three');
const { buildLevel } = await import('../frontend/src/house.js');
const { advanceStair, advanceStairMotion, enterStair, guardStairwellMove, stairRoute } = await import('../frontend/src/stair-navigation.js');

const room = (id, x0 = -10, z0 = -10, x1 = 10, z1 = 10) => ({ id, kind: 'room', points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
function fixture(stair = {}) {
  const item = { id: 's', type: 'stairs', pos: [0, 0], width: 1.2, depth: 3.2, height: 2.85, ...stair };
  const lower = { id: 'lower', elevation: 0, rooms: [room('lr')], furniture: [item] };
  const upper = { id: 'upper', elevation: 2.85, rooms: [room('ur')], furniture: [] };
  return { plan: { levels: [lower, upper] }, lower, upper, stair: item };
}

test('straight stairs use their full width and transition both directions without a height jump', () => {
  const { plan, lower, upper, stair } = fixture(), route = stairRoute(plan, lower, stair);
  assert.equal(route.width, 1.2);
  let nav = enterStair(plan, lower.id, route.points[0], { x: 0, z: -0.1 });
  assert.ok(nav);
  let priorY = 0, step;
  while (nav) {
    step = advanceStair(nav, 0.1, 0); nav = step.nav;
    assert.ok(step.floorY >= priorY - 1e-9);
    assert.ok(step.floorY - priorY < 0.12);
    priorY = step.floorY;
  }
  assert.equal(step.levelId, upper.id);
  assert.equal(step.floorY, upper.elevation);

  nav = enterStair(plan, upper.id, route.points.at(-1), { x: 0, z: 0.1 });
  assert.ok(nav);
  while (nav) { step = advanceStair(nav, 0.1, 0); nav = step.nav; }
  assert.equal(step.levelId, lower.id);
  assert.equal(step.floorY, lower.elevation);
});

test('quarter and half stairs keep their landings level', () => {
  for (const shape of ['quarter', 'half']) {
    const { plan, lower, stair } = fixture({ shape, width: 2.2, depth: 2.2, fw: 0.9 });
    const route = stairRoute(plan, lower, stair), flat = route.points.filter((p, i, all) => i && i < all.length - 1 && p.y === all[i - 1].y);
    assert.ok(flat.length, `${shape} route has a flat landing`);
    assert.ok(route.points.every((p, i) => !i || p.s > route.points[i - 1].s));
  }
});

test('entry ignores sideways crossings and clamps a walker inside the flight', () => {
  const { plan, lower, stair } = fixture(), route = stairRoute(plan, lower, stair), start = route.points[0];
  assert.equal(enterStair(plan, lower.id, start, { x: 0.1, z: 0 }), null);
  const nav = enterStair(plan, lower.id, { x: start.x + 0.58, z: start.z }, { x: 0, z: -0.1 });
  assert.ok(nav);
  const step = advanceStair(nav, 0.1, 5);
  assert.ok(Math.abs(step.nav.lateral) <= route.width / 2 - 0.18 + 1e-9);
});

test('upper entry descends with either backward input or a turned-around forward input', () => {
  for (const input of [-1, 1]) {
    const { plan, upper, lower, stair } = fixture(), route = stairRoute(plan, lower, stair);
    let nav = enterStair(plan, upper.id, route.points.at(-1), { x: 0, z: 0.1 });
    nav.controlDirection = nav.direction * Math.sign(input);
    const before = nav.s, step = advanceStair(nav, input * 0.1, 0);
    assert.ok(step.nav.s < before);
  }
});

test('free walking cannot enter or cross a stairwell opening', () => {
  const level = { rooms: [{ id: 'void', kind: 'void', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] }] };
  assert.deepEqual(guardStairwellMove(level, { x: 0, z: 1.1 }, { x: 0, z: 0.9 }), { x: 0, z: 1.1 });
  assert.deepEqual(guardStairwellMove(level, { x: -1.1, z: 0 }, { x: 1.1, z: 0 }), { x: -1.1, z: 0 });
  assert.deepEqual(guardStairwellMove(level, { x: 0, z: 0 }, { x: 0, z: 1.2 }), { x: 0, z: 1.2 });
});

test('unsafe height, skipped levels, and unsupported landings do not create traversable routes', () => {
  const mismatch = fixture({ height: 1.8 });
  assert.equal(stairRoute(mismatch.plan, mismatch.lower, mismatch.stair), null);

  const skipped = fixture({ targetLevelId: 'top' });
  skipped.plan.levels.splice(1, 0, { id: 'middle', elevation: 1.4, rooms: [room('mr')], furniture: [] });
  skipped.plan.levels.push({ id: 'top', elevation: 2.85, rooms: [room('tr')], furniture: [] });
  assert.equal(stairRoute(skipped.plan, skipped.lower, skipped.stair), null);

  const landing = fixture();
  landing.upper.rooms = [room('tiny', 4, 4, 5, 5)];
  assert.equal(stairRoute(landing.plan, landing.lower, landing.stair), null);
});

test('a U-stair with an offset upper landing traverses both ways after an explicit height correction', () => {
  const stair = { id: 'u-stair', type: 'stairs', pos: [0, 0], elevation: 0, autoElevation: true, rot: -90, width: 2.2, depth: 2.2, shape: 'half', height: 1.8 };
  const lower = { id: 'ground', elevation: 0, rooms: [room('lower-hall', -2, -2, 2, 2)], furniture: [stair] };
  const upper = {
    id: 'upper', elevation: 2.85, furniture: [], rooms: [
      { id: 'stairwell', kind: 'void', stair: stair.id, points: [[1.15, -1.15], [1.15, 1.15], [-1.15, 1.15], [-1.15, -1.15]] },
      { id: 'upper-hall', kind: 'room', points: [[-2, -2], [-1.15, -2], [-1.15, 2], [-2, 2]] }
    ]
  };
  const plan = { levels: [lower, upper] };
  assert.equal(stairRoute(plan, lower, stair), null, 'the saved 1.8 m stair must not bridge a 2.85 m rise');

  stair.height = 2.85;
  const route = stairRoute(plan, lower, stair);
  assert.ok(route, 'the corrected real stair has supported landings');
  for (const [from, entryPoint, motion, expected] of [
    [lower, route.points[0], { x: 0.1, z: 0 }, upper.id],
    [upper, route.points.at(-1), { x: 0.1, z: 0 }, lower.id]
  ]) {
    let nav = enterStair(plan, from.id, entryPoint, motion), step;
    assert.ok(nav, `entry from ${from.id}`);
    while (nav) { step = advanceStair(nav, 0.08, 0); nav = step.nav; }
    assert.equal(step.levelId, expected);
  }
});

test('walkthrough ceilings are visible and raycastable from below', () => {
  const level = { id: 'level', elevation: 0, height: 2.6, rooms: [room('room', -2, -2, 2, 2)], openings: [], furniture: [], devices: [] };
  const hidden = buildLevel(level).group.children.find(child => child.userData.blocker);
  assert.equal(hidden.material.colorWrite, false, 'cutaway ceiling remains shadow-only');

  const visible = buildLevel(level, {}, { visibleCeilings: true }).group.children.find(child => child.userData.blocker);
  assert.notEqual(visible.material.colorWrite, false);
  visible.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), 0, 3).intersectObject(visible);
  assert.ok(hits.length, 'visible ceiling is hit from inside the room');
});

test('turning around on stairs uses current world motion, not the entry key', () => {
  const {plan,lower,stair}=fixture(),route=stairRoute(plan,lower,stair);
  let nav=enterStair(plan,lower.id,route.points[0],{x:0,z:-.1});
  nav.s=1.2;nav.controlDirection=-1;
  const back=advanceStairMotion(nav,{x:0,z:.1});
  assert.ok(back.z > pointZ(route,1.2));
  const forward=advanceStairMotion(back.nav,{x:0,z:-.1});
  assert.ok(forward.z < back.z);
  function pointZ(r,s){return r.points[0].z-s;}
});
test('the landing allows a sideways exit instead of trapping the walker on the stair',()=>{
  const {plan,lower,stair}=fixture(),route=stairRoute(plan,lower,stair);
  const nav=enterStair(plan,lower.id,route.points[0],{x:0,z:-.1});
  const step=advanceStairMotion(nav,{x:.1,z:0});
  assert.equal(step.nav,null);assert.ok(step.x>0);assert.equal(step.floorY,lower.elevation);
});

test('world movement can turn at the exact corner of an L stair',()=>{
 const {plan,lower,stair}=fixture({shape:'quarter',width:2.2,depth:2.2,fw:.9});
 const route=stairRoute(plan,lower,stair),i=route.points.findIndex((p,i,all)=>i>0&&i<all.length-1&&Math.abs(p.x-all[i+1].x)>.01);
 const a=route.points[i],b=route.points[i+1],d=Math.hypot(b.x-a.x,b.z-a.z);
 const nav={route,s:a.s,lateral:0,levelId:lower.id,direction:1};
 const result=advanceStairMotion(nav,{x:(b.x-a.x)/d*.05,z:(b.z-a.z)/d*.05});
 assert.ok(result.nav.s>a.s);
});
