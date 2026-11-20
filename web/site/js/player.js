// Fly / walk / drive, like the Unreal build. Fly: WASD + mouse, E/Space up, Q/Ctrl down, wheel = speed,
// Shift x4, no collision. Walk: first person, Shift sprint, Space jump, F / click punch, walls and roofs collide.
// Drive: an arcade car (our own boxes - Epic's template car may only ship in Unreal projects),
// W/S gas/brake, A/D steer, Space handbrake, chase camera.
// Plane: the airplane (plane.js) - mouse aim, W/S throttle, A/D turn, Space brakes, Backspace back in the air.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isTyping } from './chat.js';
import { Plane } from './plane.js';

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.dom = dom;
    this.mode = 'fly';
    this.yaw = 0; this.pitch = -0.25;
    this.flySpeed = 30;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.invertY = false;
    this.locked = false;
    this.enabled = false;
    this.walker = { pos: new THREE.Vector3(), vy: 0, onGround: false };
    this.car = null;
    this.plane = null;
    this.camYawOffset = 0;
    this.blockers = [];   // avatar.js fills it
    this.analog = { x: 0, y: 0 };   // touch stick (touch.js): x right, y forward, -1..1
    // punching (walk): onPunch tells the server (main.js -> live.js punch()); punchT runs the fist's jab,
    // knockV / shake are what a punch that lands on you does (knock(), from live.js)
    this.onPunch = null; this.punchCD = 0; this.punchT = 0; this.knockV = null; this.shake = 0; this.fist = null;
    this.pointer = 'mouse';         // what last pressed on the view: mouse / touch / pen
    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;   // chat box
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyF' && !e.repeat) this.punch();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // a mouse click on the view takes the cursor; a finger on it is looking around (touch.js)
    dom.addEventListener('pointerdown', (e) => { this.pointer = e.pointerType; });
    dom.addEventListener('click', () => {
      if (this.enabled && !this.locked && this.pointer === 'mouse') dom.requestPointerLock?.()?.catch?.(() => {});
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    dom.addEventListener('mousedown', (e) => { if (e.button === 0 && this.locked) this.punch(); });   // the first click takes the cursor
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.turn(e.movementX, e.movementY, 0.0022);
    });
    addEventListener('wheel', (e) => {
      // only over the view: scrolling a panel (live players, chat, settings) shouldn't change speed
      if (e.target !== dom || !this.enabled || this.mode !== 'fly') return;
      this.flySpeed = Math.min(Math.max(this.flySpeed * (e.deltaY < 0 ? 1.25 : 0.8), 2), 2000);
    }, { passive: true });
  }

  // look around by a mouse move or a touch drag (pixels x radians per pixel); driving swings the
  // chase camera instead
  turn(dx, dy, k) {
    if (this.mode === 'drive') { this.camYawOffset -= dx * k; return; }
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }

  // keys and the touch stick together: forward / right in -1..1
  moveInput() {
    const k = this.keys, a = this.analog;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + a.y;
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + a.x;
    return [Math.max(-1, Math.min(1, f)), Math.max(-1, Math.min(1, r))];
  }

  // map coords (x east, y north, z up; heading clockwise from north) -> camera
  placeAt(x, y, z, headingDeg, pitchDeg = -10) {
    this.camera.position.set(x, z, -y);
    this.yaw = -THREE.MathUtils.degToRad(headingDeg);   // three: yaw 0 looks -z (north)
    this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.vel.set(0, 0, 0);
  }

  get speedKmh() {
    if (this.mode === 'drive' && this.car) return Math.abs(this.car.speed) * 3.6;
    if (this.mode === 'plane' && this.plane) return this.plane.speed * 3.6;
    return this.vel.length() * 3.6;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const cam = this.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    if (mode === 'walk') {
      const from = this.mode === 'drive' && this.car
        ? this.car.group.position.clone().add(new THREE.Vector3(Math.cos(this.car.heading), 0, -Math.sin(this.car.heading)).multiplyScalar(-2.5))
        : this.mode === 'plane' && this.plane ? this.plane.pos.clone().add(new THREE.Vector3(0, 1, 0)) : cam.position.clone();
      const g = this.world.groundY(from, 2, false);
      this.walker.pos.set(from.x, g + 0.05, from.z);
      this.walker.vy = 0;
      if (this.mode === 'drive') this.yaw = this.car.heading - Math.PI / 2;
      this.pitch = 0;
    } else if (mode === 'drive') {
      if (!this.car) this.car = new Car(this.world, cam.parent || this.world.scene);
      const p = cam.position;
      if (this.car.group.position.distanceTo(p) > 40 || !this.car.placed) {
        const g = this.world.groundY(p, 2, false);
        this.car.place(new THREE.Vector3(p.x, g, p.z), Math.atan2(-fwd.z, fwd.x));
      }
      this.camYawOffset = 0;
    } else if (mode === 'fly') {
      // keep looking where the camera looks
      this.yaw = Math.atan2(-fwd.x, -fwd.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
      this.vel.set(0, 0, 0);
    }
    if (this.car) this.car.handbrake = mode !== 'drive';
    if (this.mode === 'plane') this.plane?.hide();   // put away (not left hanging in the sky)
    const was = this.mode;
    this.mode = mode;
    if (mode === 'plane') this.launchPlane(was);
  }

  // into the plane, flying level the way you look, at least 150 m over the ground (Backspace: again
  // from where the plane is)
  launchPlane(from = 'plane') {
    if (!this.plane) this.plane = new Plane(this.world, this.camera.parent || this.world.scene);
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const p = from === 'plane' && this.plane.group.visible ? this.plane.pos.clone()
      : from === 'walk' ? this.walker.pos.clone()
      : from === 'drive' && this.car ? this.car.group.position.clone() : this.camera.position.clone();
    const ground = Math.max(this.world.heightAt(p.x, -p.z), 0);
    p.y = Math.max(p.y, ground + 150);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.plane.launch(p, yaw);
    this.yaw = yaw; this.pitch = -0.08;   // aim: straight ahead, a touch down
  }

  // Get into a car of `kind` (CARS): swapped in place if you're driving, else where you are looking
  // from. Everyone can pick the Bugatti (ui.js: the CAR buttons, B); the concept car is the dev's (N).
  spawnCar(kind) {
    const old = this.car;
    const swap = this.mode === 'drive' && old ? { p: old.group.position.clone(), h: old.heading } : null;
    if (old && old.kind !== kind) { old.dispose(); this.car = null; }
    if (!this.car) this.car = new Car(this.world, this.camera.parent || this.world.scene, kind);
    if (swap) this.car.place(swap.p, swap.h);
    else { this.car.placed = false; this.setMode('drive'); }
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.mode === 'fly') this.updateFly(dt);
    else if (this.mode === 'walk') this.updateWalk(dt);
    else if (this.mode === 'plane') this.updatePlane(dt);
    else this.updateDrive(dt);
  }

  look() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  updateFly(dt) {
    const k = this.keys;
    const [f, r] = this.moveInput();
    const u = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0);
    this.look();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).add(new THREE.Vector3(0, u, 0));
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(this.flySpeed * (k.has('ShiftLeft') ? 4 : 1));
    this.vel.lerp(wish, 1 - Math.exp(-6 * dt));
    this.camera.position.addScaledVector(this.vel, dt);
    // never under the ground
    const g = this.world.heightAt(this.camera.position.x, -this.camera.position.z);
    if (this.camera.position.y < g + 1.5) this.camera.position.y = g + 1.5;
  }

  // a punch (walking: F, a click once the mouse is captured, the phone's PUNCH button): the fist jabs and the
  // server works out who it lands on (worker punch())
  punch() {
    if (!this.enabled || this.mode !== 'walk' || this.punchCD > 0) return;
    this.punchCD = 0.42;
    this.punchT = PUNCH_T;
    this.onPunch?.();
  }

  // someone's punch landed on you: knocked along (dx, dy) (map metres, unit), with a little hop
  knock(dx, dy) {
    if (this.mode !== 'walk') return;
    this.knockV = new THREE.Vector3(dx, 0, -dy).multiplyScalar(11);   // ~3.7 m in all
    this.walker.vy = Math.max(this.walker.vy, 4);
    this.walker.onGround = false;
    this.shake = 0.3;
  }

  // the first-person fist: hidden until a punch, then out and back in front of the camera
  updateFist(dt) {
    this.punchCD = Math.max(0, this.punchCD - dt);
    if (!this.fist) {
      if (this.punchT <= 0) return;
      const skin = new THREE.MeshStandardMaterial({ color: 0xc68a63, roughness: 0.7 });
      const sleeve = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 });
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), skin);
      fist.scale.set(1.0, 0.9, 1.15);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.55, 12), sleeve);
      arm.rotation.x = Math.PI / 2;
      arm.position.z = 0.37;
      this.fist = new THREE.Group();
      this.fist.add(fist, arm);
      (this.camera.parent || this.world.scene).add(this.fist);
    }
    if (this.punchT <= 0 || this.mode !== 'walk') { this.fist.visible = false; this.punchT = 0; return; }
    this.punchT -= dt;
    const ext = Math.sin(Math.min(1 - this.punchT / PUNCH_T, 1) * Math.PI);   // out, then back
    this.fist.visible = true;
    this.fist.position.set(0.2 - 0.12 * ext, -0.24 + 0.1 * ext, -0.45 - 0.35 * ext).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    this.fist.quaternion.copy(this.camera.quaternion);
  }

  updateWalk(dt) {
    const k = this.keys, w = this.walker;
    const [f, r] = this.moveInput();
    const speed = k.has('ShiftLeft') ? 9 : 4.5;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    if (move.lengthSq() > 1) move.normalize();
    w.pos.addScaledVector(move, speed * dt);
    if (this.knockV) {   // knocked back by a punch (walls below still stop it)
      w.pos.addScaledVector(this.knockV, dt);
      this.knockV.multiplyScalar(Math.exp(-3 * dt));
      if (this.knockV.lengthSq() < 0.05) this.knockV = null;
    }
    // walls: push the body out at knee and chest height
    for (const hgt of [0.6, 1.3]) {
      const c = w.pos.clone(); c.y += hgt;
      const push = this.world.pushOut(c, 0.35, w.pos.y + 0.5);   // lower than that: a step
      w.pos.x += push.x; w.pos.z += push.z;
    }
    pushFromBlockers(this.blockers, w.pos, 0.35, w.pos.y, w.pos.y + 1.8);
    // gravity, ground (steps up to 0.6 m), jump
    const ground = this.world.groundY(w.pos, 0.6, false);
    w.vy -= 9.81 * dt;
    w.pos.y += w.vy * dt;
    if (w.pos.y <= ground) { w.pos.y = ground; w.vy = 0; w.onGround = true; } else w.onGround = w.pos.y - ground < 0.05;
    if (w.onGround && k.has('Space')) { w.vy = 5.2; w.onGround = false; }
    if (w.pos.y < -200) w.pos.y = this.world.heightAt(w.pos.x, -w.pos.z) + 50;
    this.camera.position.set(w.pos.x, w.pos.y + 1.65, w.pos.z);
    if (this.shake > 0) {   // punched: a short jolt
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
    }
    this.look();
    this.updateFist(dt);
    this.vel.copy(move).multiplyScalar(speed);
  }

  updateDrive(dt) {
    const c = this.car;
    if (!c) return;
    const k = this.keys, a = this.analog;
    // the touch stick: up = gas, down = brake / reverse, sideways = steer (light push = gentle)
    const throttle = Math.max(k.has('KeyW') || k.has('ArrowUp') ? 1 : 0, Math.max(0, a.y));
    const brake = Math.max(k.has('KeyS') || k.has('ArrowDown') ? 1 : 0, Math.max(0, -a.y));
    const steer = Math.max(-1, Math.min(1, (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - a.x));
    c.handbrake = k.has('Space');
    if (k.has('Backspace')) c.reset();
    c.update(dt, throttle, brake, steer, this.blockers);
    // chase camera
    const back = new THREE.Vector3(-Math.cos(c.heading + this.camYawOffset), 0, Math.sin(c.heading + this.camYawOffset));
    const want = c.group.position.clone().addScaledVector(back, 8.5).add(new THREE.Vector3(0, 3.2, 0));
    const g = this.world.heightAt(want.x, -want.z);
    want.y = Math.max(want.y, g + 1.2);
    this.camera.position.lerp(want, 1 - Math.exp(-8 * dt));
    this.camera.lookAt(c.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
    this.camYawOffset *= Math.exp(-1.5 * dt);
  }

  updatePlane(dt) {
    const pl = this.plane;
    if (!pl) return;
    const k = this.keys, a = this.analog;
    const thr = Math.max(-1, Math.min(1, (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + a.y));
    const turn = Math.max(-1, Math.min(1, (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - a.x));
    this.yaw += turn * 0.9 * dt;   // A/D (the stick sideways) swing the aim
    if (k.has('Backspace') && !pl.crashed) this.launchPlane();
    const crashed = pl.crashed;
    pl.update(dt, { yaw: this.yaw, pitch: this.pitch }, thr, k.has('Space') ? 1 : 0);
    if (crashed && !pl.crashed) { this.launchPlane(); return; }   // done burning: back in the air over the spot
    // chase camera: behind the plane along the aim, looking where you aim (pulled back to watch a crash)
    const cp = Math.cos(this.pitch);
    const aim = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const c = pl.pos.clone(); c.y += 1.8;
    if (pl.crashed) {
      const flat = new THREE.Vector3(aim.x, 0, aim.z).normalize();
      const want = c.clone().addScaledVector(flat, -55); want.y += 22;
      want.y = Math.max(want.y, this.world.heightAt(want.x, -want.z) + 3);
      this.camera.position.lerp(want, 1 - Math.exp(-2.5 * dt));
      this.camera.lookAt(c.x, c.y + 4, c.z);
      return;
    }
    const want = c.clone().addScaledVector(aim, -17); want.y += 4;
    want.y = Math.max(want.y, this.world.heightAt(want.x, -want.z) + 1.5);
    this.camera.position.copy(want);
    this.camera.lookAt(c.addScaledVector(aim, 40));
    this.vel.copy(pl.vel);
  }

  // the HUD's plane line: speed, height over the ground, throttle, warnings
  get planeInfo() {
    const pl = this.plane;
    if (!pl) return null;
    const alt = Math.max(0, pl.pos.y - Math.max(this.world.heightAt(pl.pos.x, -pl.pos.z), 0));
    return { kmh: pl.speed * 3.6, alt, vs: pl.vel.y, thr: pl.throttle, stall: pl.stalled, crashed: pl.crashed > 0, ground: pl.onGround };
  }
}

// The car's boxes, front along +x (also the spectator's car in avatar.js, in another colour).
export function buildCarMesh(color = 0xd8262a) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a36, roughness: 0.05, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.75, 1.9), paint); body.position.y = 0.65;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 1.7), glass); cabin.position.set(-0.25, 1.3, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.65), paint); roof.position.set(-0.3, 1.62, 0);
  group.add(body, cabin, roof);
  const wheels = [];
  const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16); wg.rotateX(Math.PI / 2);
  for (const [x, z] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) {
    const w = new THREE.Mesh(wg, dark); w.position.set(x, 0.36, z); group.add(w); wheels.push(w);
  }
  const lights = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
  for (const z of [0.6, -0.6]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.35), lights); l.position.set(2.16, 0.75, z); group.add(l); }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, wheels };
}

