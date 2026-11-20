// Minimap: a GTA-style radar in the bottom-right corner. Tiles from scripts/web_minimap.py
// (assets/minimap/mm_<k>.webp, 2 m a pixel, one per 2048 m chunk with land) drawn on a 2D canvas, turned
// so you always face up, zooming out with height and speed. Dots: other players, the dev; the dev's own
// spectator view also shows the players it tracks; the map window's waypoint (bigmap.js) as a yellow
// diamond. N sits on the rim. The settings toggle it; M opens the full map instead.
import * as THREE from 'three';
import { playerColor, DEV_NAME } from './chat.js';

const W = 260, H = 190;          // CSS px
const ME_Y = 0.62;               // you sit a bit below the middle: more of what's ahead

export class Minimap {
  constructor(app) {
    this.app = app;
    const m = app.world.m;
    this.info = m.minimap || null;
    this.C = m.chunk; this.west = m.west; this.north = m.north;
    this.tiles = new Map();      // key -> Image (loading or loaded)
    this.has = new Set(this.info?.tiles || []);
    this.mpp = 2.0;              // metres per CSS pixel, eased
    this.enabled = true;
    this.dir = new THREE.Vector3();
    const el = this.el = document.createElement('div');
    el.id = 'minimap';
    el.innerHTML = '<canvas></canvas>';
    document.body.appendChild(el);
    const css = document.createElement('style');
    css.textContent = `#minimap { position: fixed; right: 16px; bottom: 16px; width: ${W}px; height: ${H}px; border-radius: 10px;
        overflow: hidden; border: 2px solid rgba(0, 0, 0, .55); box-shadow: 0 2px 12px rgba(0, 0, 0, .45); pointer-events: none;
        background: ${this.info?.water || '#3a5c7a'}; }
      #minimap canvas { width: 100%; height: 100%; display: block; }
      @media (max-width: 600px) { #minimap { width: 180px; height: 132px; } }`;
    document.head.appendChild(css);
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  setEnabled(on) { this.enabled = on; this.el.style.display = on ? '' : 'none'; }

  tile(i, j) {
    const key = `${i}_${j}`;
    if (!this.has.has(key)) return null;
    let t = this.tiles.get(key);
    if (!t) {
      t = new Image();
      t.decoding = 'async';
      t.src = `assets/minimap/mm_${key}.webp`;
      this.tiles.set(key, t);
    }
    return t.complete && t.naturalWidth ? t : null;
  }

  update(dt) {
    if (!this.enabled || !this.info) return;
    const app = this.app, start = document.getElementById('start');
    this.el.style.visibility = (start && !start.classList.contains('hidden')) || app.map?.isOpen ? 'hidden' : '';
    // keep clear of the dev's live players panel on the right
    const live = document.getElementById('live');
    this.el.style.right = live ? `${Math.round(live.getBoundingClientRect().width) + 28}px` : '16px';
    const cv = this.canvas, dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const cam = app.camera, x = cam.position.x, y = -cam.position.z;
    cam.getWorldDirection(this.dir);
    const heading = Math.atan2(this.dir.x, -this.dir.z);   // clockwise from north
    // zoom: ~1.6 m a pixel on foot, out with height above the ground and with speed
    const alt = Math.max(0, cam.position.y - (app.world.heightAt(x, y) || 0));
    const want = Math.min(Math.max(1.6 + alt / 110 + (app.player.speedKmh || 0) / 70, 1.6), 40);
    this.mpp += (want - this.mpp) * (1 - Math.exp(-3 * dt));
    const k = 1 / this.mpp;      // CSS px per metre
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.info.water;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h * ME_Y);
    ctx.rotate(-heading);
    ctx.scale(k, k);
    ctx.translate(-x, y);        // canvas y = -north
    ctx.imageSmoothingEnabled = this.mpp > 2.2;
    // the tiles the view can reach
    const R = Math.hypot(w, h) * this.mpp;
    const C = this.C;
    const i0 = Math.floor((x - R - this.west) / C), i1 = Math.floor((x + R - this.west) / C);
    const j0 = Math.floor((this.north - (y + R)) / C), j1 = Math.floor((this.north - (y - R)) / C);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const t = this.tile(i, j);
        if (t) ctx.drawImage(t, this.west + i * C, -(this.north - j * C), C, C);
      }
    }
    ctx.restore();
    // everyone else
    const dots = this.dots();
    const cx = w / 2, cy = h * ME_Y, sin = Math.sin(-heading), cos = Math.cos(-heading);
    for (const d of dots) {
      // rotate their offset into the radar; pin to the rim when off it
      const dx = (d.x - x) * k, dy = -(d.y - y) * k;
      let u = cx + dx * cos - dy * sin, v = cy + dx * sin + dy * cos;
      const out = u < 6 || u > w - 6 || v < 6 || v > h - 6;
      u = Math.min(Math.max(u, 6), w - 6); v = Math.min(Math.max(v, 6), h - 6);
      ctx.beginPath();
      ctx.arc(u, v, out ? 3.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, .7)';
      ctx.stroke();
    }
    // you: an arrow pointing up
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0, 0, 0, .8)';
    ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north on the rim
    const nx = Math.sin(-heading), ny = -Math.cos(-heading);
    const s = Math.min((nx > 0 ? (w - 12 - cx) / nx : nx < 0 ? (12 - cx) / nx : Infinity),
      (ny > 0 ? (h - 12 - cy) / ny : ny < 0 ? (12 - cy) / ny : Infinity));
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.arc(cx + nx * s, cy + ny * s, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, .65)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('N', cx + nx * s, cy + ny * s + 0.5);
    // the waypoint: a yellow diamond, on the rim when it's off the radar (drawn last: over the N)
    const wp = app.map?.waypoint;
    if (wp) {
      const dx = (wp.x - x) * k, dy = -(wp.y - y) * k;
      let u = cx + dx * cos - dy * sin, v = cy + dx * sin + dy * cos;
      u = Math.min(Math.max(u, 8), w - 8); v = Math.min(Math.max(v, 8), h - 8);
      ctx.beginPath();
      ctx.moveTo(u, v - 7); ctx.lineTo(u + 6, v); ctx.lineTo(u, v + 7); ctx.lineTo(u - 6, v); ctx.closePath();
      ctx.fillStyle = '#ffd84a'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0, 0, 0, .8)'; ctx.stroke();
    }
  }

  // map positions, colours and names of the other people in the world (the map window labels them)
  dots() {
    const live = this.app.live, out = [];
    if (!live) return out;
    if (live.admin) {
      for (const pl of live.players.values()) if (pl.p) out.push({ x: pl.p.x, y: pl.p.y, color: playerColor(pl.n || pl.id), n: pl.n || `#${pl.id}` });
      return out;
    }
    for (const av of live.others.values()) {
      const p = av.target;
      if (p) out.push({ x: p.x, y: p.y, color: av.color || '#7ec8ff', n: av.tag?.name });
    }
    const dev = live.avatar?.target;
    if (dev) out.push({ x: dev.x, y: dev.y, color: '#ff7a1a', n: DEV_NAME });
    return out;
  }
}
