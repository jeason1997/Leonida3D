// Chat (live.js owns the socket, worker/index.js routes).
// Players: T opens a box. By default a line goes to everyone playing (and the dev); Tab cycles to
// nearby (players within LOCAL_RANGE m of you; you're told if nobody heard) and to the dev only.
// Other players' lines show their name in their own colour; a dev's lines carry their tag (DEV orange, Jadon - Dev
// purple: worker DEVS), and their announcements are blocks in that colour plus a banner at the top of the screen. New
// players get the last hour's public lines. A player's line: at most PLAYER_LEN characters (a counter
// shows near the end), one every GAP_S seconds, slurs starred out (chatfilter.js; the worker does the
// same, this only shows you your line as the others get it).
// Spectator: a CHAT section in the LIVE PLAYERS panel with all of it (public lines dimmer, lines to
// the dev highlighted and counted as unread); T types, the picker chooses one player or everyone, and
// Announce switches between ordinary chat (default) and announcements (the banner).

import { censor } from './chatfilter.js';

export const DEV_NAME = 'DEV';   // what players see the owner called (chat and the character's tag) ...
export const DEV_COL = '#ff7a1a';   // ... in this colour; other devs come with their own name and colour (worker DEVS)
const MAX_LEN = 200;             // the spectator's lines (the worker cuts longer messages) ...
const PLAYER_LEN = 150;          // ... and a player's (worker PLAYER_LEN)
const GAP_S = 3;                 // a player sends one line every this many seconds (worker CHAT_GAP)
const LOCAL_RANGE = 100;         // m: nearby chat's reach (worker/index.js LOCAL_RANGE)
// the T box's targets, in Tab order
const TARGETS = {
  '*': { next: 'local', note: 'To everyone playing', ph: 'Message everyone…', you: 'You:' },
  local: { next: 'dev', note: `Nearby: players within ${LOCAL_RANGE} m of you`, ph: 'Message players near you…', you: 'You (nearby):' },
  dev: { next: '*', note: "To the dev only - other players can't see it", ph: 'Message the dev…', you: `You → ${DEV_NAME}:` },
};
const TAB_TO = { '*': 'everyone', local: 'nearby', dev: 'the dev only' };
const FADE_S = 12;               // closed player chat: a line stays this long
const DEV_FADE_S = 30;           // ... and a line from the dev this long

// a player's colour (their character, tag and chat name), from their name (else id) so it stays the
// same when they come back; never a dev's orange or purple
export function playerColor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let hue = h % 300;
  if (hue >= 15) hue += 30;   // skip 15-45 (orange)
  if (hue >= 255 && hue < 290) hue += 35;   // and 255-290 (Jadon's purple, hue 271): those go to 290-325
  return `hsl(${hue}, 70%, 55%)`;
}

// keys typed into a text box must not drive the game (WASD, Space, P, T, Esc)
export const isTyping = (e) => !!e.target?.matches?.('input[type=text], textarea');

const clock = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function line(cls, who, whoCls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (who) {
    const b = document.createElement('b');
    b.className = whoCls;
    b.textContent = who;
    el.append(b, ' ');
  }
  el.append(text);   // text node: player text is never HTML
  return el;
}

