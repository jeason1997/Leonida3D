# Unity port status

Last updated after commit `ac65b3d`.

## Verified by build only

The following compile in a Windows player build, but have not been visually checked
after the latest changes:

- start screen / PLAY gate
- minimap rebuilt from `assets/minimap/mm_*.webp` tiles
- full map `M`, teleports `1-7`
- F8 admin panel
- F1 fly / F2 walk / F3 drive / F4 plane
- walk gravity/jump, car throttle/brake, plane stall/turn/bank

Do not call these finished until a real run confirms them.

## Known open issues

- minimap is rendered into a fixed image and sampled from 1024 tiles; default rotation is flipped, `R` toggles it, still needs a real screenshot check
- mouse yaw sign corrected to Unity camera basis (`edad28f`), still needs a real feel check
- car now spawns at Vice Beach when switching from high altitude; needs a real check
- plane/walk/car feel still needs comparison against `Reference/js/player.js`
- start screen bottom control line overlaps the debug HUD text
- mobile/touch controls are not implemented
- Android/iOS builds are paused; no SDK/module changes are to be made without
  the user's explicit request

## Render state

- facade: full `materials.js` port, facade height/clip fixed
- roof: `ROOF_FRAG_COLOR` kinds 0閳?
- sky: `Sky.js` Preetham + `SKY_CLOUDS`
- detail: `DETAIL_FRAG_COLOR`
- AO: `ao_*.webp` atlas applied to facade/roof/detail
- water: bright translucent colour; depth-based shore foam is subtle
- terrain/vegetation: original data and colour textures

## Verification rule

No more visible player windows during automated checks. Either:

1. the user runs the build and supplies a screenshot, or
2. only batchmode/compile/log checks are used.
