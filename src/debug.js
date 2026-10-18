// Headless gameplay tests: open index.html?test=all (or ?test=smoke etc.).
// Results are written to the on-screen debug log as "PASS"/"FAIL" lines.
import { NIGHT } from './config.js';
import { Skeleton } from './entities/skeleton.js';
import { Zombie } from './entities/zombie.js';
import { HIDING_TESTS } from './hiding-tests.js';
import { JUMPSCARE_TESTS } from './jumpscare-tests.js';
import { ENCOUNTER_TESTS } from './encounter-tests.js';
import { PLAYER_AVATAR_TESTS } from './player-avatar-tests.js';
import { SPIDER_AVATAR_TESTS } from './spider-avatar-tests.js';

const DT = 1 / 60;
const NO_INPUT = { forward: 0, strafe: 0, turn: 0, mouseTurn: 0, sprint: false, grabPressed: false, flashPressed: false };

function steps(game, n, intents) {
  for (let i = 0; i < n; i++) {
    if (intents) game.testIntents = intents;
    game.step(DT);
    for (const p of game.players) p.updateCamera(DT);
  }
  game.testIntents = null;
}

// Walk a player along the level's flow field to the lift, carrying whatever it holds.
function walkToLift(game, p, maxSteps = 1500, until = () => false) {
  const lvl = game.level;
  const lp = lvl.liftPos;
  for (let i = 0; i < maxSteps && !until(); i++) {
    let wp = lvl.nextWaypoint(p.pos.x, p.pos.z, lvl.liftField);
    if (!wp || lvl.inLift(p.pos.x, p.pos.z)) wp = lp;
    const dx = wp.x - p.pos.x, dz = wp.z - p.pos.z;
    p.yaw = Math.atan2(dx, dz);
    const forward = Math.hypot(lp.x - p.pos.x, lp.z - p.pos.z) > 0.2 ? 1 : 0;
    steps(game, 1, game.players.map((q) => (q === p ? { ...NO_INPUT, forward } : NO_INPUT)));
  }
}

function facing(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// Put a player just in front of an item, facing it.
function standAt(game, p, item, dist = 0.9) {
  const lvl = game.level;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = item.pos.x + Math.sin(a) * dist, z = item.pos.z + Math.cos(a) * dist;
    if (!lvl.isWallAt(x, z) && !lvl.isWallAt(x + 0.36, z) && !lvl.isWallAt(x - 0.36, z) && !lvl.isWallAt(x, z + 0.36) && !lvl.isWallAt(x, z - 0.36)) {
      p.pos.set(x, 0, z);
      p.yaw = facing(p.pos, item.pos);
      p.vel.set(0, 0, 0);
      return true;
    }
  }
  return false;
}

function calmMonsters(game) {
  // Park every monster far away so a test isn't interrupted.
  for (const m of game.monsters) {
    m.pos.set(-1000, 0, -1000);
    m.update = () => {};
  }
}

