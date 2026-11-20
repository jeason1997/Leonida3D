// Materials: three.js standard (PBR) materials with the Unreal shaders' patterns patched in, so
// lighting, shadows, fog and the log depth buffer keep working. Ported from scripts/ue_materials.py
// (FACADE_HLSL, ROOF_HLSL, ROAD_MARKINGS_HLSL). glTF flips v, as Unreal does, so the same "1 - v"s apply.
import * as THREE from 'three';

// Shared by every patched material: the sun (for night lights) and a city-lights switch.
export const shared = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },   // towards the sun, three.js axes (y up)
  uCityLights: { value: 1.0 },
  uTime: { value: 0 },
  uAOStrength: { value: 1.0 },   // baked ambient occlusion (scripts/web_ao.py), 0 = off
  uReflBoost: { value: 1.0 },    // sky reflections on facades (glass), raised around sunset by sky.js
};

const COMMON = /* glsl */`
uniform vec3 uSunDir;
uniform float uCityLights;
uniform float uTime;
uniform float uReflBoost;
float nightAmount() { return clamp((0.07 - uSunDir.y) / 0.1, 0.0, 1.0) * uCityLights; }
`;

// Baked ambient occlusion: a chunk's sky-visibility map (web/assets/ao/ao_<k>.webp, 2 m texels, row 0 =
// north) looked up by world position. It mostly scales the sky light (indirect diffuse / specular) and
// only a little of the sun, so sunlit streets stay bright while shade, canyons and corners darken.
const AO_HEAD = /* glsl */`
varying vec3 vWorldP;
uniform sampler2D uAO; uniform vec4 uAOChunk; uniform float uAOStrength;   // uAOChunk = x0, y1, C, loaded
float aoAt(vec2 mp) {
  if (uAOChunk.w < 0.5) return 1.0;
  vec2 uv = vec2((mp.x - uAOChunk.x) / uAOChunk.z, (uAOChunk.y - mp.y) / uAOChunk.z);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return pow(texture2D(uAO, uv).r, 1.5);
}
// The sky fill is weak next to the sun here (matched to Unreal's dark shade), so occlusion also takes
// some of the sun: a little near the camera, where real shadow maps do that job, and most of it past
// the shadow range (~350 m), where nothing else grounds the buildings.
void applyAO(inout ReflectedLight rl, float v) {
  float o = mix(1.0, v, uAOStrength);
  rl.indirectDiffuse *= o; rl.indirectSpecular *= o;
  float far = smoothstep(150.0, 450.0, length(vWorldP - cameraPosition));
  rl.directDiffuse *= mix(1.0, o, mix(0.45, 0.85, far));
}
`;

// per-material AO uniforms; material.setAO(tex, x0, y1, C) once the chunk's map has loaded
function withAO(material) {
  material.aoU = { uAO: { value: null }, uAOChunk: { value: new THREE.Vector4(0, 0, 1, 0) } };
  material.setAO = (tex, x0, y1, C) => { material.aoU.uAO.value = tex; material.aoU.uAOChunk.value.set(x0, y1, C, tex ? 1 : 0); };
  return material;
}

// ao: GLSL that sets "float aoVal" (vWorldP = world position, normal = view-space normal)
function patch(material, { vertexHead = '', vertexBody = '', fragmentHead = '', fragmentAfterColor = '',
  fragmentAfterRough = '', fragmentAfterMetal = '', fragmentAfterEmissive = '', afterLightMaps = '', ao = '' }) {
  if (ao) withAO(material);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, material.aoU || {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + vertexHead + (ao ? '\nvarying vec3 vWorldP;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertexBody);
    if (ao) {
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON + (ao ? AO_HEAD : '') + fragmentHead)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + fragmentAfterColor)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + fragmentAfterRough)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + fragmentAfterMetal)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + fragmentAfterEmissive)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + afterLightMaps);
    if (ao) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
        `#include <aomap_fragment>\n{\n${ao}\n  applyAO(reflectedLight, aoVal);\n}`);
    }
  };
  material.customProgramCacheKey = () => material.name + '_patched';
  return material;
}

// walls: the ground just outside the wall, fading towards open sky higher up (street canyons stay
// darker lower down), and a little contact shadow at the very foot
const FACADE_AO = /* glsl */`
  float zA = 1.0 - vF.y;
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  vec2 outward = normalize(vec2(nW.x, -nW.z) + 1e-5);
  float g = aoAt(vec2(vWorldP.x, -vWorldP.z) + outward * 2.5);
  float aoVal = mix(g, 1.0, smoothstep(0.0, 20.0, zA)) * mix(0.72, 1.0, smoothstep(0.0, 1.5, zA));`;
// roofs: next to taller neighbours; half strength (2 m texels blur into the ground at roof edges)
const ROOF_AO = /* glsl */`  float aoVal = mix(1.0, aoAt(vec2(vWorldP.x, -vWorldP.z)), 0.5);`;
const GROUND_AO = /* glsl */`  float aoVal = aoAt(vec2(vWorldP.x, -vWorldP.z));`;

// ------------------------------------------------------------------------------- facades
const FACADE_VERT_HEAD = /* glsl */`
attribute vec2 uv1;
attribute vec2 uv2;
varying vec2 vF; varying vec2 vS; varying vec2 vL;
`;
const FACADE_VERT_BODY = /* glsl */`vF = uv; vS = uv1; vL = uv2;`;

const FACADE_FRAG_HEAD = /* glsl */`
varying vec2 vF; varying vec2 vS; varying vec2 vL;
float gAa, gSeed;
#define LBOX(x, h) clamp(((h) - abs(x)) / gAa + 0.5, 0.0, 1.0)
#define LRANGE(x, a, b) (clamp(((x) - (a)) / gAa + 0.5, 0.0, 1.0) * clamp(((b) - (x)) / gAa + 0.5, 0.0, 1.0))
float LHASH(float a, float b) { return fract(sin(a * 12.9898 + b * 78.233 + gSeed * 37.719) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
const vec3 pastel[7] = vec3[7](vec3(0.98,0.70,0.73), vec3(0.60,0.89,0.79), vec3(0.99,0.88,0.56), vec3(0.58,0.81,0.96),
                               vec3(0.84,0.73,0.94), vec3(0.97,0.95,0.90), vec3(0.99,0.75,0.57));
const vec3 accentP[5] = vec3[5](vec3(0.06,0.60,0.62), vec3(0.95,0.40,0.44), vec3(0.99,0.77,0.22), vec3(0.18,0.44,0.86), vec3(0.97,0.97,0.96));
const vec3 whites[5] = vec3[5](vec3(0.95,0.94,0.91), vec3(0.94,0.90,0.81), vec3(0.87,0.88,0.89), vec3(0.86,0.92,0.92), vec3(0.93,0.87,0.77));
const vec3 earth[6] = vec3[6](vec3(0.93,0.85,0.70), vec3(0.96,0.94,0.89), vec3(0.91,0.71,0.58), vec3(0.97,0.88,0.62),
                              vec3(0.83,0.79,0.71), vec3(0.80,0.89,0.80));
const vec3 greys[4] = vec3[4](vec3(0.71,0.71,0.69), vec3(0.79,0.75,0.68), vec3(0.63,0.64,0.67), vec3(0.85,0.84,0.81));
const vec3 glassP[5] = vec3[5](vec3(0.13,0.27,0.31), vec3(0.08,0.16,0.28), vec3(0.18,0.19,0.21), vec3(0.14,0.24,0.19), vec3(0.24,0.28,0.34));
const vec3 metalP[5] = vec3[5](vec3(0.89,0.90,0.90), vec3(0.77,0.79,0.81), vec3(0.56,0.66,0.76), vec3(0.83,0.79,0.69), vec3(0.67,0.73,0.67));
const vec3 neonP[4] = vec3[4](vec3(1.0,0.22,0.72), vec3(0.15,0.95,1.0), vec3(0.62,0.28,1.0), vec3(0.25,0.55,1.0));
float fRough, fMetal; vec3 fEmit;
`;