// The Bugatti (Chiron-like hypercar; anyone can drive it), front along +x like buildCarMesh: a low two-tone body
// extruded from a side profile with the wheel arches cut out, glass canopy, the chrome C-line on the
// flanks, horseshoe grille, quad headlights, a full-width tail-light bar, rear wing and quad exhaust.
export function buildBugattiMesh(color = 0x0b2f7a) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.65 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.3, metalness: 0.4 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.12, metalness: 1.0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1116, roughness: 0.05, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.25, metalness: 0.9 });
  const W = 2.04, FX = 1.38, RX = -1.33, WR = 0.37;
  const extrude = (shape, depth, mat, bevel = 0.06) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel,
      bevelSize: bevel, bevelSegments: 4, curveSegments: 18 });
    g.translate(0, 0, -(depth - 2 * bevel) / 2);
    return new THREE.Mesh(g, mat);
  };
  // body: side profile, rear (-x) to front (+x), arches over both axles
  const s = new THREE.Shape();
  s.moveTo(-2.12, 0.16);
  s.lineTo(RX - 0.5, 0.16); s.lineTo(RX - 0.5, 0.36); s.absarc(RX, 0.36, 0.5, Math.PI, 0, true); s.lineTo(RX + 0.5, 0.15);
  s.lineTo(FX - 0.49, 0.15); s.lineTo(FX - 0.49, 0.36); s.absarc(FX, 0.36, 0.49, Math.PI, 0, true); s.lineTo(FX + 0.49, 0.15);
  s.lineTo(2.12, 0.15);
  s.quadraticCurveTo(2.3, 0.2, 2.27, 0.38);     // nose
  s.quadraticCurveTo(2.2, 0.56, 1.7, 0.68);      // bonnet
  s.quadraticCurveTo(1.0, 0.82, 0.55, 0.86);     // cowl
  s.lineTo(-1.25, 0.94);                         // along the door top to the engine cover
  s.quadraticCurveTo(-2.05, 0.95, -2.24, 0.82);  // rear deck
  s.quadraticCurveTo(-2.33, 0.55, -2.22, 0.3);   // tail
  s.lineTo(-2.12, 0.16);
  const body = extrude(s, W, paint, 0.09);
  group.add(body);
  // glass canopy, narrower, black roof line
  const c = new THREE.Shape();
  c.moveTo(1.0, 0.8);
  c.quadraticCurveTo(0.45, 1.04, -0.05, 1.13);
  c.quadraticCurveTo(-0.55, 1.16, -0.95, 1.06);
  c.quadraticCurveTo(-1.45, 0.96, -1.75, 0.9);
  c.lineTo(1.0, 0.8);
  group.add(extrude(c, 1.5, glass, 0.08));
  // the C-line: chrome sweep from behind the front wheel over the cabin side and down behind the door
  for (const side of [1, -1]) {
    const z = side * (W / 2 + 0.005);
    const curve = new THREE.CatmullRomCurve3([[0.62, 0.45], [0.55, 0.78], [0.1, 0.9], [-0.55, 0.92], [-0.98, 0.78],
      [-1.02, 0.48], [-0.78, 0.24]].map(([x, y]) => new THREE.Vector3(x, y, z)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.025, 6), chrome));
    // dark side intake inside the C
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.04), carbon);
    intake.position.set(-0.62, 0.58, side * (W / 2 - 0.005));
    group.add(intake);
  }
  // horseshoe grille, facing +x
  const hs = (r, h) => {
    const p = new THREE.Shape();
    p.moveTo(-r, -h); p.lineTo(-r, 0); p.absarc(0, 0, r, Math.PI, 0, true); p.lineTo(r, -h);
    p.quadraticCurveTo(0, -h - 0.06, -r, -h);
    return p;
  };
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(hs(0.17, 0.14), { depth: 0.04, bevelEnabled: false }), chrome);
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(hs(0.13, 0.11), { depth: 0.05, bevelEnabled: false }), carbon);
  for (const m of [ring, mesh]) { m.rotation.y = Math.PI / 2; m.position.set(2.31 + (m === mesh ? 0.01 : 0), 0.36, 0); group.add(m); }
  // quad headlights: two small lamps a side
  const lamp = new THREE.MeshBasicMaterial({ color: 0xeaf4ff });
  for (const side of [1, -1]) for (const [dx, dz] of [[0, 0.62], [-0.06, 0.78]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.12), lamp);
    l.position.set(2.22 + dx, 0.52 + dx * 0.6, side * dz);
    l.rotation.z = -0.35;
    group.add(l);
  }
  // rear: full-width light bar, black diffuser, quad exhaust, wing on two struts
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, W - 0.25), new THREE.MeshBasicMaterial({ color: 0xff1a12 }));
  tail.position.set(-2.37, 0.68, 0); group.add(tail);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, W - 0.3), carbon);
  diffuser.position.set(-2.27, 0.24, 0); group.add(diffuser);
  const pipe = new THREE.CylinderGeometry(0.055, 0.055, 0.12, 12); pipe.rotateZ(Math.PI / 2);
  for (const [y, z] of [[0.33, 0.07], [0.33, -0.07], [0.2, 0.07], [0.2, -0.07]]) {
    const e = new THREE.Mesh(pipe, chrome); e.position.set(-2.4, y, z); group.add(e);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, W - 0.2), carbon);
  wing.position.set(-1.98, 1.13, 0); wing.rotation.z = 0.08; group.add(wing);
  for (const z of [0.45, -0.45]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.04), carbon); st.position.set(-1.98, 1.05, z); group.add(st);
  }
  // wheels: tyre + rim + five spokes, all turning together
  const tyre = new THREE.CylinderGeometry(WR, WR, 0.32, 24); tyre.rotateX(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.27, 0.27, 0.01, 24); disc.rotateX(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.05, 0.25, 0.012);
  const wheels = [];
  for (const [x, z] of [[FX, 0.87], [FX, -0.87], [RX, 0.87], [RX, -0.87]]) {
    const w = new THREE.Mesh(tyre, rubber);
    w.position.set(x, WR, z);
    const face = Math.sign(z) * 0.165;
    const d = new THREE.Mesh(disc, carbon); d.position.z = face; w.add(d);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(spoke, rim);
      sp.rotation.z = (k / 5) * Math.PI * 2;
      sp.position.set(-Math.sin(sp.rotation.z) * 0.13, Math.cos(sp.rotation.z) * 0.13, face + Math.sign(z) * 0.008);
      w.add(sp);
    }
    group.add(w); wheels.push(w);
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, wheels };
}

