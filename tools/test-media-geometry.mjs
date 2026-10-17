import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boundsOf, buildRecipe, mergeByMaterial, screenGeometry } from '../engine/recipe.js';

const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
const closeArray = (actual, expected, message, tolerance = 1e-6) => actual.forEach((value, i) => close(value, expected[i], `${message}[${i}]`, tolerance));

// Screens keep the requested height and UV range. Curved screens get enough subdivisions to avoid visible facets.
const flat = screenGeometry(1.2, 0.675);
closeArray(boundsOf(new THREE.Mesh(flat)).size, [1.2, 0.675, 0], 'flat screen bounds');
closeArray([flat.attributes.uv.array.reduce((a, b) => Math.min(a, b)), flat.attributes.uv.array.reduce((a, b) => Math.max(a, b))], [0, 1], 'flat screen UV range');
const curved = screenGeometry(1.2, 0.675, 4.2);
assert.equal(curved.parameters.widthSegments, 48, 'curved TV uses the adaptive subdivision cap');
const curvedBounds = boundsOf(new THREE.Mesh(curved));
close(curvedBounds.size[1], 0.675, 'curved screen height');
assert.ok(curvedBounds.size[0] > 1.19 && curvedBounds.size[2] > 0.04, 'curved screen has the expected span and depth');

const recipe = {
  materials: { body: { base: 'plastic_white' }, display: { base: 'screen' } },
  parts: [
    { shape: 'cylinder', r: 0.004, h: 0.02, seg: 32, mat: 'body' },
    { shape: 'screen', w: 0.4, h: 0.225, radius: 2, mat: 'display', pos: [0, 0.1, 0] },
  ],
};
const adaptiveBuild = buildRecipe(recipe);
const detailedBuild = buildRecipe(recipe, {}, { adaptive: false });
assert.ok(adaptiveBuild.stats.triangles < detailedBuild.stats.triangles, 'adaptive tessellation reduces small curved parts');
const screen = adaptiveBuild.object.children.find((o) => o.userData.role === 'screen');
assert.ok(screen?.isMesh, 'screen shape gets the screen role and remains a separate mesh');
assert.equal(screen.castShadow, false, 'screen role does not cast a shadow');

// Merging preserves bounds and source geometry, fixes mirrored winding, and keeps semantic/animated subtrees intact.
const material = new THREE.MeshStandardMaterial();
const shared = new THREE.BoxGeometry(0.4, 0.6, 0.2);
const sharedPositions = shared.attributes.position.array.slice();
const root = new THREE.Group(); root.name = 'pick-root'; root.userData = { furn: 'chair-1' }; root.position.set(3, 0.5, -2); root.rotation.y = 0.4;
const parent = new THREE.Group(); parent.position.set(-4, 1, 5); parent.rotation.x = 0.2; parent.add(root);
const ordinary = new THREE.Mesh(shared, material); ordinary.position.set(0.7, 0.3, 0.1); root.add(ordinary);
const mirrored = new THREE.Mesh(shared, material); mirrored.position.set(-0.7, 0.3, 0.1); mirrored.scale.x = -1; root.add(mirrored);
const hinge = new THREE.Group(); hinge.userData = { opening: 'door-1' }; hinge.position.set(0.2, 0, -0.4);
const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.04), material); leaf.position.set(0.4, 1, 0); hinge.add(leaf); root.add(hinge);
const animated = new THREE.Group(); animated.animations = [new THREE.AnimationClip('pulse', 1, [])]; animated.position.set(0, 0.4, 0.5);
animated.add(new THREE.Mesh(new THREE.SphereGeometry(0.1), material)); root.add(animated);
parent.updateMatrixWorld(true);
const before = boundsOf(root);
const hingeWorld = hinge.getWorldPosition(new THREE.Vector3()).clone();
const merged = mergeByMaterial(root); parent.add(merged); parent.updateMatrixWorld(true);
closeArray(boundsOf(merged).min, before.min, 'merged minimum bounds');
closeArray(boundsOf(merged).max, before.max, 'merged maximum bounds');
assert.deepEqual(merged.userData, { furn: 'chair-1' }, 'root picking metadata survives');
assert.equal(merged.getObjectByProperty('uuid', hinge.uuid), hinge, 'semantic subtree keeps object identity');
assert.equal(merged.getObjectByProperty('uuid', animated.uuid), animated, 'animated subtree keeps object identity');
closeArray(hinge.getWorldPosition(new THREE.Vector3()).toArray(), hingeWorld.toArray(), 'kept subtree world position');
assert.deepEqual(shared.attributes.position.array, sharedPositions, 'shared source geometry is not mutated');

const baked = merged.children.find((o) => o.isMesh && o !== leaf);
assert.ok(baked, 'ordinary and mirrored meshes are merged');
const positions = baked.geometry.attributes.position;
const normals = baked.geometry.attributes.normal;
for (let i = 0; i < positions.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(positions, i);
  const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
  const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
  const face = b.sub(a).cross(c.sub(a)).normalize();
  const normal = new THREE.Vector3().fromBufferAttribute(normals, i).normalize();
  assert.ok(face.dot(normal) > 0.99, `triangle ${i / 3} winding matches its normal`);
}

console.log('media geometry tests passed');
