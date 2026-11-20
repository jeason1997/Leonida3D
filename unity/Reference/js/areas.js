// Rough area names for where a player is (map metres; same places as data\zones.json and the
// teleports). Used by the spectator panel (live.js) and the phone admin page (admin.html).
export const AREAS = [
  ['Downtown', -640, 85], ['Brickell', -700, -1000], ['Brickell Key', -140, -1085], ['Bayside', -650, 1350],
  ['Vice Beach', 1725, 1200], ['Ocean Beach', 1725, -100], ['Washington Beach', 1725, 2450], ['Port of Vice City', 900, -450],
  ['Capri', -7350, -650], ['Port Gellhorn', -7050, 3250],
];

export function areaName(x, y) {
  if (y < -4000) return 'The Keys';
  let best = null, bd = 2500;
  for (const [n, ax, ay] of AREAS) { const d = Math.hypot(x - ax, y - ay); if (d < bd) { bd = d; best = n; } }
  return best || `${(x / 1000).toFixed(1)} km E, ${(y / 1000).toFixed(1)} km N`;
}