// The facade pattern (FACADE_HLSL): writes diffuseColor.rgb and fRough / fMetal / fEmit.
const FACADE_FRAG_COLOR = /* glsl */`
{
  float style = floor(vS.x);
  gSeed = fract(vS.x);
  float seed = gSeed;
  float H = max(1.0 - vS.y, 3.0);
  float u = vF.x;
  float z = 1.0 - vF.y;
  float halfL = max(vL.x, 0.5);
  gAa = max(max(abs(dFdx(u)) + abs(dFdy(u)), abs(dFdx(z)) + abs(dFdy(z))), 0.003);
  float aa = gAa;
  float r1 = fract(seed * 13.17), r2 = fract(seed * 71.31), r3 = fract(seed * 191.7);
  vec3 wallC = whites[0], glassC = glassP[0], frameC = vec3(0.85, 0.85, 0.83);
  float glass = 0.0, frame = 0.0, accent = 0.0, dark = 0.0, shade = 0.0, shop = 0.0;
  float glassMetal = 0.0, curtainOdds = 0.14;
  vec3 accentC = accentP[int(r2 * 4.99)];
  vec3 darkC = vec3(0.06, 0.05, 0.05);
  float texAmt = 0.4, wallRough = 0.85, wallMetal = 0.0, floorH = 3.2, glassFrac = 0.4;
  float inner = 1.0, fi, fz, bi, bx, bayW = 3.0;
  int st = int(style);
  if (st == 0) {
    floorH = 4.0; bayW = 1.5;
    glassC = glassP[int(r1 * 4.99)]; frameC = mix(vec3(0.22,0.24,0.27), vec3(0.75,0.76,0.78), r3);
    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
    float pane = LBOX(bx, bayW * 0.5 - 0.05) * LRANGE(fz, 0.12, floorH - 0.03);
    float spandrel = pane * (1.0 - LRANGE(fz, 1.0, floorH + 1.0));
    float lobby = 1.0 - clamp((z - 5.5) / aa + 0.5, 0.0, 1.0);
    float cap = clamp((z - (H - 2.2)) / aa + 0.5, 0.0, 1.0);
    glass = (pane - spandrel) * (1.0 - cap) + lobby * LBOX(bx, bayW * 0.5 - 0.06);
    dark = spandrel * (1.0 - cap) * (1.0 - lobby); darkC = glassC * 0.55;
    frame = 1.0 - glass - dark;
    wallC = frameC; texAmt = 0.1; wallRough = 0.35; wallMetal = 0.8; glassFrac = 0.85; glassMetal = 0.3; curtainOdds = 0.06;
  } else if (st == 1) {
    floorH = 3.2; bayW = 4.2;
    wallC = whites[int(r1 * 4.99)]; glassC = glassP[int(r2 * 4.99)] * 0.6;
    inner = LBOX(u, halfL - 1.2);
    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
    float body = LRANGE(z, 4.5, H - 1.2);
    float balc = r3 > 0.3 ? 1.0 : 0.0;
    float win = LBOX(bx, balc > 0.0 ? 1.75 : 1.1) * LRANGE(fz, 0.3, floorH - (balc > 0.0 ? 0.25 : 0.7)) * inner * body;
    float rail = LRANGE(fz, 0.3, 1.3) * inner * body * balc;
    float slab = (1.0 - LRANGE(fz, 0.3, floorH + 1.0)) * body * inner * balc;
    float lobby = (1.0 - clamp((z - 4.3) / aa + 0.5, 0.0, 1.0)) * LBOX(bx, 1.8) * inner * LRANGE(z, 0.2, 9.0);
    glass = clamp(win + lobby, 0.0, 1.0) * (1.0 - rail * 0.6);
    frame = rail * 0.6; frameC = mix(glassC * 2.2 + 0.18, vec3(0.88, 0.92, 0.92), 0.45);
    accent = slab; accentC = mix(wallC, vec3(0.98, 0.98, 0.97), 0.7);
    shade = 0.5 * LRANGE(fz, floorH - 0.55, floorH + 1.0) * body * inner * balc;
    shop = lobby; texAmt = 0.3; glassFrac = 0.55; curtainOdds = 0.3;
  } else if (st == 2) {
    floorH = 3.3; bayW = 3.2;
    wallC = pastel[int(r1 * 6.99)]; glassC = vec3(0.05, 0.08, 0.09);
    inner = LBOX(u, halfL - 0.9);
    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
    float body = LRANGE(z, 3.6, H - 1.3);
    float fin = LBOX(u, 0.75) * (halfL > 5.0 ? 1.0 : 0.0) * LRANGE(z, 3.6, H + 1.0);
    float win = LBOX(bx, 0.65) * LRANGE(fz, 0.9, 2.5) * inner * body * (1.0 - fin);
    float trim = LBOX(bx, 0.73) * LRANGE(fz, 0.82, 2.58) * inner * body * (1.0 - fin) - win;
    float brow = LBOX(bx, 0.95) * LRANGE(fz, 2.68, 2.85) * inner * body * (1.0 - fin);
    float browShade = LBOX(bx, 0.95) * LRANGE(fz, 2.2, 2.68) * inner * body * (1.0 - fin);
    float store = LBOX(bx, 1.35) * LRANGE(z, 0.3, 3.0) * inner;
    float awning = LRANGE(z, 3.0, 3.5) * inner;
    float band = LRANGE(z, H - 1.05, H - 0.85);
    float speed = (LRANGE(z, H - 2.05, H - 1.9) + LRANGE(z, H - 2.45, H - 2.3) + LRANGE(z, H - 2.85, H - 2.7)) * inner * (H > 7.0 ? 1.0 : 0.0);
    float pilaster = (1.0 - LBOX(u, halfL - 0.55)) * LRANGE(z, 0.0, H - 0.85);
    glass = win + store; shop = store;
    frame = clamp(trim + pilaster, 0.0, 1.0); frameC = vec3(0.97, 0.97, 0.95);
    accent = clamp(fin + brow + awning * (0.5 + 0.5 * step(0.5, fract(u / 0.9))) + band + speed, 0.0, 1.0);
    shade = 0.35 * browShade * (1.0 - smoothstep(2.2, 2.68, fz)) + 0.35 * LRANGE(z, 2.6, 3.0) * inner;
    texAmt = 0.3; glassFrac = 0.25; curtainOdds = 0.25;
  } else if (st == 3) {
    floorH = 3.0; bayW = 3.8;
    wallC = earth[int(r1 * 5.99)]; glassC = vec3(0.05, 0.07, 0.08);
    inner = LBOX(u, halfL - 1.0);
    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
    float col = step(0.28, LHASH(bi, 1.0));
    float body = LRANGE(z, 0.0, H - 0.6);
    float win = LBOX(bx, 0.55) * LRANGE(fz, 1.0, 2.3) * inner * body * col;
    float trim = LBOX(bx, 0.63) * LRANGE(fz, 0.92, 2.38) * inner * body * col - win;
    float door = LBOX(bx, 0.5) * LRANGE(z, 0.0, 2.2) * inner * (1.0 - col);
    float cap = LRANGE(z, H - 0.45, H + 1.0);
    glass = win; frame = clamp(trim + cap, 0.0, 1.0); frameC = vec3(0.95, 0.95, 0.93);
    dark = door; darkC = vec3(0.18, 0.11, 0.07);
    shade = 0.25 * LBOX(bx, 0.63) * LRANGE(fz, 2.3, 2.45) * inner * body * col;
    texAmt = 0.4; glassFrac = 0.15; curtainOdds = 0.45;
  } else if (st == 4) {
    floorH = 3.8; bayW = 1.6;
    wallC = greys[int(r1 * 3.99)]; glassC = glassP[int(r2 * 4.99)];
    inner = LBOX(u, halfL - 0.6);
    fi = floor(z / floorH); fz = z - fi * floorH; bi = floor(u / bayW + 0.5); bx = u - bi * bayW;
    float body = LRANGE(z, 4.5, H - 1.0);
    float rib = LRANGE(fz, 1.0, 2.9) * inner * body;
    float store = LRANGE(z, 0.2, 3.9) * inner;
    float mull = 1.0 - LBOX(bx, bayW * 0.5 - 0.04);
    float b2 = floor(u / (bayW * 2.0) + 0.5), x2 = u - b2 * bayW * 2.0;
    float joint = (1.0 - LBOX(x2, bayW - 0.03)) * (1.0 - rib) * body;
    glass = clamp(rib + store, 0.0, 1.0) * (1.0 - mull); shop = store * (1.0 - mull);
    frame = clamp(rib + store, 0.0, 1.0) * mull; frameC = vec3(0.3, 0.31, 0.32);
    dark = joint * 0.5; darkC = wallC * 0.6;
    shade = 0.3 * LRANGE(fz, 2.9, 3.15) * inner * body;
    texAmt = 0.75; glassFrac = 0.4; curtainOdds = 0.1;
  } else {
    floorH = 6.0; bayW = 4.0;
    wallC = metalP[int(r1 * 4.99)];
    inner = LBOX(u, halfL - 2.0);
    float rib = sin(u * 6.2832 / 0.2);
    float ribFade = clamp(1.0 - aa / 0.08, 0.0, 1.0);
    wallC *= 1.0 + 0.05 * rib * ribFade;
    float bD = floor(u / 14.0 + 0.5), xD = u - bD * 14.0;
    float door = LBOX(xD, 2.0) * LRANGE(z, 0.0, 4.2) * inner;
    float slat = sin(z * 6.2832 / 0.15);
    float b3 = floor(u / 3.0 + 0.5), x3 = u - b3 * 3.0;
    float clere = LBOX(x3, 1.0) * LRANGE(z, H - 2.4, H - 1.4) * inner * (H > 7.0 ? 1.0 : 0.0);
    float plinth = 1.0 - clamp((z - 1.0) / aa + 0.5, 0.0, 1.0);
    dark = door; darkC = vec3(0.32, 0.33, 0.34) * (1.0 + 0.12 * slat * ribFade);
    frame = clere; frameC = vec3(0.72, 0.78, 0.74);
    accent = plinth * (1.0 - door); accentC = vec3(0.45, 0.44, 0.42);
    texAmt = 0.15; wallRough = 0.45; wallMetal = 0.55; glassFrac = 0.05;
  }
  // grain (procedural stand-in for the concrete scan), grime streaks, dirt at the foot
  float grainN = vnoise(vec2(u, z) * 2.3) * 0.6 + vnoise(vec2(u, z) * 9.0) * 0.4;
  vec3 grain = vec3(0.82 + 0.36 * grainN);
  float sx = u * 1.7, s0 = LHASH(floor(sx), 3.0), s1 = LHASH(floor(sx) + 1.0, 3.0);
  float streak = mix(s0, s1, smoothstep(0.0, 1.0, fract(sx)));
  float grime = (1.0 - 0.10 * streak * clamp(1.0 - aa / 0.3, 0.0, 1.0)) * (1.0 - 0.15 * clamp(1.0 - z / 1.5, 0.0, 1.0));
  vec3 wall = wallC * mix(vec3(1.0), grain, texAmt) * grime;
  float ph = LHASH(floor(u / max(bayW, 1.0) + 0.5), floor(z / floorH));
  vec3 paneC = glassC * (0.75 + 0.5 * ph);
  float curtain = step(1.0 - curtainOdds, ph);
  paneC = mix(paneC, mix(vec3(0.62, 0.57, 0.48), vec3(0.75, 0.75, 0.73), fract(ph * 7.0)) * 0.55, curtain * 0.8);
  paneC = mix(paneC, vec3(0.55, 0.46, 0.33), clamp(shop, 0.0, 1.0) * 0.6);
  vec3 col = wall;
  col = mix(col, accentC, clamp(accent, 0.0, 1.0));
  col = mix(col, frameC, clamp(frame, 0.0, 1.0));
  col = mix(col, darkC, clamp(dark, 0.0, 1.0));
  col = mix(col, paneC, clamp(glass, 0.0, 1.0));
  col *= 1.0 - clamp(shade, 0.0, 1.0);
  float g = clamp(glass, 0.0, 1.0);
  float paneRough = mix(0.03 + 0.05 * ph, 0.85, clamp(curtain + shop, 0.0, 1.0));
  fRough = mix(mix(wallRough, 0.5, clamp(frame + dark, 0.0, 1.0)), paneRough, g);
  fMetal = mix(wallMetal * (1.0 - clamp(accent, 0.0, 1.0)), glassMetal * (1.0 - curtain), g);
  // far: box-filtered window grid -> soft stripes -> the facade's mean
  float far = clamp((aa / floorH - 0.12) / 0.3, 0.0, 1.0);
  float zg0 = 0.3, zg1 = 2.95, gw = 3.2, colOdds = 1.0, bw = bayW;
  if (st == 0) { zg0 = 1.0; zg1 = floorH - 0.03; gw = bayW - 0.1; }
  else if (st == 2) { zg0 = 0.9; zg1 = 2.5; gw = 1.3; }
  else if (st == 3) { zg0 = 1.0; zg1 = 2.3; gw = 1.1; colOdds = 0.72; }
  else if (st == 4) { zg0 = 1.0; zg1 = 2.9; gw = bayW - 0.08; }
  else if (st == 5) { zg0 = 0.0; zg1 = 0.0; gw = 0.0; bw = 4.0; }
  #define CUM(x, P, a0, a1) (floor((x) / (P)) * ((a1) - (a0)) + clamp((x) - floor((x) / (P)) * (P) - (a0), 0.0, (a1) - (a0)))
  float hz = max(aa, 0.05) * 0.5;
  float covZ = (CUM(z + hz, floorH, zg0, zg1) - CUM(z - hz, floorH, zg0, zg1)) / (2.0 * hz);
  float ug = u + bw * 0.5, g0 = bw * 0.5 - gw * 0.5, g1 = bw * 0.5 + gw * 0.5;
  float covU = (CUM(ug + hz, bw, g0, g1) - CUM(ug - hz, bw, g0, g1)) / (2.0 * hz) * colOdds;
  float gcov = clamp(covZ * covU, 0.0, 1.0) * LRANGE(z, 4.0, H - 1.2) * LBOX(u, halfL - 0.8);
  vec3 coarse = mix(wallC, glassC * 1.1, gcov);
  col = mix(col, coarse, far);
  fRough = mix(fRough, mix(wallRough, 0.12, glassFrac), far);
  fMetal = mix(fMetal, mix(wallMetal, glassMetal, glassFrac), far);
  // night: lit rooms, shop fronts, Deco neon, warehouse clerestories
  fEmit = vec3(0.0);
  float Night = nightAmount();
  if (Night > 0.001) {
    float fiN = floor(z / floorH);
    float biN = floor(u / max(bayW, 1.0) + 0.5);
    float lh = LHASH(biN + 31.0, fiN + 17.0);
    float lh2 = fract(lh * 57.31);
    bool work = (st == 0 || st == 4);
    float lit = work ? step(0.45, LHASH(17.0, fiN + 3.0)) * step(0.2, lh) : step(0.58, lh);
    vec3 warm = mix(vec3(1.0, 0.70, 0.40), vec3(1.0, 0.85, 0.64), lh2);
    vec3 cool = mix(vec3(0.78, 0.88, 1.0), vec3(0.95, 0.97, 1.0), lh2);
    vec3 roomC = work ? cool : (lh2 > 0.86 ? vec3(0.45, 0.6, 1.0) : warm);
    const float LEVEL = 0.65;
    vec3 emit = roomC * LEVEL * (0.6 + 0.8 * lh2) * (curtain > 0.5 ? 0.75 : 1.0) * lit * g;
    emit += vec3(1.0, 0.78, 0.52) * 1.6 * clamp(shop, 0.0, 1.0);
    if (st == 2) emit += neonP[int(r3 * 3.99)] * 6.0 * clamp(accent, 0.0, 1.0) * (1.0 - g);
    if (st == 5) emit += vec3(1.0, 0.85, 0.6) * 1.2 * clamp(frame, 0.0, 1.0);
    float lhc = LHASH(floor(biN / 2.0) + 71.0, fiN + 5.0);
    float share = clamp((lhc - 0.35) / 0.65, 0.0, 1.0); share *= share;
    vec3 roomCc = work ? vec3(0.86, 0.92, 1.0) : mix(vec3(1.0, 0.72, 0.44), vec3(1.0, 0.84, 0.62), fract(lhc * 31.7));
    float bodyN = LRANGE(z, 4.0, H - 1.5);
    vec3 patchE = roomCc * LEVEL * share * glassFrac * bodyN;
    vec3 avgEmit = roomCc * LEVEL * 0.11 * glassFrac * bodyN;
    emit = mix(emit, patchE, clamp((aa / floorH - 0.3) / 0.3, 0.0, 1.0));
    emit = mix(emit, avgEmit, clamp((aa / floorH - 0.9) / 0.9, 0.0, 1.0));
    fEmit = emit * Night * 2.5;
  }
  diffuseColor.rgb = col;
}
`;

