// Gameplay tunables. Tweak these to balance the game.

export const CELL = 2.5;            // meters per level grid cell
export const WALL_H = 3.4;          // wall / ceiling height

export const PLAYER = {
  radius: 0.35,
  walkSpeed: 3.0,
  sprintSpeed: 5.4,
  backMul: 0.6,
  turnSpeed: 2.7,                   // rad/s with keyboard
  mouseSens: 0.0026,
  staminaMax: 100,
  staminaDrain: 24,                 // per second while sprinting
  staminaRegen: 16,
  batteryMax: 100,
  batteryDrain: 0.9,                // per second while flashlight is on
  batteryRecharge: 25,              // per second inside the lift
};

export const FLASH = {
  range: 20,
  angle: 0.44,                      // half-angle in radians
  intensity: 90,
  color: 0xfff1d2,
};

export const NIGHT = {
  seconds: 360,                     // real seconds from 10 PM to midnight
  startHour: 22,
};

// How far (meters) each kind of noise carries. The Listener hunts these.
export const NOISE = {
  walk: 3.5,
  sprint: 13,
  crack: 16,
  shatter: 26,
  drop: 8,
  deposit: 6,
};

export const LIFT_HALF = 1.45;      // half-size of the deposit zone

// Optional AI boss: URL of the deployed tools/gemma-boss-worker.js. Empty = canned lines.
export const BOSS_AI_URL = '';

export function quotaForFloor(floor) {
  return Math.round((300 * Math.pow(1.42, floor - 1)) / 10) * 10;
}

// Which specimens haunt each floor. New ones get a facility notice.
export function monstersForFloor(floor) {
  if (floor === 1) return ['skeleton', 'spider', 'thief'];
  if (floor === 2) return ['zombie', 'skeleton', 'spider', 'lizard', 'thief'];
  if (floor === 3) return ['ghost', 'zombie', 'spider', 'lizard', 'thief'];
  if (floor === 4) return ['ghost', 'skeleton', 'zombie', 'spider', 'lizard', 'thief'];
  const list = ['ghost', 'skeleton', 'zombie', 'spider', 'lizard', 'thief'];
  for (let i = 5; i <= floor; i++) list.push(['skeleton', 'zombie', 'ghost'][i % 3]);
  return list;
}
