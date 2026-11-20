// Phones and tablets: on-screen controls over the game (touch devices only; ?touch=1 forces them on a
// desktop for testing).
// - left: a thumb stick - move (fly / walk); in a car up = gas, down = brake / reverse, sideways = steer
// - anywhere else on the view: drag to look around (in a car: swing the camera)
// - right: the current mode's buttons - fly: up, down, boost, speed; walk: jump, sprint, punch;
//   drive: handbrake, reset; plane: brakes, restart (the stick: up / down throttle, sideways turn;
//   drag the view to aim)
// - top: menu (the P panel), map (M), chat (T), and fly / walk / drive / plane
// They press the same keys the keyboard does (player.keys) and feed the stick into player.analog,
// so the game itself doesn't care where the input comes from.
import { isTyping } from './chat.js';

const LOOK = 0.0042;              // radians per pixel dragged
const STICK_R = 54;               // px: full push
const FLY_SPEEDS = [8, 30, 100, 300];   // m/s, the speed button cycles them (cruise 30 = the desktop start)
const MODES = ['fly', 'walk', 'drive', 'plane'];
const MODE_NAME = { fly: 'FLY', walk: 'WALK', drive: 'DRIVE', plane: 'PLANE' };

// keep a finger's moves coming to this element even when it slides off (some browsers refuse: fine)
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* not a live pointer */ } };

export const isTouch = () => /[?&]touch=1/.test(location.search) || matchMedia('(pointer: coarse)').matches
  || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

const CSS = `
  body.touch { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; overscroll-behavior: none; }
  body.touch canvas { touch-action: none; }
  #touch { position: fixed; inset: 0; pointer-events: none; z-index: 3; font: 700 13px system-ui, sans-serif; color: #fff; }
  #touch.off { display: none; }
  #touch.menu .stick, #touch.menu .btns { display: none; }
  #touch .stick { position: absolute; width: 132px; height: 132px; border-radius: 50%; pointer-events: auto; touch-action: none;
    left: max(18px, env(safe-area-inset-left, 0px)); bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    background: radial-gradient(circle, rgba(255,255,255,0.10) 0 58%, rgba(255,255,255,0.18) 59% 61%, rgba(255,255,255,0.06) 62%);
    border: 2px solid rgba(255,255,255,0.28); }
  #touch .knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
    background: rgba(255,255,255,0.55); box-shadow: 0 2px 10px rgba(0,0,0,0.35); }
  #touch .btns { position: absolute; display: grid; grid-template-columns: repeat(2, 64px); gap: 12px; justify-items: center;
    right: max(18px, env(safe-area-inset-right, 0px)); bottom: calc(22px + env(safe-area-inset-bottom, 0px)); }
  #touch .btn { pointer-events: auto; touch-action: none; width: 64px; height: 64px; border-radius: 50%;
    background: rgba(12, 16, 26, 0.55); border: 2px solid rgba(255,255,255,0.35); color: #fff; font: 800 12px system-ui, sans-serif;
    letter-spacing: 0.03em; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.1;
    text-shadow: 0 1px 2px #000; }
  #touch .btn.held { background: rgba(47, 111, 209, 0.75); border-color: #8cbfff; }
  #touch .btn .big { font-size: 22px; line-height: 1; }
  #touch .top { position: absolute; display: flex; gap: 8px; pointer-events: none;
    left: max(12px, env(safe-area-inset-left, 0px)); top: calc(10px + env(safe-area-inset-top, 0px)); }
  #touch .chip { pointer-events: auto; touch-action: manipulation; min-width: 44px; height: 40px; padding: 0 12px; border-radius: 20px;
    background: rgba(12, 16, 26, 0.7); border: 1px solid rgba(255,255,255,0.3); color: #fff; font: 800 13px system-ui, sans-serif;
    letter-spacing: 0.04em; }
  #touch .chip.mode { color: #8cbfff; }
  #touch .turn { position: absolute; left: 50%; transform: translateX(-50%); top: 38%;
    background: rgba(12, 16, 26, 0.8); border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  body.touch #hud { top: calc(58px + env(safe-area-inset-top, 0px)); left: max(14px, env(safe-area-inset-left, 0px)); font-size: 12px; }
  body.touch #minimap { top: calc(10px + env(safe-area-inset-top, 0px)) !important; bottom: auto !important;
    width: 150px !important; height: 110px !important; }
  body.touch #minimap { right: max(16px, env(safe-area-inset-right, 0px)) !important; }
  body.touch #chat { left: max(16px, env(safe-area-inset-left, 0px)); }
  body.touch #chat:not(.open) { bottom: calc(170px + env(safe-area-inset-bottom, 0px)); }
  body.touch #chat:not(.open) .log { max-height: 24vh; }
  body.touch #chat .to { padding: 6px 0; text-decoration: underline dotted; cursor: pointer; }
  body.touch .chat-in { font-size: 16px; }
  body.touch #admin { top: calc(58px + env(safe-area-inset-top, 0px)); max-height: calc(100% - 76px - env(safe-area-inset-top, 0px)); }
  @media (max-width: 500px) { body.touch #minimap { width: 112px !important; height: 112px !important; } }
  @media (max-height: 430px) {
    #touch .stick { width: 112px; height: 112px; }
    #touch .btn { width: 54px; height: 54px; }
    #touch .btns { grid-template-columns: repeat(2, 54px); gap: 10px; }
    body.touch #chat:not(.open) { bottom: calc(140px + env(safe-area-inset-bottom, 0px)); }
  }`;