// The dev's car (the spectator's only; ui.js, worker body()): Khronos' "Car Concept" glTF sample asset, CC BY 4.0
// (Eric Chadwick / Darmstadt Graphics Group, from a public-domain model by Unity Fan), logos taken out by
// scripts/cars/prep_concept.py. Loaded once, the first time anyone needs it - the group stays empty until then.
// The asset is Y-up with its nose towards +Z: turned nose to +x like buildCarMesh, set on the ground, and each
// wheel group put on a pivot at its centre (rotation.z spins it, as the other cars' wheels).
let conceptScene = null;
function loadConcept() {
  conceptScene ??= new GLTFLoader().loadAsync('assets/cars/concept.glb').then((gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      // glass: plain see-through - a transmission material re-renders the whole city behind it every frame
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.42; m.color.set(0x1a232c); m.depthWrite = false; }
    });
    return gltf.scene;
  });
  return conceptScene;
}

// a wheel's axle: the axis its tyre's vertices vary least along (pointing +z-ish)
function axleOf(tyre) {
  const pos = tyre.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
  const step = Math.max(1, Math.floor(pos.count / 2000));
  for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(tyre.matrixWorld).clone());
  const m = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = [p.x - m.x, p.y - m.y, p.z - m.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j];
  }
  const inv = new THREE.Matrix3().set(...C).invert();
  const ax = new THREE.Vector3(0.1, 0.1, 1);
  for (let k = 0; k < 40; k++) ax.applyMatrix3(inv).normalize();   // inverse power iteration: the smallest
  return ax.z < 0 ? ax.negate() : ax;   // world = the car's frame here (built before it joins the scene)
}