const TESTS = {
  ...JUMPSCARE_TESTS,
  ...ENCOUNTER_TESTS,
  ...PLAYER_AVATAR_TESTS,
  ...SPIDER_AVATAR_TESTS,
  ...HIDING_TESTS,
  smoke(game) {
    game.startRun(2, { skipNotice: true });
    const spawned = game.items.length;
    const lootValue = game.items.reduce((s, i) => s + i.baseValue, 0);
    const t0 = performance.now();
    for (let i = 0; i < 1500; i++) {
      game.testIntents = game.players.map(() => ({
        forward: Math.random() < 0.8 ? 1 : -1, turn: Math.random() * 2 - 1, sprint: Math.random() < 0.3,
        grabPressed: Math.random() < 0.02, flashPressed: Math.random() < 0.01,
      }));
      game.step(DT);
      if (game.state !== 'playing') break;
    }
    game.testIntents = null;
    const simMs = performance.now() - t0;
    const bad = [...game.players, ...game.monsters].some((e) => !Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z));
    const inWall = game.players.some((p) => p.alive && game.level.isWallAt(p.pos.x, p.pos.z));
    return {
      ok: !bad && !inWall,
      info: `state=${game.state} spawned=${spawned} ($${lootValue} vs quota $${game.quota}) left=${game.items.length} ` +
        `broken=${game.run.broken} monsters=${game.monsters.length} cash=${game.cash} ` +
        `alive=${game.players.filter((p) => p.alive).length} grid=${game.level.W}x${game.level.H} rooms=${game.level.rooms.length} sim=${simMs.toFixed(0)}ms`,
    };
  },

  // Random play on B4, where all three specimens are active together.
  smokeDeep(game) {
    game.startRun(2, { skipNotice: true });
    game.startFloor(4);
    const kinds = game.monsters.map((m) => m.constructor.id).join('+');
    let maxWhisper = 0, deaths = 0;
    for (let i = 0; i < 2400 && game.state === 'playing'; i++) {
      game.testIntents = game.players.map(() => ({
        forward: 1, turn: Math.sin(i / 40) * 0.8, sprint: i % 300 < 60,
        grabPressed: Math.random() < 0.02, flashPressed: Math.random() < 0.005,
      }));
      game.step(DT);
      maxWhisper = Math.max(maxWhisper, game.ghostNear);
    }
    game.testIntents = null;
    deaths = game.run.deaths;
    const bad = [...game.players, ...game.monsters].some((e) => !Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z));
    return { ok: !bad, info: `B4 ${kinds}, state=${game.state}, deaths=${deaths}, maxGhostNear=${maxWhisper.toFixed(2)}, items=${game.items.length}` };
  },

  carry(game) {
    game.startRun(1, { skipNotice: true });
    calmMonsters(game);
    const p = game.players[0];
    const item = game.items.find((i) => !i.heavy);
    const startValue = item.value;
    if (!standAt(game, p, item)) return { ok: false, info: 'no free spot near item' };
    game.toggleGrab(p);
    if (p.holding !== item) return { ok: false, info: `grab failed (cand=${game.grabCandidate(p)?.type.id})` };
    steps(game, 20);
    walkToLift(game, p, 2000, () => !game.items.includes(item) || item.depositing > 0);
    steps(game, 60);
    return {
      ok: game.cash > 0 && !game.items.includes(item),
      info: `cash=${game.cash} (item was $${startValue}, hp=${item.hp.toFixed(0)}, held=${p.holding === item})`,
    };
  },

  wallDamage(game) {
    game.startRun(1, { skipNotice: true });
    calmMonsters(game);
    const p = game.players[0];
    const item = game.items.find((i) => !i.heavy);
    standAt(game, p, item);
    game.toggleGrab(p);
    steps(game, 10);
    // Find the nearest wall direction and sprint into it.
    let best = 0, bestLen = 99;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let len = 0;
      while (len < 20 && !game.level.isWallAt(p.pos.x + Math.sin(a) * len, p.pos.z + Math.cos(a) * len)) len += 0.2;
      if (len < bestLen) { bestLen = len; best = a; }
    }
    p.yaw = best;
    const hp0 = item.hp;
    const start = p.pos.clone();
    let maxSpeed = 0, contacts = 0;
    for (let i = 0; i < 120; i++) {
      steps(game, 1, [{ ...NO_INPUT, forward: 1, sprint: true }]);
      maxSpeed = Math.max(maxSpeed, Math.hypot(p.vel.x, p.vel.z));
      if (game.level.collideCircle(item.pos.clone(), item.radius + 0.02, false)) contacts++;
    }
    return {
      ok: (item.hp < hp0 && item.hp > 0) || item.gone,
      info: `${item.type.id} hp ${hp0} -> ${item.hp.toFixed(0)} (wall ${bestLen.toFixed(1)}m, moved ${start.distanceTo(p.pos).toFixed(2)}m, ` +
        `maxSpeed ${maxSpeed.toFixed(1)}, contacts ${contacts}, held=${p.holding === item})`,
    };
  },

  heavy(game) {
    game.startRun(2, { skipNotice: true });
    calmMonsters(game);
    const [a, b] = game.players;
    const coffin = game.items.find((i) => i.heavy);
    if (!coffin) return { ok: false, info: 'no heavy item spawned' };
    standAt(game, a, coffin, 1.0);
    game.toggleGrab(a);
    const solo = coffin.carrySpeed;
    standAt(game, b, coffin, 1.0);
    // Second intern stands on the other side if possible.
    b.pos.set(coffin.pos.x - (a.pos.x - coffin.pos.x), 0, coffin.pos.z - (a.pos.z - coffin.pos.z));
    if (game.level.isWallAt(b.pos.x, b.pos.z)) standAt(game, b, coffin, 1.0);
    b.yaw = facing(b.pos, coffin.pos);
    game.toggleGrab(b);
    const duo = coffin.carrySpeed;
    steps(game, 30);
    return { ok: coffin.holders.length === 2 && solo < duo, info: `holders=${coffin.holders.length} soloSpeed=${solo} duoSpeed=${duo} y=${coffin.pos.y.toFixed(2)}` };
  },

  skeletonFreeze(game) {
    game.startRun(1, { skipNotice: true });
    const p = game.players[0];
    const sk = game.monsters.find((m) => m instanceof Skeleton);
    for (const m of game.monsters) if (m !== sk) { m.pos.set(-1000, 0, -1000); m.update = () => {}; }
    sk.dormant = 0;
    // Find a straight open line from the player position.
    const lp = game.level.liftPos;
    p.pos.set(lp.x + 1.6, 0, lp.z);
    let placed = false;
    for (let k = 0; k < 16 && !placed; k++) {
      const a = (k / 16) * Math.PI * 2;
      const sx = p.pos.x + Math.sin(a) * 6, sz = p.pos.z + Math.cos(a) * 6;
      if (game.level.lineOfSight(p.pos.x, p.pos.z, sx, sz) && !game.level.isWallAt(sx, sz) && !game.level.inLift(sx, sz)) {
        sk.pos.set(sx, 0, sz);
        p.yaw = a;
        placed = true;
      }
    }
    // Step out of the lift so the skeleton is allowed to hunt.
    p.pos.x += 0.0;
    if (!placed) return { ok: false, info: 'no line of sight spot' };
    p.flashOn = true;
    p.battery = p.batteryMax;
    const before = sk.pos.clone();
    steps(game, 90);
    const movedLit = sk.pos.distanceTo(before);
    p.flashOn = false;
    const before2 = sk.pos.clone();
    steps(game, 30);
    const movedDark = sk.pos.distanceTo(before2);
    return { ok: movedLit < 0.05 && movedDark > 0.5, info: `moved lit=${movedLit.toFixed(2)}m dark=${movedDark.toFixed(2)}m` };
  },

  listener(game) {
    game.startRun(1, { skipNotice: true });
    game.startFloor(2);
    const z = game.monsters.find((m) => m instanceof Zombie);
    if (!z) return { ok: false, info: 'no zombie on floor 2' };
    for (const m of game.monsters) if (m !== z) { m.pos.set(-1000, 0, -1000); m.update = () => {}; }
    game.emitNoise(z.pos.x + 3, z.pos.z, 10, 'crack');
    steps(game, 2);
    return { ok: z.state === 'hunt', info: `state=${z.state}` };
  },

  deathAndRevive(game) {
    game.startRun(2, { skipNotice: true });
    const [a, b] = game.players;
    const sk = game.monsters.find((m) => m instanceof Skeleton);
    for (const m of game.monsters) if (m !== sk) { m.pos.set(-1000, 0, -1000); m.update = () => {}; }
    sk.dormant = 0;
    // Intern A steps out of the lift in the dark, with the skeleton right behind.
    const lp = game.level.liftPos;
    a.pos.set(lp.x + 2.6, 0, lp.z);
    if (game.level.isWallAt(a.pos.x, a.pos.z)) a.pos.set(lp.x - 2.6, 0, lp.z);
    a.flashOn = false;
    b.flashOn = false;
    sk.pos.set(a.pos.x + 0.3, 0, a.pos.z);
    steps(game, 5);
    const jar = a.soulJar;
    if (a.alive || !jar) return { ok: false, info: `alive=${a.alive} jar=${!!jar}` };
    sk.pos.set(-1000, 0, -1000);
    sk.update = () => {};
    standAt(game, b, jar, 0.8);
    game.toggleGrab(b);
    if (b.holding !== jar) return { ok: false, info: 'could not pick up soul jar' };
    walkToLift(game, b, 1500, () => a.alive);
    steps(game, 30);
    return { ok: a.alive, info: `revived=${a.alive} deaths=${game.run.deaths}` };
  },

  // Not a real test: stages a screenshot of an intern facing a specimen in a dark room.
  scene(game, players = 1) {
    game.startRun(players, { skipNotice: true });
    const lvl = game.level;
    const room = [...lvl.rooms].filter((r) => r.index !== 0).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const sk = game.monsters.find((m) => m instanceof Skeleton);
    for (const m of game.monsters) m.update = (dt) => { m.anim.update(dt); m.sync(); };
    const c = lvl.cellCenter(room.x, room.y);
    game.players.forEach((p, i) => {
      p.pos.set(c.x + 0.4 + i * 1.2, 0, c.z + 0.4);
      p.yaw = Math.PI / 4;
      p.sync();
      p.snapCamera();
    });
    const p = game.players[0];
    sk.pos.set(p.pos.x + Math.sin(p.yaw) * 5, 0, p.pos.z + Math.cos(p.yaw) * 5);
    lvl.collideCircle(sk.pos, 0.4);
    sk.yaw = p.yaw + Math.PI;
    sk.anim.play('sprint');
    sk.sync();
    const loot = game.items.find((i) => !i.heavy);
    loot.pos.set(p.pos.x + Math.sin(p.yaw) * 2.2 + 0.5, 0, p.pos.z + Math.cos(p.yaw) * 2.2);
    game.radioCooldown = 99;
    document.querySelector('#debug-log').classList.add('hidden');
    return { ok: true, info: `room ${room.w}x${room.h}` };
  },

  scene2(game) {
    return TESTS.scene(game, 2);
  },

  carryShot(game) {
    game.startRun(1, { skipNotice: true });
    calmMonsters(game);
    const p = game.players[0];
    const item = game.items.find((i) => i.type.id === 'pumpkin' || i.type.id === 'jack') || game.items.find((i) => !i.heavy);
    standAt(game, p, item, 1.0);
    game.toggleGrab(p);
    p.pitch = -0.15;
    steps(game, 40);
    game.radioCooldown = 99;
    document.querySelector('#debug-log').classList.add('hidden');
    return { ok: p.holding === item, info: item.type.id };
  },

  noticeShot(game) {
    game.startRun(2);
    document.querySelector('#debug-log').classList.add('hidden');
    return { ok: game.state === 'notice', info: game.state };
  },

  midnight(game) {
    game.startRun(1, { skipNotice: true });
    calmMonsters(game);
    game.clockTime = NIGHT.seconds - 0.01;
    steps(game, 3);
    return { ok: game.state === 'gameover', info: `state=${game.state}` };
  },

  async descend(game) {
    game.startRun(2, { skipNotice: true });
    calmMonsters(game);
    game.cash = game.quota;
    const lp = game.level.liftPos;
    game.players.forEach((p, i) => p.pos.set(lp.x + (i ? 0.4 : -0.4), 0, lp.z));
    steps(game, 200);
    const s1 = game.state;
    await new Promise((r) => setTimeout(r, 1600));
    const s2 = game.state;
    game.leaveShop();
    return { ok: s1 === 'descending' && s2 === 'shop' && game.floor === 2 && game.state === 'playing', info: `${s1} -> ${s2} -> floor ${game.floor} ${game.state}` };
  },
};

export async function runTests(game, which) {
  const log = window.debugWrite || console.log;
  const names = which === 'all' || !which ? Object.keys(TESTS) : which.split(',');
  let pass = 0;
  for (const name of names) {
    try {
      const r = await TESTS[name](game);
      log(`${r.ok ? 'PASS' : 'FAIL'} ${name}: ${r.info}`);
      if (r.ok) pass++;
    } catch (e) {
      log(`FAIL ${name}: threw ${e.stack || e}`);
    }
  }
  log(`DONE ${pass}/${names.length}`);
  document.title = `TESTS ${pass}/${names.length}`;
}