export class TouchControls {
  constructor(app) {
    this.app = app;
    this.p = app.player;
    document.body.classList.add('touch');
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.className = 'off';
    el.innerHTML = `
      <div class="top">
        <button class="chip" data-act="menu" aria-label="Menu">&#9776; MENU</button>
        <button class="chip" data-act="map" aria-label="Map">MAP</button>
        <button class="chip" data-act="chat" aria-label="Chat" hidden>CHAT</button>
        <button class="chip mode" data-act="mode" aria-label="Change mode"></button>
      </div>
      <div class="turn" hidden>Turn your phone sideways for a wider view</div>
      <div class="stick" aria-label="Move"><div class="knob"></div></div>
      <div class="btns"></div>`;
    document.body.appendChild(el);
    this.stick = el.querySelector('.stick');
    this.knob = el.querySelector('.knob');
    this.btns = el.querySelector('.btns');
    this.chatBtn = el.querySelector('[data-act=chat]');
    this.modeBtn = el.querySelector('[data-act=mode]');
    this.turnTip = el.querySelector('.turn');
    this.mode = null;
    this.stickId = null;
    this.looks = new Map();     // pointerId -> last x, y
    this.wireTop();
    this.wireStick();
    this.wireLook();
    addEventListener('resize', () => this.orient());
  }

  wireTop() {
    const ui = () => this.app.ui;
    this.el.querySelector('[data-act=menu]').onclick = () => {
      const panel = document.getElementById('admin');
      ui().togglePanel(panel.classList.contains('hidden'));
    };
    this.chatBtn.onclick = () => this.app.live.chat?.open?.();
    this.el.querySelector('[data-act=map]').onclick = () => this.app.map?.toggle(true);
    this.modeBtn.onclick = () => {
      const next = MODES[(MODES.indexOf(this.p.mode) + 1) % MODES.length];
      this.p.setMode(next);
      ui().refresh();
    };
  }

