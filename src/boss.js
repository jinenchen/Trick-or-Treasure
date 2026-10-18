// "GRIMCO HQ" boss on the radio. Canned lines by default; set BOSS_AI_URL in
// config.js (or window.GRIMCO_AI_URL) to the Gemma worker to make it live.
import { BOSS_AI_URL } from './config.js';

const LINES = {
  floorStart: [
    'Floor {floor}. Quota is ${quota}. Midnight is a hard deadline, interns.',
    'Welcome to B{floor}. The last crew is... on extended leave. Quota: ${quota}.',
    'B{floor}, ${quota} quota. Remember: you break it, you bought it.',
    'Lights on, heads down, ${quota} by midnight. GRIMCO believes in you. Legally.',
  ],
  crack: [
    'Was that the {item}? That is coming out of your paycheck.',
    'I heard that crack from HQ.',
    'Careful! That {item} is older than your family tree.',
    'Every scratch is a deduction, intern.',
  ],
  shatter: [
    'You SHATTERED the {item}. ${value}. Gone. Like your bonus.',
    'Ah. The {item}. Fantastic. I will add it to your tab.',
    'That was a priceless {item}. Well. It had a price. ${value}.',
  ],
  death: [
    '{name} is down. Someone grab their soul jar, it is company property.',
    'We lost {name}. HR has been notified. HR is also a skeleton.',
    '{name} has been... reassigned. Bring their jar to the lift.',
  ],
  deathSolo: [
    'You died. Fortunately your contract does not allow that. Back to work.',
    'Death is not an excuse to miss quota.',
  ],
  quotaMet: [
    'Quota met! Get in the lift. Or keep looting for a bonus. Your call. Choose greed.',
    'Quota reached. The lift is ready. Anything extra goes to the company store.',
  ],
  lowTime: [
    'It is 11:30. You have thirty minutes or you are fired. Literally, there is a furnace.',
    'Half an hour to midnight. Move it.',
  ],
  floorDone: [
    'Floor cleared with ${cash}. Deeper we go.',
    'Not bad. ${cash} delivered, {broken} things broken. The next floor is worse.',
    'You made ${cash}. Do not get used to it.',
  ],
  fired: [
    'Midnight. Quota missed. You are fired. Please leave your soul at the front desk.',
    'Clock is out and so are you. Fired.',
    'Everyone is dead. That is a fireable offense.',
  ],
};

function fill(tpl, data) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (data[k] !== undefined ? data[k] : ''));
}

export async function bossLine(kind, data = {}) {
  const url = window.GRIMCO_AI_URL || BOSS_AI_URL;
  if (url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...data }),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.line) return json.line;
      }
    } catch { /* fall back to canned lines */ }
  }
  const pool = LINES[kind] || ['...'];
  return fill(pool[Math.floor(Math.random() * pool.length)], data);
}