const CSS = `
  #chat { position: fixed; left: 16px; bottom: 16px; width: min(440px, calc(100vw - 32px)); pointer-events: none; }
  #chat .log { display: flex; flex-direction: column; gap: 2px; max-height: 40vh; overflow: hidden; }
  #chat .msg { color: #fff; text-shadow: 1px 1px 2px #000; overflow-wrap: anywhere; transition: opacity .8s; }
  #chat .msg.fade { opacity: 0; } #chat .msg.gone { display: none; }
  #chat .msg b.me { color: var(--label); }
  #chat.to-dev .chat-in { border-color: #ff7a1a; }
  #chat.to-local .chat-in { border-color: #7ee07e; }
  .neartag { display: inline-block; color: #0b1a0b; background: #7ee07e; font: 800 10px system-ui, sans-serif; letter-spacing: .05em;
    padding: 1px 5px; border-radius: 4px; margin-right: 5px; vertical-align: 1px; text-shadow: none; }
  .devtag { display: inline-block; background: var(--dc, #ff7a1a); color: #fff; font: 800 11px system-ui, sans-serif; letter-spacing: .06em;
    padding: 2px 6px; border-radius: 4px; margin-right: 6px; vertical-align: 1px; text-shadow: none; }
  #chat .msg.dev { background: color-mix(in srgb, var(--dc, #ff7a1a) 24%, transparent); border-left: 3px solid var(--dc, #ff7a1a); border-radius: 4px; padding: 4px 8px;
    font-size: 15px; margin: 2px 0; }
  #dev-toast { position: fixed; top: 40px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px));
    display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; z-index: 5; }
  #dev-toast > div { background: rgba(10, 12, 20, 0.92); border: 2px solid var(--dc, #ff7a1a); border-radius: 10px; padding: 10px 14px;
    color: #fff; font-size: 16px; line-height: 1.35; box-shadow: 0 4px 18px rgba(0, 0, 0, .45); overflow-wrap: anywhere;
    animation: devToastIn .25s ease-out; transition: opacity .6s; }
  #dev-toast > div.out { opacity: 0; }
  #dev-toast .sub { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; }
  @keyframes devToastIn { from { opacity: 0; transform: translateY(-8px); } }
  #chat .msg.sys { color: var(--muted); font-size: 12px; }
  #chat .box { display: none; background: var(--panel); border-radius: 0 0 8px 8px; padding: 4px 10px 10px; }
  #chat.open { pointer-events: auto; }
  #chat.open .log { overflow-y: auto; background: var(--panel); border-radius: 8px 8px 0 0; padding: 8px 10px 4px; }
  #chat.open .msg { opacity: 1; display: block; text-shadow: none; }
  #chat.open .box { display: block; }
  #chat .to, #live-chat .to { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
  .chat-in { width: 100%; box-sizing: border-box; background: #151922; color: var(--text); border: 1px solid var(--btn-border);
    border-radius: 5px; padding: 7px 8px; font: 14px system-ui, sans-serif; }
  .chat-in:focus { outline: none; border-color: #5b95ff; }
  #chat .count { color: var(--muted); font-size: 11px; text-align: right; margin-top: 2px; font-variant-numeric: tabular-nums; }
  #chat .count:empty { display: none; } #chat .count.full { color: #ff8a80; }
  #live-chat { flex: 0 0 auto; border-top: 1px solid var(--btn-border); margin-top: 6px; }
  #live-chat .label { display: flex; justify-content: space-between; }
  #live-chat-log { max-height: 30vh; min-height: 40px; overflow-y: auto; font-size: 13px; }
  #live-chat-log > div { padding: 2px 0; overflow-wrap: anywhere; }
  #live-chat-log .t { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; margin-right: 4px; }
  #live-chat-log b.p { color: var(--warn); cursor: pointer; } #live-chat-log b.me { color: color-mix(in srgb, var(--dc, #ff7a1a) 60%, #fff); }
  #live-chat-log .mine { border-left: 3px solid var(--dc, #ff7a1a); padding-left: 5px; }
  #live-chat-log b.p.left::after { content: ' (left)'; color: var(--muted); font-weight: 400; }
  #live-chat-log .pub { opacity: .8; } #live-chat-log .pub b.p { color: var(--text); }
  #live-chat-log .tome { color: var(--warn); font-weight: 700; }
  #live-chat-log .new { background: rgba(255, 204, 102, 0.12); border-radius: 3px; }
  #live-chat-log .sys, #live-chat-log .earlier { color: var(--muted); font-size: 11px; }
  #live-chat .pick { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
  #live-ann { flex: 0 0 auto; padding: 5px 9px; } #live-ann.on { background: color-mix(in srgb, var(--dc, #ff7a1a) 75%, #000); border-color: var(--dc, #ff7a1a); }
  #live-tr { flex: 0 0 auto; padding: 5px 9px; } #live-tr.on { border-color: #4fa3d8; color: #8fd3ff; }
  #live-chat-log .tr { display: block; color: #9aa4b2; font-style: italic; padding-left: 8px; }
  #live-chat-log .tr i { font-style: normal; font-size: 10px; font-weight: 800; color: #8fd3ff; margin-right: 5px; text-transform: uppercase; }
  #live-chat.ann .chat-in { border-color: var(--dc, #ff7a1a); }
  #live-chat-log .ann { color: color-mix(in srgb, var(--dc, #ff7a1a) 60%, #fff); font-weight: 700; }
  #live-chat select { flex: 1; min-width: 0; background: var(--btn); color: var(--text); border: 1px solid var(--btn-border);
    border-radius: 5px; padding: 5px; font: 700 12px system-ui, sans-serif; }
  .badge { display: inline-block; min-width: 15px; padding: 0 4px; margin-left: 3px; border-radius: 8px; background: #d9534f;
    color: #fff; font-size: 10px; line-height: 15px; text-align: center; }`;