  wireStick() {
    const s = this.stick;
    const move = (e) => {
      const r = s.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy), max = STICK_R * (r.width / 132);
      if (d > max) { dx *= max / d; dy *= max / d; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // a small dead zone, then the push squared so small corrections stay small
      const ax = dx / max, ay = -dy / max, m = Math.hypot(ax, ay);
      const g = m < 0.12 ? 0 : Math.min(1, (m - 0.12) / 0.88) ** 1.4 / Math.max(m, 1e-6);
      this.p.analog.x = ax * g;
      this.p.analog.y = ay * g;
    };
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.knob.style.transform = '';
      this.p.analog.x = this.p.analog.y = 0;
    };
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      capture(s, e.pointerId);
      move(e);
    });
    s.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }

  // drag on the view itself (the canvas) to look: each finger turns by how far it moved
  wireLook() {
    const cv = this.app.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      // a tap on the view puts the chat box away (iPhones don't always blur it by themselves)
      if (isTyping({ target: document.activeElement })) { document.activeElement.blur(); return; }
      if (!this.on) return;
      this.looks.set(e.pointerId, [e.clientX, e.clientY]);
      capture(cv, e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const last = this.looks.get(e.pointerId);
      if (!last) return;
      this.p.turn(e.clientX - last[0], e.clientY - last[1], LOOK);
      this.looks.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const end = (e) => this.looks.delete(e.pointerId);
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // a button that holds a key down while pressed (or taps it once)
  button(label, code, { tap = false, onTap = null } = {}) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.innerHTML = label;
    const keys = this.p.keys;
    const down = (e) => {
      e.preventDefault();
      capture(b, e.pointerId);
      b.classList.add('held');
      if (onTap) { onTap(); return; }
      keys.add(code);
      if (tap) setTimeout(() => keys.delete(code), 120);
    };
    const up = () => {
      b.classList.remove('held');
      if (!tap && !onTap) keys.delete(code);
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  build(mode) {
    this.mode = mode;
    const p = this.p;
    this.release();
    this.btns.textContent = '';
    const add = (...b) => this.btns.append(...b);
    if (mode === 'fly') {
      const speed = this.button('', null, {
        onTap: () => {
          const i = FLY_SPEEDS.findIndex((v) => v >= p.flySpeed - 0.5);
          p.flySpeed = FLY_SPEEDS[(i + 1) % FLY_SPEEDS.length];
          this.speedLabel(speed);
        },
      });
      this.speedLabel(speed);
      add(this.button('<span class="big">&#9650;</span>', 'KeyE'), this.button('BOOST', 'ShiftLeft'),
        this.button('<span class="big">&#9660;</span>', 'KeyQ'), speed);
    } else if (mode === 'walk') {
      add(this.button('JUMP', 'Space'), this.button('SPRINT', 'ShiftLeft'), this.button('PUNCH', null, { onTap: () => p.punch() }));
    } else if (mode === 'plane') {
      add(this.button('BRAKES', 'Space'), this.button('RE-<br>START', 'Backspace', { tap: true }));
    } else {
      add(this.button('HAND<br>BRAKE', 'Space'), this.button('RESET', 'Backspace', { tap: true }));
    }
    this.modeBtn.textContent = MODE_NAME[mode];
  }

  speedLabel(b) { b.innerHTML = `SPEED<br>${Math.round(this.p.flySpeed * 3.6)}`; }

  // let go of the stick and every held button
  release() {
    this.stickId = null;
    this.knob.style.transform = '';
    this.p.analog.x = this.p.analog.y = 0;
    for (const b of this.btns.querySelectorAll('.held')) b.classList.remove('held');
    for (const code of ['KeyE', 'Space', 'KeyQ', 'ShiftLeft', 'Backspace']) this.p.keys.delete(code);
  }

  get on() { return !this.el.classList.contains('off'); }

  // held upright on a phone: say once that sideways is better (gone after a few seconds)
  orient() {
    const portrait = innerHeight > innerWidth && Math.min(innerWidth, innerHeight) < 700;
    const show = portrait && this.on && !this.turnSeen;
    this.turnTip.hidden = !show;
    if (show && !this.turnTimer) this.turnTimer = setTimeout(() => { this.turnSeen = true; this.orient(); }, 7000);
    if (!portrait && this.on) this.turnSeen = true;
  }

  // every frame: shown while playing (not on the start menu, not while typing in the chat)
  update() {
    const started = document.getElementById('start').classList.contains('hidden');
    const typing = isTyping({ target: document.activeElement });
    const show = started && !typing && !this.app.map?.isOpen;
    // the MENU panel covers the stick's corner: stick and buttons go while it's open
    const panel = !document.getElementById('admin').classList.contains('hidden');
    if (panel !== this.el.classList.contains('menu')) {
      this.el.classList.toggle('menu', panel);
      if (panel) this.release();
    }
    if (show !== this.on) {
      this.el.classList.toggle('off', !show);
      if (!show) { this.release(); this.looks.clear(); }
      this.orient();
    }
    if (!show) return;
    if (this.p.mode !== this.mode) this.build(this.p.mode);
    const chat = !!(this.app.live.chatOn && !this.app.live.admin && !this.app.live.chat?.hidden);
    if (this.chatBtn.hidden === chat) this.chatBtn.hidden = !chat;
  }
}
