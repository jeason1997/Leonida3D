// Live multiplayer (worker/index.js, /api/live). Players: after PLAY, your camera and body (feet, or
// the car, with velocity) go to the site up to 5 times a second, with the name you picked; you see
// everyone else as a character (avatar.js, their own colour, a nametag you can see from anywhere on the
// map) and chat with them (chat.js: T, Tab = the dev only).
// Spectator: open the site as  /#admin=<a dev's key, worker DEVS>  - you send no position and don't count as a play,
// so nobody can tell you're there until you write. You get a list of who's playing and where, a marker
// and character for each one, Go (fly to them), Watch (ride along with their camera and time of day),
// all chat (you answer one of them or everyone) and "Show me to players": your character walks /
// flies / drives in everyone's world, tagged with your dev name (DEV, Jadon - Dev ...), while it's on. Devs
// see each other's characters too.
import * as THREE from 'three';
import { PlayerChat, AdminChat, isTyping, playerColor, DEV_NAME, DEV_COL } from './chat.js';
import { Avatar } from './avatar.js';
import { areaName } from './areas.js';

export { areaName };
const MODE_COL = { fly: '#5bb4ff', walk: '#7ee07e', drive: '#ffb347' };

// Where your body is, in map coords: feet when walking / flying, the car when driving; with its
// velocity (m/s) so others can run it on between updates.
function bodyState(app) {
  const pl = app.player, rd = THREE.MathUtils.radToDeg, norm = (h) => ((h % 360) + 360) % 360;
  if (pl.mode === 'drive' && pl.car) {
    const p = pl.car.group.position, hd = pl.car.heading, v = pl.car.speed;
    // k: which car (the normal one is left out; the worker passes on 'bugatti' for anyone)
    return { x: p.x, y: -p.z, z: p.y, h: norm(90 - rd(hd)), pt: rd(pl.car.pitch || 0), vx: Math.cos(hd) * v, vy: Math.sin(hd) * v, m: 'drive',
      ...(pl.car.kind !== 'car' ? { k: pl.car.kind } : {}) };
  }
  if (pl.mode === 'plane' && pl.plane) {
    // rl: bank; c: crashed (others see the plane go)
    const p = pl.plane.pos, v = pl.plane.vel;
    return { x: p.x, y: -p.z, z: p.y, h: norm(-rd(pl.plane.yaw)), pt: rd(pl.plane.pitch), rl: rd(pl.plane.roll), vx: v.x, vy: -v.z, m: 'plane',
      ...(pl.plane.crashed ? { c: 1 } : {}) };
  }
  const v = pl.vel;
  if (pl.mode === 'walk') {
    const p = pl.walker.pos;
    return { x: p.x, y: -p.z, z: p.y, h: norm(-rd(pl.yaw)), pt: 0, vx: v.x, vy: -v.z, m: 'walk' };
  }
  const c = app.camera.position;
  return { x: c.x, y: -c.z, z: c.y - 1.65, h: norm(-rd(pl.yaw)), pt: 0, vx: v.x, vy: -v.z, m: 'fly' };
}

// send again? moved, turned, changed speed (so a stop goes out at once) or mode
// screen effects for punches: 'mark' = the hit marker on the crosshair (a punch you landed), 'hurt' = a red
// flash round the edges (one landed on you)
function fx(kind) {
  let el = document.getElementById(`fx-${kind}`);
  if (!el) {
    if (!document.getElementById('fx-css')) {
      const css = document.createElement('style');
      css.id = 'fx-css';
      css.textContent = `#fx-mark, #fx-hurt { position: fixed; pointer-events: none; opacity: 0; z-index: 30; }
        #fx-mark { left: 50%; top: 50%; width: 30px; height: 30px; margin: -15px 0 0 -15px; }
        #fx-mark::before, #fx-mark::after { content: ''; position: absolute; left: 13px; top: -2px; width: 4px; height: 34px;
          background: #fff; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,0.6); transform: rotate(45deg); }
        #fx-mark::after { transform: rotate(-45deg); }
        #fx-mark.on { animation: fx-mark 0.32s ease-out; }
        @keyframes fx-mark { 0% { opacity: 1; transform: scale(1.5); } 100% { opacity: 0; transform: scale(0.85); } }
        #fx-hurt { inset: 0; background: radial-gradient(ellipse at center, transparent 40%, rgba(210, 20, 20, 0.6) 100%); }
        #fx-hurt.on { animation: fx-hurt 0.55s ease-out; }
        @keyframes fx-hurt { 0% { opacity: 1; } 100% { opacity: 0; } }`;
      document.head.appendChild(css);
    }
    el = document.createElement('div');
    el.id = `fx-${kind}`;
    document.body.appendChild(el);
  }
  el.classList.remove('on');
  void el.offsetWidth;   // restart the animation
  el.classList.add('on');
}