export function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'facade', roughness: 0.8, metalness: 0 });
  return patch(m, {
    vertexHead: FACADE_VERT_HEAD, vertexBody: FACADE_VERT_BODY, fragmentHead: FACADE_FRAG_HEAD,
    fragmentAfterColor: FACADE_FRAG_COLOR,
    fragmentAfterRough: 'roughnessFactor = fRough;',
    fragmentAfterMetal: 'metalnessFactor = fMetal;',
    fragmentAfterEmissive: 'totalEmissiveRadiance += fEmit;',
    afterLightMaps: 'radiance *= uReflBoost;',
    ao: FACADE_AO,
  });
}

// ------------------------------------------------------------------------------- roofs
const ROOF_FRAG_COLOR = /* glsl */`
{
  int st = int(floor(vS.x));
  float seed = fract(vS.x);
  float r1 = fract(seed * 13.17), r2 = fract(seed * 71.31), r3 = fract(seed * 191.7);
  vec2 w = vec2(vF.x, 1.0 - vF.y);
  float aa = max(max(abs(dFdx(w.x)) + abs(dFdy(w.x)), abs(dFdx(w.y)) + abs(dFdy(w.y))), 0.004);
  int kind = r1 < 0.45 ? 0 : (r1 < 0.75 ? 1 : 2);
  if (st == 0 || st == 1) kind = r1 < 0.65 ? 0 : 1;
  if (st == 2 || st == 3) kind = r2 < 0.4 ? 3 : (r1 < 0.6 ? 0 : 1);
  if (st == 5) kind = r1 < 0.65 ? 4 : 0;
  vec3 col; float rough = 0.85, metal = 0.0;
  float n = fract(sin(dot(floor(w * 3.0), vec2(12.9898, 78.233)) + seed * 37.7) * 43758.5);
  if (kind == 0) {
    col = mix(vec3(0.86, 0.87, 0.86), vec3(0.74, 0.75, 0.74), r3);
    float d = abs(fract(w.x / 1.8 + 0.5) - 0.5) * 1.8;
    col *= 1.0 - 0.12 * clamp((0.04 - d) / aa + 0.5, 0.0, 1.0);
    rough = 0.7;
  } else if (kind == 1) {
    col = mix(vec3(0.60, 0.58, 0.54), vec3(0.70, 0.68, 0.62), r3) * (0.9 + 0.2 * n); rough = 0.95;
  } else if (kind == 2) {
    col = mix(vec3(0.17, 0.17, 0.18), vec3(0.25, 0.24, 0.23), r3); rough = 0.7;
  } else if (kind == 3) {
    float row = floor(w.y / 0.33);
    float tile = fract(sin((floor(w.x / 0.28 + row * 0.5)) * 12.9898 + row * 78.233 + seed * 37.719) * 43758.5453);
    col = mix(vec3(0.72, 0.36, 0.22), vec3(0.80, 0.50, 0.32), tile * 0.8 + r3 * 0.2);
    float gap = abs(fract(w.y / 0.33) - 0.5) * 0.33;
    col *= 1.0 - 0.35 * clamp((0.03 - (0.165 - gap)) / aa + 0.5, 0.0, 1.0);
    rough = 0.75;
  } else {
    col = mix(vec3(0.80, 0.82, 0.83), vec3(0.66, 0.70, 0.72), r3);
    col *= 1.0 + 0.06 * sin(w.x * 6.2832 / 0.3) * clamp(1.0 - aa / 0.1, 0.0, 1.0);
    rough = 0.4; metal = 0.6;
  }
  // AC units / roof clutter: dark specks on flat roofs
  float cell = fract(sin(dot(floor(w / 7.0), vec2(41.3, 289.1)) + seed) * 9871.3);
  vec2 cf = fract(w / 7.0) - 0.5;
  if (kind != 3 && cell > 0.8 && max(abs(cf.x), abs(cf.y)) < 0.12) col *= 0.55;
  fRough = rough; fMetal = metal; fEmit = vec3(0.0);
  diffuseColor.rgb = col;
}
`;

