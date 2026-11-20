// The map window (M, or MAP on a phone): all of Leonida from the minimap tiles (scripts/web_minimap.py:
// the radar's 2 m tiles, and 1 m ones in assets/minimap/hi/ for zoomed right in), north up, dragged and zoomed like a web map (wheel / pinch, + and -). Shows you (an arrow), everyone
// else with their names, the area names and a scale (NAMES hides the names; remembered in the settings). Click or tap the map to drop a waypoint - it shows
// on the radar too and clears when you get there - and GO THERE flies you to it (a plane keeps flying,
// launched over it). Your character waits while the map is open.
import * as THREE from 'three';
import { isTyping, DEV_NAME } from './chat.js';
import { AREAS } from './areas.js';

// Sharpness: each zoom draws the tile picture nearest the screen's own pixels (device px, up to 3 a
// CSS px) - 1 m, 2 m, or a 4 m / 8 m copy halved down from the 2 m tile - so nothing is stretched much
// or shrunk more than 2x (which shimmers). Further out, one 12 m picture of the whole map.
const OV_RES = 12;          // m a pixel: the zoomed-out picture, built from the tiles as they load
const HI = 'assets/minimap/hi/';   // 1 m tiles (2048 px)
const HI_KEEP = 9;          // 1 m tiles kept at once (16 MB each decoded)
const DPR_MAX = 3;
const OPEN_MPP = 6;         // where it opens (about 6 km across a 1000 px window)
const ARRIVE = 40;          // m: a waypoint this close is reached
const WAY_COLOR = '#ffd84a';
// zoomed out, names that would overlap are left out - these first
const RANK = ['Downtown', 'Vice Beach', 'Capri', 'Port Gellhorn', 'The Keys', 'Brickell', 'Port of Vice City', 'Bayside',
  'Washington Beach', 'Ocean Beach', 'Brickell Key'];

const CSS = `
  #bigmap { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
    box-sizing: border-box; background: rgba(4, 6, 10, 0.45);
    padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px))
      max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }
  /* a window in the middle of the screen; phones (narrow or short) get nearly all of it */
  #bigmap .frame { position: relative; flex: 0 1 auto; width: min(1500px, 88%); height: min(1000px, 86%); min-width: 0;
    border-radius: 12px; overflow: hidden;
    border: 2px solid rgba(0, 0, 0, 0.6); box-shadow: 0 6px 30px rgba(0, 0, 0, 0.5); }
  #bigmap canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
  #bigmap canvas.drag { cursor: grabbing; }
  #bigmap .bar { position: absolute; left: 10px; right: 10px; top: 10px; display: flex; gap: 6px; align-items: center;
    pointer-events: none; }
  #bigmap .bar > * { pointer-events: auto; }
  #bigmap .title { background: var(--panel); padding: 7px 12px; border-radius: 8px; font-weight: 800; letter-spacing: 0.1em; }
  #bigmap .where { background: var(--panel); padding: 7px 10px; border-radius: 8px; color: var(--muted); font-size: 12px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #bigmap .where:empty { display: none; }
  #bigmap .sp { flex: 1; }
  #bigmap .bar button { padding: 7px 11px; font-size: 13px; min-width: 36px; }
  #bigmap .way { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: var(--panel);
    padding: 7px 8px 7px 14px; border-radius: 10px; display: flex; gap: 10px; align-items: center; white-space: nowrap; }
  #bigmap .way b { color: ${WAY_COLOR}; }
  #bigmap .way button { padding: 7px 12px; font-size: 13px; }
  #bigmap .way button.go { background: #1f4f9c; border-color: #4b84e0; }
  #bigmap .hint { position: absolute; left: 12px; bottom: 14px; color: #fff; text-shadow: 0 1px 2px #000; font-size: 12px;
    pointer-events: none; }
  #bigmap .frame.way-on .hint { display: none; }
  @media (max-width: 700px), (max-height: 500px) {
    #bigmap .frame { width: 100%; height: 100%; }
  }
  @media (max-width: 700px) {
    #bigmap { padding: max(6px, env(safe-area-inset-top, 0px)) max(6px, env(safe-area-inset-right, 0px))
      max(6px, env(safe-area-inset-bottom, 0px)) max(6px, env(safe-area-inset-left, 0px)); }
    #bigmap .hint { display: none; }
    #bigmap .title { display: none; }
  }`;