function changed(b, L) {
  return Math.hypot(b.x - L.x, b.y - L.y, b.z - L.z) > 0.05 || Math.abs(((b.h - L.h + 540) % 360) - 180) > 1
    || Math.hypot(b.vx - L.vx, b.vy - L.vy) > 0.5 || b.m !== L.m || b.k !== L.k
    || Math.abs((b.rl || 0) - (L.rl || 0)) > 3 || Math.abs(b.pt - L.pt) > 2 || b.c !== L.c;
}

// write a DOM property only when it changes (renderList runs several times a second)
const set = (o, k, v) => { if (o[k] !== v) o[k] = v; };


export class Live {
  constructor(app) {
    this.app = app;
    const m = location.hash.match(/admin=([^&]+)/);
    this.adminKey = m ? decodeURIComponent(m[1]) : null;
    // pasting the #admin= link into a tab that already has the site only changes the hash (no reload),
    // so the key would never be read: reload when it comes or goes
    window.addEventListener('hashchange', () => {
      const k = location.hash.match(/admin=([^&]+)/);
      if ((k ? decodeURIComponent(k[1]) : null) !== this.adminKey) location.reload();
    });
    this.admin = !!this.adminKey;
    this.ws = null;
    this.tries = 0;
    this.last = { t: 0, x: 0, y: 0, z: 0, h: 0, m: '', hr: 0, b: { x: 0, y: 0, z: 0, h: 0, vx: 0, vy: 0, m: '' } };
    this.players = new Map();   // admin: id -> { since, p, marker, avatar }
    this.watching = null;
    this.showing = false;   // spectator: your character is in players' worlds
    this.lastMe = { t: 0, x: 0, y: 0, z: 0, h: 0, vx: 0, vy: 0, m: '' };
    this.devAvatars = new Map();   // dev number -> Avatar: the devs' characters once they show up (a dev: the others')
    this.myDev = 0;         // spectator: which dev you are (worker DEVS) ...
    this.devInfo = null;    // ... and every dev's { n: name, c: colour }, from the server
    this.others = new Map();   // player: id -> Avatar of everyone else
    this.myId = null;
    this.name = null;          // player: the name picked on the start menu (ui.js)
    if (this.admin) this.buildAdmin();
    else this.chat = new PlayerChat(this);
  }

  // T: chat in the HUD once there's someone to talk to
  get chatOn() { return this.admin || this.chat.on; }