function addCss() {
  if (document.getElementById('chat-css')) return;
  const s = document.createElement('style');
  s.id = 'chat-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ------------------------------------------------------------------------------------------ player
export class PlayerChat {
  constructor(live) {
    this.live = live;
    this.on = false;   // after PLAY, once the socket is up
    this.lastSent = 0;
    this.hidden = false;   // settings: CHAT Hide
    this.to = '*';     // '*' = everyone playing, 'local' = nearby, 'dev' = the dev only (Tab cycles)
    addCss();
    const el = document.createElement('div');
    el.id = 'chat';
    el.innerHTML = `<div class="log"></div>
      <div class="box"><div class="to"></div>
      <input class="chat-in" type="text" maxlength="${PLAYER_LEN}" autocomplete="off" enterkeyhint="send"><div class="count"></div></div>`;
    document.body.appendChild(el);
    this.el = el;
    this.log = el.querySelector('.log');
    this.input = el.querySelector('input');
    this.toEl = el.querySelector('.to');
    this.countEl = el.querySelector('.count');
    this.input.addEventListener('input', () => this.renderCount());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.send(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.to = TARGETS[this.to].next; this.renderTo(); }
    });
    // phones have no Tab: tap the line above the box (mousedown kept from taking the focus, so the
    // keyboard stays up)
    this.toEl.addEventListener('mousedown', (e) => e.preventDefault());
    this.toEl.addEventListener('click', () => { this.to = TARGETS[this.to].next; this.renderTo(); this.input.focus(); });
    this.renderTo();
    this.input.addEventListener('blur', () => this.close());   // clicking back into the game
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && this.on && !this.hidden && !isTyping(e) && !e.ctrlKey && !e.metaKey && !e.altKey
        && document.getElementById('start').classList.contains('hidden')) {
        e.preventDefault();   // so the T isn't typed into the box
        this.open();
      }
    });
  }

  get isOpen() { return this.el.classList.contains('open'); }

  renderTo() {
    const t = TARGETS[this.to];
    this.toEl.textContent = document.body.classList.contains('touch') ? `${t.note} · tap here: ${TAB_TO[t.next]}`
      : `${t.note} · Tab: ${TAB_TO[t.next]} · Enter sends, Esc closes`;
    this.input.placeholder = t.ph;
    this.el.classList.toggle('to-dev', this.to === 'dev');
    this.el.classList.toggle('to-local', this.to === 'local');
  }

  // settings: CHAT Hide - no chat on screen and T does nothing (lines still arrive, so Show brings back
  // the recent ones; the dev's announcement banner still shows)
  setHidden(h) {
    this.hidden = h;
    if (h) this.close();
    this.el.style.display = h ? 'none' : '';
  }

  open() {
    if (this.hidden) return;
    this.renderTo();
    this.el.classList.add('open');
    this.live.app.player.keys.clear();   // let go of whatever was held
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('open');
    this.input.blur();
    this.log.scrollTop = this.log.scrollHeight;
  }

  // characters left, once you're near the limit
  renderCount() {
    const n = this.input.value.length;
    this.countEl.textContent = n >= PLAYER_LEN - 30 ? `${n}/${PLAYER_LEN}` : '';
    this.countEl.classList.toggle('full', n >= PLAYER_LEN);
  }

  send() {
    const s = this.input.value.trim();
    if (!s) { this.close(); return; }
    const wait = GAP_S - (performance.now() - this.lastSent) / 1000;
    // the text stays in the box, so Enter again sends it
    if (wait > 0) { this.sys(`One message every ${GAP_S} seconds - wait ${Math.ceil(wait)} s.`); return; }
    if (!this.live.send({ t: 'c', s, to: this.to })) { this.sys('Not sent - reconnecting. Try again in a moment.'); return; }
    this.lastSent = performance.now();
    this.input.value = '';
    this.renderCount();
    this.add(line('msg', TARGETS[this.to].you, 'me', censor(s)));   // as everyone else sees it
    this.close();
  }

  // the worker turned a line away (sent too soon after the last one)
  slow(s) { this.sys(`That last message wasn't sent - one every ${GAP_S} seconds${s ? ` (wait ${s} s)` : ''}.`); }

  // another player's public line
  fromPlayer(m) {
    const el = line('msg', `${m.n || `#${m.from}`}:`, 'pl', m.s);
    el.firstChild.style.color = playerColor(m.n || m.from);
    if (m.local) {
      const t = document.createElement('span');
      t.className = 'neartag';
      t.textContent = 'NEARBY';
      el.prepend(t);
    }
    this.add(el);
  }

  // after a nearby line: say so if nobody was close enough
  heard(n) {
    if (!n) this.sys(`Nobody was within ${LOCAL_RANGE} m to hear that.`);
  }

  // the last hour's public lines, when you come in
  history(list) {
    if (!list?.length) return;
    this.sys('Recent chat:');
    for (const m of list) {
      if (m.from) this.fromPlayer(m);
      else this.receive(m, true);
    }
  }

  receive(m, old = false) {
    if (m.from) { this.fromPlayer(m); return; }
    const name = m.n || DEV_NAME, col = m.c || DEV_COL;   // which dev
    if (m.ann === false || old) {
      // a dev chatting: an ordinary line with their tag (no banner)
      const el = line('msg', m.all ? '' : '(to you)', 'me', m.s);
      const tag = document.createElement('span');
      tag.className = 'devtag';
      tag.textContent = name;
      tag.style.setProperty('--dc', col);
      el.prepend(tag);
      this.add(el);
      if (!old && !this.isOpen && !this.hinted) { this.hinted = true; this.sys('T to reply'); }
      return;
    }
    // an announcement (older servers send no ann: treated as one, as before)
    const who = m.all ? `${name} → EVERYONE` : name;
    const el = document.createElement('div');
    el.className = 'msg dev';
    el.style.setProperty('--dc', col);
    const tag = document.createElement('span');
    tag.className = 'devtag';
    tag.textContent = who;
    el.append(tag, m.s);
    this.add(el, DEV_FADE_S);
    if (old) return;
    this.toast(who, m.s, col);
    if (!this.isOpen && !this.hinted) { this.hinted = true; this.sys('T to reply'); }
  }

  // banner at the top of the screen for a few seconds (longer for longer messages)
  toast(who, text, col = DEV_COL) {
    let host = document.getElementById('dev-toast');
    if (!host) { host = document.createElement('div'); host.id = 'dev-toast'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.style.setProperty('--dc', col);
    const tag = document.createElement('span');
    tag.className = 'devtag';
    tag.textContent = who;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = 'Message from the developer · T to reply';
    el.append(tag, text, sub);
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    const ms = Math.min(14000, 5000 + text.length * 60);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 700);
  }

  sys(t) { this.add(line('msg sys', '', '', t)); }

  add(el, fadeS = FADE_S) {
    this.log.appendChild(el);
    while (this.log.children.length > 60) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => el.classList.add('fade'), fadeS * 1000);
    setTimeout(() => el.classList.add('gone'), fadeS * 1000 + 900);
  }
}

