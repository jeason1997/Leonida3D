# Leonida 3D

The GTA VI community map (YANIS) from [leonidastate3d.com](https://leonidastate3d.com/), kept in two forms:

- **`web/`** — the complete offline web build, packaged as a Windows app (no browser chrome, no network).
- **`unity/`** — a native Unity port of the same map, in progress.

> Map data and artwork belong to leonidastate3d.com / the YANIS community.
> This repository is for personal, offline use; do not redistribute the map assets commercially.

## Web offline app

```
web/
├─ Leonida 3D.exe      launcher (starts a local server and opens an Edge app window)
├─ site/               full mirror: 477 assets, 226 MB
├─ 使用说明.txt
├─ 预览.jpg
└─ 地图全图.png
```

Double-click `web/Leonida 3D.exe`. Close the app window and the local server exits.
The launcher uses Microsoft Edge in app-window mode; no Edge extensions or network are needed.
Multiplayer/chat are disabled in the offline build.

See [web/使用说明.txt](web/使用说明.txt) for details.

## Unity native port

- Engine: **Unity 6000.3.18f1**, URP
- Packages: glTFast 6.17.0, Input System 1.20.1
- Open `unity/` with Unity Hub, then open `unity/Assets/Scenes/Leonida.unity` and press **Play**.

Assets are stored once under `web/site/assets`. In the editor the project reads them through a
relative fallback (`../../web/site/assets`). Before building a player, sync them into StreamingAssets:

```powershell
powershell -ExecutionPolicy Bypass -File unity/tools/sync-assets.ps1
```

Or use the editor menu `Leonida > Build Scene + Windows Player` after syncing.

### Controls

| Key | Action |
|---|---|
| W A S D | move |
| Q / E | down / up |
| right mouse drag | look |
| Shift | boost |
| Ctrl | slow |

`LeonidaWorld > Chunk Radius` controls how many 2048 m city tiles load (2 = 25 tiles, 5 = all 110).

### Implemented

- manifest, far terrain (110 chunks / 464,750 vertices)
- runtime GLB streaming via glTFast, with the glTF→Unity X-axis mirror corrected
- material mapping by mesh/primitive: walls, roofs, roads, sidewalks, water
- facade shader ported from the web build (six facade styles, windows, frames,
  balconies, grime, night-lit rooms), water shader, sky shader
- vegetation: 21 GLB variants, `veg/inst_*.bin` instancing (trees / shrubs / grass)
- roof details `details/det_*.bin`, native minimap/full map, 1–7 teleports
- ocean, directional light, shadows, fog, fly camera, loading HUD
- scene/player build menu

### Roadmap

- [x] facade / water / sky shaders
- [x] vegetation (`veg/inst_*.bin`)
- [x] roof details (`det_*.bin`)
- [x] native minimap / full map / teleports
- [ ] baked AO (`ao_*.webp`)
- [ ] far vegetation billboards / impostors
- [ ] admin panel, start menu, chat
- [ ] walk / car / plane modes
- [ ] Android / iOS export

## Repository layout

```
web/                  offline web app + mirror (226 MB assets)
unity/                Unity project (StreamingAssets excluded; shared assets)
unity/tools/sync-assets.ps1 copies web/site/assets -> unity/Assets/StreamingAssets/leonida/assets
```

The 226 MB asset tree is intentionally stored once. Unity's generated `StreamingAssets` copy is
git-ignored.

## Credits

- Map, models and textures: [leonidastate3d.com](https://leonidastate3d.com/) / YANIS community
- Web build: original Three.js project, mirrored for offline use
- Unity port: this repository