  // HUD: who you are and how many others are here
  get hudInfo() {
    if (this.admin || !this.myId) return '';
    const n = this.others.size;
    return `You are ${this.name || `#${this.myId}`} · ${n ? `${n} other${n > 1 ? 's' : ''} playing` : 'nobody else here yet'}`;
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  // your punch (player.js punch(), walking), with where you are and face right now: the server works out who it
  // lands on (worker punch()). The dev punches with its character out (Show me to players).
  punch() {
    if (this.admin && !this.showing) return;
    this.send({ t: 'pu', b: bodyState(this.app) });
  }

  // {t:'pu', id, hits}: a punch near you - the puncher's arm jabs, everyone it hit flinches with a POW, and a hit
  // you landed flashes a marker on your crosshair. A dev is '*dev<d>' (worker devId).
  punched(m) {
    const meId = this.admin ? `*dev${this.myDev}` : this.myId;
    const avatarOf = (id) => (String(id).startsWith('*dev') ? this.devAvatars.get(+String(id).slice(4))
      : this.admin ? this.players.get(id)?.avatar : this.others.get(id));
    if (m.id !== meId) avatarOf(m.id)?.punch();
    for (const h of m.hits || []) {
      if (m.id === meId) fx('mark');
      if (h.id !== meId) avatarOf(h.id)?.knocked(h.dx, h.dy);
    }
  }

  // {t:'hit'}: a punch landed on you
  gotHit(m) {
    this.app.player.knock(m.dx, m.dy);
    fx('hurt');
    const t = `${m.n || 'Someone'} punched you!`;
    if (this.admin) this.chat.note(t); else this.chat.sys(t);
  }

  // ---------------------------------------------------------------- connection
  url() {
    const u = new URL('/api/live', location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.searchParams.set('v', '2');   // this page shows other players (older pages don't)
    return u.href;
  }

  // the spectator's key goes once, in a request body, for a one-use ticket - never in the socket's URL (URLs end
  // up in server / proxy logs; worker ticket()). null = try again later, false = the key was turned away.
  async ticket() {
    let res = null;
    try {
      res = await fetch('/api/live/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: this.adminKey }), cache: 'no-store' });
    } catch { return null; }
    if (res.status === 404) return false;
    return res.ok ? (await res.json().catch(() => null))?.ticket || null : null;
  }

  async start() {
    if (window.LEONIDA_OFFLINE) return;   // offline desktop build: the map is local, there is no live server
    if (this.ws || this.starting || this.kicked || !('WebSocket' in window)) return;
    let url = this.url();
    if (this.admin) {
      this.starting = true;
      const t = await this.ticket();
      this.starting = false;
      if (t === false) { this.status('key not accepted - check the link and reload'); return; }
      if (!t) {
        if (++this.tries <= 8) setTimeout(() => this.start(), Math.min(30000, 1000 * 2 ** this.tries));
        else this.status('no live server here');
        return;
      }
      const u = new URL(url);
      u.searchParams.set('ticket', t);
      url = u.href;
    }
    if (!this.admin) {
      // kicked a moment ago (this browser): don't knock again until it's over
      let until = 0;
      try { until = +localStorage.getItem('leonida-kicked') || 0; } catch { /* private mode */ }
      if (until > Date.now()) { this.showKicked(Math.ceil((until - Date.now()) / 60000)); return; }
    }
    let ws;
    try { ws = new WebSocket(url); } catch { return; }
    this.ws = ws;
    ws.onopen = () => {
      const first = !this.opened;   // false = back after a drop (e.g. the site was updated)
      this.opened = true;
      this.tries = 0; this.last.t = 0; this.lastMe.t = 0;   // a new socket: report again (also the character)
      // Report straight away, not from the render loop: a background tab draws no frames, and after
      // the site updates everyone reconnects - the tabs nobody is looking at must still show up.
      if (this.admin) {
        this.status('connected');
        if (this.showing) this.sendMe();
      } else {
        this.chat.on = true;
        if (this.name) this.send({ t: 'n', n: this.name, first });   // first, so others get it with your body
        this.sendPos();
      }
    };
    ws.onmessage = (e) => { if (this.admin) this.onAdminMessage(e.data); else this.onPlayerMessage(e.data); };
    ws.onclose = () => {
      this.ws = null;
      if (this.kicked) return;   // no reconnecting after a kick
      // the server sends all of it again after reconnecting
      for (const av of this.devAvatars.values()) av.set(null);
      for (const id of [...this.others.keys()]) this.dropOther(id);
      // (a wrong key is turned away at the ticket, above)
      if (this.admin) this.status('reconnecting…');
      // back off; give up quietly where there's no live server (e.g. a plain static preview)
      if (++this.tries <= 8) setTimeout(() => this.start(), Math.min(30000, 1000 * 2 ** this.tries));
      else if (this.admin) this.status('no live server here');
    };
  }

  onPlayerMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'c' && typeof m.s === 'string') this.chat.receive(m);
    else if (m.t === 'heard') this.chat.heard(m.n);
    else if (m.t === 'slow') this.chat.slow(m.s);
    else if (m.t === 'you') {
      // the dev censored your name (or it was one they'd censored before, or a slur)
      this.name = m.n;
      try { localStorage.removeItem('leonida-name'); } catch { /* private mode */ }
      this.chat.sys(m.why === 'slur' ? `That name isn't allowed - you're ${m.n}.` : `The dev changed your name to ${m.n}.`);
    } else if (m.t === 'kick') {
      try { localStorage.setItem('leonida-kicked', String(Date.now() + (m.mins || 10) * 60000)); } catch { /* private mode */ }
      this.showKicked(m.mins || 10);
      try { this.ws?.close(); } catch { /* already closed */ }
    }
    else if (m.t === 'o') this.other(m.id, m.b, m.n);
    else if (m.t === 'pu') this.punched(m);
    else if (m.t === 'hit') this.gotHit(m);
    else if (m.t === 'ox') this.dropOther(m.id);
    else if (m.t === 'hi') {
      this.myId = m.id;
      for (const id of [...this.others.keys()]) this.dropOther(id);
      for (const o of m.others || []) this.other(o.id, o.b, o.n);
      this.chat.history(m.chat);
    } else if (m.t === 'dev') this.devChar(m);
  }

  // {t:'dev', d, n, c, w, p}: dev d's character, under their name and colour (p = null: gone). Players get every
  // dev's, a dev the other devs'. Older servers sent only p (the owner).
  devChar(m) {
    const d = m.d || 0;
    let av = this.devAvatars.get(d);
    if (!av && m.p) this.devAvatars.set(d, (av = new Avatar(this.app, { name: m.n || DEV_NAME, color: m.c || DEV_COL })));
    if (!av) return;
    const was = av.shown;
    av.set(m.p);
    const who = d ? m.n : 'The dev', say = (t) => (this.admin ? this.chat.note(t) : this.chat.sys(t));
    if (!was && m.p) say(`${who} is here - look for the ${d ? `${m.w} tag` : `orange ${DEV_NAME} tag`}.`);
    else if (was && !m.p) say(`${who} left.`);
  }

  // kicked: everyone else disappears and the page stops connecting (you can still fly around alone)
  showKicked(mins) {
    this.kicked = true;
    this.chat.on = false;
    for (const av of this.devAvatars.values()) av.set(null);
    for (const id of [...this.others.keys()]) this.dropOther(id);
    if (document.getElementById('kicked')) return;
    const el = document.createElement('div');
    el.id = 'kicked';
    el.className = 'panel';
    el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);text-align:center;border:2px solid #d9534f;z-index:6';
    el.innerHTML = `<h2>You were kicked by the dev</h2>
      <div class="sub">You can rejoin the multiplayer in about ${mins} minute${mins === 1 ? '' : 's'}. Until then you can keep
      exploring on your own.</div><button class="wide">OK</button>`;
    el.querySelector('button').onclick = () => el.remove();
    document.body.appendChild(el);
  }