// --------------------------------------------------------------------------------------- spectator
export class AdminChat {
  constructor(live, panel) {
    this.live = live;
    this.to = '*';
    this.ids = [];           // connected players, in the picker
    this.unread = new Map(); // id -> count
    addCss();
    const el = document.createElement('div');
    el.id = 'live-chat';
    el.innerHTML = `<div class="label"><span>CHAT</span><span id="live-chat-new"></span></div>
      <div id="live-chat-log"><div class="sys">Players press T to write to you; nobody else sees it.</div></div>
      <div class="pick"><select id="live-to"></select>
        <button id="live-ann" title="Off: an ordinary chat line with your dev tag. On: an announcement - the banner at the top of their screen.">Announce: off</button>
        <button id="live-tr" title="English under lines written in other languages">Translate</button></div>
      <input id="live-msg" class="chat-in" type="text" maxlength="${MAX_LEN}" autocomplete="off">
      <div class="to">T types, Enter sends, Esc leaves the box. Click a name to answer them.</div>`;
    panel.appendChild(el);
    this.log = el.querySelector('#live-chat-log');
    this.select = el.querySelector('#live-to');
    this.input = el.querySelector('#live-msg');
    this.select.onchange = () => this.target(this.select.value);
    this.announce = false;   // off every time the page opens
    this.annBtn = el.querySelector('#live-ann');
    this.annBtn.onclick = () => { this.announce = !this.announce; this.renderPicker(); this.input.focus(); };
    // auto-translate (worker translate()): English under other languages' lines; same setting as admin.html
    this.byKey = new Map();   // "id|ts" -> {el, m} for players' lines
    this.showTr = true;
    try { this.showTr = localStorage.getItem('leonida-admin-tr') !== 'off'; } catch { /* private mode */ }
    this.trBtn = el.querySelector('#live-tr');
    this.trBtn.onclick = () => {
      this.showTr = !this.showTr;
      try { localStorage.setItem('leonida-admin-tr', this.showTr ? 'on' : 'off'); } catch { /* private mode */ }
      for (const { el: line, m } of this.byKey.values()) this.showTranslation(line, m);
      this.renderTrBtn();
    };
    this.renderTrBtn();
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.send(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.input.blur(); }
    });
    this.input.addEventListener('focus', () => this.markRead(this.to));
    this.log.addEventListener('click', (e) => { const id = e.target.closest('b.p')?.dataset.id; if (id) this.target(id); });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !isTyping(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.input.focus();
      }
    });
    this.setPlayers([]);
  }

  // the picker: everyone + connected players (+ the current target if they just left, so a private
  // reply never quietly turns into one to everyone)
  setPlayers(ids) {
    const same = ids.length === this.ids.length && ids.every((id, i) => id === this.ids[i]);
    this.ids = ids;
    for (const b of this.log.querySelectorAll('b.p')) b.classList.toggle('left', !ids.includes(b.dataset.id));
    if (same && this.select.options.length) return;   // rebuilding closes an open dropdown
    this.renderPicker();
  }

  renderPicker() {
    const who = (id) => { const n = this.live.players.get(id)?.n; return n ? `${n} (#${id})` : `#${id}`; };
    const opts = [['*', `Everyone (${this.ids.length} playing)`], ...this.ids.map((id) => [id, who(id)])];
    if (this.to !== '*' && !this.ids.includes(this.to)) opts.push([this.to, `#${this.to} (left)`]);
    this.select.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }));
    this.select.value = this.to;
    const toName = this.to === '*' ? 'everyone' : (this.live.players.get(this.to)?.n || `#${this.to}`);
    this.input.placeholder = this.announce ? `Announcement to ${toName}…` : `Message ${toName}…`;
    this.annBtn.textContent = `Announce: ${this.announce ? 'ON' : 'off'}`;
    this.annBtn.classList.toggle('on', this.announce);
    this.input.closest('#live-chat').classList.toggle('ann', this.announce);
  }

  target(id, focus = true) {
    this.to = id;
    this.renderPicker();
    if (focus) { this.input.focus(); this.markRead(id); }
    this.live.renderList();
  }

  markRead(id) {
    if (!this.unread.delete(id)) return;
    this.renderUnread();
  }

  renderUnread() {
    const n = [...this.unread.values()].reduce((a, b) => a + b, 0);
    document.getElementById('live-chat-new').innerHTML = n ? `<span class="badge">${n} new</span>` : '';
    this.live.renderList();
  }

  // a past day's log (on connect / reconnect): replaces what's shown
  renderTrBtn() {
    this.trBtn.textContent = `Translate: ${this.showTr ? 'on' : 'off'}`;
    this.trBtn.classList.toggle('on', this.showTr);
  }

  showTranslation(line, m) {
    line.querySelector('.tr')?.remove();
    if (!this.showTr || !m.tr) return;
    const tr = document.createElement('span');
    tr.className = 'tr';
    const lang = document.createElement('i');
    lang.textContent = m.lang || 'translated';
    tr.append(lang, m.tr);
    line.append(tr);
  }

  // {t:'tr'}: the English for a player's line, a moment after it
  translated(m) {
    const hit = this.byKey.get(`${m.id}|${m.ts}`);
    if (!hit) return;
    hit.m.tr = m.tr;
    hit.m.lang = m.lang;
    const atEnd = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 8;
    this.showTranslation(hit.el, hit.m);
    if (atEnd) this.log.scrollTop = this.log.scrollHeight;
  }

  load(rows) {
    this.byKey.clear();
    this.log.replaceChildren();
    if (rows.length) this.log.appendChild(line('earlier', '', '', 'Earlier today'));
    for (const m of rows) this.add(m, false);
    if (!rows.length) this.log.appendChild(line('sys', '', '', 'Players press T to write to you; nobody else sees it.'));
    this.setPlayers(this.ids);
  }

  receive(m) {
    const toDev = m.scope ? m.scope === 'dev' : !m.pub;
    const fresh = !m.admin && toDev && !(document.activeElement === this.input && this.to === m.id);
    if (fresh) { this.unread.set(m.id, (this.unread.get(m.id) || 0) + 1); this.renderUnread(); }
    this.add(m, fresh);
  }

  add(m, fresh) {
    const el = document.createElement('div');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = clock(m.ts);
    const b = document.createElement('b');
    if (m.admin) {
      el.className = 'mine';
      b.className = 'me';
      // dv = which dev wrote it (worker DEVS); another dev's line in their name and colour
      const other = m.dv != null && m.dv !== this.live.myDev ? this.live.devInfo?.[m.dv] : null;
      if (other) el.style.setProperty('--dc', other.c);
      b.textContent = `${other ? other.n : 'you'} → ${m.id === '*' ? 'everyone' : this.live.players.get(m.id)?.n || m.n || `#${m.id}`}`;
      b.textContent += m.ann ? ' (announcement):' : ':';
      if (m.ann) b.classList.add('ann');
    } else {
      b.className = 'p';
      b.dataset.id = m.id;
      b.title = `#${m.id} - click to answer them`;
      b.textContent = m.n || this.live.players.get(m.id)?.n || `#${m.id}`;
      b.style.color = playerColor(m.n || this.live.players.get(m.id)?.n || m.id);
      b.classList.toggle('left', !this.ids.includes(m.id));
    }
    el.append(t, b);
    if (!m.admin) {
      // public lines everyone saw vs. lines written to you alone
      const scope = m.scope || (m.pub ? 'all' : 'dev');
      const k = document.createElement('span');
      k.className = scope === 'dev' ? 'tome' : 'sys';
      k.textContent = scope === 'all' ? ' (all):' : scope === 'local' ? ' (nearby):' : ' → you:';
      el.append(k);
      if (scope !== 'dev') el.classList.add('pub');
    }
    el.append(' ', m.s);
    if (!m.admin) {
      this.byKey.set(`${m.id}|${m.ts}`, { el, m });
      this.showTranslation(el, m);
    }
    if (m.admin && m.sent === 0) {
      const n = document.createElement('span');
      n.className = 'sys';
      n.textContent = m.id === '*' ? '  (nobody is playing)' : '  (not delivered - they left)';
      el.append(n);
    }
    if (fresh) { el.classList.add('new'); setTimeout(() => el.classList.remove('new'), 8000); }
    const atEnd = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 8;
    this.log.appendChild(el);
    while (this.log.children.length > 1000) this.log.firstChild.remove();   // the day's log the server sends (chatLog)
    if (atEnd || m.admin) this.log.scrollTop = this.log.scrollHeight;
  }

  // a grey line in the log (moderation results)
  note(t) {
    this.log.appendChild(line('sys', '', '', t));
    this.log.scrollTop = this.log.scrollHeight;
  }

  send() {
    const s = this.input.value.trim();
    if (!s) return;
    if (this.to !== '*' && !this.ids.includes(this.to)) { this.log.appendChild(line('sys', '', '', `#${this.to} has left.`)); return; }
    if (!this.live.send({ t: 'c', to: this.to, s, ann: this.announce })) { this.log.appendChild(line('sys', '', '', 'Not connected - try again in a moment.')); return; }
    this.input.value = '';   // the worker echoes it back into the log
  }
}