// Building details (scripts/web_details.py: hipped roofs, parapets, rooftop units, crowns): vertex
// colours, shaded flat from screen-space derivatives (the files carry no normals), roof-level AO.
// House roofs are the only sloped faces here (hipped, ~29 deg): on them, tile courses, barrel ridges and
// per-tile variegation where the colour reads as clay, mottling and mildew streaks running down the
// slope. The fine pattern fades out once it gets smaller than a few pixels. Faces are flat-shaded, so
// the face normal comes from screen-space derivatives of the world position.
const DETAIL_FRAG_HEAD = /* glsl */`
float dHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dHash(i), dHash(i + vec2(1, 0)), f.x), mix(dHash(i + vec2(0, 1)), dHash(i + vec2(1, 1)), f.x), f.y); }
`;
const DETAIL_FRAG_COLOR = /* glsl */`{
  diffuseColor.rgb *= 0.94 + 0.08 * dHash(floor(vWorldP.xz * 2.0));   // a little grain so big planes aren't flat colour
  vec3 fn = normalize(cross(dFdx(vWorldP), dFdy(vWorldP)));
  float ny = abs(fn.y);
  float slope = smoothstep(0.55, 0.7, ny) * (1.0 - smoothstep(0.95, 0.985, ny));
  vec2 e = vec2(-fn.z, fn.x) / max(length(fn.xz), 1e-4);      // along the eave
  float a = dot(vWorldP.xz, e), b = vWorldP.y;                 // across / up the slope
  vec3 c = diffuseColor.rgb;
  float clay = smoothstep(0.38, 0.5, (c.r - c.b) / max(c.r, 1e-3));   // red well above blue
  float mott = dNoise(vec2(a, b * 2.0) * 0.8) * 0.6 + dNoise(vec2(a, b * 2.0) * 3.1) * 0.4;
  c *= 0.86 + 0.26 * mott;
  float streak = dNoise(vec2(a * 1.4, b * 0.35 + 17.0));
  c = mix(c, c * vec3(0.66, 0.68, 0.64), smoothstep(0.55, 0.9, streak) * 0.55);
  // courses every 0.17 m of height (~0.35 m up the slope), barrels 0.26 m apart
  float tb = b / 0.17, ta = a / 0.26;
  float fine = 1.0 - smoothstep(0.12, 0.35, max(fwidth(tb), fwidth(ta) * clay));
  float lip = 1.0 - smoothstep(0.0, 0.25, fract(tb));
  c *= 1.0 - 0.25 * lip * fine;
  c *= 1.0 - 0.2 * clay * fine * smoothstep(0.5, 1.0, abs(fract(ta) - 0.5) * 2.0);
  float h = dHash(vec2(floor(ta), floor(tb)));
  c *= 1.0 + (h - 0.5) * 2.0 * mix(0.06, 0.16, clay) * fine;
  diffuseColor.rgb = mix(diffuseColor.rgb, c, slope);
}`;

