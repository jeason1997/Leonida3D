// Vegetation: 1.6 M placements from vegscatter.py. Near the camera every variant is a real instanced
// mesh (re-picked as you move); further out trees are camera-facing billboards from an atlas of
// side renders, one draw per chunk. Grass and shrubs only exist near the camera.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSETS = 'assets/';
const TEX = {
  VEG_Frond: ['frond.png', true], VEG_Needles: ['needles.png', true], VEG_Leaves: ['leaves.png', true],
  VEG_Grass: ['grass.png', true], VEG_GrassDry: ['grass_dry.png', true], VEG_Sawgrass: ['grass.png', true, [0.85, 0.8, 0.55]],
  VEG_PalmTrunk: ['palm_trunk.png', false], VEG_SabalTrunk: ['bark.png', false, [0.8, 0.75, 0.68]], VEG_Bark: ['bark.png', false],
};
const TREE_KINDS = new Set(['palm', 'pine', 'oak']);

export class Vegetation {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();      // key -> { variants: [{x,y,z,yaw,s}...], impostor }
    this.loading = new Set();
    this.lastPick = new THREE.Vector3(1e9, 0, 0);
    this.settings = { treeR: 350, shrubR: 180, grassR: 70, farR: 3500, maxTrees: 6000, maxShrubs: 8000, maxGrass: 15000,
      shadows: true, hidden: false };
  }

  async init() {
    const m = this.world.m;
    this.variants = m.veg.variants;
    const loader = new GLTFLoader();
    const tl = new THREE.TextureLoader();
    const texCache = {};
    // glTF UVs run top-down (GLTFLoader's own textures have flipY off). Left on, palm fronds sampled
    // the dead brown half of frond.png and grass / leaf cards were upside down.
    const tex = (file) => (texCache[file] ||= tl.loadAsync(`${ASSETS}veg/tex/${file}`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false; return t;
    }));
    const matCache = {};
    const material = async (name) => {
      if (matCache[name]) return matCache[name];
      const [file, alpha, tint] = TEX[name.replace(/\.\d+$/, '')] || ['bark.png', false];
      const m = new THREE.MeshStandardMaterial({ map: await tex(file), roughness: 0.85, alphaTest: alpha ? 0.45 : 0,
        alphaToCoverage: alpha,   // soft leaf edges from the MSAA samples instead of a hard cut
        side: alpha ? THREE.DoubleSide : THREE.FrontSide, color: tint ? new THREE.Color(...tint) : 0xffffff });
      matCache[name] = m;
      return m;
    };
    // near meshes: one InstancedMesh per primitive, sharing the variant's instance matrices
    this.near = [];
    for (const v of this.variants) {
      const gltf = await loader.loadAsync(`${ASSETS}veg/${v.name}.glb`);
      const kind = v.kind.startsWith('grass') ? 'grass' : (TREE_KINDS.has(v.kind) ? 'tree' : 'shrub');
      const cap = { tree: 2500, shrub: 3000, grass: 6000 }[kind];
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
      attr.setUsage(THREE.DynamicDrawUsage);
      const meshes = [];
      const prims = [];
      gltf.scene.traverse((o) => { if (o.isMesh) prims.push(o); });
      for (const o of prims) {
        const im = new THREE.InstancedMesh(o.geometry, await material(o.material.name), cap);
        im.instanceMatrix = attr;
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = kind !== 'grass';
        im.receiveShadow = true;
        this.group.add(im);
        meshes.push(im);
      }
      this.near.push({ v, kind, cap, attr, meshes });
    }
    // far billboards
    const atlas = await tl.loadAsync(ASSETS + m.veg.atlas);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    this.impMat = this.impostorMaterial(atlas);
    // shrubs get billboards too (to a shorter range): from the air they are the dark ground cover
    this.impMatShrub = this.impostorMaterial(atlas);
  }

  impostorMaterial(atlas) {
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uAtlas: { value: null }, uNearR: { value: 350 }, uFarR: { value: 3500 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uAmb: { value: new THREE.Color(0.4, 0.45, 0.5) },
      }]),
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iPos; attribute vec4 iTile; attribute vec3 iSize;   // tile uv rect; width, height, base
        uniform float uNearR, uFarR;
        varying vec2 vUv; varying float vShade;
        void main() {
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 right = normalize(vec3(camR.x, 0.0, camR.z));
          float d = distance(iPos, cameraPosition);
          float keep = step(uNearR, d) * step(d, uFarR);
          vec3 p = iPos + right * (position.x * iSize.x) + vec3(0.0, position.y * iSize.y + iSize.z, 0.0);
          p = mix(iPos, p, keep);
          vUv = iTile.xy + uv * iTile.zw;
          vShade = 0.85 + 0.15 * position.y;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uAtlas; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb;
        varying vec2 vUv; varying float vShade;
        void main() {
          #include <logdepthbuf_fragment>
          vec4 c = texture2D(uAtlas, vUv);
          // Further out the mips average the black around the leaves in: alpha thins (trees went
          // sparse next to Unreal's full canopy) and colour darkens. Keep coverage per mip level
          // and divide the black back out.
          vec2 ts = vec2(textureSize(uAtlas, 0));
          vec2 dx = dFdx(vUv * ts), dy = dFdy(vUv * ts);
          float lod = max(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0);
          if (c.a * (1.0 + 0.3 * lod) < 0.5) discard;
          c.rgb = min(c.rgb / mix(1.0, max(c.a, 0.25), clamp(lod - 0.5, 0.0, 1.0)), vec3(1.0));
          vec3 lit = c.rgb * (uAmb + uSunCol * max(uSunDir.y, 0.0) * 0.9) * vShade;
          gl_FragColor = vec4(lit, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uAtlas.value = atlas;
    return mat;
  }

  chunkKeyAt(x, z) {
    const m = this.world.m;
    return `${Math.floor((x - m.west) / m.chunk)}_${Math.floor((m.north + z) / m.chunk)}`;
  }

  async loadChunk(key) {
    if (this.chunks.has(key) || this.loading.has(key)) return;
    const counts = this.world.m.veg.chunks[key];
    if (!counts) { this.chunks.set(key, null); return; }
    this.loading.add(key);
    const buf = await (await fetch(`${ASSETS}veg/inst_${key}.bin`)).arrayBuffer();
    const dv = new DataView(buf);
    const m = this.world.m;
    const [i, j] = key.split('_').map(Number);
    const x0 = m.west + i * m.chunk, y1 = m.north - j * m.chunk;
    const variants = [];
    let rec = 0;
    const treeRows = [], shrubRows = [];
    counts.forEach((n, vi) => {
      const pos = new Float32Array(n * 3), rot = new Float32Array(n), sc = new Float32Array(n);
      for (let k = 0; k < n; k++, rec++) {
        const o = rec * 8;
        const x = x0 + dv.getUint16(o, true) / 65535 * m.chunk;
        const y = y1 - dv.getUint16(o + 2, true) / 65535 * m.chunk;
        pos[k * 3] = x; pos[k * 3 + 1] = dv.getInt16(o + 4, true) / 100; pos[k * 3 + 2] = -y;
        rot[k] = dv.getUint8(o + 6) / 256 * Math.PI * 2;
        sc[k] = dv.getUint8(o + 7) / 100;
      }
      variants.push({ pos, rot, sc, n });
      const kind = this.variants[vi].kind;
      if (this.variants[vi].imp && !kind.startsWith('grass')) (TREE_KINDS.has(kind) ? treeRows : shrubRows).push(vi);
    });
    // billboards: one instanced quad per tree / shrub
    const centre = new THREE.Vector3(x0 + m.chunk / 2, 0, -(y1 - m.chunk / 2));
    const imp = this.billboards(variants, treeRows, this.impMat, centre);
    const impShrub = this.billboards(variants, shrubRows, this.impMatShrub, centre);
    this.chunks.set(key, { variants, imp, impShrub });
    this.loading.delete(key);
    this.lastPick.set(1e9, 0, 0);   // re-pick near meshes with the new data
  }

  billboards(variants, rows, mat, centre) {
    let total = 0;
    for (const vi of rows) total += variants[vi].n;
    const iPos = new Float32Array(total * 3), iTile = new Float32Array(total * 4), iSize = new Float32Array(total * 3);
    let t = 0;
    for (const vi of rows) {
      const v = variants[vi], imp = this.variants[vi].imp;
      for (let k = 0; k < v.n; k++, t++) {
        iPos.set(v.pos.subarray(k * 3, k * 3 + 3), t * 3);
        iTile.set(imp.uv, t * 4);
        iSize[t * 3] = imp.w * v.sc[k]; iSize[t * 3 + 1] = imp.h * v.sc[k]; iSize[t * 3 + 2] = imp.base * v.sc[k];
      }
    }
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    quad.setAttribute('iTile', new THREE.InstancedBufferAttribute(iTile, 4));
    quad.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 3));
    quad.instanceCount = total;
    quad.boundingSphere = new THREE.Sphere(centre, this.world.m.chunk);
    const mesh = new THREE.Mesh(quad, mat);
    mesh.visible = !this.settings.hidden;
    this.group.add(mesh);
    return mesh;
  }

  update(camPos) {
    const m = this.world.m;
    // load chunks within the far radius
    const r = this.settings.farR;
    for (let i = 0; i < m.nx; i++) {
      for (let j = 0; j < m.ny; j++) {
        const cx = m.west + (i + 0.5) * m.chunk, cz = -(m.north - (j + 0.5) * m.chunk);
        if (Math.hypot(camPos.x - cx, camPos.z - cz) < r + m.chunk * 0.75) this.loadChunk(`${i}_${j}`);
      }
    }
    this.impMat.uniforms.uNearR.value = this.settings.treeR - 15;
    this.impMat.uniforms.uFarR.value = this.settings.farR;
    this.impMatShrub.uniforms.uNearR.value = this.settings.shrubR - 10;
    this.impMatShrub.uniforms.uFarR.value = Math.min(this.settings.farR, 1800);
    if (camPos.distanceTo(this.lastPick) < 25) return;
    this.lastPick.copy(camPos);
    this.pickNear(camPos);
  }

  pickNear(camPos) {
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const keys = [];
    const m = this.world.m;
    for (const [key, c] of this.chunks) {
      if (!c) continue;
      const [i, j] = key.split('_').map(Number);
      const cx = m.west + (i + 0.5) * m.chunk, cz = -(m.north - (j + 0.5) * m.chunk);
      if (Math.hypot(camPos.x - cx, camPos.z - cz) < this.settings.treeR + m.chunk * 0.75) keys.push(key);
    }
    this.near.forEach((nv, vi) => {
      const R = nv.kind === 'tree' ? this.settings.treeR : (nv.kind === 'shrub' ? this.settings.shrubR : this.settings.grassR);
      const cap = Math.min(nv.cap, nv.kind === 'tree' ? this.settings.maxTrees : (nv.kind === 'shrub' ? this.settings.maxShrubs : this.settings.maxGrass));
      const hidden = this.settings.hidden && nv.kind !== 'grass';
      let n = 0;
      const arr = nv.attr.array;
      if (!hidden) {
        for (const key of keys) {
          const v = this.chunks.get(key).variants[vi];
          for (let k = 0; k < v.n && n < cap; k++) {
            const dx = v.pos[k * 3] - camPos.x, dz = v.pos[k * 3 + 2] - camPos.z;
            if (dx * dx + dz * dz > R * R) continue;
            p.set(v.pos[k * 3], v.pos[k * 3 + 1], v.pos[k * 3 + 2]);
            q.setFromAxisAngle(up, v.rot[k]);
            s.setScalar(v.sc[k]);
            mtx.compose(p, q, s);
            mtx.toArray(arr, n * 16);
            n++;
          }
        }
      }
      nv.attr.needsUpdate = true;
      for (const im of nv.meshes) {
        im.count = n;
        im.castShadow = this.settings.shadows && nv.kind === 'tree';
      }
    });
  }

  setHidden(hidden) {
    this.settings.hidden = hidden;
    for (const c of this.chunks.values()) if (c) { c.imp.visible = !hidden; c.impShrub.visible = !hidden; }
    this.lastPick.set(1e9, 0, 0);
  }

  setLight(sunDir, sunCol, amb) {
    for (const mat of [this.impMat, this.impMatShrub]) {
      const u = mat.uniforms;
      u.uSunDir.value.copy(sunDir);
      u.uSunCol.value.copy(sunCol);
      u.uAmb.value.copy(amb);
    }
  }
}
