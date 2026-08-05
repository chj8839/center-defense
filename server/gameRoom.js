import { CONFIG, expForLevel, isBossLevel, getBossType } from '../js/config.js';
import { createStats, getRandomChoices, applyAugment, AUGMENTS } from '../js/augments.js';
import {
  Player, Enemy, Boss, Bullet, EnemyBullet,
  spawnEnemy, spawnBoss, fireBullets,
  getPointBlankHits, getMeleeHits,
} from '../js/entities.js';

const PLAYER_COLORS = ['#3af', '#f84', '#4f4', '#fc4'];
const TICK_RATE = 20;
const VIEW_W = 1280;
const VIEW_H = 720;

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function findNearestAlive(enemy, players) {
  let best = null;
  let bestDist = Infinity;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const d = Math.hypot(enemy.x - p.player.x, enemy.y - p.player.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function getWorldLevel(players) {
  let max = 1;
  for (const p of players.values()) {
    if (p.alive) max = Math.max(max, p.level);
  }
  return max;
}

function getSpawnAnchor(players) {
  const alive = [...players.values()].filter((p) => p.alive);
  if (!alive.length) return { x: 0, y: 0 };
  const x = alive.reduce((s, p) => s + p.player.x, 0) / alive.length;
  const y = alive.reduce((s, p) => s + p.player.y, 0) / alive.length;
  return { x, y };
}

export class GameRoom {
  constructor(hostId) {
    this.code = randCode();
    this.hostId = hostId;
    this.players = new Map();
    this.state = 'waiting';
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.spawnTimer = 0;
    this.tick = 0;
    this.lastTick = Date.now();
    this.interval = null;
  }

  addPlayer(id, name) {
    if (this.players.size >= 4) return false;
    const slot = this.players.size;
    const offset = slot * 100;
    const player = new Player(offset, offset);
    player.id = id;
    this.players.set(id, {
      id,
      name: name.slice(0, 12) || `P${slot + 1}`,
      color: PLAYER_COLORS[slot],
      player,
      stats: createStats(),
      level: 1,
      exp: 0,
      kills: 0,
      nextBossLevel: CONFIG.BOSS_INTERVAL,
      bossEnemyId: null,
      bossWarningTimer: 0,
      gameState: 'playing',
      augmentQueue: [],
      alive: true,
      orbitAngles: [],
      input: { up: false, down: false, left: false, right: false, angle: 0 },
    });
    return true;
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.players.size === 0) return 'empty';
    if (this.hostId === id) {
      this.hostId = this.players.keys().next().value;
    }
    return 'ok';
  }

  startGame() {
    if (this.state !== 'waiting' || this.players.size < 1) return false;
    this.state = 'playing';
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.spawnTimer = 0;
    for (const p of this.players.values()) {
      p.level = 1;
      p.exp = 0;
      p.kills = 0;
      p.stats = createStats();
      p.nextBossLevel = CONFIG.BOSS_INTERVAL;
      p.bossEnemyId = null;
      p.bossWarningTimer = 0;
      p.gameState = 'playing';
      p.augmentQueue = [];
      p.alive = true;
      p.orbitAngles = [];
      p.player.hp = p.player.maxHp;
    }
    this.lastTick = Date.now();
    this.interval = setInterval(() => this.update(), 1000 / TICK_RATE);
    return true;
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.state = 'waiting';
  }

  endRound() {
    if (this.state !== 'playing') return;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.state = 'waiting';
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.spawnTimer = 0;
    for (const p of this.players.values()) {
      p.alive = true;
      p.gameState = 'playing';
      p.augmentQueue = [];
      p.bossEnemyId = null;
      p.bossWarningTimer = 0;
      p.pendingBoss = null;
    }
    this.onRoundEnd?.(this);
  }

  hasActivePlayers() {
    return [...this.players.values()].some(
      (p) => p.alive && (p.gameState === 'playing' || p.gameState === 'boss' || p.gameState === 'bossWarning'),
    );
  }

  forfeitPlayer(id) {
    const p = this.players.get(id);
    if (!p || this.state !== 'playing') return false;
    if (!p.alive) return true;
    p.alive = false;
    p.gameState = 'gameOver';
    p.augmentQueue = [];
    p.bossEnemyId = null;
    p.bossWarningTimer = 0;
    p.pendingBoss = null;
    this.bullets = this.bullets.filter((b) => b.ownerId !== id);
    if (!this.hasActivePlayers()) {
      this.endRound();
    }
    return true;
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = { ...p.input, ...input };
  }

  pickAugment(id, augmentId) {
    const p = this.players.get(id);
    if (!p?.augmentQueue?.length) return;
    const entry = p.augmentQueue[0];
    const choice = entry.choices.find((a) => a.id === augmentId);
    if (!choice) return;
    const augDef = AUGMENTS.find((a) => a.id === augmentId);
    if (!augDef) return;
    const aug = { ...augDef, tier: choice.tier };
    applyAugment(aug, p.stats, p.player);
    if (aug.id === 'orbit') {
      p.orbitAngles.push(Math.random() * Math.PI * 2);
    }
    p.augmentQueue.shift();

    const clearedLevel = entry.level;
    if (isBossLevel(clearedLevel) && clearedLevel >= p.nextBossLevel && !p.bossEnemyId) {
      const bossType = getBossType(clearedLevel);
      p.gameState = 'bossWarning';
      p.bossWarningTimer = 2.5;
      p.pendingBoss = bossType;
    } else if (p.gameState !== 'boss') {
      p.gameState = 'playing';
    }

    this.tryLevelUp(p);
  }

  levelUpPlayer(p) {
    if (p.level >= CONFIG.MAX_LEVEL) return;
    p.level++;
    const choices = getRandomChoices(p.stats, 3).map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      desc: a.desc,
      tier: a.tier,
    }));
    if (!choices.length) {
      this.tryLevelUp(p);
      return;
    }
    p.augmentQueue.push({ level: p.level, choices });
  }

  tryLevelUp(p) {
    if (!p.alive) return;
    if (p.gameState === 'bossWarning' || p.gameState === 'gameOver' || p.gameState === 'victory') return;
    if (p.exp >= expForLevel(p.level) && p.level < CONFIG.MAX_LEVEL) {
      p.exp -= expForLevel(p.level);
      this.levelUpPlayer(p);
    }
  }

  addExp(p, amount) {
    if (p.gameState === 'bossWarning') return;
    p.exp += Math.floor(amount * p.stats.expMult * CONFIG.PLAYER.baseExpMult);
    this.tryLevelUp(p);
  }

  getSpawnInterval() {
    const worldLevel = getWorldLevel(this.players);
    const reduction = Math.min(worldLevel * 0.06, CONFIG.ENEMY.spawnInterval - CONFIG.ENEMY.spawnIntervalMin);
    return Math.max(CONFIG.ENEMY.spawnIntervalMin, CONFIG.ENEMY.spawnInterval - reduction);
  }

  spawnBossFor(p) {
    const boss = spawnBoss(p.player, p.level);
    this.enemies.push(boss);
    p.bossEnemyId = boss.id;
    p.gameState = 'boss';
    p.pendingBoss = null;
  }

  onEnemyKill(killer, enemy) {
    if (!killer?.alive) return;
    killer.kills++;
    this.addExp(killer, enemy.exp);
    if (killer.bossEnemyId === enemy.id) {
      const cleared = killer.level;
      killer.bossEnemyId = null;
      killer.nextBossLevel += CONFIG.BOSS_INTERVAL;
      if (cleared >= CONFIG.MAX_LEVEL) {
        killer.gameState = 'victory';
      } else {
        killer.gameState = 'playing';
      }
    }
  }

  isPausedPlayer(p) {
    return p.gameState === 'bossWarning'
      || p.gameState === 'gameOver' || p.gameState === 'victory';
  }

  updatePlayer(p, dt) {
    if (!p.alive) return;
    if (p.gameState === 'gameOver' || p.gameState === 'victory') return;

    if (p.gameState === 'bossWarning') {
      p.bossWarningTimer -= dt;
      if (p.bossWarningTimer <= 0) {
        this.spawnBossFor(p);
      }
      return;
    }

    const keys = new Set();
    if (p.input.up) keys.add('w');
    if (p.input.down) keys.add('s');
    if (p.input.left) keys.add('a');
    if (p.input.right) keys.add('d');

    const worldMouse = {
      x: p.player.x + Math.cos(p.input.angle) * 200,
      y: p.player.y + Math.sin(p.input.angle) * 200,
    };

    p.player.angle = p.input.angle;
    p.player.update(dt, worldMouse, p.stats, keys);
    p.player.contactCooldown = Math.max(0, (p.player.contactCooldown || 0) - dt);

    if (p.player.canFire(dt, p.stats)) {
      const newBullets = fireBullets(p.player, p.stats);
      newBullets.forEach((b) => { b.ownerId = p.id; });
      this.bullets.push(...newBullets);

      getPointBlankHits(p.player, p.stats, this.enemies).forEach(({ enemy, amount, angle, knockback, crit }) => {
        if (enemy.dead) return;
        const dmg = crit ? amount * (CONFIG.PLAYER.baseCritMult + p.stats.critMult) : amount;
        this.applyHit(enemy, dmg, angle, knockback, p);
      });
    }

    getMeleeHits(p.player, p.stats, this.enemies, dt).forEach(({ enemy, amount, angle, knockback }) => {
      if (enemy.dead) return;
      this.applyHit(enemy, amount, angle, knockback, p);
    });

    for (let i = 0; i < p.orbitAngles.length; i++) {
      p.orbitAngles[i] += 2.5 * dt;
      const total = p.orbitAngles.length;
      const a = p.orbitAngles[i] + (i / total) * Math.PI * 2;
      const ox = p.player.x + Math.cos(a) * 55;
      const oy = p.player.y + Math.sin(a) * 55;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(ox - e.x, oy - e.y) < 8 + e.radius) {
          const angle = Math.atan2(e.y - oy, e.x - ox);
          e.takeDamage(15 * p.stats.damageMult, angle, 80 * p.stats.knockbackMult);
          if (e.dead) this.onEnemyKill(p, e);
        }
      }
    }
  }

  applyHit(enemy, amount, angle, knockback, killer) {
    enemy.takeDamage(amount, angle, knockback);
    if (enemy.dead) this.onEnemyKill(killer, enemy);
  }

  update() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.05);
    this.lastTick = now;
    this.tick++;

    if (this.state !== 'playing') return;

    const worldLevel = getWorldLevel(this.players);
    const anchor = getSpawnAnchor(this.players);
    const fakePlayer = { x: anchor.x, y: anchor.y };

    for (const p of this.players.values()) {
      this.updatePlayer(p, dt);
    }

    const anyPlaying = [...this.players.values()].some(
      (p) => p.alive && (p.gameState === 'playing' || p.gameState === 'boss')
    );

    if (anyPlaying) {
      this.spawnTimer -= dt;
      const maxEnemies = CONFIG.ENEMY.maxOnScreen + this.players.size * 10;
      if (this.spawnTimer <= 0 && this.enemies.length < maxEnemies) {
        this.enemies.push(spawnEnemy(fakePlayer, VIEW_W, VIEW_H, worldLevel));
        this.spawnTimer = this.getSpawnInterval();
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive || !p.bossEnemyId) continue;
      const boss = this.enemies.find((e) => e.id === p.bossEnemyId);
      if (boss && !boss.dead) {
        boss.minionTimer -= dt;
        if (boss.minionTimer <= 0) {
          const count = boss.minionCount || 3;
          for (let i = 0; i < count; i++) {
            this.enemies.push(spawnEnemy(p.player, VIEW_W, VIEW_H, p.level));
          }
          boss.minionTimer = boss.minionInterval;
        }
      }
    }

    this.bullets.forEach((b) => b.update(dt));
    this.bullets = this.bullets.filter((b) => !b.dead);

    for (const e of this.enemies) {
      if (e.dead) continue;
      const target = findNearestAlive(e, this.players);
      if (!target) continue;
      e.update(dt, target.player.x, target.player.y, this.enemyBullets);
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.player.x;
        const dy = e.y - p.player.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = p.player.radius + e.radius * 0.85;
        if (dist < minDist) {
          const push = (minDist - dist) / dist;
          e.x += dx * push;
          e.y += dy * push;
        }
      }
    }

    for (const b of this.bullets) {
      if (b.dead) continue;
      const owner = this.players.get(b.ownerId);
      if (!owner?.alive) continue;
      for (const e of this.enemies) {
        if (e.dead || b.dead) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < b.radius + e.radius) {
          if (!b.canHit(e)) continue;
          const { amount, crit } = b.getDamage();
          this.applyHit(e, amount, b.angle, b.knockback, owner);
          b.registerHit(e);
        }
      }
    }

    this.enemyBullets.forEach((b) => b.update(dt));
    this.enemyBullets = this.enemyBullets.filter((b) => {
      if (b.dead) return false;
      for (const p of this.players.values()) {
        if (!p.alive || this.isPausedPlayer(p)) continue;
        if (Math.hypot(b.x - p.player.x, b.y - p.player.y) < b.radius + p.player.radius) {
          if (p.player.takeDamage(b.damage)) {
            if (p.player.hp <= 0) {
              p.alive = false;
              p.gameState = 'gameOver';
            }
          }
          return false;
        }
      }
      return true;
    });

    for (const e of this.enemies) {
      if (e.dead || e.typeKey === 'ranged') continue;
      for (const p of this.players.values()) {
        if (!p.alive || this.isPausedPlayer(p)) continue;
        const dist = Math.hypot(e.x - p.player.x, e.y - p.player.y);
        if (dist < e.radius + p.player.radius) {
          const angle = Math.atan2(e.y - p.player.y, e.x - p.player.x);
          e.knockbackX += Math.cos(angle) * 280 * p.stats.knockbackMult * (1 - e.knockbackResist);
          e.knockbackY += Math.sin(angle) * 280 * p.stats.knockbackMult * (1 - e.knockbackResist);
          if (p.player.contactCooldown <= 0) {
            if (p.player.takeDamage(e.damage)) {
              p.player.contactCooldown = 0.4;
              if (p.player.hp <= 0) {
                p.alive = false;
                p.gameState = 'gameOver';
              }
            }
          }
        }
      }
    }

    this.enemies = this.enemies.filter((e) => !e.dead);

    if (!this.hasActivePlayers()) {
      this.endRound();
    }
  }

  getLobbyInfo() {
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        alive: p.alive,
      })),
    };
  }

  getStateFor(id) {
    const me = this.players.get(id);
    return {
      type: 'state',
      tick: this.tick,
      roomState: this.state,
      code: this.code,
      you: id,
      isHost: this.hostId === id,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        x: p.player.x,
        y: p.player.y,
        angle: p.player.angle,
        hp: p.player.hp,
        maxHp: p.player.maxHp,
        level: p.level,
        exp: p.exp,
        expNeed: expForLevel(p.level),
        kills: p.kills,
        color: p.color,
        alive: p.alive,
        gameState: p.gameState,
        moveSpeedMult: p.stats.moveSpeedMult,
        augmentTags: Object.entries(p.stats.picked).map(([aid, tier]) => {
          const aug = AUGMENTS.find((a) => a.id === aid);
          return aug ? `${aug.name} Lv${tier}` : aid;
        }),
        bossWarning: p.gameState === 'bossWarning' && p.pendingBoss
          ? { name: p.pendingBoss.name, desc: p.pendingBoss.desc }
          : null,
        pendingAugments: p.augmentQueue?.length ?? 0,
      })),
      enemies: this.enemies.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        typeKey: e.typeKey,
        hp: e.hp,
        maxHp: e.maxHp,
        radius: e.radius,
        color: e.color,
        stroke: e.stroke,
        bossName: e.bossName || null,
        bossTier: e.bossTier || null,
        phase2: e.phase2 || false,
      })),
      bullets: this.bullets.filter((b) => !b.dead).map((b) => ({
        id: b.id, x: b.x, y: b.y, angle: b.angle, ownerId: b.ownerId,
      })),
      enemyBullets: this.enemyBullets.map((b) => ({
        id: b.id, x: b.x, y: b.y, radius: b.radius,
      })),
      augmentChoices: me?.augmentQueue?.[0]?.choices ?? null,
      pendingAugments: me?.augmentQueue?.length ?? 0,
    };
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRoom = new Map();
  }

  createRoom(playerId, name) {
    const room = new GameRoom(playerId);
    room.addPlayer(playerId, name);
    this.rooms.set(room.code, room);
    this.playerRoom.set(playerId, room.code);
    return room;
  }

  joinRoom(playerId, code, name) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.state !== 'waiting') return null;
    if (!room.addPlayer(playerId, name)) return null;
    this.playerRoom.set(playerId, room.code);
    return room;
  }

  getRoomByPlayer(playerId) {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : null;
  }

  leave(playerId) {
    const code = this.playerRoom.get(playerId);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) {
      this.playerRoom.delete(playerId);
      return null;
    }
    room.removePlayer(playerId);
    this.playerRoom.delete(playerId);
    if (room.players.size === 0) {
      room.stop();
      this.rooms.delete(code);
      return null;
    }
    if (room.state === 'playing' && !room.hasActivePlayers()) {
      room.endRound();
    }
    return room;
  }

  getPlayingRooms() {
    return [...this.rooms.values()].filter((r) => r.state === 'playing');
  }
}
