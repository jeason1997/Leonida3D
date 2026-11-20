// Relief on building walls, built in the browser from the facade meshes as each chunk loads (so it
// costs no download): balconies, ledges, cornices, pilasters, fins, eyebrows, awnings, canopies -
// placed where materials.js FACADE_FRAG_COLOR paints them, from the same per-vertex data:
//   uv  = (u along the wall from its middle, 1 - z) with z = height above the building base
//   uv1 = (style + seed, 1 - building height H),  uv2 = (half the wall length, 1)
// A wall is a quad from z = -0.5 to its top; of its two triangles exactly one holds the bottom edge,
// which gives the wall's two foot corners. Colours follow the shader's palettes (linear values).
import * as THREE from 'three';

const whites = [[0.95, 0.94, 0.91], [0.94, 0.90, 0.81], [0.87, 0.88, 0.89], [0.86, 0.92, 0.92], [0.93, 0.87, 0.77]];
const accentP = [[0.06, 0.60, 0.62], [0.95, 0.40, 0.44], [0.99, 0.77, 0.22], [0.18, 0.44, 0.86], [0.97, 0.97, 0.96]];
const greys = [[0.71, 0.71, 0.69], [0.79, 0.75, 0.68], [0.63, 0.64, 0.67], [0.85, 0.84, 0.81]];
const metalP = [[0.89, 0.90, 0.90], [0.77, 0.79, 0.81], [0.56, 0.66, 0.76], [0.83, 0.79, 0.69], [0.67, 0.73, 0.67]];
const fract = (x) => x - Math.floor(x);
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

