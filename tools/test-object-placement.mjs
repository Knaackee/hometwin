import assert from 'node:assert/strict';
import * as THREE from 'three';
import { objectBounds, surfaceElevation } from '../frontend/src/object-placement.js';

const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
const closeArray = (actual, expected, message) => actual.forEach((value, index) => close(value, expected[index], `${message}[${index}]`));
const material = () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const box = (width, height, depth, y = height / 2) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material());
  mesh.position.y = y;
  return mesh;
};
const table = (width = 1.8, depth = 1.2, top = 0.74) => {
  const root = new THREE.Group();
  root.add(box(width, 0.08, depth, top - 0.04));
  return root;
};

// Bounds stay root-local and include child transforms without changing source geometry.
const boundsRoot = new THREE.Group();
const physical = box(0.4, 0.6, 0.2); physical.position.set(0.3, 0.3, -0.2); boundsRoot.add(physical);
const hit = box(20, 20, 20); hit.material.visible = false; boundsRoot.add(hit);
const hiddenGroup = new THREE.Group(); hiddenGroup.visible = false; hiddenGroup.add(box(30, 30, 30)); boundsRoot.add(hiddenGroup);
const pool = box(40, 40, 40); pool.userData.pool = true; boundsRoot.add(pool);
const deviceEffect = box(50, 50, 50); deviceEffect.userData.roomEffect = true; boundsRoot.add(deviceEffect);
boundsRoot.position.set(12, 8, -4); boundsRoot.rotation.y = 0.8;
const beforePosition = boundsRoot.position.clone();
const beforeGeometry = physical.geometry.attributes.position.array.slice();
const bounds = objectBounds(boundsRoot);
closeArray(bounds.min.toArray(), [0.1, 0, -0.3], 'physical minimum bounds');
closeArray(bounds.max.toArray(), [0.5, 0.6, -0.1], 'physical maximum bounds');
assert.ok(boundsRoot.position.equals(beforePosition), 'bounds do not modify the root transform');
assert.deepEqual(physical.geometry.attributes.position.array, beforeGeometry, 'bounds do not modify geometry');

// A rotated and translated level still reports elevation relative to its displayed floor.
const level = new THREE.Group(); level.position.set(7, 2.5, -3); level.rotation.y = Math.PI / 3;
const desk = table();
const object = new THREE.Group(); object.add(box(0.4, 0.4, 0.4));
level.add(desk, object); level.updateMatrixWorld(true);
close(surfaceElevation(object, [desk], level.position.y), 0.74, 'table surface elevation');
assert.equal(surfaceElevation(object, [], level.position.y), 0, 'no support falls back to the level floor');
assert.equal(surfaceElevation(object, [object], level.position.y), 0, 'the object cannot support itself');
desk.visible = false;
assert.equal(surfaceElevation(object, [desk], level.position.y), 0, 'hidden supports are ignored');
desk.visible = true;

// Near-base geometry uses a narrow trunk rather than broad foliage as the contact footprint.
const plant = new THREE.Group();
plant.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 12), material()));
plant.children[0].position.y = 0.25;
const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), material()); foliage.position.y = 1.4; plant.add(foliage);
const stand = table(0.45, 0.45);
level.add(plant, stand); level.updateMatrixWorld(true);
close(surfaceElevation(plant, [stand], level.position.y), 0.74, 'near-base footprint excludes foliage width');

// Rays reject bounding-box-only support, central holes, and partially supported bases.
const frame = new THREE.Group();
frame.add(box(1.2, 0.08, 0.25, 0.7), box(1.2, 0.08, 0.25, 0.7));
frame.children[0].position.z = -0.475; frame.children[1].position.z = 0.475;
frame.add(box(0.25, 0.08, 0.7, 0.7), box(0.25, 0.08, 0.7, 0.7));
frame.children[2].position.x = -0.475; frame.children[3].position.x = 0.475;
level.add(frame); level.updateMatrixWorld(true);
assert.equal(surfaceElevation(object, [frame], level.position.y), 0, 'a hole under the base center is not a support surface');

const narrow = table(0.3, 0.3);
level.add(narrow); level.updateMatrixWorld(true);
assert.equal(surfaceElevation(object, [narrow], level.position.y), 0, 'a support must cover the base corners');

const edgeOnly = table(0.4, 0.4); edgeOnly.position.x = 0.4;
level.add(edgeOnly); level.updateMatrixWorld(true);
assert.equal(surfaceElevation(object, [edgeOnly], level.position.y), 0, 'edge-only contact is not footprint overlap');

console.log('object placement geometry tests passed');
