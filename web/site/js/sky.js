// Sky, sun, fog and time of day. Same Florida sun path as the Unreal build (LeonidaPlayerController::
// SetHour): up in the east at 6, 60 deg high in the south at noon, down in the west at 18.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { shared } from './materials.js';

// Daytime sun (three.js lux-ish units). Was 3.6 while matching the Unreal captures, but those were
// taken at a pinned exposure and come out darker than the game looks: the user found the site too dark.
const SUN = 5.0;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Fair-weather cumulus over the visible sky (Unreal's sky has clouds; the three.js Sky is clear
// haze): fbm on a flat layer, drifting slowly, lit from setHour. Reflections use a clear sky.
const SKY_CLOUDS = /* glsl */`
uniform float uGain; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform vec3 uCloudGlow; uniform float uWarm; uniform float uTime;
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), f.x), f.y); }
float cFbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * cNoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
vec3 clouds(vec3 d, vec3 sky, vec3 sd) {
  if (d.y <= 0.0) return sky;
  // around sunset the clouds towards the sun glow (light through thin edges, lit undersides)
  float toward = pow(max(dot(d, normalize(sd)), 0.0), 3.0);
  // golden hour: the low sky goes gold, most of all towards the sun (the Sky shader stays whitish)
  sky *= mix(vec3(1.0), vec3(1.3, 0.86, 0.58), uWarm * pow(1.0 - d.y, 3.0) * (0.45 + 0.55 * toward));
  vec2 p = d.xz / (d.y + 0.08) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
  float n = cFbm(p);
  float cov = smoothstep(0.4, 0.64, n) * smoothstep(0.01, 0.12, d.y);
  float core = smoothstep(0.58, 0.9, n);
  vec3 c = mix(uCloudLit, uCloudShade, core * 0.9) + uCloudGlow * toward * (1.0 - 0.6 * core);
  return mix(sky, c, cov * 0.92);
}
`;
function addClouds(sky, uniforms) {
  sky.material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', SKY_CLOUDS + 'void main() {')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( clouds( direction, retColor * uGain, vSunDirection ), 1.0 );');
  };
}

