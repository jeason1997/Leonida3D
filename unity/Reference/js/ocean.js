// Real waves: a round grid that follows the camera, its rings packed tight near the middle (0.5 m)
// and wide at the rim, shaped by the Gerstner waves in materials.js (waterMaterial with waves: true).
// It covers water deeper than a few metres within RADIUS of the camera; the flat chunk water does the
// rest (shallows, canals, lakes, far away). Off on Low graphics and when flying very high.
import * as THREE from 'three';
import { waterMaterial, waveU } from './materials.js';

const RADIUS = 1800;      // m
const RINGS = 230;
const SEGMENTS = 256;
const FIRST = 0.5;        // m: the innermost ring spacing
const MAX_HEIGHT = 2500;  // m above the sea: higher than this the waves can't be seen anyway

function ringGrid() {
  // spacing grows geometrically: FIRST * q^i, summing to RADIUS
  let lo = 1.0001, hi = 1.2;
  for (let it = 0; it < 60; it++) {
    const q = (lo + hi) / 2, r = FIRST * (q ** RINGS - 1) / (q - 1);
    if (r > RADIUS) hi = q; else lo = q;
  }
  const q = lo;
  const pos = [0, 0, 0];
  for (let i = 1; i <= RINGS; i++) {
    // a metre past the edge, so the flat water's circle (it steps aside inside RADIUS) is covered
    const r = i === RINGS ? RADIUS + 1.5 : FIRST * (q ** i - 1) / (q - 1);
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const idx = [];
  const at = (i, s) => 1 + (i - 1) * SEGMENTS + (s % SEGMENTS);
  for (let s = 0; s < SEGMENTS; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let i = 1; i < RINGS; i++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = at(i, s), b = at(i, s + 1), c = at(i + 1, s), d = at(i + 1, s + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((v, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class Ocean {
  constructor(app) {
    this.app = app;
    const w = app.world;
    this.material = waterMaterial(...w.waterArgs, null, { waves: true, atlas: w.seabedAtlas });
    this.mesh = new THREE.Mesh(ringGrid(), this.material);
    this.mesh.frustumCulled = false;   // it's always around the camera
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 0;
    app.scene.add(this.mesh);
    this.enabled = true;
  }

  setEnabled(on) { this.enabled = on; }

  update(cam) {
    const on = this.enabled && cam.position.y < MAX_HEIGHT;
    this.mesh.visible = on;
    waveU.uWaveR.value = on ? RADIUS : 0;
    if (!on) return;
    this.mesh.position.set(cam.position.x, 0, cam.position.z);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld();
    waveU.uWaveC.value.set(cam.position.x, cam.position.z);
  }
}
