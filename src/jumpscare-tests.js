// Browser integration checks for creature attacks and their split-screen lifecycle.
const STILL = { forward: 0, strafe: 0, turn: 0, mouseTurn: 0, sprint: false, grabPressed: false, flashPressed: false, hidePressed: false, mapPressed: false };
function assert(condition, message) { if (!condition) throw new Error(message); }

function setup(game) {
  game.startRun(2, { skipNotice: true });
  game.startFloor(4);
  for (const m of game.monsters) {
    m.pos.set(-1000, 0, -1000);
    m.update = () => {};
  }
  return game.players;
}

function catchPlayer(game, player, monster) {
  const room = game.level.rooms.find(r => r.index > 0);
  player.pos.copy(game.level.cellCenter(room.cx, room.cy));
  player.flashOn = false;
  player.lightOn = false;
  player.sync();
  player.snapCamera();
  player.updateCamera(0);
  monster.pos.copy(player.pos);
  monster.pos.x += 0.2;
  monster.cooldown = 0;
  monster.sync();
  assert(monster.tryCatch(), `${monster.modelName} did not catch the player`);
  const attack = game.jumpscares.get(player.index);
  assert(attack, 'catch did not start an attack');
  return attack;
}

function advance(game, seconds) {
  const count = Math.ceil(seconds * 60);
  for (let i = 0; i < count; i++) game.jumpscares.update(1 / 60);
}

function pose(scene) {
  const values = [];
  scene.traverse(o => values.push(...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()));
  return values.join(',');
}

function renderedViews(game) {
  const views = [], original = game.film.render;
  game.film.render = (scene, camera, options) => views.push({ scene, camera, ...options });
  try { game.render(); }
  finally { game.film.render = original; }
  return views;
}

export const JUMPSCARE_TESTS = {
  jumpscareSpecies(game) {
    const [p] = setup(game);
    const kinds = [];
    for (const monster of game.monsters.filter(m => ['skeleton', 'zombie', 'ghost'].includes(m.constructor.id))) {
      const attack = catchPlayer(game, p, monster);
      assert(attack.monster === monster && attack.player === p, 'attack lost its victim or source monster');
      assert(attack.kind === monster.modelName, `wrong attack design for ${monster.modelName}`);
      assert(attack.scene !== game.scene && attack.camera !== p.camera, 'attack shares the gameplay camera or scene');
      assert(monster.group.parent === game.scene && monster.model.parent === monster.group, 'attack removed the creature from the world');
      let meshes = 0;
      attack.scene.traverse(o => { if (o.isMesh) meshes++; });
      assert(meshes > 0, 'attack scene has no creature geometry');
      const before = pose(attack.scene), worldPose = pose(monster.model);
      advance(game, 0.45);
      assert(pose(attack.scene) !== before, 'creature is a static image instead of an animated attack');
      assert(pose(monster.model) === worldPose, 'attack animation also moved the creature in the partner world');
      assert(attack.elapsed > 0.4 && Number.isFinite(attack.camera.fov), 'attack time or camera is invalid');
      advance(game, attack.duration);
      assert(!game.jumpscares.get(p.index) && !p.alive, 'completed attack did not return to the death view');
      kinds.push(attack.kind);
      game.respawn(p);
      assert(p.alive, 'player did not revive after attack');
      monster.pos.set(-1000, 0, -1000);
    }
    return { ok: true, info: `${kinds.join(', ')}: actual catch, matching source, animated geometry, timed completion` };
  },

  jumpscareCoverAndPause(game) {
    const [p] = setup(game);
    const spot = game.level.hidingSpots.find(s => s.kind === 'locker');
    const monster = game.monsters.find(m => m.constructor.id === 'skeleton');
    assert(p.enterHiding(spot, true), 'could not enter exposed cover');
    p.mapOpen = true;
    monster.pos.copy(spot.entry);
    monster.cooldown = 0;
    assert(monster.tryCatch(), 'creature did not catch the exposed locker occupant');
    const attack = game.jumpscares.get(p.index), deaths = game.run.deaths;
    assert(attack && !p.alive && !p.hidingSpot && !spot.occupant && !p.mapOpen, 'attack leaked cover occupancy or the paper map');
    game.killPlayer(p, game.monsters.find(m => m !== monster));
    assert(game.jumpscares.get(p.index) === attack && game.run.deaths === deaths, 'duplicate death restarted the attack or counted twice');
    game.setPaused(true);
    const elapsed = attack.elapsed;
    try {
      game.step(0.2);
      assert(attack.elapsed === elapsed, 'paused attack kept advancing');
    } finally { game.setPaused(false); }
    game.testIntents = game.players.map(() => ({ ...STILL }));
    try { game.step(1 / 60); }
    finally { game.testIntents = null; }
    assert(attack.elapsed > elapsed, 'attack did not resume with gameplay');
    return { ok: true, info: 'exposed locker catch, cover/map cleanup, one death per attack, pause/resume' };
  },

  jumpscareCoop(game) {
    const [a, b] = setup(game);
    const first = catchPlayer(game, a, game.monsters[0]);
    assert(b.alive && !game.jumpscares.get(b.index), 'partner inherited the victim attack');
    let views = renderedViews(game);
    assert(views.length === 2 && views[0].scene === first.scene && views[0].camera === first.camera, 'victim viewport does not render its attack');
    assert(views[1].scene === game.scene && views[1].camera === b.camera, 'living partner lost their gameplay viewport');
    const second = catchPlayer(game, b, game.monsters[1]);
    assert(second !== first && second.scene !== first.scene, 'simultaneous victims share an attack scene');
    views = renderedViews(game);
    assert(views[0].scene === first.scene && views[1].scene === second.scene, 'simultaneous attacks render in the wrong viewports');
    game.jumpscares.clear(a.index);
    assert(!game.jumpscares.get(a.index) && game.jumpscares.get(b.index) === second, 'clearing player zero also cleared their partner');
    return { ok: true, info: 'victim-only render, live partner view, independent simultaneous attacks and cleanup' };
  },

  jumpscareReset(game) {
    let [p] = setup(game);
    catchPlayer(game, p, game.monsters[0]);
    game.respawn(p);
    assert(p.alive && !game.jumpscares.get(p.index), 'revival retained the attack camera');
    game.killPlayer(p);
    assert(!p.alive && !game.jumpscares.get(p.index), 'a death without a creature invented an attack');
    game.respawn(p);
    catchPlayer(game, p, game.monsters[0]);
    game.startFloor(4);
    assert(game.players.every(q => q.alive && !game.jumpscares.get(q.index)), 'new floor retained an old attack');
    catchPlayer(game, p, game.monsters[0]);
    game.startRun(2, { skipNotice: true });
    assert(game.players.every(q => !game.jumpscares.get(q.index)), 'new run retained an old attack');
    p = game.players[0];
    catchPlayer(game, p, game.monsters[0]);
    game.toTitle();
    assert(!game.jumpscares.get(0) && !game.jumpscares.get(1) && game.state === 'title', 'title retained an old attack');
    return { ok: true, info: 'revive, non-creature death, floor transition, new run and title cleanup' };
  },
};
