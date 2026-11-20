// The airplane (plane mode): a light high-wing prop plane anyone can fly. Arcade "mouse aim": the
// mouse (or a finger dragged on the view) points where you want to go and the plane swings its nose
// that way, banking into the turn - the bank moves heavily (over a second or two), the nose freely. W/S
// throttle, A/D turn, Space wheel brakes, Backspace starts again in the air (player.js). Too slow and
// the wings stop holding it up: the nose drops and it sinks. Coming in to land (not diving), the air
// near the ground cushions the descent and the wings level out, so a normal approach onto a road, roof
// or open ground touches down; a dive, a wall or the water is a crash - a fireball (or a splash), then
// back in the air.
import * as THREE from 'three';

const G = 9.81;
const V_MAX = 92;          // m/s, level at full throttle (~330 km/h)
const THRUST = 13;         // m/s² at full throttle
const DRAG = THRUST / V_MAX ** 2;
export const STALL = 30;   // m/s (108 km/h): slower than this it sinks
const CRUISE = 60;         // m/s: where a launch starts
const TURN = 0.85;         // rad/s: the fastest it swings its nose (at cruise and up)
const LAND_SINK = 6;       // m/s: touch down slower than this, wings fairly level, to land
const MAX_BANK = 0.75;     // rad (43°): the most it leans into a turn
const ROLL = 1.1;          // 1/s: how fast the bank follows (heavy)
const PITCH_GAIN = 2.5, PITCH_RATE = 0.9;   // the nose follows the aim smoothly, at most 0.9 rad/s
const CRASH_S = 2.5;       // s on the ground in flames before starting again

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// a soft round puff (white middle fading to clear) for fire, smoke and spray, made once
let PUFF = null;
function puffTexture() {
  if (PUFF) return PUFF;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  PUFF = new THREE.CanvasTexture(c);
  PUFF.colorSpace = THREE.SRGBColorSpace;
  return PUFF;
}
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Nose along -z (like the camera), wheels on y = 0. Body white, the colour on the cowling, wing tips
// and tail; red / green lights on the wing tips.
export function buildPlaneMesh(color = 0xc8202a) {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.4, metalness: 0.2 });
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a36, roughness: 0.05, metalness: 0.3 });
  const add = (geo, mat, x, y, z, parent = group) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  };
  // a rod from a to b
  const rod = (a, b, r, mat) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = add(new THREE.CylinderGeometry(r, r, d.length(), 6), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  // fuselage: turned from a profile (radius, tail -> nose), laid along -z, a little taller than wide
  const prof = [[0, -4.1], [0.16, -4.0], [0.3, -3.2], [0.55, -1.6], [0.78, 0], [0.85, 1.2], [0.82, 2.6],
    [0.62, 3.6], [0.4, 4.1], [0, 4.2]].map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = (pts) => { const g = new THREE.LatheGeometry(pts, 20); g.rotateX(-Math.PI / 2); g.scale(1, 1.15, 1); return g; };
  add(lathe(prof), white, 0, 1.55, 0);
  add(lathe(prof.filter((p) => p.y >= 2.6).map((p) => new THREE.Vector2(p.x * 1.03, p.y))), paint, 0, 1.55, 0);   // cowling
  const cabin = add(new THREE.SphereGeometry(1, 20, 12), glass, 0, 2.05, -1.25);
  cabin.scale.set(0.8, 0.55, 1.35);
  // high wing in two halves (a little dihedral), coloured tips, nav lights, struts
  for (const s of [1, -1]) {
    const w = add(new THREE.BoxGeometry(5.6, 0.14, 1.6), white, s * 2.85, 2.68, -1.05);
    w.rotation.z = s * 0.04;
    add(new THREE.BoxGeometry(0.7, 0.16, 1.62), paint, s * 2.5, 0, 0, w);
    add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: s > 0 ? 0x33ff66 : 0xff2a2a }), s * 2.86, 0, -0.5, w);
    rod(new THREE.Vector3(s * 0.62, 1.05, -1.0), new THREE.Vector3(s * 2.7, 2.62, -1.0), 0.05, dark);
  }
  // tail: stabiliser and a swept fin (extruded side outline)
  const stab = add(new THREE.BoxGeometry(3.8, 0.1, 1.0), white, 0, 1.78, 3.55);
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.5, 0.11, 1.0), paint, s * 1.65, 0, 0, stab);
  const fin = new THREE.Shape([[2.9, 0], [4.15, 0], [4.25, 1.5], [3.75, 1.5]].map(([u, v]) => new THREE.Vector2(u, v)));
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.1, bevelEnabled: false });
  fg.rotateY(-Math.PI / 2); fg.translate(0.05, 0, 0);
  add(fg, paint, 0, 1.85, 0);
  // propeller: spinner, two blades, and a faint disc once it's spinning fast
  const spin = new THREE.ConeGeometry(0.22, 0.45, 12); spin.rotateX(-Math.PI / 2);
  add(spin, paint, 0, 1.55, -4.42);
  const prop = new THREE.Group(); prop.position.set(0, 1.55, -4.3); group.add(prop);
  add(new THREE.BoxGeometry(0.14, 2.0, 0.04), dark, 0, 0, 0, prop);
  const disc = add(new THREE.CircleGeometry(1.0, 24), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true,
    opacity: 0, depthWrite: false, side: THREE.DoubleSide }), 0, 1.55, -4.32);
  // fixed gear: two mains and a nose wheel
  const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 14); wg.rotateZ(Math.PI / 2);
  for (const [x, z] of [[1.15, -0.5], [-1.15, -0.5], [0, -3.3]]) {
    add(wg, dark, x, 0.3, z);
    rod(new THREE.Vector3(x, 0.3, z), new THREE.Vector3(x * 0.35, 1.0, z), 0.05, dark);
  }
  group.traverse((o) => { if (o.isMesh && o !== disc) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, prop, disc };
}