export function detailMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'details', vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });
  return patch(m, { fragmentHead: DETAIL_FRAG_HEAD, fragmentAfterColor: DETAIL_FRAG_COLOR, ao: ROOF_AO });
}

// Wall relief (walldetail.js: balconies, ledges, cornices, fins, awnings): vertex colours, flat shading,
// AO from the ground map fading out with height (a balcony 30 m up shouldn't take street-level shade).
export function wallDetailMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'wallDetails', vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0 });
  return patch(m, { ao: '  float aoVal = mix(aoAt(vec2(vWorldP.x, -vWorldP.z)), 1.0, smoothstep(2.0, 22.0, vWorldP.y));' });
}

// balcony railings: tinted glass
export function railGlassMaterial() {
  return new THREE.MeshStandardMaterial({ name: 'railGlass', vertexColors: true, transparent: true, opacity: 0.38, roughness: 0.08,
    metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
}

export function roofMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'roof', roughness: 0.85, metalness: 0 });
  return patch(m, {
    vertexHead: FACADE_VERT_HEAD, vertexBody: FACADE_VERT_BODY, fragmentHead: FACADE_FRAG_HEAD,
    fragmentAfterColor: ROOF_FRAG_COLOR,
    fragmentAfterRough: 'roughnessFactor = fRough;',
    fragmentAfterMetal: 'metalnessFactor = fMetal;',
    ao: ROOF_AO,
  });
}

// ------------------------------------------------------------------------------- roads
// scripts/roadgeo.py writes the road meshes: uv = (u across 0 left .. 1 right, v metres along),
// uv1 = (width m, negative = one-way carriageway; marking fade), uv2 = (metres from the junction at the
// road's start, to the one at its end; 9999 = none). glTF flips every v, hence the "1.0 - ...".
const ROAD = {
  Road_highway: { color: [0.035, 0.035, 0.038], markings: 1, lane: 3.6, lights: 1, cross: 0 },
  Road_road: { color: [0.045, 0.045, 0.048], markings: 1, lane: 3.3, lights: 1, cross: 1 },
  Road_dirt: { color: [0.22, 0.15, 0.08], markings: 0, lane: 3.0, lights: 0, cross: 0 },
  Road_alley: { color: [0.16, 0.16, 0.16], markings: 0, lane: 3.0, lights: 0.5, cross: 0 },
};

