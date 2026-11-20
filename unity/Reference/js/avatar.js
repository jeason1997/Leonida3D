// Other people in your world (live.js): every player as a person with their own colour and a nametag
// (their name + distance, visible anywhere on the map), and the dev (the spectator's "Show me to
// players") in orange with a DEV tag. Our own primitives -
// a person that walks, sprints, jumps and flies (superhero lean), or a car when they drive. Bodies
// arrive ~5 times a second ({x, y, z, h, pt, m, vx, vy}: map metres, degrees, m/s); between updates
// the avatar runs on along its velocity and eases in. You bump into them (blockers -> Player).
import * as THREE from 'three';
import { buildCarMesh, buildBugattiMesh, buildConceptMesh } from './player.js';
import { buildPlaneMesh } from './plane.js';

const deg = THREE.MathUtils.degToRad;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const BODY_RANGE = 3000;   // m: further than this only the tag shows

function buildPerson(shirt) {
  const mat = (color, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });
  const skin = mat(0xc68a62, 0.6), hoodie = mat(shirt), pants = mat(0x26303d), shoes = mat(0x141414), hair = mat(0x2a1d14, 0.9);
  const capsule = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m);
  const root = new THREE.Group();        // feet on the ground, facing -z
  const body = new THREE.Group();        // leans around the hips (flying)
  body.position.y = 0.95;
  root.add(body);
  const torso = capsule(0.17, 0.4, hoodie);
  torso.scale.set(1.25, 1, 0.8);
  torso.position.y = 0.3;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin);
  neck.position.y = 0.66;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
  head.scale.set(0.9, 1.05, 0.95);
  head.position.y = 0.8;
  // hair: the top half of a sphere tipped back, so the hairline sits on the forehead (face is -z)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  cap.position.set(0, 0.815, 0.008);
  cap.rotation.x = 0.45;
  const eyeMat = mat(0x101010, 0.4);
  const eyes = [-0.04, 0.04].map((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat); e.position.set(x, 0.815, -0.108); return e; });
  body.add(torso, neck, head, cap, ...eyes);
  const limb = (x, y, len, r, m, end) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    const c = capsule(r, len, m);
    c.position.y = -len / 2 - r;
    g.add(c);
    if (end) { end.position.y = -len - 2 * r; g.add(end); }
    body.add(g);
    return g;
  };
  const shoe = () => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.27), shoes); s.position.z = -0.06; return s; };
  const hand = () => new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
  const legL = limb(-0.1, 0, 0.72, 0.075, pants, shoe()), legR = limb(0.1, 0, 0.72, 0.075, pants, shoe());
  const armL = limb(-0.26, 0.5, 0.5, 0.055, hoodie, hand()), armR = limb(0.26, 0.5, 0.5, 0.055, hoodie, hand());
  for (const s of [legL, legR]) s.children[1].position.y -= 0.04;   // shoe soles on the ground
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, body, legL, legR, armL, armR };
}

// Nametag: the name on a pill in their colour, how far away they are underneath. A fixed size on
// screen, drawn over everything, so you can find people anywhere on the map.
class Tag {
  constructor(name, bg) {
    this.cv = document.createElement('canvas');
    this.cv.width = 384; this.cv.height = 128;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    // toneMapped off: the scene's exposure would turn the white name grey and dim the colour
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, sizeAttenuation: false, depthTest: false, fog: false, toneMapped: false }));
    this.sprite.scale.set(0.2, 0.0667, 1);   // ~37 px tall on a 768 px high view: a ~13 px name
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 10;
    this.name = name; this.bg = bg; this.sub = '';
    this.draw();
  }

  set(name, sub) {
    if (name === this.name && sub === this.sub) return;
    this.name = name; this.sub = sub;
    this.draw();
  }

  draw() {
    const x = this.cv.getContext('2d'), W = 384, H = 128;
    x.clearRect(0, 0, W, H);
    let size = 44;
    x.font = `bold ${size}px system-ui, sans-serif`;
    const nw = x.measureText(this.name).width;
    if (nw > 330) { size = Math.floor(size * 330 / nw); x.font = `bold ${size}px system-ui, sans-serif`; }
    const tw = Math.min(nw, 330);
    const h = this.sub ? 100 : 64, w = Math.max(tw + 40, 110);
    x.fillStyle = this.bg; x.globalAlpha = 0.92;
    x.beginPath(); x.roundRect(W / 2 - w / 2, H - h - 4, w, h, 16); x.fill();
    x.globalAlpha = 1;
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 4;
    x.fillText(this.name, W / 2, H - h - 4 + 34);
    if (this.sub) {
      x.font = '600 30px system-ui, sans-serif';
      x.fillText(this.sub, W / 2, H - 4 - 22);
    }
    x.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }
}