export function buildConceptMesh() {
  const group = new THREE.Group(), wheels = [];
  loadConcept().then((scene) => {
    const root = new THREE.Group(), fix = new THREE.Group();
    fix.add(scene.clone(true));
    fix.rotation.y = Math.PI / 2;   // nose (+z in the asset) to +x
    root.add(fix);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fix), c = box.getCenter(new THREE.Vector3());
    fix.position.set(-c.x, -box.min.y, -c.z);
    root.updateMatrixWorld(true);
    // each wheel spins on a pivot at its tyre's centre; the asset's front wheels are steered 30 deg, so a wheel is
    // first turned until its axle (the tyre's thinnest axis) lies along z, or it would wobble as it spins; the
    // brake calipers stay put (they don't turn with the wheel)
    for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
      const w = fix.getObjectByName(name);
      if (!w) continue;
      let tyre = null, vol = 0;
      w.traverse((o) => {
        if (!o.isMesh) return;
        const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
        if (s.x * s.y * s.z > vol) { vol = s.x * s.y * s.z; tyre = o; }
      });
      const pivot = new THREE.Group(), align = new THREE.Group();
      new THREE.Box3().setFromObject(tyre).getCenter(pivot.position);
      root.add(pivot);
      pivot.add(align);
      pivot.updateMatrixWorld(true);
      align.attach(w);
      align.quaternion.setFromUnitVectors(axleOf(tyre), new THREE.Vector3(0, 0, 1));
      align.updateMatrixWorld(true);
      const calipers = [];
      w.traverse((o) => { if (/BrakePad/.test(o.name)) calipers.push(o); });
      for (const c of calipers) root.attach(c);
      wheels.push(pivot);
    }
    group.add(root);
  }).catch((e) => console.warn('dev car:', e));
  return { group, wheels };
}

