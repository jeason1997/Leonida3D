// Leonida in the browser: the same map as the Unreal build (scripts/web_export*.py write assets/).
import * as THREE from 'three';
import { World } from './world.js';
import { Daylight } from './sky.js';
import { Vegetation } from './vegetation.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Compare } from './compare.js';
import { Ocean } from './ocean.js';
import { Minimap } from './minimap.js';
import { Live } from './live.js';
import { RoadProps } from './roadprops.js';
import { TouchControls, isTouch } from './touch.js';
import { MapWindow } from './bigmap.js';
import { shared } from './materials.js';
import { AntiAlias } from './aa.js';

// phones and tablets: on-screen controls, lighter graphics (before anything reads body.touch)
const touch = isTouch();
if (touch) {
  document.body.classList.add('touch');
  document.getElementById('start-hint').textContent = 'You start flying. Left stick: move · drag anywhere: look · '
    + 'MENU (top left): fly, walk, drive or a plane, time of day, teleports, and the settings · MAP: the whole map. Best held sideways.';
}

const loading = document.getElementById('loading');
const say = (t) => { loading.textContent = t; };

if (window.LEONIDA_OFFLINE) {
  const hint = document.getElementById('start-hint');
  if (hint) hint.textContent += ' Offline edition: the map is stored on this PC; multiplayer and chat need the website.';
  const disc = document.getElementById('discord');
  if (disc) disc.classList.add('hidden');
  // Keep PLAY above the fold in the desktop app: the settings move below it.
  const st = document.querySelector('#start .settings');
  if (st) st.parentElement.append(st);
}

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.3, 15000);
scene.add(camera);

const app = { renderer, scene, camera };
app.aa = new AntiAlias(renderer, scene, camera);   // MSAA, or MSAA + SMAA (settings)
window.leonida = app;   // handy from the console

async function start() {
  say('Loading terrain…');
  const world = new World(scene, renderer);
  await world.init();
  app.world = world;
  const day = new Daylight(scene, renderer);
  day.setHour(11);
  app.day = day;
  say('Loading vegetation…');
  const veg = new Vegetation(scene, world);
  await veg.init();
  app.veg = veg;
  const player = new Player(camera, world, renderer.domElement);
  app.player = player;
  // Start in the sky over the bay south of Brickell, looking past Brickell Key at the skyline
  // (manifest spawn = the Unreal car start on a Downtown street, kept for that build).
  player.placeAt(150, -1700, 420, 330, -14);
  player.look();
  app.live = new Live(app);
  player.onPunch = () => app.live.punch();   // walking: F / click / PUNCH
  app.compare = new Compare(app);   // GTA V / RDR2 maps to scale (settings)
  app.ocean = new Ocean(app);       // real waves around the camera
  app.minimap = new Minimap(app);   // GTA-style radar, bottom right
  app.map = new MapWindow(app);     // the whole map, waypoint (M)
  app.props = new RoadProps(app);   // streetlights and traffic signals (roadgeo.py)
  app.props.init().catch((e) => console.warn('road props', e));
  app.ui = new UI(app);
  if (touch) app.touch = new TouchControls(app);   // stick, look drag, buttons
  if (app.live.admin) app.live.start();   // the spectator connects straight away (and never reports itself)
  world.loadMeshes(camera.position, (n, total) => {
    say(`Loading the city… ${n} / ${total}`);
    if (n === total) setTimeout(() => loading.classList.add('hidden'), 800);
  });

  const clock = new THREE.Clock();
  let lodTimer = 0;
  const camDir = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    shared.uTime.value += dt;
    player.update(dt);
    lodTimer -= dt;
    if (lodTimer <= 0) { world.updateTerrainLod(camera.position); lodTimer = 0.5; }
    veg.update(camera.position);
    veg.setLight(day.dir, day.sunCol, day.ambCol);
    day.follow(camera.position, camera.getWorldDirection(camDir), world.heightAt(camera.position.x, -camera.position.z));
    app.compare.update(camera);
    app.ocean.update(camera);
    app.minimap.update(dt);
    app.map.update();
    app.live.update(dt);
    app.props.update(dt, camera.position);
    app.ui.hud();
    app.touch?.update();
    app.aa.render();
  });
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  app.aa.resize();
});

start().catch((e) => { console.error(e); say('Failed to load: ' + e.message); });