const fmtDist = (d) => (d < 60 ? '' : d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`);

export class Avatar {
  // name: the tag ('DEV', a player's name); color: hoodie, car and tag colour
  constructor(app, { name, color }) {
    this.app = app;
    this.color = color;   // the minimap's dot
    this.group = new THREE.Group();
    this.group.visible = false;
    const c = new THREE.Color(color);
    this.paint = c;                // their plane's colour too (built when first seen)
    this.person = buildPerson(c);
    const car = buildCarMesh(c);
    this.car = car.group;
    this.carWheels = car.wheels;
    this.tag = new Tag(name, color);
    this.label = this.tag.sprite;
    this.tagTimer = 0;
    this.labelPos = new THREE.Vector3();
    this.group.add(this.person.root, this.car, this.label);
    app.scene.add(this.group);
    this.target = null;            // latest body
    this.tAt = 0;                  // when it came (performance.now)
    this.pos = new THREE.Vector3();   // eased, three coords (feet / car base)
    this.want = new THREE.Vector3();
    this.yaw = 0;                  // eased three rotation.y
    this.speed = 0; this.vy = 0; this.phase = 0; this.lean = 0; this.t = 0;
    this.pt = 0; this.rl = 0;      // eased plane pitch / bank (radians)
    this.blockers = [];
  }

  get shown() { return !!this.target; }

  setName(name) { if (name) this.tag.set(name, this.tag.sub); }

  set(p) {
    const first = !this.target;
    this.target = p;
    this.tAt = performance.now();
    if (!p) { this.group.visible = false; this.blockers = []; return; }
    if (first) this.snap();
  }

  snap() {
    const p = this.target;
    this.pos.set(p.x, p.z, -p.y);
    this.yaw = this.yawOf(p);
    this.mode = p.m;
    this.speed = 0; this.vy = 0;
  }

  // person: rotation.y = -heading (faces -z = north at 0); car: front is +x, so 90 deg - heading
  yawOf(p) { return p.m === 'drive' ? deg(90 - p.h) : -deg(p.h); }

  update(dt) {
    const p = this.target;
    if (!p) return;
    this.t += dt;
    // where they should be by now: the last body run on along its velocity (at most 0.3 s)
    const age = Math.min((performance.now() - this.tAt) / 1000, 0.3);
    const vx = p.vx || 0, vy = p.vy || 0;
    this.want.set(p.x + vx * age, p.z, -(p.y + vy * age));
    if (this.want.distanceTo(this.pos) > 80) this.snap();   // teleported
    const y0 = this.pos.y;
    this.pos.lerp(this.want, 1 - Math.exp(-12 * dt));
    const wantYaw = this.yawOf(p);
    if (this.mode !== p.m) { this.yaw = wantYaw; this.mode = p.m; }   // person <-> car flips the frame
    this.yaw += wrapPi(wantYaw - this.yaw) * (1 - Math.exp(-10 * dt));
    if (dt > 0) {
      const k = 1 - Math.exp(-8 * dt);
      this.speed += (Math.hypot(vx, vy) - this.speed) * k;
      this.vy += ((this.pos.y - y0) / dt - this.vy) * k;
    }
    const camDist = this.app.camera.position.distanceTo(this.pos);
    const drive = p.m === 'drive', plane = p.m === 'plane';
    this.group.visible = true;
    this.group.position.copy(this.pos);
    if (this.knockT > 0) {   // punched: thrown back a little and leaning away (their own page moves them for real)
      this.knockT -= dt;
      const u = Math.sin(Math.min(1 - this.knockT / 0.55, 1) * Math.PI);
      this.group.position.addScaledVector(this.knockDir, u * 1.4);
      this.group.position.y += u * 0.35;
    }
    if (this.pow) {   // the POW over their head
      this.powT -= dt;
      const u = 1 - Math.max(this.powT, 0) / 0.5;
      this.pow.visible = this.powT > 0;
      this.pow.scale.setScalar(0.5 + 0.9 * Math.min(u * 2.5, 1));
      this.pow.material.opacity = Math.min(1, 3 * (1 - u));
    }
    // which car: their Bugatti (in their colour; anyone's since 2026-11-01) or the dev's concept car (the worker
    // passes 'concept' on for the spectator's character only), each built when first seen
    const kind = drive ? (p.k === 'bugatti' || p.k === 'concept' ? p.k : 'car') : null;
    if (kind === 'bugatti' && !this.hyper) {
      const b = buildBugattiMesh(this.paint);
      this.hyper = b.group; this.hyperWheels = b.wheels;
      this.group.add(this.hyper);
    }
    if (kind === 'concept' && !this.concept) {
      const b = buildConceptMesh();
      this.concept = b.group; this.conceptWheels = b.wheels;
      this.group.add(this.concept);
    }
    // their plane, in their colour (gone while it's crashed); planes show from further off
    if (plane && !this.plane) {
      const b = buildPlaneMesh(this.paint);
      this.plane = b.group; this.planeProp = b.prop;
      this.plane.rotation.order = 'YXZ';
      this.group.add(this.plane);
    }
    if (this.plane) this.plane.visible = plane && !p.c && camDist < BODY_RANGE * 3;
    this.person.root.visible = !drive && !plane && camDist < BODY_RANGE;
    this.car.visible = kind === 'car' && camDist < BODY_RANGE;
    if (this.hyper) this.hyper.visible = kind === 'bugatti' && camDist < BODY_RANGE;
    if (this.concept) this.concept.visible = kind === 'concept' && camDist < BODY_RANGE;
    if (plane) {
      const k = 1 - Math.exp(-8 * dt);
      this.pt += (deg(p.pt || 0) - this.pt) * k;
      this.rl += wrapPi(deg(p.rl || 0) - this.rl) * k;
      this.plane.rotation.set(this.pt, this.yaw, this.rl);
      this.planeProp.rotation.z += 50 * dt;
    } else if (drive) {
      const car = kind === 'bugatti' ? this.hyper : kind === 'concept' ? this.concept : this.car;
      car.rotation.set(0, this.yaw, 0);
      car.rotateZ(deg(p.pt || 0));
      for (const w of kind === 'bugatti' ? this.hyperWheels : kind === 'concept' ? this.conceptWheels : this.carWheels) w.rotation.z -= this.speed * dt / (kind === 'concept' ? 0.53 : 0.36);
    } else {
      this.person.root.rotation.y = this.yaw;
      this.animate(dt, p.m === 'fly');
      if (this.punchT > 0) {   // a punch: the right arm jabs straight out and back
        this.punchT -= dt;
        const ext = Math.sin(Math.min(1 - this.punchT / 0.3, 1) * Math.PI);
        this.person.armR.rotation.set(1.55 * ext, 0, 0.08 * (1 - ext));   // (+x swings an arm forward: they face -z)
      }
      if (this.knockT > 0) {   // ... and when hit: rocked back, arms up
        const u = Math.sin(Math.min(1 - this.knockT / 0.55, 1) * Math.PI);
        this.person.body.rotation.x = 0.55 * u;
        this.person.armL.rotation.set(-0.9 * u, 0, -0.6 * u);
        this.person.armR.rotation.set(-0.9 * u, 0, 0.6 * u);
      }
    }
    // the tag: over their head, or - past the camera's far plane - pulled in along the same line of
    // sight (same spot on screen, since it's a fixed size), so it shows from anywhere on the map
    const cam = this.app.camera, lp = this.labelPos.copy(this.pos);
    lp.y += plane ? 4.2 : drive ? 2.2 : 2.05;
    const d = cam.position.distanceTo(lp), maxD = cam.far * 0.85;
    if (d > maxD) lp.sub(cam.position).multiplyScalar(maxD / d).add(cam.position);
    this.label.position.copy(lp).sub(this.group.position);
    this.label.visible = !this.app.tagsHidden;   // settings: NAMETAGS Hide
    if ((this.tagTimer -= dt) <= 0) { this.tagTimer = 0.5; this.tag.set(this.tag.name, fmtDist(camDist)); }
    // bump into it (walking, driving); someone flying is up in the air anyway
    this.blockers = plane ? [{ x: this.pos.x, z: this.pos.z, y0: this.pos.y - 0.3, y1: this.pos.y + 3, r: 2.5 }]
      : drive
      ? [-1.2, 1.2].map((o) => ({ x: this.pos.x + Math.cos(this.yaw) * o, z: this.pos.z - Math.sin(this.yaw) * o, y0: this.pos.y - 0.3, y1: this.pos.y + 1.7, r: 1.0 }))
      : [{ x: this.pos.x, z: this.pos.z, y0: this.pos.y - 0.2, y1: this.pos.y + 1.85, r: 0.3 }];
  }

  // they threw a punch (live.js, from the server)
  punch() { this.punchT = 0.3; }

  // a punch landed on them, knocking them along (dx, dy) (map x / y, unit): a flinch and a POW
  knocked(dx, dy) {
    this.knockT = 0.55;
    this.knockDir = new THREE.Vector3(dx, 0, -dy);
    if (!this.pow) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.translate(64, 64);
      g.beginPath();
      for (let i = 0; i < 24; i++) {
        const r = i % 2 ? 34 : 60, a = (i / 24) * Math.PI * 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fillStyle = '#ffd21f'; g.fill();
      g.lineWidth = 5; g.strokeStyle = '#d4380d'; g.stroke();
      g.font = 'bold 34px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 6; g.strokeStyle = '#7a1a00'; g.strokeText('POW', 0, 2);
      g.fillStyle = '#fff'; g.fillText('POW', 0, 2);
      this.pow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
      this.pow.position.set(0, 2.25, 0);
      this.pow.renderOrder = 10;
      this.group.add(this.pow);
    }
    this.powT = 0.5;
  }

  animate(dt, flying) {
    const { body, legL, legR, armL, armR } = this.person;
    const s = this.speed;
    if (flying) {
      // hover upright with a slow bob; lean into it (arms ahead) as speed builds
      const lean = Math.min(s / 25, 1);
      this.lean += (lean - this.lean) * (1 - Math.exp(-4 * dt));
      const L = this.lean;
      body.rotation.x = -L * 1.35;
      body.position.y = 0.95 + Math.sin(this.t * 2) * 0.04 * (1 - L);
      const sway = Math.sin(this.t * 1.6) * 0.08 * (1 - L);
      armL.rotation.set(-L * 2.9 + sway, 0, -0.18 * (1 - L));
      armR.rotation.set(-L * 2.9 - sway, 0, 0.18 * (1 - L));
      legL.rotation.set(0.12 * (1 - L) + 0.05, 0, -0.04);
      legR.rotation.set(-0.06 * (1 - L) + 0.05, 0, 0.04);
      return;
    }
    this.lean = 0;
    body.rotation.x = 0;
    body.position.y = 0.95;
    if (Math.abs(this.vy) > 1.2) {   // jumping / falling
      legL.rotation.set(-0.5, 0, 0); legR.rotation.set(0.25, 0, 0);
      armL.rotation.set(-0.4, 0, -0.5); armR.rotation.set(-0.4, 0, 0.5);
      return;
    }
    // stride: legs swing with distance walked, wider when sprinting
    this.phase += s * dt * 2.1;
    const amp = Math.min(s / 4.5, 1) * (s > 6.5 ? 0.75 : 0.55);
    const sw = Math.sin(this.phase) * amp;
    legL.rotation.set(sw, 0, 0);
    legR.rotation.set(-sw, 0, 0);
    armL.rotation.set(-sw * 0.9, 0, -0.08);
    armR.rotation.set(sw * 0.9, 0, 0.08);
    body.position.y = 0.95 + Math.abs(Math.cos(this.phase)) * 0.03 * Math.min(s / 4.5, 1);
  }

  dispose() {
    this.app.scene.remove(this.group);
    const mats = new Set();
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) mats.add(o.material); });
    for (const m of mats) { m.map?.dispose(); m.dispose(); }
  }
}