export function roadMaterial(name) {
  const key = Object.keys(ROAD).find((k) => name.startsWith(k)) || 'Road_road';
  const p = ROAD[key];
  const m = new THREE.MeshStandardMaterial({ name: key, color: new THREE.Color().fromArray(p.color), roughness: 0.85 });
  // asphalt is linear-space dark grey; the markings go white / yellow
  return patch(m, {
    vertexHead: 'attribute vec2 uv1; attribute vec2 uv2; varying vec2 vUV; varying vec2 vD; varying vec2 vI;',
    vertexBody: 'vUV = uv; vD = uv1; vI = uv2;',
    fragmentHead: `varying vec2 vUV; varying vec2 vD; varying vec2 vI; vec3 rEmit; float rMark;
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1, 0)), f.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), f.x), f.y); }`,
    fragmentAfterColor: `
{
  float oneWay = vD.x < 0.0 ? 1.0 : 0.0;
  float W = max(abs(vD.x), 2.0);
  float fade = 1.0 - vD.y;
  float x = (vUV.x - 0.5) * W;               // metres from the centreline; + = right of travel along +v
  float ax = abs(x);
  float m = ${p.markings.toFixed(1)} * clamp(fade, 0.0, 1.0);
  float along = abs(1.0 - vUV.y);
  float dash = step(fract(along / 9.0), 0.35);
  float LaneW = ${p.lane.toFixed(2)};
  float laneLine, edge, yellow;
  if (oneWay > 0.5) {
    // a carriageway: lanes between 1.2 m shoulders, solid edge lines, dashed lane lines
    float lanes = max(1.0, floor((W - 2.4) / LaneW + 0.5));
    float hlf = lanes * LaneW * 0.5;
    float xl = x + hlf;
    float lane = abs(fract(xl / LaneW + 0.5) - 0.5) * LaneW;
    laneLine = (1.0 - step(0.075, lane)) * step(LaneW * 0.5, xl) * step(xl, 2.0 * hlf - LaneW * 0.5) * dash;
    edge = 1.0 - step(0.08, abs(ax - hlf - 0.1));
    yellow = 0.0;
  } else {
    // two-way: double yellow centre, dashed lanes, solid edges
    float lanes = max(2.0, 2.0 * floor((W - 0.6) / LaneW / 2.0 + 0.5));
    float hlf = lanes * LaneW * 0.5;
    float lane = abs(fract(ax / LaneW + 0.5) - 0.5) * LaneW;
    laneLine = (1.0 - step(0.075, lane)) * step(LaneW * 0.5, ax) * step(ax, hlf - LaneW * 0.5) * dash;
    edge = 1.0 - step(0.08, abs(ax - min(hlf, W * 0.5 - 0.3)));
    yellow = 1.0 - step(0.055, abs(ax - 0.12));
  }
  // junction approaches: zebra crossing 1.2-4.8 m from the junction, stop line on the arriving lanes
  float dS = vI.x, dE = 1.0 - vI.y;
  float stop = 0.0, zebra = 0.0;
  if (${p.cross.toFixed(1)} > 0.5 && oneWay < 0.5) {
    stop = step(5.8, dE) * step(dE, 6.3) * step(0.0, x) * step(x, W * 0.5 - 0.3)
         + step(5.8, dS) * step(dS, 6.3) * step(x, 0.0) * step(-W * 0.5 + 0.3, x);
    float zz = min(dS, dE);
    zebra = step(1.2, zz) * step(zz, 4.8) * step(fract((x + W) / 1.2), 0.55) * step(ax, W * 0.5 - 0.25);
  }
  float white = clamp(clamp(laneLine + edge, 0.0, 1.0) * m + stop + zebra, 0.0, 1.0);
  yellow *= m;
  // asphalt: grain, tar patches, lighter wheel paths
  // smooth value noise at three scales (the old per-cell hash read as a checkerboard up close)
  vec2 ap = vec2(x, along);
  float gr = 0.5 * rNoise(ap * 2.7) + 0.3 * rNoise(ap * 0.61 + 17.0) + 0.2 * rNoise(ap * 0.13 + 41.0);
  float patchN = rNoise(vec2(x * 0.22, along * 0.05) + 7.0);
  float wheel = smoothstep(0.7, 0.2, abs(abs(fract(ax / LaneW) - 0.5) * LaneW - 0.95));
  diffuseColor.rgb *= (0.86 + 0.28 * gr) * (1.0 - 0.28 * smoothstep(0.72, 0.8, patchN)) * (1.0 + 0.1 * wheel);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8), white);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.62, 0.08), yellow);
  rMark = clamp(white + yellow, 0.0, 1.0);
  // streetlight pools: every 32 m, alternate sides (carriageways: the median side) - roadgeo.py puts
  // the poles exactly there
  float k = floor(along / 32.0 + 0.5);
  float side = oneWay > 0.5 ? -1.0 : (fract(k * 0.5) < 0.25 ? 1.0 : -1.0);
  float da = along - k * 32.0;
  float dx = x - side * (W * 0.5 - 1.0);
  float pool = exp(-da * da / 60.0) * exp(-dx * dx / 22.0) * ${p.lights.toFixed(1)};
  rEmit = vec3(1.0, 0.75, 0.5) * pool * nightAmount() * 0.42;
}`,
    fragmentAfterRough: 'roughnessFactor = mix(roughnessFactor, 0.6, rMark);',
    fragmentAfterEmissive: 'totalEmissiveRadiance += rEmit;',
    ao: GROUND_AO,
  });
}

// Kerbs, sidewalks, bridge decks, piers and jersey barriers (roadgeo.py): concrete in four tones.
// uv = metres (along, up / across).
const RS = {
  RS_Sidewalk: { color: [0.42, 0.41, 0.38], rough: 0.9, joints: 1.0, stain: 0.0 },
  RS_Kerb: { color: [0.56, 0.55, 0.51], rough: 0.85, joints: 0.0, stain: 0.3 },
  RS_Concrete: { color: [0.40, 0.39, 0.37], rough: 0.92, joints: 0.0, stain: 1.0 },
  RS_Barrier: { color: [0.62, 0.61, 0.57], rough: 0.85, joints: 2.0, stain: 0.5 },
  RS_Pier: { color: [0.42, 0.41, 0.39], rough: 0.9, joints: 0.0, stain: 0.6, mural: 1.0 },
};