  // another player's body (and name): their character appears on the first one
  other(id, b, n) {
    if (!b || id === this.myId) return;
    let av = this.others.get(id);
    if (!av) {
      av = new Avatar(this.app, { name: n || `#${id}`, color: playerColor(n || id) });
      this.others.set(id, av);
    } else av.setName(n);
    av.set(b);
  }

  dropOther(id) {
    this.others.get(id)?.dispose();
    this.others.delete(id);
  }

  // everyone's characters move on; you bump into them
  updateAvatars(dt, list) {
    const blockers = [];
    for (const av of list) {
      if (!av) continue;
      av.update(dt);
      if (av.shown) blockers.push(...av.blockers);
    }
    this.app.player.blockers = blockers;
  }

  update(dt) {
    if (this.admin) { this.updateAdmin(dt); return; }
    this.updateAvatars(dt, [...this.devAvatars.values(), ...this.others.values()]);
    this.sendPos(false);
  }

  // your camera and body to the server: when it changed (at most 5 a second), every 15 s anyway,
  // or now (force: just connected)
  sendPos(force = true) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const c = this.app.camera, d = c.getWorldDirection(new THREE.Vector3());
    const p = { t: 'p', x: c.position.x, y: -c.position.z, z: c.position.y,
      h: THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)), pt: THREE.MathUtils.radToDeg(Math.asin(d.y)),
      m: this.app.player.mode, hr: this.app.day.hour, b: bodyState(this.app) };
    const now = performance.now(), L = this.last;
    const moved = changed(p.b, L.b) || Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z) > 0.5
      || Math.abs(((p.h - L.h + 540) % 360) - 180) > 3 || p.m !== L.m || Math.abs(p.hr - L.hr) > 0.05;
    if (force || (moved && now - L.t > 200) || now - L.t > 15000) {
      ws.send(JSON.stringify(p));
      Object.assign(L, p, { t: now });
    }
  }

  // ---------------------------------------------------------------- spectator
  buildAdmin() {
    const el = document.createElement('div');
    el.id = 'live';
    el.className = 'panel';
    el.innerHTML = `<h2>LIVE PLAYERS <span id="live-n">0</span></h2>
      <div class="sub" id="live-status">connecting…</div>
      <button id="live-show" class="wide">Show me to players: OFF</button>
      <div class="note" id="live-show-note" style="color:var(--muted)">Incognito: players can't see you until you write to them.</div>
      <div id="live-list"></div>
      <button id="live-stop" class="wide hidden">Stop watching (Esc)</button>
      <button id="live-pardon" class="wide" title="Kicked players can't rejoin for 10 minutes; this lets them back now">Let kicked players back in</button>`;
    document.body.appendChild(el);
    const css = document.createElement('style');
    css.textContent = `#live { position: fixed; right: 16px; top: 12px; width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 40px);
        padding: 14px 16px; display: flex; flex-direction: column; overflow: hidden; }
      #live > * { flex: 0 0 auto; } #live #live-list { flex: 0 1 auto; min-height: 0; overflow-y: auto; }
      #live .pl { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid var(--btn-border); }
      #live .pl .who { flex: 1; min-width: 0; } #live .pl .who b { font-variant-numeric: tabular-nums; }
      #live .pl .who .id { color: var(--muted); font-size: 11px; }
      #live .mod { display: flex; gap: 6px; padding: 0 0 6px 15px; }
      #live .mod button { padding: 3px 8px; font-size: 11px; } #live .mod button.sure { background: #b52a2a; border-color: #ff6b6b; }
      #live-pardon { margin-top: 4px; font-size: 11px; padding: 4px; }
      #live .pl .who div { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #live .pl button { flex: 0 0 auto; padding: 5px 9px; } #live .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
      #live-show { margin: 0 0 4px; } #live-show.showing { background: color-mix(in srgb, var(--dc, #ff7a1a) 76%, #000); border-color: var(--dc, #ff7a1a); }
      #dev-badge { position: fixed; left: 50%; top: 36px; transform: translateX(-50%); background: color-mix(in srgb, var(--dc, #ff7a1a) 76%, #000); color: #fff;
        font: 800 12px system-ui, sans-serif; letter-spacing: .06em; padding: 5px 12px; border-radius: 6px; pointer-events: none; }`;
    document.head.appendChild(css);
    this.listEl = el.querySelector('#live-list');
    this.rows = new Map();   // player id -> that row's elements (renderList updates them in place)
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'hint';
    this.emptyEl.textContent = 'Nobody else is playing right now.';
    this.listEl.appendChild(this.emptyEl);
    // one handler for every row's buttons
    this.listEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      const id = b?.closest('[data-id]')?.dataset.id;
      if (!id || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'go') this.goTo(id);
      else if (act === 'watch') this.watch(this.watching === id ? null : id);
      else if (act === 'msg') this.chat.target(id);
      else this.modClick(act, id);
    });
    el.querySelector('#live-stop').onclick = () => this.watch(null);
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.watching && !isTyping(e)) this.watch(null); });
    this.chat = new AdminChat(this, el);
    el.querySelector('#live-show').onclick = () => this.show(!this.showing);
    el.querySelector('#live-pardon').onclick = () => { if (this.send({ t: 'mod', act: 'pardon' })) this.chat.note('Kicked players can rejoin now.'); };
    this.sure = null;   // { key, until }: a moderation button waiting for its second click
    const badge = document.createElement('div');
    badge.id = 'dev-badge';
    badge.className = 'hidden';
    badge.textContent = 'PLAYERS CAN SEE YOU';
    document.body.appendChild(badge);
    this.markers = new THREE.Group();
    this.app.scene.add(this.markers);
    this.listTimer = 0;
  }

  status(t) { const s = document.getElementById('live-status'); if (s) s.textContent = t; }

  // Censor name / Kick: the first click arms the button ("Sure?") for 4 s, the second one acts
  modButton(b, act, id, label, disabled = false) {
    const armed = this.sure?.key === `${act}:${id}` && this.sure.until > Date.now();
    set(b, 'textContent', armed ? `Sure? ${label}` : label);
    set(b, 'disabled', disabled);
    b.classList.toggle('sure', armed);
  }

  modClick(act, id) {
    const key = `${act}:${id}`;
    if (this.sure?.key === key && this.sure.until > Date.now()) {
      this.sure = null;
      this.send({ t: 'mod', act, id });
    } else {
      this.sure = { key, until: Date.now() + 4000 };
      setTimeout(() => this.renderList(), 4100);
    }
    this.renderList();
  }

  // "Show me to players": your character appears in every player's world (and goes when you switch
  // it off or close the page). Off every time the page opens.
  show(on) {
    this.showing = on;
    this.lastMe.t = 0;
    if (!on) this.send({ t: 'me', off: true });
    const b = document.getElementById('live-show');
    b.textContent = `Show me to players: ${on ? 'ON' : 'OFF'}`;
    b.classList.toggle('showing', on);
    document.getElementById('live-show-note').textContent = on
      ? `Players see your character (${this.devInfo?.[this.myDev]?.n || DEV_NAME} tag) walk, fly and drive. Watching someone freezes it where it stood.`
      : "Incognito: players can't see you until you write to them.";
    document.getElementById('dev-badge').classList.toggle('hidden', !on);
  }

  // your character's body for the players (while "Show me to players" is on)
  sendMe() {
    const me = bodyState(this.app);
    const now = performance.now(), L = this.lastMe;
    if ((changed(me, L) && now - L.t > 100) || now - L.t > 5000) {
      if (this.send({ t: 'me', ...me })) Object.assign(L, me, { t: now });
    }
  }

  onAdminMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'all') {
      // which dev you are: the panel, your chat lines and the "players can see you" badge in your colour
      this.myDev = m.me || 0;
      this.devInfo = m.devs || null;
      document.documentElement.style.setProperty('--dc', this.devInfo?.[this.myDev]?.c || DEV_COL);
      for (const id of [...this.players.keys()]) this.remove(id);
      for (const pl of m.players) this.upsert(pl.id, pl.since, pl.p, pl.n);
      this.chat.setPlayers([...this.players.keys()]);
      this.chat.load(m.chat || []);
    } else if (m.t === 'join') this.upsert(m.id, m.since, null);
    else if (m.t === 'p') this.upsert(m.id, null, m.p);
    else if (m.t === 'leave') this.remove(m.id);
    else if (m.t === 'name') { this.upsert(m.id, null, null, m.n); this.chat.renderPicker(); }
    else if (m.t === 'c') { this.chat.receive(m); return; }
    else if (m.t === 'tr') { this.chat.translated(m); return; }   // auto-translate (admin chat)
    else if (m.t === 'pu') { this.punched(m); return; }
    else if (m.t === 'hit') { this.gotHit(m); return; }
    else if (m.t === 'dev') { this.devChar(m); return; }   // another dev's character
    else if (m.t === 'mod') {
      const who = this.players.get(m.id)?.n || m.n || `#${m.id}`;
      if (m.act === 'rename') this.chat.note(m.ok ? `Censored "${m.old}" (now ${who}); that name is blocked.` : `#${m.id} has left.`);
      else if (m.act === 'kick') this.chat.note(m.ok ? `Kicked ${m.n || `#${m.id}`}${m.blocked === false ? ' (rejoin not blocked: no connection info)' : " (can't rejoin for 10 min)"}.` : `#${m.id} has left.`);
      return;
    }
    this.renderList();
  }

  upsert(id, since, p, n) {
    let pl = this.players.get(id);
    if (!pl) {
      pl = { id, since: since || Date.now(), p: null, n: null, marker: this.makeMarker(id) };
      this.players.set(id, pl);
    }
    if (n) { pl.n = n; pl.avatar?.setName(n); }
    if (p) {
      pl.p = p;
      pl.marker.visible = this.watching !== id;
      pl.marker.position.set(p.x, p.z, -p.y);
      pl.marker.userData.beam.material.color.set(MODE_COL[p.m] || '#fff');
      if (p.b) {
        pl.avatar ||= new Avatar(this.app, { name: pl.n || `#${id}`, color: playerColor(pl.n || id) });
        pl.avatar.set(p.b);
        pl.marker.userData.label.visible = false;   // the character's nametag says it
      }
    }
  }

  remove(id) {
    const pl = this.players.get(id);
    if (!pl) return;
    this.markers.remove(pl.marker);
    pl.marker.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    pl.avatar?.dispose();
    this.players.delete(id);
    if (this.watching === id) this.watch(null);
  }

  makeMarker(id) {
    const g = new THREE.Group();
    g.visible = false;   // until the first position arrives
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 400, 8, 1, true).translate(0, 200, 0),
      new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(10,12,20,0.8)'; x.beginPath(); x.roundRect(8, 8, 240, 48, 12); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(`#${id}`, 128, 33);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, fog: false, toneMapped: false }));
    label.scale.set(0.12, 0.03, 1);
    label.center.set(0.5, -0.4);
    label.renderOrder = 10;
    g.add(beam, label);
    g.userData.beam = beam;
    g.userData.label = label;
    this.markers.add(g);
    return g;
  }

  // One row per player, built once and then updated in place. The list refreshes on every position
  // update; rebuilding it each time swapped the buttons out between mouse-down and mouse-up (so
  // Censor / Kick / Go only sometimes worked) and threw the scroll position about.
  row(id) {
    let r = this.rows.get(id);
    if (r) return r;
    const el = document.createElement('div');
    el.dataset.id = id;
    el.innerHTML = `<div class="pl"><span class="dot"></span>
        <div class="who"><b></b> <span class="id"></span><div></div><div></div></div>
        <button data-act="go">Go</button><button data-act="watch">Watch</button><button data-act="msg">Msg<span class="badge hidden"></span></button></div>
      <div class="mod"><button data-act="rename"></button><button data-act="kick"></button></div>`;
    const q = (s) => el.querySelector(s), info = el.querySelectorAll('.who div');
    q('.id').textContent = `#${id}`;
    r = { el, dot: q('.dot'), name: q('b'), where: info[0], what: info[1], go: q('[data-act=go]'), watch: q('[data-act=watch]'),
      msg: q('[data-act=msg]'), badge: q('.badge'), rename: q('[data-act=rename]'), kick: q('[data-act=kick]') };
    this.rows.set(id, r);
    return r;
  }

  renderList() {
    const n = this.players.size;
    document.getElementById('live-n').textContent = `(${n})`;
    const cam = this.app.camera.position;
    for (const [id, r] of this.rows) if (!this.players.has(id)) { r.el.remove(); this.rows.delete(id); }
    let prev = null;
    for (const pl of [...this.players.values()].sort((a, b) => a.since - b.since)) {
      const r = this.row(pl.id), p = pl.p, mins = Math.max(0, Math.round((Date.now() - pl.since) / 60000));
      set(r.dot.style, 'background', MODE_COL[p?.m] || '#888');
      set(r.name, 'textContent', pl.n || `#${pl.id}`);
      set(r.name.style, 'color', playerColor(pl.n || pl.id));
      set(r.where, 'textContent', p ? `${areaName(p.x, p.y)} · ${(Math.hypot(p.x - cam.x, -p.y - cam.z) / 1000).toFixed(1)} km from you` : 'loading in…');
      set(r.what, 'textContent', p ? `${p.m.toUpperCase()} · ${String(Math.floor(p.hr)).padStart(2, '0')}:${String(Math.round((p.hr % 1) * 60)).padStart(2, '0')} · ${mins} min` : `${mins} min`);
      set(r.go, 'disabled', !p);
      set(r.watch, 'disabled', !p);
      r.watch.classList.toggle('on', this.watching === pl.id);
      r.msg.classList.toggle('on', this.chat.to === pl.id);
      const unread = this.chat.unread.get(pl.id) || 0;
      set(r.badge, 'textContent', String(unread));
      r.badge.classList.toggle('hidden', !unread);
      this.modButton(r.rename, 'rename', pl.id, 'Censor name', !pl.n || /^Player [0-9a-f]{4}$/.test(pl.n));
      this.modButton(r.kick, 'kick', pl.id, 'Kick');
      // keep join order without touching rows that are already in place
      const want = prev ? prev.nextSibling : this.listEl.firstChild;
      if (r.el !== want) this.listEl.insertBefore(r.el, want);
      prev = r.el;
    }
    this.emptyEl.classList.toggle('hidden', n > 0);
    document.getElementById('live-stop').classList.toggle('hidden', !this.watching);
    this.chat.setPlayers([...this.players.keys()]);
  }

  goTo(id) {
    const p = this.players.get(id)?.p;
    if (!p) return;
    this.watch(null);
    const a = this.app, back = THREE.MathUtils.degToRad(p.h);
    // a little behind and above them, looking their way
    a.player.setMode('fly');
    a.player.placeAt(p.x - Math.sin(back) * 60, p.y - Math.cos(back) * 60, p.z + 25, p.h, -12);
    a.player.look();
    a.ui.refresh();
  }

  watch(id) {
    const a = this.app;
    this.watching = id;
    for (const pl of this.players.values()) pl.marker.visible = !!pl.p && pl.id !== id;
    if (id) {
      a.player.setMode('fly');
      a.player.enabled = false;   // the camera follows them; your own controls wait
      document.exitPointerLock?.();
      this.status(`watching #${id} (Esc to stop)`);
      this.chat.target(id, false);   // T now writes to whoever you're watching
    } else {
      // back to flying from where their camera was
      const c = a.camera, d = c.getWorldDirection(new THREE.Vector3());
      a.player.placeAt(c.position.x, -c.position.z, c.position.y, THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)),
        THREE.MathUtils.radToDeg(Math.asin(d.y)));
      a.player.enabled = document.getElementById('start').classList.contains('hidden');
      this.status(this.ws ? 'connected' : 'reconnecting…');
    }
    this.renderList();
  }

  updateAdmin(dt) {
    if (this.showing && !this.watching) this.sendMe();
    // players' characters (not the one whose camera you're riding)
    for (const pl of this.players.values()) {
      if (pl.avatar) pl.avatar.group.visible = pl.id !== this.watching;
      pl.marker.userData.label.visible = !pl.avatar && !this.app.tagsHidden;   // the character's tag says it
    }
    this.updateAvatars(dt, [...this.players.values()].filter((pl) => pl.id !== this.watching).map((pl) => pl.avatar)
      .concat([...this.devAvatars.values()]));
    if ((this.listTimer -= dt) <= 0) { this.listTimer = 1; if (this.players.size) this.renderList(); }
    const pl = this.watching && this.players.get(this.watching);
    if (!pl?.p) return;
    // ride along: ease towards their latest camera (updates arrive ~2 a second)
    const p = pl.p, c = this.app.camera, k = 1 - Math.exp(-5 * dt);
    c.position.lerp(new THREE.Vector3(p.x, p.z, -p.y), k);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(p.pt), -THREE.MathUtils.degToRad(p.h), 0, 'YXZ'));
    c.quaternion.slerp(q, k);
    if (Math.abs(this.app.day.hour - p.hr) > 0.05) this.app.day.setHour(p.hr);
  }
}