class Builder {
  constructor() { this.p = []; this.c = []; this.i = []; }
  // a box in wall space: u along the wall, z up from the base, d out from the wall face; no back face
  box(W, u0, u1, z0, z1, d0, d1, col) {
    if (z0 < W.zbot - 0.01 || z1 > W.ztop + 0.7) return;   // only on this wall's own stretch of height
    const b = this.p.length / 3;
    for (const [u, z, d] of [[u0, z0, d0], [u1, z0, d0], [u1, z1, d0], [u0, z1, d0], [u0, z0, d1], [u1, z0, d1], [u1, z1, d1], [u0, z1, d1]]) {
      this.p.push(W.cx + u * W.tx + d * W.nx, W.y0 + z, W.cz + u * W.tz + d * W.nz);
      this.c.push(col[0], col[1], col[2]);
    }
    // front (d1), top, bottom, left, right - counter-clockwise from outside when (t, up, n) is
    // right-handed; reversed when the wall's axes are the other way round
    const f = W.flip;
    const q = (a, bb, c, d) => (f ? this.i.push(b + a, b + c, b + bb, b + a, b + d, b + c) : this.i.push(b + a, b + bb, b + c, b + a, b + c, b + d));
    q(4, 5, 6, 7); q(7, 6, 2, 3); q(0, 1, 5, 4); q(0, 4, 7, 3); q(1, 2, 6, 5);
  }
  // a single quad (glass railing), double-sided material
  quad(W, u0, u1, z0, z1, d, col) {
    if (z0 < W.zbot - 0.01 || z1 > W.ztop + 0.7) return;
    const b = this.p.length / 3;
    for (const [u, z] of [[u0, z0], [u1, z0], [u1, z1], [u0, z1]]) {
      this.p.push(W.cx + u * W.tx + d * W.nx, W.y0 + z, W.cz + u * W.tz + d * W.nz);
      this.c.push(col[0], col[1], col[2]);
    }
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// the walls of one facade geometry (world coordinates)
function walls(geo) {
  const P = geo.attributes.position, U = geo.attributes.uv, S = geo.attributes.uv1, L = geo.attributes.uv2, N = geo.attributes.normal;
  const I = geo.index, nt = (I ? I.count : P.count) / 3, out = [];
  if (!U || !S || !L) return out;
  for (let t = 0; t < nt; t++) {
    const v = [0, 1, 2].map((k) => (I ? I.getX(t * 3 + k) : t * 3 + k));
    const z = v.map((i) => 1 - U.getY(i)), u = v.map((i) => U.getX(i));
    const hl = L.getX(v[0]);
    const zmin = Math.min(...z);
    // the bottom edge: two corners at the lowest z, one at each end of the wall
    const bot = v.filter((_, k) => Math.abs(z[k] - zmin) < 0.01);
    if (bot.length !== 2 || hl < 1) continue;
    const ia = U.getX(bot[0]) < U.getX(bot[1]) ? bot[0] : bot[1], ib = ia === bot[0] ? bot[1] : bot[0];
    if (Math.abs(U.getX(ia) + hl) > 0.05 || Math.abs(U.getX(ib) - hl) > 0.05) continue;
    const ax = P.getX(ia), az = P.getZ(ia), bx = P.getX(ib), bz = P.getZ(ib);
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    let nx = N.getX(ia), nz = N.getZ(ia);
    const nl = Math.hypot(nx, nz);
    if (nl < 0.5) continue;   // not a vertical wall
    nx /= nl; nz /= nl;
    const sx = S.getX(ia);
    out.push({
      cx: (ax + bx) / 2, cz: (az + bz) / 2, tx, tz, nx, nz,
      // winding: boxes are wound for t x up = n, i.e. n = (-tz, 0, tx); flip when n points the other way
      flip: tx * nz - tz * nx < 0,
      y0: P.getY(ia) - zmin,                      // world height of the base (z = 0)
      zbot: zmin + 0.5, ztop: Math.max(...z), hl, H: Math.max(1 - S.getY(ia), 3),
      st: Math.floor(sx), seed: fract(sx),
    });
  }
  return out;
}

function detail(W, B, G) {
  const { hl, H, st, seed } = W;
  const top = Math.min(W.ztop, H);
  const r1 = fract(seed * 13.17), r2 = fract(seed * 71.31), r3 = fract(seed * 191.7);
  const floors = (h, z0, z1, every = 1) => { const out = []; for (let fi = Math.ceil(z0 / h); fi * h <= z1; fi += every) out.push(fi * h); return out; };
  if (st === 1) {                                         // condo: balconies (or floor ledges) + cornice
    const wallC = whites[Math.floor(r1 * 4.99)];
    const slabC = mix(wallC, [0.98, 0.98, 0.97], 0.7);
    const inner = hl - 1.2;
    if (inner > 1.2) {
      const balc = r3 > 0.3;
      for (const zf of floors(3.2, 4.5, top - 1.2 - 1.3)) {
        if (balc) {
          B.box(W, -inner, inner, zf, zf + 0.22, 0, 1.35, slabC);
          B.box(W, -inner, inner, zf + 1.18, zf + 1.26, 1.27, 1.35, [0.88, 0.9, 0.9]);
          G.quad(W, -inner, inner, zf + 0.22, zf + 1.18, 1.31, [0.55, 0.68, 0.70]);
        } else {
          B.box(W, -hl, hl, zf, zf + 0.18, 0, 0.25, slabC);
        }
      }
    }
    if (top >= H - 0.05) B.box(W, -hl, hl, H - 0.4, H, 0, 0.35, slabC);
  } else if (st === 0) {                                  // glass: mullion fins
    const frameC = mix([0.22, 0.24, 0.27], [0.75, 0.76, 0.78], r3);
    const step = hl > 30 ? 4.5 : 3.0;
    for (let u = step / 2; u < hl - 0.3; u += step) {
      for (const s of [-1, 1]) B.box(W, s * u - 0.06, s * u + 0.06, 5.5, Math.min(top, H - 2.2), 0, 0.3, frameC);
    }
  } else if (st === 2) {                                  // Art Deco
    const accentC = accentP[Math.floor(r2 * 4.99)], white = [0.97, 0.97, 0.95];
    const inner = hl - 0.9;
    B.box(W, -hl, -hl + 0.55, W.zbot, H - 0.85, 0, 0.2, white);      // corner pilasters
    B.box(W, hl - 0.55, hl, W.zbot, H - 0.85, 0, 0.2, white);
    if (hl > 5) B.box(W, -0.75, 0.75, 3.6, H + 0.6, 0, 0.45, accentC);   // the centre fin
    if (inner > 1) {
      B.box(W, -inner, inner, 3.0, 3.25, 0, 1.2, accentC);          // ground-floor awning
      for (const zf of floors(3.3, 3.6, H - 1.3 - 2.85)) B.box(W, -inner, inner, zf + 2.68, zf + 2.85, 0, 0.45, accentC);   // eyebrows
      if (H > 7) for (const z of [H - 2.85, H - 2.45, H - 2.05]) B.box(W, -inner, inner, z, z + 0.15, 0, 0.12, accentC);   // speed lines
    }
  } else if (st === 3) {                                  // stucco: a cornice on anything taller than a house
    if (H >= 8 && top >= H - 0.05) B.box(W, -hl, hl, H - 0.45, H, 0, 0.18, [0.95, 0.95, 0.93]);
  } else if (st === 4) {                                  // office: sunshade ledges + a street canopy
    const ledgeC = greys[Math.floor(r1 * 3.99)].map((v) => v * 0.95);
    const inner = hl - 0.6;
    if (inner > 1) {
      for (const zf of floors(3.8, 4.5, Math.min(top, H - 1.0) - 3.2, H > 45 ? 2 : 1)) B.box(W, -inner, inner, zf + 2.9, zf + 3.02, 0, 0.55, ledgeC);
      B.box(W, -inner, inner, 3.9, 4.1, 0, 1.6, [0.3, 0.31, 0.32]);
    }
  } else if (st === 5) {                                  // warehouse: canopies over the loading doors
    const metal = metalP[Math.floor(r1 * 4.99)].map((v) => v * 0.9);
    for (let k = -Math.floor((hl - 2) / 14 + 0.5); k * 14 <= hl - 2; k++) {
      const u = k * 14;
      if (Math.abs(u) + 2.4 < hl) B.box(W, u - 2.4, u + 2.4, 4.4, 4.55, 0, 1.6, metal);
    }
  }
}

// solid relief + glass railings for one facade geometry
export function wallDetails(geo) {
  const B = new Builder(), G = new Builder();
  for (const W of walls(geo)) detail(W, B, G);
  return { solid: B.geometry(), glass: G.geometry() };
}