export function roadsideMaterial(name) {
  const key = Object.keys(RS).find((k) => name.startsWith(k)) || 'RS_Concrete';
  const p = RS[key];
  const m = new THREE.MeshStandardMaterial({ name: key, color: new THREE.Color().fromArray(p.color), roughness: p.rough });
  return patch(m, {
    vertexHead: 'attribute vec2 uv1; varying vec2 vUV; varying vec2 vD1; varying vec3 vWp;',
    vertexBody: 'vUV = uv; vD1 = uv1; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    fragmentHead: `varying vec2 vUV; varying vec2 vD1; varying vec3 vWp;
float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1, 0)), f.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), f.x), f.y); }
vec3 mPal(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }`,
    fragmentAfterColor: `
{
  vec2 q = vUV;
  float n = fract(sin(dot(floor(q * vec2(3.0, 3.0)), vec2(12.9898, 78.233))) * 43758.5);
  float n2 = fract(sin(dot(floor(q * vec2(0.4, 0.7)), vec2(39.3, 11.1))) * 9871.3);
  diffuseColor.rgb *= 0.9 + 0.12 * n + 0.08 * n2;
  // slab joints: sidewalks every 1.5 m both ways, barriers every 6 m
  float J = ${p.joints.toFixed(1)};
  if (J > 0.5 && J < 1.5) {
    vec2 f = abs(fract(q / 1.5) - 0.5) * 1.5;
    diffuseColor.rgb *= 1.0 - 0.35 * (1.0 - step(0.025, min(f.x, f.y)));
  } else if (J > 1.5) {
    float f = abs(fract(q.x / 6.0) - 0.5) * 6.0;
    diffuseColor.rgb *= 1.0 - 0.3 * (1.0 - step(0.02, f));
  }
  // run-off streaks on decks and piers
  float S = ${p.stain.toFixed(1)};
  if (S > 0.0) {
    float sx = vWp.x * 0.7 + vWp.z * 0.7;
    float st = fract(sin(floor(sx) * 12.9898) * 43758.5);
    diffuseColor.rgb *= 1.0 - S * 0.18 * st * smoothstep(0.0, 1.0, fract(vWp.y * 0.13 + st));
  }
  // murals on Vice City's viaduct columns (uv1 = (mural, ground height); glTF flips v)
  if (${(p.mural || 0).toFixed(1)} > 0.5 && vD1.x > 0.5) {
    float hz = vWp.y - (1.0 - vD1.y);
    float seed = mHash(floor(vWp.xz / 5.0));
    if (seed > 0.33 && hz > 0.25 && hz < 7.5) {
      vec2 m2 = vec2(vUV.x * 0.9, hz * 0.55) + seed * 13.0;
      float n1 = mNoise(m2), n2 = mNoise(m2 * 2.1 + 5.0), n3 = mNoise(m2 * 4.3 + 9.0);
      vec3 c = mix(mix(mPal(seed), mPal(seed + 0.31), smoothstep(0.35, 0.65, n1)), mPal(seed + 0.62), smoothstep(0.55, 0.8, n2));
      c = mix(c, vec3(0.95), smoothstep(0.78, 0.86, n3) * 0.8);
      c *= 1.0 - 0.75 * (1.0 - smoothstep(0.0, 0.025, abs(n1 - 0.5)));
      diffuseColor.rgb = mix(diffuseColor.rgb, c * 0.85, smoothstep(7.5, 6.6, hz) * smoothstep(0.25, 0.6, hz));
    }
  }
}`,
  });
}

// ------------------------------------------------------------------------------- water
// Real waves (ocean.js): a grid around the camera displaced by Gerstner waves, drawn where the water
// is deeper than WAVE_DEPTH m and within uWaveR of the camera; the flat chunk water steps aside there
// (both decide per pixel from the same height texture, so they meet exactly). uWaveR = 0: no waves.
export const waveU = { uWaveR: { value: 0 }, uWaveC: { value: new THREE.Vector2() } };
const WAVE_DEPTH = '3.0';
// the wave trains: travel direction (three x, z), wavelength m, amplitude m - a swell rolling in from
// the open sea in the east plus shorter crossing sets
const GERSTNER = /* glsl */`
uniform float uWaveR; uniform vec2 uWaveC;
const vec4 WAVES[6] = vec4[6](
  vec4(-0.93, -0.36, 74.0, 0.55), vec4(-0.72, -0.69, 44.0, 0.36), vec4(-0.99, 0.10, 27.0, 0.24),
  vec4(-0.45, -0.89, 16.0, 0.13), vec4(-0.96, -0.27, 9.5, 0.065), vec4(0.22, -0.97, 5.5, 0.03));
