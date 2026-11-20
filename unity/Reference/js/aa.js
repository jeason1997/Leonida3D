// Anti-aliasing. The canvas itself has 4x MSAA (WebGLRenderer antialias). "MSAA + SMAA" renders the scene
// into a 4x multisampled target instead and runs SMAA over it, which also smooths what MSAA can't reach:
// shading edges, sub-pixel rails and lane lines, specular sparkle on water and glass.
// The target is flagged like an XR one so three.js tone-maps and sRGB-encodes into it exactly as it does for
// the canvas: fog, sky and horizon colours are tuned as display values (sky.js, materials.js), so the look is
// unchanged, and SMAA gets the display-encoded image it is meant to work on.
import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class AntiAlias {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.mode = 'msaa';
    this.rt = null;
    this.smaa = null;
    this._size = new THREE.Vector2();
  }

  setMode(mode) {
    this.mode = mode === 'smaa' ? 'smaa' : 'msaa';
    if (this.mode === 'smaa' && !this.rt) {
      const s = this.renderer.getDrawingBufferSize(this._size);
      this.rt = new THREE.WebGLRenderTarget(s.x, s.y, { samples: 4, type: THREE.UnsignedByteType });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
      this.rt.isXRRenderTarget = true;   // tone mapping + sRGB output like the canvas (see above)
      // the flag stores the multisample buffer as plain RGBA8 (the shaders already encode sRGB), but the
      // resolved texture would get SRGB8_ALPHA8 and WebGL won't resolve between different formats: pin it
      this.rt.texture.internalFormat = 'RGBA8';
      this.smaa = new SMAAPass(s.x, s.y);
      this.smaa.renderToScreen = true;
    }
    this.resize();
  }

  // after the canvas size or pixel ratio changes
  resize() {
    if (!this.rt) return;
    const s = this.renderer.getDrawingBufferSize(this._size);
    if (this.rt.width !== s.x || this.rt.height !== s.y) {
      this.rt.setSize(s.x, s.y);
      this.smaa.setSize(s.x, s.y);
    }
  }

  render() {
    const r = this.renderer;
    if (this.mode !== 'smaa') {
      r.render(this.scene, this.camera);
      return;
    }
    this.resize();
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    this.smaa.render(r, null, this.rt);
  }
}
