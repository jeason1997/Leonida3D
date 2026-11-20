// Streetlights and traffic signals from scripts/roadgeo.py (assets/roads/props.json: [type, x, y, z,
// yaw deg (map, the arm's direction), arm length]). One InstancedMesh per type and chunk, so whole
// chunks drop out of view / range. The lamps glow at night; signals cycle (cross directions opposite).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ASSETS = 'assets/';
const CHUNK = 2048;
const RANGE = 2200;    // m: farther chunks are hidden (a pole is under a pixel by then)

function part(geo, x, y, z, rz = 0) {
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

// Local frame: origin at the pole foot, +x along the arm (over the road), y up, +z = the way traffic
// arriving at a signal travels (its heads face -z).
function lightGeometry(h, arm) {
  return {
    body: mergeGeometries([
      part(new THREE.CylinderGeometry(0.09, 0.15, h, 8), 0, h / 2, 0),
      part(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8), 0, 0.25, 0),
      part(new THREE.BoxGeometry(arm, 0.11, 0.11), arm / 2, h - 0.25, 0, 0.06),
    ]),
    lamp: part(new THREE.BoxGeometry(0.75, 0.16, 0.34), arm - 0.1, h - 0.22, 0),
  };
}

function signalGeometry() {
  const h = 6.6, arm = 1.0;   // the mast arm is scaled per instance in x
  return {
    pole: mergeGeometries([
      part(new THREE.CylinderGeometry(0.13, 0.18, h, 10), 0, h / 2, 0),
      part(new THREE.CylinderGeometry(0.28, 0.32, 0.6, 10), 0, 0.3, 0),
    ]),
    arm: part(new THREE.BoxGeometry(arm, 0.2, 0.2), arm / 2, h - 0.5, 0),
    head: part(new THREE.BoxGeometry(0.38, 1.05, 0.3), 0, 0, 0),
    dot: part(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10).rotateX(Math.PI / 2), 0, 0, -0.17),
  };
}

export class RoadProps {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    app.scene.add(this.group);
    this.chunks = new Map();
    this.metal = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.6, roughness: 0.5 });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.2, roughness: 0.6 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.4, emissive: new THREE.Color(1.0, 0.78, 0.5), emissiveIntensity: 0 });
    this.dotMats = [0xff2a1a, 0xffb000, 0x2aff6a].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    this.dotOff = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    this.t = 0;
  }

  async init() {
    let list;
    try { list = await (await fetch(`${ASSETS}roads/props.json`)).json(); } catch { return; }
    const m = this.app.world.m;
    const by = new Map();
    for (const p of list) {
      const key = `${Math.floor((p[1] - m.west) / CHUNK)}_${Math.floor((m.north - p[2]) / CHUNK)}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(p);
    }
    const city = lightGeometry(9.0, 2.6), hw = lightGeometry(12.0, 3.2), sig = signalGeometry();
    const tmp = new THREE.Object3D();
    const mk = (geo, mat, items, place, shadow) => {
      if (!items.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((p, i) => { place(tmp, p); tmp.updateMatrix(); im.setMatrixAt(i, tmp.matrix); });
      im.castShadow = shadow;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      this.group.add(im);
      return im;
    };
    const base = (o, p) => { o.position.set(p[1], p[3], -p[2]); o.rotation.set(0, THREE.MathUtils.degToRad(p[4]), 0); o.scale.set(1, 1, 1); };
    for (const [key, items] of by) {
      const lights = items.filter((p) => p[0] === 'light'), hwl = items.filter((p) => p[0] === 'light_hw');
      const sigs = items.filter((p) => p[0] === 'signal');
      const meshes = [
        mk(city.body, this.metal, lights, base, true), mk(city.lamp, this.lampMat, lights, base, false),
        mk(hw.body, this.metal, hwl, base, true), mk(hw.lamp, this.lampMat, hwl, base, false),
        mk(sig.pole, this.dark, sigs, base, true),
        mk(sig.arm, this.dark, sigs, (o, p) => { base(o, p); o.scale.set(Math.max(p[5] || 4, 2.5), 1, 1); }, true),
      ];
      // two heads per mast arm, each with red / amber / green dots
      const heads = [], dots = [[], [], []];
      for (const p of sigs) {
        const L = Math.max(p[5] || 4, 2.5);
        for (const f of [0.55, 0.92]) {
          const a = THREE.MathUtils.degToRad(p[4]);
          const hx = p[1] + Math.cos(a) * L * f, hy = p[2] + Math.sin(a) * L * f;
          heads.push([hx, hy, p[3] + 5.45, p[4]]);
          for (let c = 0; c < 3; c++) dots[c].push([hx, hy, p[3] + 5.45 + 0.32 - c * 0.32, p[4]]);
        }
      }
      const at = (o, q) => { o.position.set(q[0], q[2], -q[1]); o.rotation.set(0, THREE.MathUtils.degToRad(q[3]), 0); o.scale.set(1, 1, 1); };
      meshes.push(mk(sig.head, this.dark, heads, at, false));
      const dm = dots.map((d, c) => mk(sig.dot, this.dotMats[c], d, at, false));
      // signal phase per head: arms within 45 deg of east-west run opposite to north-south ones
      const phase = [];
      for (const p of sigs) for (let f = 0; f < 2; f++) phase.push(Math.abs(Math.cos(THREE.MathUtils.degToRad(p[4]))) > 0.707 ? 0 : 0.5);
      const [i, j] = key.split('_').map(Number);
      this.chunks.set(key, { meshes: meshes.filter(Boolean), dots: dm, phase,
        cx: m.west + (i + 0.5) * CHUNK, cz: -(m.north - (j + 0.5) * CHUNK) });
    }
  }

  update(dt, camPos) {
    this.t += dt;
    const sun = this.app.day.dir.y;
    this.lampMat.emissiveIntensity = THREE.MathUtils.clamp((0.07 - sun) / 0.1, 0, 1) * 4.0;
    const cycle = 40.0;
    for (const c of this.chunks.values()) {
      const vis = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < RANGE + CHUNK * 0.71;
      for (const mesh of c.meshes) mesh.visible = vis;
      for (const d of c.dots) if (d) d.visible = vis;
      if (!vis || !c.dots[0] || this.t - (c.last || 0) < 0.5) continue;
      c.last = this.t;
      // green 0-0.45, amber 0.45-0.5, red 0.5-1 (of the cycle), per head phase
      const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
      c.saved ||= c.dots.map((d) => d && Array.from({ length: d.count }, (_, k) => { const mm = new THREE.Matrix4(); d.getMatrixAt(k, mm); return mm; }));
      const ph = (this.t / cycle) % 1;
      c.phase.forEach((p0, k) => {
        const u = (ph + p0) % 1;
        const on = u < 0.45 ? 2 : u < 0.5 ? 1 : 0;
        for (let col = 0; col < 3; col++) c.dots[col].setMatrixAt(k, col === on ? c.saved[col][k] : hidden);
      });
      for (const d of c.dots) d.instanceMatrix.needsUpdate = true;
    }
  }
}
