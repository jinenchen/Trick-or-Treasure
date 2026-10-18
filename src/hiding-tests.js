// Integration checks for cover, detection and independent co-op maps.
import { Skeleton } from './entities/skeleton.js';
import { Zombie } from './entities/zombie.js';
import { elevatorRoute } from './field-map.js';

const STILL = { forward: 0, strafe: 0, turn: 0, mouseTurn: 0, sprint: false, grabPressed: false, flashPressed: false, hidePressed: false, mapPressed: false };
function assert(condition, message) { if (!condition) throw new Error(message); }
function park(game) { for (const m of game.monsters) { m.pos.set(-1000, 0, -1000); m.update = () => {}; } }
function approach(player, spot) {
  player.pos.copy(spot.entry);
  player.yaw = spot.yaw + Math.PI;
  player.vel.set(0, 0, 0);
  player.sync();
}
function tick(game, intents = []) {
  game.testIntents = game.players.map((_, i) => ({ ...STILL, ...intents[i] }));
  game.step(1 / 60);
  game.testIntents = null;
  for (const p of game.players) p.updateCamera(1 / 60);
}

export const HIDING_TESTS = {
  hidingObjects(game) {
    game.startRun(2, { skipNotice: true });
    park(game);
    const [p, partner] = game.players;
    for (const kind of ['table', 'locker']) {
      const spot = game.level.hidingSpots.find(s => s.kind === kind);
      assert(spot, `missing ${kind}`);
      approach(p, spot);
      tick(game, [{ hidePressed: true }]);
      assert(p.isHidden && p.hidingSpot === spot && spot.occupant === p, `${kind} entry did not conceal`);
      const hidden = p.pos.clone();
      for (let i = 0; i < 30; i++) tick(game, [{ forward: 1, sprint: true }]);
      assert(p.pos.distanceTo(hidden) < 0.001 && p.speed === 0, 'hidden player drifted outside cover');
      assert(Math.abs(p.camera.position.y - spot.eyeHeight) < 0.01, 'hiding camera is outside cavity');
      approach(partner, spot);
      tick(game, [{}, { hidePressed: true }]);
      assert(!partner.hidingSpot && spot.occupant === p, 'two players entered the same hiding spot');
      partner.pos.copy(game.level.liftPos);
      tick(game, [{ hidePressed: true }]);
      assert(!p.hidingSpot && !spot.occupant, 'hiding slot did not release');
      const checked = p.pos.clone();
      game.level.collideCircle(checked, 0.35);
      assert(checked.distanceTo(p.pos) < 0.01 && !game.level.isWallAt(p.pos.x, p.pos.z), 'exit is obstructed');
    }
    const spot = game.level.hidingSpots[0];
    approach(p, spot);
    const item = game.items[0];
    item.holders = [p]; p.holding = item;
    assert(!game.toggleHide(p) && !p.hidingSpot && p.holding === item, 'hiding must require empty hands');
    game.release(p);
    return { ok: true, info: 'table + locker entry, low camera, fixed position, occupancy, safe exit, empty hands' };
  },

  hidingDetection(game) {
    game.startRun(1, { skipNotice: true });
    game.startFloor(2);
    park(game);
    const p = game.players[0];
    const spot = game.level.hidingSpots.find(s => s.kind === 'locker');
    const skeleton = game.monsters.find(m => m instanceof Skeleton);
    approach(p, spot);
    assert(game.toggleHide(p), 'could not hide');
    skeleton.pos.copy(spot.entry);
    skeleton.cooldown = 0;
    assert(!skeleton.nearestPlayer().player && !skeleton.tryCatch() && p.alive, 'quiet cover failed');
    p.update(1 / 60, { ...STILL, flashPressed: true });
    assert(!p.isHidden && skeleton.nearestPlayer().player === p, 'flashlight did not expose occupant');
    assert(skeleton.tryCatch() && !p.alive && !spot.occupant && !p.hidingSpot, 'exposed occupant unreachable or slot leaked on death');

    game.startFloor(2);
    park(game);
    const cover = game.level.hidingSpots.find(s => s.kind === 'table');
    const sk = game.monsters.find(m => m instanceof Skeleton);
    const z = game.monsters.find(m => m instanceof Zombie);
    approach(p, cover);
    sk.pos.copy(cover.entry);
    sk.pos.x += Math.sin(cover.yaw) * 2;
    sk.pos.z += Math.cos(cover.yaw) * 2;
    sk.yaw = cover.yaw + Math.PI;
    assert(sk.canWitnessHiding(p) && !z.canWitnessHiding(p), 'witness rules incorrect');
    assert(game.toggleHide(p) && p.hidingRevealed && !p.isHidden, 'witnessed entry was concealed');
    p.leaveHiding();
    sk.pos.set(-1000, 0, -1000);
    approach(p, cover);
    game.toggleHide(p);
    z.pos.copy(cover.entry);
    z.state = 'wander'; z.target.copy(p.pos);
    z.investigateHiding();
    assert(p.isHidden, 'wandering Listener saw through cover');
    z.state = 'hunt'; z.target.copy(game.level.liftPos);
    z.investigateHiding();
    assert(p.isHidden, 'unrelated noise revealed cover');
    z.target.copy(p.pos);
    z.investigateHiding();
    assert(p.hidingRevealed && !p.isHidden, 'nearby noise investigation did not reveal cover');
    p.hidingRevealed = false;
    // A table's broad side must not leave an alerted creature stuck forever
    // just outside its ordinary catch distance.
    z.pos.copy(cover.pos);
    z.pos.x += Math.cos(cover.yaw) * (cover.halfWidth + z.radius + 0.02);
    z.pos.z -= Math.sin(cover.yaw) * (cover.halfWidth + z.radius + 0.02);
    z.investigateHiding();
    assert(p.hidingRevealed, 'Listener cannot investigate the wide side of a table');
    return { ok: true, info: 'concealment, light exposure, witnessed entry, blind noise investigation, death cleanup' };
  },

  independentMaps(game) {
    game.startRun(2, { skipNotice: true });
    park(game);
    const [a, b] = game.players;
    const time = game.clockTime;
    tick(game, [{ mapPressed: true }]);
    assert(a.mapOpen && !b.mapOpen && game.state === 'playing' && game.clockTime > time, 'map paused world or opened partner map');
    tick(game, [{}, { mapPressed: true }]);
    assert(a.mapOpen && b.mapOpen, 'second player map did not open');
    tick(game, [{ mapPressed: true }]);
    assert(!a.mapOpen && b.mapOpen, 'closing first map closed partner map');
    const spot = game.level.hidingSpots[0];
    approach(a, spot);
    game.toggleHide(a);
    tick(game, [{ mapPressed: true }]);
    assert(a.mapOpen && a.isHidden, 'map broke concealment');
    game.startFloor(2);
    assert(!a.mapOpen && !b.mapOpen && !a.hidingSpot && !spot.occupant, 'floor transition leaked map or occupancy');
    return { ok: true, info: 'independent toggles, live clock, map in cover, floor reset' };
  },

  elevatorNavigation(game) {
    game.startRun(1, { skipNotice: true });
    park(game);
    const level = game.level, p = game.players[0];
    for (const spot of level.hidingSpots) {
      const route = elevatorRoute(level, spot.entry);
      assert(route.length > 1 && route.at(-1) === level.liftPos, 'map route misses elevator');
      for (let i = 0; i < route.length; i++) {
        assert(!level.isWallAt(route[i].x, route[i].z), 'map route crosses a wall');
        if (i) assert(level.lineOfSight(route[i-1].x, route[i-1].z, route[i].x, route[i].z), 'route segment cuts through a wall');
      }
    }
    p.pos.copy(level.liftPos); p.pos.x += 2.2; p.yaw = -Math.PI / 2;
    game.hud.update(game, 0);
    const ui = game.hud.panels[0];
    const facing = Number(ui.compass.style.transform.match(/rotate\(([^r]+)rad\)/)?.[1]);
    assert(Math.abs(facing) < 0.01, 'elevator arrow not forward while facing elevator');
    p.yaw = Math.PI / 2;
    game.hud.update(game, 0);
    const away = Number(ui.compass.style.transform.match(/rotate\(([^r]+)rad\)/)?.[1]);
    assert(Math.abs(Math.abs(away) - Math.PI) < 0.01, 'elevator arrow not behind while facing away');
    p.pos.copy(level.liftPos); game.hud.update(game, 0);
    assert(ui.compassDistance.textContent === 'SAFE ZONE', 'elevator arrival status missing');
    return { ok: true, info: `${level.hidingSpots.length} walkable escape routes, arrow facing, elevator arrival` };
  },
};
