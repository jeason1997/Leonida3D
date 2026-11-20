// The world: terrain tiles (32 m everywhere, 8 m near the camera), chunk meshes (buildings, filler,
// roads, water) and the height / collision queries the player uses.
// Map metres (x east, y north, z up) <-> three.js (x, y = up, z = -north).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { facadeMaterial, roofMaterial, roadMaterial, roadsideMaterial, waterMaterial, terrainMaterial, detailMaterial, wallDetailMaterial, railGlassMaterial } from './materials.js';
import { wallDetails } from './walldetail.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const ASSETS = 'assets/';

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();          // key -> { far, near, nearMesh, colorTex, meshes, loaded }
    this.colliders = [];              // meshes with a BVH (buildings, filler, roads)
    this.loadedMeshes = 0;
    this.totalMeshes = 0;
    this.nearRadius = 2600;
  }

  async init(onProgress) {
    this.m = await (await fetch(ASSETS + 'manifest.json')).json();
    const m = this.m;
    this.C = m.chunk;
    const far = new Int16Array(await (await fetch(ASSETS + m.terrain.far)).arrayBuffer());
    const n = m.terrain.far_n;
    for (let j = 0; j < m.ny; j++) {
      for (let i = 0; i < m.nx; i++) {
        const key = `${i}_${j}`;
        const off = (j * m.nx + i) * n * n;
        this.chunks.set(key, { i, j, key, far: far.subarray(off, off + n * n), near: null, nearMesh: null,
          farMesh: null, colorTex: null, meshes: null });
      }
    }
    // near tiles: small (132 KB each) - load them all up front, they also serve ground queries
    await Promise.all(m.terrain.near.map(async (key) => {
      const buf = await (await fetch(`${ASSETS}terrain/near_${key}.bin`)).arrayBuffer();
      this.chunks.get(key).near = new Int16Array(buf);
    }));
    onProgress?.('terrain');
    // whole-map height texture for the water's depth colour
    const h = m.terrain.height16;
    const raw = new Int16Array(await (await fetch(ASSETS + h.file)).arrayBuffer());
    const half = new Uint16Array(raw.length);
    for (let k = 0; k < raw.length; k++) half[k] = THREE.DataUtils.toHalfFloat(raw[k] / 10);
    this.heightTex = new THREE.DataTexture(half, h.w, h.h, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.flipY = false;
    this.heightTex.needsUpdate = true;
    const tl = new THREE.TextureLoader();
    const normal = await tl.loadAsync(ASSETS + 'water_normal.png');
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    this.waterArgs = [this.heightTex, { west: m.west, north: m.north, cell: h.cell, w: h.w, h: h.h }, normal];
    this.mats = {
      facade: facadeMaterial(), roof: roofMaterial(),
      water: waterMaterial(...this.waterArgs),
      roads: {},
      seabed: terrainMaterial(null),
    };
    this.textureLoader = tl;
    // the whole map's seabed colours in one square texture (the wave grid spans chunks, so it can't
    // use their own colour textures); chunk (i, j) at (i, j) x 256 px, filled as the colours arrive
    const S = 256, side = Math.max(m.nx, m.ny);
    const cv = document.createElement('canvas');
    cv.width = cv.height = side * S;
    this.seabedCtx = cv.getContext('2d');
    this.seabedCtx.fillStyle = '#ccc7ad';   // the shaders' open-sea sand, in sRGB
    this.seabedCtx.fillRect(0, 0, cv.width, cv.height);
    const atlas = new THREE.CanvasTexture(cv);
    atlas.colorSpace = THREE.SRGBColorSpace;
    this.seabedAtlas = { tex: atlas, info: { west: m.west, north: m.north, size: side * this.C }, S };
    for (const c of this.chunks.values()) this.buildFar(c);
    // baked ambient occlusion per land chunk (scripts/web_ao.py), applied as each map arrives
    for (const key of m.ao || []) {
      const c = this.chunks.get(key);
      if (!c) continue;
      tl.loadAsync(`${ASSETS}ao/ao_${key}.webp`).then((t) => {
        t.flipY = false;                    // row 0 = north, sampled by world position
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        c.aoTex = t;
        this.applyAO(c);
      }).catch(() => { /* no AO for this chunk: it just stays unshaded */ });
    }
  }

  // ---------------------------------------------------------------- terrain
  heightAt(x, y) {
    // map metres -> ground height from the finest tile available
    const C = this.C, m = this.m;
    const i = Math.floor((x - m.west) / C), j = Math.floor((m.north - y) / C);
    const c = this.chunks.get(`${i}_${j}`);
    if (!c) return -10;
    const fx = (x - (m.west + i * C)) / C, fy = ((m.north - j * C) - y) / C;
    const [arr, n] = c.near ? [c.near, m.terrain.near_n] : [c.far, m.terrain.far_n];
    const gx = Math.min(Math.max(fx * (n - 1), 0), n - 1.001), gy = Math.min(Math.max(fy * (n - 1), 0), n - 1.001);
    const ix = Math.floor(gx), iy = Math.floor(gy), ax = gx - ix, ay = gy - iy;
    const a = arr[iy * n + ix], b = arr[iy * n + ix + 1], cc = arr[(iy + 1) * n + ix], d = arr[(iy + 1) * n + ix + 1];
    return ((a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + d * ax) * ay) / 10;
  }

  tileGeometry(c, arr, n, withColors) {
    const C = this.C, m = this.m;
    const x0 = m.west + c.i * C, y1 = m.north - c.j * C;
    const step = C / (n - 1);
    // grid + a skirt round the edge (hides cracks between 8 m and 32 m neighbours)
    const N = n * n, S = 4 * (n - 1);
    const pos = new Float32Array((N + S) * 3), uv = new Float32Array((N + S) * 2);
    const col = withColors ? new Float32Array((N + S) * 3) : null;
    const sand = [0.55, 0.5, 0.36], grass = [0.2, 0.32, 0.13], sea = [0.42, 0.45, 0.33];
    for (let r = 0; r < n; r++) {
      for (let q = 0; q < n; q++) {
        const k = r * n + q, h = arr[k] / 10;
        pos[k * 3] = x0 + q * step; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -(y1 - r * step);
        uv[k * 2] = q / (n - 1); uv[k * 2 + 1] = 1 - r / (n - 1);
        if (col) {
          const c3 = h < -0.5 ? sea : (h < 1.5 ? sand : grass);
          col[k * 3] = c3[0]; col[k * 3 + 1] = c3[1]; col[k * 3 + 2] = c3[2];
        }
      }
    }
    const idx = [];
    for (let r = 0; r < n - 1; r++) {
      for (let q = 0; q < n - 1; q++) {
        const a = r * n + q, b = a + 1, cc = a + n, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    // skirt: duplicate the border 15 m lower, joined to the border
    const border = [];
    for (let q = 0; q < n - 1; q++) border.push(q);
    for (let r = 0; r < n - 1; r++) border.push(r * n + n - 1);
    for (let q = n - 1; q > 0; q--) border.push((n - 1) * n + q);
    for (let r = n - 1; r > 0; r--) border.push(r * n);
    border.forEach((k, s) => {
      const t = N + s;
      pos[t * 3] = pos[k * 3]; pos[t * 3 + 1] = pos[k * 3 + 1] - 15; pos[t * 3 + 2] = pos[k * 3 + 2];
      uv[t * 2] = uv[k * 2]; uv[t * 2 + 1] = uv[k * 2 + 1];
      if (col) { col[t * 3] = col[k * 3]; col[t * 3 + 1] = col[k * 3 + 1]; col[t * 3 + 2] = col[k * 3 + 2]; }
    });
    for (let s = 0; s < S; s++) {
      const a = border[s], b = border[(s + 1) % S], a2 = N + s, b2 = N + (s + 1) % S;
      idx.push(a, a2, b, b, a2, b2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  buildFar(c) {
    const hasColor = this.m.terrain.colors.includes(c.key);
    // vertex colours too: what land shows until its colour texture arrives (and all the sea shows)
    const mesh = new THREE.Mesh(this.tileGeometry(c, c.far, this.m.terrain.far_n, true), this.mats.seabed);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    c.farMesh = mesh;
    this.group.add(mesh);
    if (hasColor) {
      this.textureLoader.loadAsync(`${ASSETS}terrain/color_${c.key}.jpg`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        c.colorTex = t;
        const a = this.seabedAtlas;
        a && this.seabedCtx.drawImage(t.image, c.i * a.S, c.j * a.S, a.S, a.S);
        if (a) a.tex.needsUpdate = true;
        mesh.material = terrainMaterial(t);
        mesh.material.vertexColors = false;
        this.applyAO(c);
        if (c.nearMesh) c.nearMesh.material = mesh.material;
        c.water?.setSeabed(t);
      });
    }
  }

  updateTerrainLod(camPos) {
    const C = this.C, m = this.m;
    for (const c of this.chunks.values()) {
      if (!c.near) continue;
      const cx = m.west + (c.i + 0.5) * C, cz = -(m.north - (c.j + 0.5) * C);
      const d = Math.hypot(camPos.x - cx, camPos.z - cz) - C * 0.7;
      const wantNear = d < this.nearRadius;
      if (wantNear && !c.nearMesh) {
        c.nearMesh = new THREE.Mesh(this.tileGeometry(c, c.near, m.terrain.near_n, true), c.farMesh.material);
        c.nearMesh.receiveShadow = true;
        c.nearMesh.matrixAutoUpdate = false;
        this.group.add(c.nearMesh);
      }
      if (c.nearMesh) {
        c.nearMesh.visible = wantNear;
        c.farMesh.visible = !wantNear;
        if (!wantNear && d > this.nearRadius + 1500) {
          this.group.remove(c.nearMesh);
          c.nearMesh.geometry.dispose();
          c.nearMesh = null;
        }
      }
    }
  }

  // ---------------------------------------------------------------- chunk meshes
  async loadMeshes(camPos, onProgress) {
    const loader = new GLTFLoader();
    const m = this.m;
    const entries = Object.entries(m.meshes);
    this.totalMeshes = entries.length;
    const dist = ([key]) => {
      const mm = /^(\d+)_(\d+)$/.exec(key);
      if (!mm) return 0;
      const cx = m.west + (+mm[1] + 0.5) * this.C, cz = -(m.north - (+mm[2] + 0.5) * this.C);
      return Math.hypot(camPos.x - cx, camPos.z - cz);
    };
    entries.sort((a, b) => dist(a) - dist(b));
    const queue = entries.slice();
    const worker = async () => {
      while (queue.length) {
        const [key, file] = queue.shift();
        try {
          const gltf = await loader.loadAsync(ASSETS + file);
          this.adopt(key, gltf.scene);
        } catch (e) {
          console.warn('chunk failed', key, e);
        }
        this.loadedMeshes++;
        onProgress?.(this.loadedMeshes, this.totalMeshes);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await this.loadDetails(camPos);
    await this.loadLandmarks();
  }

  // ---------------------------------------------------------------- building details
  // Hipped roofs, parapets, rooftop units and tower crowns (scripts/web_details.py), nearest chunks
  // first. det_<k>.bin: u32 vertices, u32 indices, f32 origin x / z, i16 positions (5 cm), u8 sRGB
  // colours, padding, u16 / u32 indices.
  // Hand-made models (data/landmarks.json, scripts/web_landmarks.py): Jason's house. The placement is baked
  // into the geometry, so they collide like the chunk meshes (world-space vertices): you can climb the
  // stairs onto the deck.
  async loadLandmarks() {
    const loader = new GLTFLoader();
    for (const lm of this.m.landmarks || []) {
      try {
        const root = (await loader.loadAsync(ASSETS + lm.file)).scene;
        root.position.set(lm.x, lm.z, -lm.y);
        root.rotation.y = THREE.MathUtils.degToRad(lm.rot);
        root.updateMatrixWorld(true);
        const meshes = [];
        root.traverse((o) => { if (o.isMesh) meshes.push(o); });
        for (const o of meshes) {
          o.geometry.applyMatrix4(o.matrixWorld);
          o.geometry.computeBoundingSphere();
          o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
          o.updateMatrix(); o.matrixAutoUpdate = false;
          o.material.roughness = 0.9; o.material.metalness = 0;
          o.castShadow = o.receiveShadow = true;
          o.name = lm.id;
          this.group.add(o);
          this.colliders.push(o);
        }
      } catch (e) { console.warn('landmark', lm.id, e); }
    }
  }

  async loadDetails(camPos) {
    const m = this.m, keys = (m.details || []).slice();
    const centre = (k) => { const [i, j] = k.split('_').map(Number); return [m.west + (i + 0.5) * this.C, -(m.north - (j + 0.5) * this.C)]; };
    keys.sort((a, b) => { const [ax, az] = centre(a), [bx, bz] = centre(b); return Math.hypot(camPos.x - ax, camPos.z - az) - Math.hypot(camPos.x - bx, camPos.z - bz); });
    const lin = new Float32Array(256).map((_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const worker = async () => {
      while (keys.length) {
        const key = keys.shift();
        try {
          const buf = await (await fetch(`${ASSETS}details/det_${key}.bin`)).arrayBuffer();
          const dv = new DataView(buf);
          const nv = dv.getUint32(0, true), ni = dv.getUint32(4, true), ox = dv.getFloat32(8, true), oz = dv.getFloat32(12, true);
          const q = new Int16Array(buf, 16, nv * 3);
          const pos = new Float32Array(nv * 3);
          for (let v = 0; v < nv; v++) {
            pos[v * 3] = q[v * 3] * 0.05 + ox; pos[v * 3 + 1] = q[v * 3 + 1] * 0.05; pos[v * 3 + 2] = q[v * 3 + 2] * 0.05 + oz;
          }
          const c8 = new Uint8Array(buf, 16 + nv * 6, nv * 3);
          const col = new Float32Array(nv * 3);
          for (let k = 0; k < col.length; k++) col[k] = lin[c8[k]];
          const ioff = 16 + nv * 9 + ((4 - ((nv * 9) % 4)) % 4);
          const index = nv < 65536 ? new Uint16Array(buf, ioff, ni) : new Uint32Array(buf, ioff, ni);
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          g.setIndex(new THREE.BufferAttribute(index, 1));
          g.computeBoundingSphere();
          const mesh = new THREE.Mesh(g, this.chunkMats(key).details);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.visible = this.detailsOn !== false;
          (this.detailMeshes ||= []).push(mesh);
          this.group.add(mesh);
        } catch (e) {
          console.warn('details failed', key, e);
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  // roof details (Medium up) and wall relief (High / Ultra: ~2 M triangles) - ui.js applyAll
  setDetails(roofs, walls = roofs) {
    this.detailsOn = roofs;
    this.wallDetailsOn = walls;
    for (const m of this.detailMeshes || []) m.visible = roofs;
    for (const m of this.wallDetailMeshes || []) m.visible = walls;
  }

  // A chunk's own building / road materials, so they can read that chunk's AO map (other keys, like
  // OpenSea, share the plain ones). Same shader programs; only the AO texture differs.
  chunkMats(key) {
    const c = this.chunks.get(key);
    if (!c) return this.mats;
    if (!c.mats) {
      c.mats = { facade: facadeMaterial(), roof: roofMaterial(), details: detailMaterial(), wallDetails: wallDetailMaterial(), roads: {} };
      this.applyAO(c);
    }
    return c.mats;
  }

  applyAO(c) {
    if (!c.aoTex) return;
    const x0 = this.m.west + c.i * this.C, y1 = this.m.north - c.j * this.C;
    const mats = [c.farMesh?.material, c.mats?.facade, c.mats?.roof, c.mats?.details, c.mats?.wallDetails, ...Object.values(c.mats?.roads || {})];
    for (const mat of mats) mat?.setAO?.(c.aoTex, x0, y1, this.C);
  }

  adopt(key, root) {
    const list = [];
    const cm = this.chunkMats(key);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material?.name || '';
      let mat;
      if (name.startsWith('Building_Wall')) mat = cm.facade;
      else if (name.startsWith('Building_Roof')) mat = cm.roof;
      else if (name.startsWith('Road_')) {
        const rk = name.replace(/\.\d+$/, '');
        if (!cm.roads[rk]) { cm.roads[rk] = roadMaterial(name); this.applyAO(this.chunks.get(key) || {}); }
        mat = cm.roads[rk];
      } else if (name.startsWith('RS_')) {
        // kerbs, sidewalks, decks, piers, barriers (roadgeo.py); shared by every chunk
        const rk = name.replace(/\.\d+$/, '');
        mat = (this.mats.roadside ||= {})[rk] ||= roadsideMaterial(rk);
      } else if (name.startsWith('Water') || o.name.startsWith('Water') || o.name.startsWith('OpenSea')) mat = this.waterFor(key);
      else mat = cm.facade;
      o.material = mat;
      const isWater = mat.name === 'water';
      o.castShadow = !isWater && !name.startsWith('Road_');
      o.receiveShadow = true;
      if (name.startsWith('Road_')) o.renderOrder = 1;
      list.push(o);
    });
    // Flatten into the world group: bake any node transform into the vertices.
    for (const o of list) {
      o.geometry.applyMatrix4(o.matrixWorld);
      o.removeFromParent();
      o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      o.geometry.computeBoundingSphere();
      this.group.add(o);
      if (o.material.name !== 'water') this.colliders.push(o);   // BVH built on first use
    }
    // relief on the walls, built from this chunk's facades (walldetail.js)
    for (const o of list) {
      if (o.material !== cm.facade || !cm.wallDetails) continue;
      const { solid, glass } = wallDetails(o.geometry);
      for (const [g, mat, shadow] of [[solid, cm.wallDetails, true], [glass, this.mats.railGlass ||= railGlassMaterial(), false]]) {
        if (!g) continue;
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = mat.transparent ? 2 : 0;
        mesh.visible = this.wallDetailsOn !== false;
        (this.wallDetailMeshes ||= []).push(mesh);
        this.group.add(mesh);
      }
    }
  }

  // The chunk's own water material: it shows that chunk's baked seabed colour once it has loaded.
  waterFor(key) {
    const c = this.chunks.get(key);
    if (!c) return this.mats.water;
    if (!c.water) {
      const C = this.C, m = this.m;
      c.water = waterMaterial(...this.waterArgs, { x0: m.west + c.i * C, y1: m.north - c.j * C, C });
      if (c.colorTex) c.water.setSeabed(c.colorTex);
    }
    return c.water;
  }

  // ---------------------------------------------------------------- queries (three.js coordinates)
  groundY(pos, from = 3.0, ignoreRoofs = false) {
    // highest surface under pos: terrain, or a collider (road / roof) below pos.y + from
    const tH = this.heightAt(pos.x, -pos.z);
    let best = tH;
    const ray = this._ray ||= new THREE.Raycaster();
    ray.firstHitOnly = true;
    ray.set(new THREE.Vector3(pos.x, pos.y + from, pos.z), new THREE.Vector3(0, -1, 0));
    ray.far = from + 60;
    const near = this.nearColliders(pos, 40);
    const hits = ray.intersectObjects(near, false);
    for (const h of hits) if (h.point.y > best) best = h.point.y;
    return best;
  }

  nearColliders(pos, radius) {
    const out = [];
    const s = this._sphere ||= new THREE.Sphere();
    for (const o of this.colliders) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      s.copy(o.geometry.boundingSphere);
      if (s.center.distanceTo(pos) < s.radius + radius) {
        if (!o.geometry.boundsTree) o.geometry.computeBoundsTree();
        out.push(o);
      }
    }
    return out;
  }

  // push a sphere out of nearby geometry; returns the push applied. Roads are never walls (their
  // ribbons sit ~0.3 m over the terrain, and that edge used to stop cars and walkers driving onto
  // them); contacts below stepY are steps you climb (groundY lifts you), not walls.
  pushOut(center, radius, stepY = -Infinity) {
    const near = this.nearColliders(center, radius + 2);
    const push = new THREE.Vector3();
    const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    for (const o of near) {
      if (o.material.name.startsWith('Road_')) continue;
      for (let it = 0; it < 3; it++) {
        const hit = o.geometry.boundsTree.closestPointToPoint(center, target, 0, radius);
        if (!hit) break;
        if (target.point.y < stepY) break;
        const d = center.distanceTo(target.point);
        if (d >= radius || d < 1e-5) break;
        const n = center.clone().sub(target.point).normalize();
        if (Math.abs(n.y) > 0.7) break;                 // floors / roofs: not a wall
        n.y = 0; n.normalize();
        const k = radius - d + 1e-3;
        center.addScaledVector(n, k);
        push.addScaledVector(n, k);
      }
    }
    return push;
  }
}