vec3 gDisp; vec3 gNorm; float gCrest;
void gerstner(vec2 p, float amp, float dist) {
  gDisp = vec3(0.0); vec3 n = vec3(0.0, 1.0, 0.0); float top = 0.0, ys = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 d = normalize(WAVES[i].xy); float L = WAVES[i].z;
    float k = 6.2831853 / L, c = sqrt(9.81 / k);           // deep-water speed: long swell runs faster
    float A = WAVES[i].w * amp * (1.0 - smoothstep(L * 6.0, L * 18.0, dist));   // short waves fade far off
    float Q = min(1.0, 0.55 / (k * A * 6.0 + 1e-4));        // sharper crests, never looping over
    float f = k * (dot(d, p) - c * uTime);
    float cf = cos(f), sf = sin(f);
    gDisp += vec3(Q * A * d.x * cf, A * sf, Q * A * d.y * cf);
    n.x -= d.x * k * A * cf; n.z -= d.y * k * A * cf; n.y -= Q * k * A * sf;
    ys += A * sf; top += WAVES[i].w * amp;
  }
  gNorm = normalize(n);
  gCrest = top > 1e-3 ? ys / top : 0.0;                     // ~1 on the crests
}`;

// Opaque water that shows its seabed like the Unreal build's Single Layer Water: the chunk's baked
// ground colour (sand, seagrass) seen through the water column, red absorbed fast and green / blue
// slowly (Unreal's AbsorptionPerMeter), with the same aqua cast on the seabed (BehindWaterTint),
// fading to a deep teal-blue. Depth from a whole-map height texture; scrolling normals and the
// sky's reflection (scene.environment) on top. One material per chunk (its seabed texture); they
// share one shader program. chunk = { x0, y1, C } (map metres); setSeabed(tex) once it loads.
// Ocean, not a mirror (2026-10-26): ripples at four scales, roughness that grows with distance (far
// normals average out, so far water would otherwise be a perfect mirror, and the sun becomes a
// glitter path instead of a dot), a gentler sky reflection, foam lapping in the shallows, whitecaps.
// opts.waves: the wave grid's material (seabed from the whole-map atlas opts.atlas = { tex, info }).
export function waterMaterial(heightTex, mapInfo, normalTex, chunk = null, opts = {}) {
  const waves = !!opts.waves;
  const m = new THREE.MeshStandardMaterial({ name: 'water', color: 0x0d5a74, roughness: 0.1, metalness: 0,
    normalMap: normalTex, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 1.0 });
  const u = {
    uHeight: { value: heightTex },
    uHMap: { value: new THREE.Vector4(mapInfo.west, mapInfo.north, mapInfo.cell * (mapInfo.w - 1), mapInfo.cell * (mapInfo.h - 1)) },
    uSeabed: { value: waves ? opts.atlas?.tex ?? null : null },
    uChunk: { value: waves && opts.atlas
      ? new THREE.Vector4(opts.atlas.info.west, opts.atlas.info.north, opts.atlas.info.size, 1)
      : new THREE.Vector4(chunk?.x0 ?? 0, chunk?.y1 ?? 0, chunk?.C ?? 1, 0) },
  };
  m.setSeabed = (tex) => { u.uSeabed.value = tex; u.uChunk.value.w = tex ? 1 : 0; };
  const HMAP = 'uniform sampler2D uHeight; uniform vec4 uHMap;\nfloat groundAt(vec2 mp) { return texture2D(uHeight, vec2((mp.x - uHMap.x) / uHMap.z, (uHMap.y - mp.y) / uHMap.w)).r; }';
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, u, waveU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP; varying float vCrest;\nuniform float uTime;\n' + HMAP + GERSTNER)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    if (waves) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', `
  vec2 gP = (modelMatrix * vec4(position, 1.0)).xz;
  float gDist = distance(gP, cameraPosition.xz);
  float gDepth = -groundAt(vec2(gP.x, -gP.y));
  // calm in the shallows (and where it hands over to the flat water), full out at sea; none at the edge
  float gAmp = smoothstep(${WAVE_DEPTH}, 16.0, gDepth) * (1.0 - smoothstep(uWaveR * 0.55, uWaveR, gDist));
  gerstner(gP, gAmp, gDist);
  vCrest = gCrest * gAmp;
  vec3 objectNormal = gNorm;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + gDisp;');
    } else {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrest = 0.0;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON +
        'varying vec3 vWorldP; varying float vCrest; uniform sampler2D uSeabed; uniform vec4 uChunk;' +
        'uniform float uWaveR; uniform vec2 uWaveC;\n' + HMAP + '\nfloat wFoam; float wDist;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 mp = vec2(vWorldP.x, -vWorldP.z);                       // map metres
  float ground = groundAt(mp);
  // the wave grid owns deep water near the camera, the flat chunk water everything else
  ${waves ? `if (ground > -${WAVE_DEPTH}) discard;`
    : `if (uWaveR > 0.0 && ground < -${WAVE_DEPTH} && distance(vWorldP.xz, uWaveC) < uWaveR) discard;`}
  float depth = max(vWorldP.y - ground, 0.0);
  // light goes down to the seabed and back up towards the eye
  vec3 eye = normalize(cameraPosition - vWorldP);
  float path = depth * (1.0 + 1.0 / max(eye.y, 0.2));
  vec3 bed = vec3(0.60, 0.56, 0.42);                            // open-sea sand (no baked texture there)
  if (uChunk.w > 0.5) bed = texture2D(uSeabed, vec2((mp.x - uChunk.x) / uChunk.z, (mp.y - (uChunk.y - uChunk.z)) / uChunk.z)).rgb;
  // tuned by eye against the Unreal capture: its bay reads a muted grey-teal (red never fully gone),
  // the channels a darker teal
  vec3 T = exp(-vec3(0.17, 0.11, 0.12) * path);
  vec3 deep = vec3(0.04, 0.15, 0.17);
  diffuseColor.rgb = bed * vec3(0.76, 0.82, 0.90) * T + deep * (1.0 - (T.g + T.b) * 0.5);
  // looking towards the sun Unreal's water lifts to a bright turquoise (light scattered forward
  // under the surface); looking away it stays the darker teal above
  vec2 vd = normalize(vWorldP.xz - cameraPosition.xz + 1e-4), sd = normalize(uSunDir.xz + 1e-4);
  float fwd = smoothstep(-0.6, 0.9, dot(vd, sd)) * smoothstep(0.0, 0.3, uSunDir.y);
  diffuseColor.rgb += vec3(0.05, 0.16, 0.14) * fwd;
  // wave tops catch more light through the thin water (a lighter green-teal on the crests)
  diffuseColor.rgb += vec3(0.02, 0.07, 0.06) * smoothstep(0.2, 0.9, vCrest);
  // big slow patches of slightly different water (wind slicks, currents) so open sea isn't one flat colour
  wDist = length(cameraPosition - vWorldP);
  vec2 wp = vWorldP.xz;
  float patchN = texture2D(normalMap, wp / 900.0 + uTime * vec2(0.0006, 0.0004)).x;
  diffuseColor.rgb *= 0.92 + 0.16 * patchN;
  // foam: lapping bands where it's shallow, whitecaps out at sea (more on the wave crests)
  float fA = texture2D(normalMap, wp / 7.0 + uTime * vec2(0.020, -0.013)).x;
  float fB = texture2D(normalMap, wp / 19.0 - uTime * vec2(0.008, 0.011)).y;
  float shore = 1.0 - smoothstep(0.15, 1.8, depth);
  float lap = 0.5 + 0.5 * sin(depth * 9.0 - uTime * 1.3 + fB * 6.0);
  float shoreFoam = shore * smoothstep(0.45, 0.85, lap * 0.6 + fA * 0.6);
  float caps = smoothstep(0.84, 0.95, fA * fB * 1.9 + 0.35 * smoothstep(0.55, 1.0, vCrest)) * smoothstep(4.0, 12.0, depth)
             * smoothstep(0.35, 0.7, texture2D(normalMap, wp / 260.0 + uTime * vec2(0.002, 0.001)).y);
  wFoam = clamp(shoreFoam + caps * 0.8, 0.0, 1.0) * (1.0 - smoothstep(600.0, 2500.0, wDist));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.90, 0.90), wFoam);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  // rougher further out: far normals average out, so far water would be a perfect mirror
  roughnessFactor = mix(0.10, 0.30, smoothstep(40.0, 2500.0, wDist));
  roughnessFactor = mix(roughnessFactor, 0.85, wFoam);`)
      .replace('#include <normal_fragment_maps>', `
{
  vec2 wuv = vec2(vWorldP.x, vWorldP.z);
  // ripples on top of the wave shape: long swell, two sets crossing, and chop up close
  vec3 n0 = texture2D(normalMap, wuv / 140.0 + uTime * vec2(0.0035, 0.0022)).xyz * 2.0 - 1.0;
  vec3 n1 = texture2D(normalMap, wuv / 23.0 + uTime * vec2(0.010, 0.006)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(normalMap, wuv / 61.0 - uTime * vec2(0.004, 0.009)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(normalMap, wuv / 6.5 + uTime * vec2(-0.03, 0.02)).xyz * 2.0 - 1.0;
  float near = 1.0 - smoothstep(150.0, 700.0, wDist);
  float big = ${waves ? '0.5' : '1.3'};   // the wave grid already has the big shapes in its geometry
  vec3 mapN = normalize(vec3((big * n0.xy + n1.xy + n2.xy + 1.3 * near * n3.xy) * normalScale * (1.0 - 0.6 * wFoam), 1.0));
  normal = normalize(tbn * mapN);
}`)
      // the scene's environment intensity is kept low as sky fill (Unreal's shade sides are dark),
      // but the water should mirror the sky about as bright as it looks overhead
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nradiance *= 1.8;');
  };
  m.customProgramCacheKey = () => (waves ? 'water_waves' : 'water_patched');
  return m;
}

// ------------------------------------------------------------------------------- terrain
// Baked ground colour (or, at sea, colour by depth) + a little fine noise so it isn't flat up close.
export function terrainMaterial(colorTex) {
  const m = withAO(new THREE.MeshStandardMaterial({ name: 'terrain', map: colorTex || null, roughness: 0.95,
    vertexColors: !colorTex }));
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, m.aoU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + AO_HEAD)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n{\n${GROUND_AO}\n  applyAO(reflectedLight, aoVal);\n}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 p = vWorldP.xz;
  float n = fract(sin(dot(floor(p * 1.5), vec2(12.9898, 78.233))) * 43758.5453);
  float n2 = fract(sin(dot(floor(p * 0.25), vec2(39.3468, 11.135))) * 43758.5453);
  // the bake is lighter and greyer than Unreal's splat textures: darker, warmer sand, olive grass
  diffuseColor.rgb *= (0.9 + 0.12 * n + 0.08 * n2) * vec3(0.80, 0.76, 0.66);
}`);
  };
  m.customProgramCacheKey = () => 'terrain_' + (colorTex ? 'map' : 'vc');
  return m;
}