export class Plane {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const { group, prop, disc } = buildPlaneMesh();
    this.group = group; this.prop = prop; this.disc = disc;
    group.rotation.order = 'YXZ';
    group.visible = false;
    scene.add(group);
    this.pos = group.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;   // three: yaw 0 looks -z (north), like the camera
    this.speed = 0; this.sink = 0; this.throttle = 0; this.yawRate = 0;
    this.onGround = false;
    this.height = 150;      // m over the ground / water under it (last frame)
    this.overWater = false;
    this.crashed = 0;    // s left in flames
    this.fx = null;
    this._ray = new THREE.Raycaster();
    this._ray.firstHitOnly = true;
  }

  get stalled() { return !this.onGround && !this.crashed && this.speed < STALL; }

  // flying level at p (three coords) heading yaw, at cruise
  launch(p, yaw) {
    this.pos.copy(p);
    this.yaw = yaw; this.pitch = 0; this.roll = 0; this.yawRate = 0;
    this.speed = CRUISE; this.sink = 0; this.throttle = 0.65;
    this.onGround = false; this.crashed = 0; this.height = 150; this.overWater = false;
    this.clearFx();
    this.vel.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(CRUISE);
    this.group.visible = true;
    this.pose();
  }

  hide() { this.group.visible = false; this.clearFx(); }

  dispose() {
    this.hide();
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }

  pose() {
    this.group.rotation.set(this.pitch, this.yaw, this.roll);
    this.disc.material.opacity = 0.12 + 0.2 * this.throttle;
  }

  // aim: { yaw, pitch } where you're looking; thr: -1..1 throttle down / up; turn the nose wheel
  // and brakes on the ground (brake 0..1)
  update(dt, aim, thr, brake) {
    if (this.crashed) { this.crashed = Math.max(0, this.crashed - dt); this.updateFx(dt); return; }
    this.throttle = clamp(this.throttle + thr * 0.6 * dt, 0, 1);
    const v = this.speed;
    // the nose swings toward the aim, slower the slower it flies
    const auth = clamp((v - STALL * 0.5) / (CRUISE - STALL * 0.5), 0.15, 1);
    const dyaw = wrapPi(aim.yaw - this.yaw);
    if (this.onGround) {
      // taxi: steer with the nose wheel (only while rolling); the nose comes up once fast enough
      this.yawRate = clamp(dyaw * 2, -0.7, 0.7) * Math.min(1, v / 4);
      const lift = v > STALL * 1.1 && aim.pitch > 0.04;
      this.pitch = lift ? Math.min(this.pitch + 0.25 * dt, aim.pitch, 0.2) : 0;
      this.roll *= Math.exp(-6 * dt);
    } else {
      this.yawRate = clamp(dyaw * 2, -TURN * auth, TURN * auth);
      const want = clamp(aim.pitch, -1.2, 1.2);
      this.pitch += clamp((want - this.pitch) * PITCH_GAIN, -PITCH_RATE * auth, PITCH_RATE * auth) * dt;
      // bank into the turn (coordinated: tan(bank) = v * turn rate / g), slowly; the wings come
      // level close to the ground so a last correction doesn't dig a wing tip in
      const low = clamp((this.height - 3) / 20, 0.25, 1);
      const bank = clamp(Math.atan(v * this.yawRate / G), -MAX_BANK, MAX_BANK) * low;
      this.roll += (bank - this.roll) * (1 - Math.exp(-ROLL * dt));
    }
    this.yaw = wrapPi(this.yaw + this.yawRate * dt);
    // stall: below STALL the nose drops and it sinks
    const stall = this.onGround ? 0 : clamp(1 - v / STALL, 0, 1);
    if (stall) this.pitch -= stall * 1.8 * dt;
    this.pitch = clamp(this.pitch, -1.4, 1.3);
    this.sink += (stall * 16 - this.sink) * (1 - Math.exp(-1.5 * dt));
    // speed: thrust - drag - gravity along the path; rolling resistance and brakes on the ground
    let a = THRUST * this.throttle - DRAG * v * v - G * Math.sin(this.pitch);
    if (this.onGround) a -= 0.4 + 7 * brake;
    this.speed = Math.max(0, v + a * dt);
    const cp = Math.cos(this.pitch);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.vel.copy(fwd).multiplyScalar(this.speed);
    this.vel.y -= this.sink;
    if (this.onGround) this.vel.y = Math.max(this.vel.y, 0);
    // landing: near the ground on an approach (not a dive) the air cushions it - the descent eases
    // off to ~1 m/s at the wheels
    else if (this.vel.y < 0 && this.height < 15 && !this.overWater && this.pitch > -0.35 && this.speed < 75)
      this.vel.y = Math.max(this.vel.y, -(1.2 + this.height * 0.45));
    // a wall or a tower in the way (a ray along the move from the middle of the plane to past the nose)
    const step = this.vel.length() * dt;
    if (step > 0.01 && this.hitWall(fwd, step)) { this.crash(false); return; }
    this.pos.addScaledVector(this.vel, dt);
    // the ground: terrain, roads and roofs under the wheels; the sea's surface over open water
    let floor = this.world.groundY(this.pos, 2, false);
    const water = floor < -0.3;
    if (water) floor = 0;
    if (this.pos.y <= floor) {
      if (!this.onGround) {
        const gentle = !water && -this.vel.y < LAND_SINK && Math.abs(this.roll) < 0.55 && this.pitch > -0.3 && this.speed < 75;
        if (!gentle) { this.pos.y = floor; this.crash(water); return; }
        this.onGround = true;
        this.sink = 0;
      }
      this.pos.y = floor;
    } else if (this.onGround) {
      const gap = this.pos.y - floor;
      if (this.vel.y > 0.5 || gap > 1.5) { if (gap > 0.3) this.onGround = false; }   // lifting off / rolled off an edge
      else this.pos.y = floor;   // keep the wheels on the ground over small dips
    }
    this.height = Math.max(0, this.pos.y - floor);
    this.overWater = water;
    this.prop.rotation.z += (8 + 50 * this.throttle) * dt;
    this.pose();
  }

  hitWall(fwd, step) {
    const from = this.pos.clone(); from.y += 1.5;
    const ray = this._ray;
    ray.set(from, this.vel.clone().normalize());
    ray.far = step + 4.5;
    const hits = ray.intersectObjects(this.world.nearColliders(this.pos, step + 25), false);
    const h = hits[0];
    if (!h || !h.face) return false;
    // something you could stand on (a road, a roof) is the ground's business, not a wall
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    return n.y < 0.6;
  }

  crash(water) {
    this.crashed = CRASH_S;
    this.speed = 0; this.sink = 0; this.vel.set(0, 0, 0);
    this.group.visible = false;
    this.clearFx();
    // a fireball (or a white splash): soft puffs flying out and swelling, then smoke (or mist) rising
    const at = this.pos.clone(); at.y += 1.5;
    const parts = [];
    const puff = (color, additive, opacity) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color, transparent: true, opacity,
        depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      m.position.copy(at);
      this.scene.add(m);
      return m;
    };
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 12; i++) {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1)).normalize();
      parts.push({ s: puff(water ? 0xffffff : [0xffe08a, 0xffa040, 0xff6a1a][i % 3], !water, 1),
        v: d.multiplyScalar(water ? rnd(4, 9) : rnd(5, 12)).add(new THREE.Vector3(0, water ? rnd(8, 16) : 2, 0)),
        s0: rnd(2, 4), s1: rnd(7, 12), life: rnd(0.9, 1.4), delay: 0, fire: true });
    }
    for (let i = 0; i < 9; i++) {
      parts.push({ s: puff(water ? 0xe6eef2 : 0x2e2e2e, false, 0),
        v: new THREE.Vector3(rnd(-2, 2), rnd(4, 8), rnd(-2, 2)),
        s0: rnd(5, 8), s1: rnd(14, 22), life: CRASH_S, delay: rnd(0.1, 0.5), fire: false });
    }
    this.fx = { t: 0, parts };
  }

  updateFx(dt) {
    const f = this.fx;
    if (!f) return;
    f.t += dt;
    for (const p of f.parts) {
      const t = f.t - p.delay;
      if (t < 0) continue;
      const u = Math.min(t / p.life, 1);
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(Math.exp(-2.5 * dt));   // puffs slow down in the air
      if (!p.fire) p.v.y += 1.5 * dt;            // smoke keeps rising
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(u));
      p.s.material.opacity = p.fire ? (1 - u) ** 1.5 : 0.55 * Math.min(t / 0.3, 1) * (1 - u);
    }
  }

  clearFx() {
    if (!this.fx) return;
    for (const p of this.fx.parts) { p.s.removeFromParent(); p.s.material.dispose(); }
    this.fx = null;
  }
}