export class Daylight {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(400000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.skyU = { uGain: { value: 1 }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uCloudGlow: { value: new THREE.Color() }, uWarm: { value: 0 }, uTime: shared.uTime };
    addClouds(this.sky, this.skyU);
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8ca8ff, 0);
    scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5040, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xbcd0e6, 2000, 9000);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    Object.assign(this.envSky.material.uniforms.turbidity, { value: 3.2 });
    // the reflected sky gets the clouds too (they are what shows the waves on the water), at full
    // sky brightness since the scene's environment intensity sets the overall level
    addClouds(this.envSky, { ...this.skyU, uGain: { value: 1 } });
    this.envScene.add(this.envSky);
    // The Sky shader is bright haze below the horizon too, so glass seen from above mirrored white
    // and every wall got a strong fill from below. A ground disc gives reflections and ambient a
    // dark lower half like Unreal's (Lumen sees the city there).
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(1900, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ fog: false }));
    this.envGround.position.y = -2;
    this.envScene.add(this.envGround);
    this.dir = new THREE.Vector3();
    this.hour = 11;
    this.lastEnvHour = -99;
    this.shadowRange = 250;
    this.drawDistance = 9000;
  }

  setShadowQuality(mapSize, range) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== mapSize) {
      s.mapSize.set(mapSize, mapSize);
      s.map?.dispose(); s.map = null;
    }
    this.shadowRange = range;
    this.shadowR = 0;
    this.sun.castShadow = mapSize > 0;
    s.camera.near = 1; s.camera.far = 6000;
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    const el = Math.asin(Math.sin(THREE.MathUtils.degToRad(60)) * Math.sin(Math.PI * (this.hour - 6) / 12));
    const az = THREE.MathUtils.degToRad(90 + (this.hour - 6) * 15);
    this.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const elD = THREE.MathUtils.radToDeg(el);
    this.sky.material.uniforms.sunPosition.value.copy(this.dir);
    shared.uSunDir.value.copy(this.dir);
    {
      // the three.js Sky only reddens right at the horizon; more haze and Rayleigh while the sun is low
      // give a proper orange sky and a wide glow around the sun (same for the reflected sky)
      const lw = 1 - smooth(-2, 20, elD);
      for (const sky of [this.sky, this.envSky]) {
        const u = sky.material.uniforms;
        u.turbidity.value = 3.2 + 2.5 * lw; u.rayleigh.value = 1.4 + 2.6 * lw;
        u.mieCoefficient.value = 0.004 + 0.003 * lw; u.mieDirectionalG.value = 0.8 + 0.12 * lw;
      }
    }
    // light levels
    const day = smooth(-4, 8, elD);           // 0 night .. 1 day
    const low = 1 - smooth(2, 22, elD);       // golden hour -> sunset
    // around sunset: 0 by day, 1 from the last few degrees of sun until ~7 deg after it has set
    const glow = smooth(-7, 1, elD) * (1 - smooth(6, 18, elD));
    // white -> gold -> deep orange at the horizon
    const sunCol = new THREE.Color().setRGB(1, 0.97 - 0.42 * low, 0.92 - 0.72 * low);
    this.sun.color.copy(sunCol);
    // Sun against sky fill like the Unreal build: a strong sun, a dim sky fill, so shadow sides read
    // darker (the fill used to be almost as strong as the sun and every wall came out white).
    // stays strong until the last degrees, so golden hour actually lights the city
    this.sun.intensity = SUN * smooth(-1.5, 4, elD);
    this.moon.intensity = 0.25 * (1 - day);
    this.hemi.intensity = 0.05 + 0.07 * day;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.62 + 0.2 * day, 0.85);
    this.hemi.groundColor.setRGB(0.25 * day + 0.03, 0.22 * day + 0.03, 0.18 * day + 0.04);
    this.renderer.toneMappingExposure = 0.56 + 0.44 * (1 - day);
    // fog / horizon colour
    // fog mixes in after tone mapping, so these are display values: Unreal's haze is a grey-blue
    const fogDay = new THREE.Color(0.6, 0.66, 0.72), fogGold = new THREE.Color(0.9, 0.6, 0.4);
    const fogDusk = new THREE.Color(0.38, 0.27, 0.38), fogNight = new THREE.Color(0.03, 0.04, 0.08);
    const f = fogDay.clone().lerp(fogGold, low * smooth(-2, 3, elD)).lerp(fogDusk, 1 - smooth(-2, 2, elD))
      .lerp(fogNight, 1 - smooth(-12, -3, elD));
    this.scene.fog.color.copy(f);
    this.renderer.setClearColor(f);
    this.sunCol = sunCol.clone().multiplyScalar(this.sun.intensity / 3.6);
    // visible sky a deeper blue like Unreal's; clouds sunlit on top, blue-grey underneath
    this.skyU.uGain.value = 0.45 + 0.55 * (1 - day) + 0.3 * glow;
    // Clouds sit high, so they catch the sun until it is ~8 deg below the horizon: orange while it
    // sets, pink afterwards, purple-grey cores, and a glow on the ones towards the sun.
    const cloudSun = smooth(-8, 1, elD);
    const sunset = new THREE.Color(1.0, 0.42, 0.16).lerp(new THREE.Color(0.92, 0.28, 0.42), 1 - smooth(-5, 2, elD));
    this.skyU.uCloudLit.value.copy(this.sunCol).multiplyScalar(1.3).add(new THREE.Color(0.3, 0.32, 0.36).multiplyScalar(day))
      .lerp(sunset.clone().multiplyScalar(0.7 * cloudSun), glow).add(new THREE.Color(0.012, 0.014, 0.02));
    this.skyU.uCloudShade.value.setRGB(0.48, 0.53, 0.62).multiplyScalar(0.15 + 0.85 * day)
      .lerp(new THREE.Color(0.42, 0.3, 0.42).multiplyScalar(0.3 + 0.7 * cloudSun), glow).multiplyScalar(0.05 + 0.95 * Math.max(day, cloudSun));
    // (kept below white: brighter and tone mapping bleaches the oranges to pale pink)
    this.skyU.uCloudGlow.value.copy(sunset).multiplyScalar(0.85 * glow * cloudSun);
    this.skyU.uWarm.value = glow * smooth(-3, 2, elD);
    // glass mirrors the sunset sky (the sky fill is kept low by day, which left towers dull at dusk)
    shared.uReflBoost.value = 1 + 2.5 * glow;
    // billboard trees: the hemisphere plus roughly what the sky environment gives the mesh trees
    this.ambCol = this.hemi.color.clone().multiplyScalar(this.hemi.intensity + 0.11 * day + 0.01);
    if (Math.abs(this.hour - this.lastEnvHour) > 0.2) this.updateEnv();
  }

  updateEnv() {
    this.lastEnvHour = this.hour;
    this.envSky.material.uniforms.sunPosition.value.copy(this.dir);
    const elD = THREE.MathUtils.radToDeg(Math.asin(this.dir.y));
    const day = smooth(-4, 8, elD);
    const envI = 0.06 + 0.08 * day;
    // ground radiance as the scene renders it (albedo ~0.12 under sun + sky), in env units
    const E = SUN * smooth(-2, 6, elD) * Math.max(this.dir.y, 0) + 0.6 * day;
    const g = 0.12 * E / Math.PI / envI + 0.01;
    this.envGround.material.color.setRGB(g, g * 0.98, g * 0.86);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = envI;
  }

  follow(camPos, camDir, groundY = 0) {
    // The shadow box rides with the camera, snapped to texels so edges don't crawl. From the air it
    // grows with height (up to 4x) and moves ahead onto the ground in view, so the city casts
    // shadows across the view like Unreal's instead of only under the camera.
    const s = this.sun.shadow, ms = s.mapSize.x || 1024;
    const h = Math.max(camPos.y - groundY, 0);
    const r = Math.min(Math.max(this.shadowRange, Math.round(h * 1.4 / 50) * 50), this.shadowRange * 4);
    if (r !== this.shadowR) {
      this.shadowR = r;
      const c = s.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r;
      c.updateProjectionMatrix();
      s.normalBias = Math.max(0.6, (2 * r / ms) * 0.8);
    }
    const texel = (2 * r) / ms;
    let ax = 0, az = 0;
    if (camDir) {
      const l = Math.hypot(camDir.x, camDir.z) || 1;
      ax = camDir.x / l * r * 0.6; az = camDir.z / l * r * 0.6;
    }
    const t = this.sun.target.position;
    t.set(Math.round((camPos.x + ax) / texel) * texel, Math.max(groundY, Math.min(camPos.y - 60, groundY + 60)),
      Math.round((camPos.z + az) / texel) * texel);
    this.sun.position.copy(t).addScaledVector(this.dir.y > 0.02 ? this.dir : new THREE.Vector3(0, 1, 0), 2500);
    this.moon.target.position.copy(t);
    this.moon.position.copy(t).add(new THREE.Vector3(-0.4, 0.8, 0.45).multiplyScalar(2500));
    this.sky.position.copy(camPos);
    this.scene.fog.near = this.drawDistance * 0.08;   // Unreal's aerial haze starts early and builds slowly
    this.scene.fog.far = this.drawDistance;
  }
}