const PUNCH_T = 0.28;   // s: the fist's jab, out and back

// Cars you can drive: mesh, top speed / reverse (m/s), acceleration (m/s² at speed v), brakes,
// wheel radius. bugatti: ~420 km/h, 0-100 in about 2.5 s; concept (the dev's): ~300 km/h.
const CARS = {
  car: { mesh: buildCarMesh, maxF: 55, maxR: -12, accel: () => 9, brake: 16, wheel: 0.36 },
  bugatti: { mesh: buildBugattiMesh, maxF: 117, maxR: -12, accel: (v) => 1.5 + 11.5 * (1 - Math.min(v / 117, 1) ** 1.6), brake: 24, wheel: 0.37 },
  concept: { mesh: buildConceptMesh, maxF: 83, maxR: -12, accel: (v) => 2 + 9 * (1 - Math.min(v / 83, 1) ** 1.4), brake: 22, wheel: 0.53 },
};

// Things you bump into that aren't map meshes (the spectator's character / car, avatar.js):
// vertical cylinders { x, z (three coords), y0, y1, r }. Push a circle at p (radius r) out of them.
function pushFromBlockers(blockers, p, r, y0, y1) {
  let hit = false;
  for (const b of blockers) {
    if (y1 < b.y0 || y0 > b.y1) continue;
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz), min = r + b.r;
    if (d >= min) continue;
    const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
    p.x = b.x + nx * min; p.z = b.z + nz * min;
    hit = true;
  }
  return hit;
}

