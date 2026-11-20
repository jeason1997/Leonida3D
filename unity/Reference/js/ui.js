// Start menu, admin panel (P) and HUD - the same options as the Unreal build. Settings are kept in
// localStorage (per browser); resolution (render scale) and display mode wait for APPLY.
import { isTyping } from './chat.js';
import { hasSlur } from './chatfilter.js';

export const QUALITY = {
  Low:    { pr: 1.0, shadow: 0,    range: 0,   draw: 4000,  treeR: 120, shrubR: 60,  grassR: 0,  farR: 2000, near: 1800, maxTrees: 800 },
  Medium: { pr: 1.0, shadow: 1024, range: 180, draw: 6000,  treeR: 180, shrubR: 100, grassR: 35, farR: 3000, near: 2200, maxTrees: 1200 },
  High:   { pr: 1.5, shadow: 2048, range: 250, draw: 9000,  treeR: 250, shrubR: 140, grassR: 60, farR: 3500, near: 2600, maxTrees: 2000 },
  Ultra:  { pr: 2.0, shadow: 4096, range: 350, draw: 14000, treeR: 350, shrubR: 200, grassR: 90, farR: 5000, near: 3500, maxTrees: 2500 },
};
const SCALES = [0.5, 0.67, 0.75, 1.0];
const DISPLAYS = ['Windowed', 'Fullscreen'];

