// To-scale comparison maps (settings: COMPARE WITH). The images and their placement come from
// map.stateofleonida.net's "Rockstar maps" (data/maps/rockstar.json; files copied with the user's OK
// into assets/compare/, the SVG drawn out to a WebP by scripts/overlay_raster.py). Their bounds are in
// the same metres as this map (x = lng, y = lat). As on that site: the GTA V drawing keeps its shape
// inside its bounds (fitted to the height, centred), the RDR2 image is stretched to its bounds.
// Each map lies flat over Leonida and draws on top of everything, so it reads from the air.
import * as THREE from 'three';

const ASSETS = 'assets/compare/';
export const MAPS = {
  gta5: { file: 'gtav.webp', label: 'GTA V map (to scale)', south: -3600.698, west: -5000, north: 7679.719, east: 5000, aspect: 1700.8 / 2267.7, order: 6 },
  rdr2: { file: 'rdr2.webp', label: 'RDR2 map (to scale)', south: -3100, west: -5900, north: 5300, east: 4400, order: 5 },
};

function label(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const x = cv.getContext('2d');
  x.font = 'bold 44px system-ui, sans-serif';
  const w = Math.min(500, x.measureText(text).width + 48);
  x.fillStyle = 'rgba(10,12,20,0.85)'; x.beginPath(); x.roundRect(256 - w / 2, 12, w, 72, 18); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 49);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, fog: false, toneMapped: false }));
  s.scale.set(0.16, 0.03, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 9;
  return s;
}

export class Compare {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    app.scene.add(this.group);
    this.maps = {};       // id -> { mesh, label } once loaded
    this.on = {};
    this.opacity = 0.7;
  }

  // load on first use (each image is ~1 MB; most visitors never turn them on)
  async build(id) {
    if (this.maps[id]) return this.maps[id];
    const m = MAPS[id];
    const tex = await new THREE.TextureLoader().loadAsync(ASSETS + m.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.app.renderer.capabilities.getMaxAnisotropy();
    let w = m.east - m.west, h = m.north - m.south;
    if (m.aspect) w = Math.min(w, h * m.aspect);   // keep the drawing's shape, centred in its bounds
    const cx = (m.west + m.east) / 2, cy = (m.south + m.north) / 2;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);   // image top = north (-z)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: this.opacity, depthTest: false, depthWrite: false,
      toneMapped: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 1, -cy);
    mesh.renderOrder = m.order;
    const tag = label(m.label);
    tag.position.set(cx, 1, -(cy + h / 2));   // over the north edge
    this.group.add(mesh, tag);
    this.maps[id] = { mesh, tag };
    return this.maps[id];
  }

  async set(id, on) {
    this.on[id] = on;
    if (!on && !this.maps[id]) return;
    const m = await this.build(id);
    const vis = !!this.on[id];   // it may have been switched off again while loading
    m.mesh.visible = vis; m.tag.visible = vis;
  }

  setOpacity(o) {
    this.opacity = o;
    for (const { mesh } of Object.values(this.maps)) mesh.material.opacity = o;
  }

  // Every frame (main.js, after the sky has set the fog): while a map is on, the haze and the view
  // distance grow with height, so Leonida stays visible under it from several km up. Otherwise the
  // normal settings (sky.js / ui.js) are left alone.
  update(cam) {
    const base = this.app.day.drawDistance * 1.6;
    const active = Object.values(this.on).some(Boolean);
    const alt = Math.max(0, cam.position.y);
    let far = base;
    if (active) {
      const fog = this.app.scene.fog;
      fog.near = Math.max(fog.near, alt * 0.9);
      fog.far = Math.max(fog.far, alt * 2.4 + 4000);
      far = Math.max(base, alt * 2.6 + 6000);
    }
    if (cam.far !== far) { cam.far = far; cam.updateProjectionMatrix(); }
  }
}