export class MapWindow {
  constructor(app) {
    this.app = app;
    const m = app.world.m;
    this.info = m.minimap || null;
    this.mini = app.minimap;               // shares its tile images
    this.C = m.chunk; this.west = m.west; this.north = m.north;
    const keys = [...(this.info?.tiles || [])].map((k) => k.split('_').map(Number));
    const I = keys.map((k) => k[0]), J = keys.map((k) => k[1]);
    // the tiles' extent in map metres (x east, y north)
    this.i0 = Math.min(...I); this.i1 = Math.max(...I); this.j0 = Math.min(...J); this.j1 = Math.max(...J);
    this.x0 = this.west + this.i0 * this.C; this.x1 = this.west + (this.i1 + 1) * this.C;
    this.y1 = this.north - this.j0 * this.C; this.y0 = this.north - (this.j1 + 1) * this.C;
    this.keys = keys;
    // area names, and The Keys (everything south of 4 km S - areas.js) in the middle of its tiles
    const south = keys.map(([i, j]) => [this.west + (i + 0.5) * this.C, this.north - (j + 0.5) * this.C]).filter(([, y]) => y < -4000);
    this.labels = AREAS.map(([n, x, y]) => ({ n, x, y }));
    if (south.length) this.labels.push({ n: 'The Keys', x: south.reduce((a, p) => a + p[0], 0) / south.length, y: south.reduce((a, p) => a + p[1], 0) / south.length });
    const rank = (n) => { const i = RANK.indexOf(n); return i < 0 ? RANK.length : i; };
    this.labels.sort((a, b) => rank(a.n) - rank(b.n));
    this.cx = 0; this.cy = 0; this.mpp = OPEN_MPP;
    this.waypoint = null;                  // { x, y } map metres
    this.ov = null; this.ovDone = new Set();
    this.mips = new Map();                 // key -> { m4, m8 }: the 2 m tile halved (512 px) and again (256 px)
    this.his = new Map();                  // key -> Image (1 m), oldest first
    this.pointers = new Map();             // pointerId -> { x, y } (CSS px in the canvas)
    this.dir = new THREE.Vector3();
    this.build();
    addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyM' && document.getElementById('start').classList.contains('hidden')) { e.preventDefault(); this.toggle(!this.isOpen); }
      else if (e.code === 'Escape' && this.isOpen) this.toggle(false);
    });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  get names() { return this.app.ui?.s.mapNames !== false; }   // settings (ui.js), NAMES toggles it

  build() {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    const el = this.el = document.createElement('div');
    el.id = 'bigmap';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="frame" style="background:${this.info?.water || '#3a5c7a'}">
        <canvas aria-label="Map of Leonida"></canvas>
        <div class="bar">
          <span class="title">MAP</span><span class="where"></span><span class="sp"></span>
          <button data-a="names" title="Show or hide player and place names">NAMES</button>
          <button data-a="me" title="Back to you">ME</button>
          <button data-a="in" title="Zoom in">+</button><button data-a="out" title="Zoom out">&minus;</button>
          <button data-a="close">CLOSE</button>
        </div>
        <div class="way hidden"><span><b>&#9670;</b> Waypoint <span class="dist"></span></span>
          <button class="go" data-a="go">GO THERE</button><button data-a="clear">Clear</button></div>
        <div class="hint">Drag to move · scroll to zoom · click to drop a waypoint · M or Esc closes</div>
      </div>`;
    document.body.appendChild(el);
    this.cv = el.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.whereEl = el.querySelector('.where');
    this.wayEl = el.querySelector('.way');
    this.distEl = el.querySelector('.way .dist');
    this.closeBtn = el.querySelector('[data-a=close]');
    this.frameEl = el.querySelector('.frame');
    this.hintEl = el.querySelector('.hint');
    this.namesBtn = el.querySelector('[data-a=names]');
    const act = {
      names: () => this.app.ui?.setOption('mapNames', !this.names),
      me: () => this.centerOnMe(),
      in: () => this.zoomAt(1 / 1.6),
      out: () => this.zoomAt(1.6),
      close: () => this.toggle(false),
      go: () => this.go(),
      clear: () => { this.waypoint = null; },
    };
    el.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => act[b.dataset.a](); });
    // a click outside the map frame (on the dimmed edge) closes it too
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.toggle(false); });
    this.wireCanvas();
  }

  toggle(open) {
    if (open === this.isOpen) return;
    const p = this.app.player;
    if (open) {
      this.el.classList.remove('hidden');
      const touch = document.body.classList.contains('touch');
      this.closeBtn.textContent = touch ? 'CLOSE' : 'CLOSE (M)';
      this.hintEl.textContent = touch ? 'Drag to move · pinch to zoom · tap to drop a waypoint'
        : 'Drag to move · scroll to zoom · click to drop a waypoint · M or Esc closes';
      // your character waits (keys let go) and the cursor comes back for dragging
      this.wasEnabled = p.enabled;
      p.enabled = false;
      p.keys.clear(); p.analog.x = p.analog.y = 0;
      document.exitPointerLock?.();
      for (const k of this.keys) this.mini.tile(k[0], k[1]);   // start loading every tile
      this.centerOnMe();
      this.mpp = OPEN_MPP;
    } else {
      this.el.classList.add('hidden');
      this.pointers.clear();
      // let the big pictures go (the 12 m overview stays)
      this.mips.clear();
      for (const t of this.his.values()) t.src = '';
      this.his.clear();
      p.enabled = this.wasEnabled ?? true;
      // back to steering with the mouse (not on a phone, or with the P panel still open)
      const panel = !document.getElementById('admin').classList.contains('hidden');
      if (p.enabled && !panel && !document.body.classList.contains('touch')) this.app.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    }
  }

  // where you are: the body (walk / drive / plane) or the camera (fly)
  me() {
    const p = this.app.player;
    let q = this.app.camera.position;
    if (p.mode === 'walk') q = p.walker.pos;
    else if (p.mode === 'drive' && p.car) q = p.car.group.position;
    else if (p.mode === 'plane' && p.plane) q = p.plane.pos;
    return { x: q.x, y: -q.z };
  }

  centerOnMe() { const m = this.me(); this.cx = m.x; this.cy = m.y; }

  // fly to the waypoint: a plane relaunches over it, anything else switches to Fly, 200 m short of it
  // and 120 m up, looking at it
  go() {
    const w = this.waypoint;
    if (!w) return;
    const app = this.app, p = app.player;
    const g = Math.max(app.world.heightAt(w.x, w.y), 0);
    if (p.mode === 'plane' && p.plane) {
      p.plane.launch(new THREE.Vector3(w.x, g + 150, -w.y), p.plane.yaw);
      p.yaw = p.plane.yaw; p.pitch = -0.08;
    } else {
      const me = this.me();
      const hd = Math.atan2(w.x - me.x, w.y - me.y);   // clockwise from north, from you toward it
      p.setMode('fly');
      p.placeAt(w.x - Math.sin(hd) * 200, w.y - Math.cos(hd) * 200, g + 120, THREE.MathUtils.radToDeg(hd), -30);
    }
    app.ui.refresh();
    this.toggle(false);
  }

  zoomAt(f, px, py) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (px === undefined) { px = w / 2; py = h / 2; }
    const mx = this.cx + (px - w / 2) * this.mpp, my = this.cy - (py - h / 2) * this.mpp;
    const max = Math.max((this.x1 - this.x0) / w, (this.y1 - this.y0) / h) * 1.15;
    this.mpp = Math.min(Math.max(this.mpp * f, 0.6), max);
    this.cx = mx - (px - w / 2) * this.mpp;
    this.cy = my + (py - h / 2) * this.mpp;
    this.clampView();
  }

  clampView() {
    this.cx = Math.min(Math.max(this.cx, this.x0), this.x1);
    this.cy = Math.min(Math.max(this.cy, this.y0), this.y1);
  }

  toMap(px, py) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    return { x: this.cx + (px - w / 2) * this.mpp, y: this.cy - (py - h / 2) * this.mpp };
  }

  toScreen(x, y) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    return [w / 2 + (x - this.cx) / this.mpp, h / 2 - (y - this.cy) / this.mpp];
  }

  wireCanvas() {
    const cv = this.cv;
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let moved = 0, pinch = null;
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
      this.pointers.set(e.pointerId, at(e));
      if (this.pointers.size === 1) moved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mpp: this.mpp };
        moved = 99;   // a pinch is never a tap
      }
      cv.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      const q = at(e);
      if (!this.pointers.has(e.pointerId)) { this.hover(q); return; }
      const last = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, q);
      if (this.pointers.size === 1) {
        moved += Math.hypot(q.x - last.x, q.y - last.y);
        this.cx -= (q.x - last.x) * this.mpp;
        this.cy += (q.y - last.y) * this.mpp;
        this.clampView();
      } else if (this.pointers.size === 2 && pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 10) this.zoomAt((pinch.mpp * pinch.d / d) / this.mpp, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const q = at(e);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
      if (!this.pointers.size) cv.classList.remove('drag');
      // a tap: drop the waypoint there (or pick it up again if you tap it)
      if (e.type === 'pointerup' && !this.pointers.size && moved < 6) {
        if (this.waypoint) {
          const [wx, wy] = this.toScreen(this.waypoint.x, this.waypoint.y);
          if (Math.hypot(wx - q.x, wy - q.y) < 16) { this.waypoint = null; return; }
        }
        this.waypoint = this.toMap(q.x, q.y);
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.pointers.size) this.whereEl.textContent = ''; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const q = at(e);
      this.zoomAt(Math.pow(1.2, e.deltaY / 100), q.x, q.y);
    }, { passive: false });
  }

  // what's under the cursor: the area and how far from you
  hover(q) {
    const m = this.toMap(q.x, q.y), me = this.me();
    const d = Math.hypot(m.x - me.x, m.y - me.y);
    this.whereEl.textContent = `${this.area(m.x, m.y)} · ${fmtDist(d)} from you`;
  }

  area(x, y) {
    if (y < -4000) return 'The Keys';
    let best = null, bd = 2500;
    for (const l of this.labels) { const d = Math.hypot(x - l.x, y - l.y); if (d < bd) { bd = d; best = l.n; } }
    return best || 'Leonida';
  }

  // every frame: the waypoint clears when you reach it; the map redraws while it's open
  update() {
    if (this.waypoint) {
      const me = this.me();
      if (Math.hypot(me.x - this.waypoint.x, me.y - this.waypoint.y) < ARRIVE && !this.isOpen) this.waypoint = null;
    }
    if (!this.isOpen) return;
    this.wayEl.classList.toggle('hidden', !this.waypoint);
    this.frameEl.classList.toggle('way-on', !!this.waypoint);
    this.namesBtn.classList.toggle('on', this.names);
    if (this.waypoint) {
      const me = this.me();
      this.distEl.textContent = fmtDist(Math.hypot(me.x - this.waypoint.x, me.y - this.waypoint.y));
    }
    this.draw();
  }

  // the zoomed-out picture: each tile drawn in once it has loaded
  overview() {
    if (!this.ov) {
      const c = document.createElement('canvas');
      c.width = Math.ceil((this.x1 - this.x0) / OV_RES); c.height = Math.ceil((this.y1 - this.y0) / OV_RES);
      const g = c.getContext('2d');
      g.fillStyle = this.info.water; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = 'high';
      this.ov = c;
    }
    if (this.ovDone.size < this.keys.length) {
      const g = this.ov.getContext('2d'), s = this.C / OV_RES;
      for (const [i, j] of this.keys) {
        const key = `${i}_${j}`;
        if (this.ovDone.has(key)) continue;
        const t = this.mini.tile(i, j);
        if (!t) continue;
        // 1024 -> 512 -> 256 -> ~171 px, through two scratch canvases
        this.tmpA = halve(t, 512, this.tmpA);
        this.tmpB = halve(this.tmpA, 256, this.tmpB);
        g.drawImage(this.tmpB, (i - this.i0) * s, (j - this.j0) * s, s, s);
        this.ovDone.add(key);
      }
    }
    return this.ov;
  }

  // the picture of tile i, j for this many metres per device pixel (null while it loads)
  pic(i, j, dmpp) {
    const key = `${i}_${j}`, base = this.mini.tile(i, j);   // 2 m
    if (dmpp < 1) return this.hi(key) || base;
    if (!base || dmpp < 2.8) return base;
    let m = this.mips.get(key);
    if (!m) this.mips.set(key, m = { m4: halve(base, 512) });
    if (dmpp < 5.6) return m.m4;
    return m.m8 ||= halve(m.m4, 256);
  }

  // a 1 m tile, loaded when first wanted; the least recently drawn go past HI_KEEP
  hi(key) {
    let t = this.his.get(key);
    if (t) this.his.delete(key);
    else {
      t = new Image();
      t.decoding = 'async';
      t.src = `${HI}mm_${key}.webp`;
      if (this.his.size >= HI_KEEP) {
        const old = this.his.keys().next().value;
        this.his.get(old).src = '';
        this.his.delete(old);
      }
    }
    this.his.set(key, t);   // newest last
    return t.complete && t.naturalWidth ? t : null;
  }

  draw() {
    const cv = this.cv, ctx = this.ctx, dpr = Math.min(devicePixelRatio || 1, DPR_MAX);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h || !this.info) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.info.water;
    ctx.fillRect(0, 0, w, h);
    const k = 1 / this.mpp;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const ov = this.overview();
    // the 12 m overview everywhere (all there is zoomed out; under any tile still loading closer in),
    // then the tiles in view at the detail this zoom needs
    const [ox, oy] = this.toScreen(this.x0, this.y1);
    ctx.drawImage(ov, ox, oy, (this.x1 - this.x0) * k, (this.y1 - this.y0) * k);
    const dmpp = this.mpp / dpr;
    if (dmpp < OV_RES * 0.92) {
      const C = this.C, snap = (v) => Math.round(v * dpr) / dpr;   // edges on device pixels: no seams
      for (const [i, j] of this.keys) {
        const [sx, sy] = this.toScreen(this.west + i * C, this.north - j * C);
        const s = C * k;
        if (sx > w || sy > h || sx + s < 0 || sy + s < 0) continue;
        const t = this.pic(i, j, dmpp);
        if (!t) continue;
        const x0 = snap(sx), y0 = snap(sy);
        ctx.drawImage(t, x0, y0, snap(sx + s) - x0, snap(sy + s) - y0);
      }
    }
    const names = this.names;
    // area names
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${this.mpp > 14 ? 11 : 13}px system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    const placed = [];
    for (const l of names ? this.labels : []) {
      const [sx, sy] = this.toScreen(l.x, l.y);
      if (sx < -80 || sx > w + 80 || sy < -20 || sy > h + 20) continue;
      const t = l.n.toUpperCase();
      const half = ctx.measureText(t).width / 2 + 4, box = [sx - half, sy - 9, sx + half, sy + 9];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'; ctx.strokeText(t, sx, sy);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'; ctx.fillText(t, sx, sy);
    }
    // everyone else: a dot, and their name beside it
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (const d of this.mini.dots()) {
      const [sx, sy] = this.toScreen(d.x, d.y);
      if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = d.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'; ctx.stroke();
      if (d.n && names) {
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'; ctx.strokeText(d.n, sx + 10, sy);
        ctx.fillStyle = '#fff'; ctx.fillText(d.n, sx + 10, sy);
      }
    }
    // the waypoint: a yellow pin
    if (this.waypoint) {
      const [sx, sy] = this.toScreen(this.waypoint.x, this.waypoint.y);
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx - 8, sy - 14); ctx.arc(sx, sy - 18, 9, Math.PI * 0.82, Math.PI * 0.18); ctx.closePath();
      ctx.fillStyle = WAY_COLOR; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy - 18, 3.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fill();
    }
    // you: a white arrow pointing the way you face
    const me = this.me();
    const [mx, my] = this.toScreen(me.x, me.y);
    this.app.camera.getWorldDirection(this.dir);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.atan2(this.dir.x, -this.dir.z));
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8.5, 9); ctx.lineTo(0, 4.5); ctx.lineTo(-8.5, 9); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'; ctx.stroke();
    ctx.restore();
    // scale bar, bottom right
    const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const len = steps.find((s) => s * k >= 70) || steps[steps.length - 1];
    const bw = len * k, bx = w - 16 - bw, by = h - 22;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(bx - 8, by - 18, bw + 16, 28);
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, bw, 3);
    ctx.fillRect(bx, by - 5, 2, 8); ctx.fillRect(bx + bw - 2, by - 5, 2, 8);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx + bw / 2, by - 9);
    // north
    ctx.beginPath(); ctx.arc(w - 26, 70, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText('N', w - 26, 70.5);
  }
}

// a smoothed, smaller copy of a picture (n x n), into `into` if given (reused scratch canvases)
function halve(src, n, into = null) {
  const c = into || document.createElement('canvas');
  if (c.width !== n) { c.width = c.height = n; }
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, n, n);
  g.drawImage(src, 0, 0, n, n);
  return c;
}

const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`);