// Player names: the same rules as worker/index.js cleanName (letters, digits, space, _ . - ',
// 2-16 characters, nothing that passes for the dev).
const RESERVED = /^(dev|devs|admin|administrator|developer|moderator|mod|staff|owner|system|server|jadondev)$/;
export function cleanName(n) {
  return String(n ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
}
function nameProblem(raw) {
  const n = cleanName(raw);
  if (n.length < 2) return 'Pick a name to play: 2-16 letters or numbers.';
  if (RESERVED.test(n.toLowerCase().replace(/[^\p{L}]/gu, ''))) return "That name is kept for the dev - pick another.";
  if (hasSlur(n)) return "That name isn't allowed - pick another.";
  return '';
}

function load() {
  try { return JSON.parse(localStorage.getItem('leonida-settings')) || {}; } catch { return {}; }
}
function save(s) {
  try { localStorage.setItem('leonida-settings', JSON.stringify(s)); } catch { /* private mode: fine */ }
}

export class UI {
  constructor(app) {
    this.app = app;
    this.touch = document.body.classList.contains('touch');   // phone / tablet (touch.js)
    // phones start on Low (no shadows, waves or wall details); a saved choice wins
    this.s = Object.assign({ quality: this.touch ? 'Low' : 'High', scale: 1.0, display: 'Windowed', trees: true, tags: true, aa: this.touch ? 'msaa' : 'smaa', chat: true, mapNames: true, minimap: true, invert: false, cmp: {}, cmpOp: 0.7 }, load());
    this.panels = [];
    for (const host of document.querySelectorAll('.settings')) this.panels.push(this.buildSettings(host));
    this.applyAll();
    const admin = document.getElementById('admin');
    document.getElementById('close').onclick = () => this.togglePanel(false);
    for (const b of document.querySelectorAll('#modes button')) b.onclick = () => { app.player.setMode(b.dataset.mode); this.refresh(); };
    // cars: everyone can drive the normal car or the Bugatti (2026-11-01, was the dev's only); B gets you into the Bugatti
    for (const b of document.querySelectorAll('#cars button')) b.onclick = () => { app.player.spawnCar(b.dataset.car); this.refresh(); };
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyB' && !isTyping(e) && document.getElementById('start').classList.contains('hidden')) { app.player.spawnCar('bugatti'); this.refresh(); }
    });
    // the dev's own car (Khronos' Car Concept): spectator (#admin=) only; N gets you in
    if (app.live.admin) {
      document.getElementById('devcars').classList.remove('hidden');
      for (const b of document.querySelectorAll('#devcars button')) b.onclick = () => { app.player.spawnCar(b.dataset.car); this.refresh(); };
      addEventListener('keydown', (e) => {
        if (e.code === 'KeyN' && !isTyping(e) && document.getElementById('start').classList.contains('hidden')) { app.player.spawnCar('concept'); this.refresh(); }
      });
    }
    const time = document.getElementById('time');
    time.oninput = () => { app.day.setHour(+time.value); this.refresh(); };
    const tp = document.getElementById('teleports');
    for (const t of app.world.m.teleports) {
      const b = document.createElement('button');
      b.className = 'wide'; b.textContent = t.name;
      b.onclick = () => { app.player.setMode('fly'); app.player.placeAt(t.x, t.y, t.z, t.heading, t.pitch); this.refresh(); };
      tp.appendChild(b);
    }
    const inv = document.getElementById('invert');
    inv.onclick = () => { this.s.invert = !this.s.invert; save(this.s); this.applyAll(); this.refresh(); };
    addEventListener('keydown', (e) => {
      // P toggles the panel once the start menu is gone
      if (e.code === 'KeyP' && !isTyping(e) && document.getElementById('start').classList.contains('hidden')) this.togglePanel(admin.classList.contains('hidden'));
    });
    // Your name (players only; the spectator is DEV): remembered in this browser, checked like the
    // worker's cleanName before PLAY.
    const nameEl = document.getElementById('name'), nameNote = document.getElementById('name-note');
    if (app.live.admin) document.getElementById('name-box').classList.add('hidden');
    else {
      try { nameEl.value = localStorage.getItem('leonida-name') || ''; } catch { /* private mode */ }
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); play(); } });
      nameEl.addEventListener('input', () => { nameEl.classList.remove('bad'); nameNote.textContent = ''; });
      if (!nameEl.value) nameEl.focus();
    }
    if (this.touch) {
      document.getElementById('close').textContent = 'Close';
      // PLAY first on a short screen: the settings go to the end of the start menu
      const st = document.querySelector('#start .settings');
      st.parentNode.append(st);
    }
    const play = () => {
      if (!app.live.admin) {
        const problem = nameProblem(nameEl.value);
        if (problem) { nameNote.textContent = problem; nameEl.classList.add('bad'); nameEl.focus(); return; }
        app.live.name = cleanName(nameEl.value);
        try { localStorage.setItem('leonida-name', app.live.name); } catch { /* private mode */ }
      }
      // Anonymous start count (worker/index.js logs it to D1): graphics preset, trees, touch device.
      // The incognito spectator (live.js) isn't counted and doesn't report a position.
      if (!app.live.admin) {
        try {
          navigator.sendBeacon('/api/play', JSON.stringify({ q: this.s.quality, trees: this.s.trees, m: matchMedia('(pointer: coarse)').matches }));
        } catch (e) { /* counting never blocks playing */ }
        app.live.start();
      }
      document.getElementById('start').classList.add('hidden');
      app.player.enabled = true;
      if (this.touch) {
        // full screen and sideways where the phone allows it (Android; iPhones keep the browser bars)
        document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
          ?.then(() => screen.orientation?.lock?.('landscape'))?.catch?.(() => {});
      } else app.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    };
    document.getElementById('play').onclick = play;
    this.refresh();
  }

  togglePanel(open) {
    document.getElementById('admin').classList.toggle('hidden', !open);
    if (open) document.exitPointerLock?.();
    this.refresh();
  }

  buildSettings(host) {
    const s = this.s;
    const pending = { scale: s.scale, display: s.display, baseScale: s.scale, baseDisplay: s.display };
    host.innerHTML = `
      <div class="label">GRAPHICS</div>
      <div class="row q">${Object.keys(QUALITY).map((q) => `<button data-q="${q}">${q}</button>`).join('')}</div>
      <div class="label">RESOLUTION (render scale)</div>
      <div class="cycle"><button class="l1">&lt;</button><span class="v1"></span><button class="r1">&gt;</button></div>
      <div class="label">DISPLAY</div>
      <div class="cycle"><button class="l2">&lt;</button><span class="v2"></span><button class="r2">&gt;</button></div>
      <div class="row" style="margin-top:8px"><span class="note"></span><button class="apply" style="flex:0 0 90px">APPLY</button></div>
      <div class="label">ANTI-ALIASING</div>
      <div class="row aa"><button data-aa="msaa">MSAA</button><button data-aa="smaa">MSAA + SMAA</button></div>
      <div class="label">TREES AND BUSHES</div>
      <div class="row t"><button data-t="1">Show</button><button data-t="0">Hide</button></div>
      <div class="label">NAMETAGS</div>
      <div class="row g"><button data-g="1">Show</button><button data-g="0">Hide</button></div>
      <div class="label">CHAT</div>
      <div class="row ch"><button data-ch="1">Show</button><button data-ch="0">Hide</button></div>
      <div class="label">MINIMAP</div>
      <div class="row mm"><button data-mm="1">Show</button><button data-mm="0">Hide</button></div>
      <div class="label">COMPARE MAP SIZE (to scale)</div>
      <div class="row c"><button data-c="gta5">GTA V map</button><button data-c="rdr2">RDR2 map</button></div>
      <div class="row cop-row"><span class="note" style="color:var(--muted);flex:0 0 auto">Opacity</span><input class="cop" type="range" min="0.15" max="1" step="0.05"></div>`;
    const $ = (q) => host.querySelector(q);
    host.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { s.quality = b.dataset.q; save(s); this.applyAll(); this.refresh(); });
    host.querySelectorAll('[data-aa]').forEach((b) => b.onclick = () => { s.aa = b.dataset.aa; save(s); this.applyAll(); this.refresh(); });
    host.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { s.trees = b.dataset.t === '1'; save(s); this.applyAll(); this.refresh(); });
    host.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { s.tags = b.dataset.g === '1'; save(s); this.applyAll(); this.refresh(); });
    host.querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => this.setOption('chat', b.dataset.ch === '1'));
    host.querySelectorAll('[data-mm]').forEach((b) => b.onclick = () => this.setMinimap(b.dataset.mm === '1'));
    host.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
      s.cmp = { ...s.cmp, [b.dataset.c]: !s.cmp?.[b.dataset.c] };
      save(s); this.applyAll(); this.refresh();
    });
    $('.cop').oninput = (e) => { s.cmpOp = +e.target.value; save(s); this.applyAll(); this.refresh(); };
    const step = (arr, v, d) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    $('.l1').onclick = () => { pending.scale = step(SCALES, pending.scale, -1); this.refresh(); };
    $('.r1').onclick = () => { pending.scale = step(SCALES, pending.scale, 1); this.refresh(); };
    $('.l2').onclick = () => { pending.display = step(DISPLAYS, pending.display, -1); this.refresh(); };
    $('.r2').onclick = () => { pending.display = step(DISPLAYS, pending.display, 1); this.refresh(); };
    $('.apply').onclick = () => {
      s.scale = pending.scale; s.display = pending.display;
      pending.baseScale = s.scale; pending.baseDisplay = s.display;
      save(s); this.applyAll(true); this.refresh();
    };
    return { host, pending };
  }

  // a setting changed from elsewhere (the map window's NAMES), or a simple Show / Hide row
  setOption(k, v) {
    this.s[k] = v;
    save(this.s);
    this.applyAll();
    this.refresh();
  }

  // the settings buttons
  setMinimap(on) {
    this.s.minimap = on;
    save(this.s);
    this.applyAll();
    this.refresh();
  }

  applyAll(display = false) {
    const app = this.app, s = this.s, q = QUALITY[s.quality] || QUALITY.High;
    const dpr = Math.min(devicePixelRatio || 1, q.pr) * s.scale;
    app.renderer.setPixelRatio(dpr);
    app.aa?.setMode(s.aa);   // after the pixel ratio: the SMAA target follows the drawing-buffer size
    app.day.setShadowQuality(q.shadow, q.range);
    app.day.drawDistance = q.draw;
    app.camera.far = q.draw * 1.6;
    app.camera.updateProjectionMatrix();
    app.world.nearRadius = q.near;
    Object.assign(app.veg.settings, { treeR: q.treeR, shrubR: q.shrubR, grassR: q.grassR, farR: Math.min(q.farR, q.draw),
      maxTrees: q.maxTrees, maxShrubs: q.maxTrees * 1.5, maxGrass: q.maxTrees * 3, shadows: q.shadow >= 2048 });
    app.veg.setHidden(!s.trees);
    app.ocean?.setEnabled(s.quality !== 'Low');   // real waves from Medium up
    // roof shapes / parapets / rooftop units from Medium up; balconies, ledges, fins on the walls High / Ultra
    app.world.setDetails(s.quality !== 'Low', s.quality === 'High' || s.quality === 'Ultra');
    app.minimap?.setEnabled(s.minimap !== false);
    app.tagsHidden = !s.tags;   // players' and the dev's nametags (avatar.js), spectator markers (live.js)
    app.live.chat?.setHidden?.(s.chat === false);   // players' chat (the spectator's panel chat stays)
    app.compare.setOpacity(s.cmpOp ?? 0.7);
    for (const id of ['gta5', 'rdr2']) if (!!s.cmp?.[id] !== !!app.compare.on[id]) app.compare.set(id, !!s.cmp?.[id]);
    app.player.invertY = s.invert;
    if (display) {
      if (s.display === 'Fullscreen' && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (s.display === 'Windowed' && document.fullscreenElement) document.exitFullscreen?.();
    }
  }

  refresh() {
    const s = this.s, app = this.app;
    for (const { host, pending } of this.panels) {
      host.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === s.quality));
      host.querySelectorAll('[data-aa]').forEach((b) => b.classList.toggle('on', b.dataset.aa === (s.aa === 'msaa' ? 'msaa' : 'smaa')));
      host.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', (b.dataset.t === '1') === s.trees));
      host.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', (b.dataset.g === '1') === s.tags));
      host.querySelectorAll('[data-ch]').forEach((b) => b.classList.toggle('on', (b.dataset.ch === '1') === (s.chat !== false)));
      host.querySelectorAll('[data-mm]').forEach((b) => b.classList.toggle('on', (b.dataset.mm === '1') === (s.minimap !== false)));
      host.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', !!s.cmp?.[b.dataset.c]));
      host.querySelector('.cop').value = s.cmpOp ?? 0.7;
      host.querySelector('.v1').textContent = `${Math.round(pending.scale * 100)} %`;
      host.querySelector('.v2').textContent = pending.display;
      const dirty = pending.scale !== pending.baseScale || pending.display !== pending.baseDisplay;
      host.querySelector('.note').textContent = dirty ? 'Not applied yet' : '';
      const ap = host.querySelector('.apply');
      ap.disabled = !dirty; ap.classList.toggle('on', dirty);
    }
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === app.player.mode);
    for (const b of document.querySelectorAll('#cars button, #devcars button')) b.classList.toggle('on', app.player.mode === 'drive' && app.player.car?.kind === b.dataset.car);
    const h = app.day.hour;
    document.getElementById('time').value = h;
    document.getElementById('clock').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    document.getElementById('invert').textContent = `Invert ${this.touch ? 'look' : 'mouse'} Y: ${s.invert ? 'ON' : 'off'}`;
  }

  hud() {
    const p = this.app.player;
    const info = this.app.live.hudInfo;
    const pi = p.mode === 'plane' ? p.planeInfo : null;
    // the plane: speed, height, throttle, or what's wrong
    const plane = pi && (pi.crashed ? 'PLANE   CRASHED - back in the air in a moment'
      : `PLANE   ${pi.kmh.toFixed(0).padStart(3)} km/h   ${pi.alt.toFixed(0)} m   throttle ${Math.round(pi.thr * 100)}%`
        // low down: how fast it's sinking (to land: under 6 m/s, under 270 km/h, wings level)
        + (pi.ground ? '   on the ground' : pi.alt < 120 ? `   ${pi.vs < 0 ? '▼' : '▲'} ${Math.abs(pi.vs).toFixed(1)} m/s` : '')
        + (pi.stall ? '   STALL - speed up / nose down' : ''));
    if (this.touch) {   // the buttons say the rest (touch.js)
      const v = plane || (p.mode === 'walk' ? 'WALK' : `${p.mode === 'drive' ? 'DRIVE' : 'FLY'}   ${p.speedKmh.toFixed(0)} km/h`);
      document.getElementById('hud').textContent = info ? `${v}
${info}` : v;
      return;
    }
    const chat = this.app.live.chatOn && !this.app.live.chat?.hidden;
    const hint = (chat ? 'P: admin panel   M: map   T: chat' : 'P: admin panel   M: map') + (info ? `        ${info}` : '');
    let t;
    if (p.mode === 'walk') t = `WALK      WASD + mouse   Shift sprint   Space jump        ${hint}`;
    else if (plane) t = `${plane}      mouse aim   W/S throttle   A/D turn   Space brakes   Backspace restart in the air        ${hint}`;
    else if (p.mode === 'drive') t = `DRIVE   ${p.speedKmh.toFixed(0).padStart(3)} km/h      W/S gas/brake   A/D steer   Space handbrake   Backspace reset        ${hint}`;
    else t = `FLY   ${p.speedKmh.toFixed(0).padStart(4)} km/h   (cruise ${(p.flySpeed * 3.6).toFixed(0)}: mouse wheel, Shift x4)      WASD + mouse   E/Q up/down        ${hint}`;
    document.getElementById('hud').textContent = t;
  }
}