class Car {
  constructor(world, scene, kind = 'car') {
    this.world = world;
    this.kind = CARS[kind] ? kind : 'car';
    this.spec = CARS[this.kind];
    const { group, wheels } = this.spec.mesh();
    this.group = group;
    this.wheels = wheels;
    scene.add(this.group);
    this.heading = 0; this.speed = 0; this.handbrake = false; this.placed = false; this.vy = 0; this.pitch = 0;
  }

  place(pos, heading) {
    this.group.position.copy(pos); this.heading = heading; this.speed = 0; this.vy = 0; this.placed = true;
    this.group.rotation.set(0, heading, 0);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }

  reset() {
    const p = this.group.position;
    p.y = this.world.groundY(p, 3, false) + 0.3;
    this.speed = 0;
    this.group.rotation.set(0, this.heading, 0);
  }

  update(dt, throttle, brake, steer, blockers = []) {
    const { maxF, maxR, accel, brake: stop, wheel } = this.spec;
    if (throttle) this.speed += (this.speed < 0 ? 18 : accel(this.speed)) * throttle * dt;
    if (brake) this.speed -= (this.speed > 0 ? stop : 6) * brake * dt;
    if (this.handbrake) this.speed *= Math.exp(-2.5 * dt);
    if (!throttle && !brake) this.speed *= Math.exp(-0.35 * dt);
    this.speed = Math.max(maxR, Math.min(maxF, this.speed));
    const turn = steer * Math.min(Math.abs(this.speed) / 6, 1) * (0.9 - 0.5 * Math.min(Math.abs(this.speed) / maxF, 1));
    this.heading += turn * Math.sign(this.speed) * dt;
    const dir = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    const p = this.group.position;
    p.addScaledVector(dir, this.speed * dt);
    // walls: push out, lose speed
    for (const off of [1.4, -1.4]) {
      const c = p.clone().addScaledVector(dir, off); c.y += 0.8;
      const push = this.world.pushOut(c, 1.0, p.y + 0.6);   // kerbs and steps: climb, don't stop
      if (push.lengthSq() > 1e-6) { p.x += push.x; p.z += push.z; this.speed *= 0.5; }
      const before = c.clone();
      if (pushFromBlockers(blockers, c, 1.0, p.y, p.y + 1.6)) { p.x += c.x - before.x; p.z += c.z - before.z; this.speed *= 0.5; }
    }
    // ground: average of front / back, gravity when airborne
    const f = p.clone().addScaledVector(dir, 1.4), b = p.clone().addScaledVector(dir, -1.4);
    const gf = this.world.groundY(f, 1.0, false), gb = this.world.groundY(b, 1.0, false);
    const g = (gf + gb) / 2;
    this.vy -= 9.81 * dt;
    p.y += this.vy * dt;
    if (p.y <= g) { p.y = g; this.vy = 0; }
    const pitch = Math.atan2(gf - gb, 2.8);
    this.pitch = pitch;
    this.group.rotation.set(0, this.heading, 0);
    this.group.rotateZ(pitch);
    for (const w of this.wheels) w.rotation.z -= this.speed * dt / wheel;
  }
}
