/**
 * Center Defense 멀티플레이 게임 룸 로직
 *
 * GameRoom: 단일 방의 플레이어·적·탄환 시뮬레이션 및 상태 직렬화
 * RoomManager: 방 코드 생성/조회, 플레이어-방 매핑, 전역 방 목록 관리
 *
 * 클라이언트 entities/config/augments 모듈을 서버에서 재사용하여
 * 싱글플레이와 동일한 전투·증강 규칙을 적용합니다.
 */
import { CONFIG, expForLevel, spawnIntervalForLevel, isBossLevel, getBossType } from '../js/config.js';
import { createStats, getRandomChoices, applyAugment, AUGMENTS } from '../js/augments.js';
import {
  getCharacter, applyCharacterBase, chargeSpecialMeter, useSpecialAbility, getSpecialMeterMax,
} from '../js/characters.js';
import {
  Player, Enemy, Boss, Bullet, EnemyBullet,
  spawnEnemy, spawnBoss, fireBullets,
  getPointBlankHits, getMeleeHits,
} from '../js/entities.js';

/** 플레이어 슬롯별 표시 색상 (최대 4인) */
const PLAYER_COLORS = ['#3af', '#f84', '#4f4', '#fc4'];

/** 게임 시뮬레이션 틱률(Hz) */
export const TICK_RATE = CONFIG.MULTI.tickRate;

/** 클라이언트 state 전송 틱률(Hz) — 시뮬보다 낮춰 CPU·대역폭 절약 */
export const BROADCAST_RATE = CONFIG.MULTI.broadcastRate;

/** 적 스폰·시야 계산용 가상 뷰포트 너비 */
const VIEW_W = 1280;

/** 적 스폰·시야 계산용 가상 뷰포트 높이 */
const VIEW_H = 720;

const { maxSimEnemies, maxEnemyBullets, simCullRadius, syncRadius } = CONFIG.MULTI;

/**
 * 4자리 대문자+숫자 방 참가 코드 생성 (혼동 문자 I/O/0/1 제외)
 * @returns {string}
 */
function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * 적이 추적할 가장 가까운 생존 플레이어 래퍼 반환
 * @param {import('../js/entities.js').Enemy} enemy
 * @param {Map<string, object>} players
 * @returns {object|null} players Map 값(플레이어 래퍼) 또는 null
 */
function findNearestAlive(enemy, players) {
  let best = null;
  let bestDist = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.gameState === 'bossWarning') continue;
    const d = Math.hypot(enemy.x - p.player.x, enemy.y - p.player.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** 보스는 ownerId 플레이어를 우선 추적, 그 외는 가장 가까운 생존자 */
function findTargetForEnemy(enemy, players) {
  if (enemy.typeKey === 'boss' && enemy.ownerId) {
    const owner = players.get(enemy.ownerId);
    if (owner?.alive && owner.gameState !== 'bossWarning') return owner;
  }
  return findNearestAlive(enemy, players);
}

/**
 * 방 내 생존 플레이어 중 최고 레벨 — 적 스폰 난이도·스폰 간격에 사용
 * @param {Map<string, object>} players
 * @returns {number}
 */
function getWorldLevel(players) {
  let max = 1;
  for (const p of players.values()) {
    if (p.alive) max = Math.max(max, p.level);
  }
  return max;
}

/**
 * 생존 플레이어 위치의 무게중심 — 일반 적 스폰 앵커 좌표
 * @param {Map<string, object>} players
 * @returns {{ x: number, y: number }}
 */
function getSpawnAnchor(players) {
  const alive = [...players.values()].filter((p) => p.alive);
  if (!alive.length) return { x: 0, y: 0 };
  const x = alive.reduce((s, p) => s + p.player.x, 0) / alive.length;
  const y = alive.reduce((s, p) => s + p.player.y, 0) / alive.length;
  return { x, y };
}

/** (x,y)가 생존 플레이어 중 한 명의 radius 이내인지 */
function nearAnyPlayer(x, y, players, radius) {
  const r2 = radius * radius;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = x - p.player.x;
    const dy = y - p.player.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/** getStateFor — 수신 플레이어 시야에 들어오는 엔티티만 포함 */
function inSyncRange(x, y, focusX, focusY) {
  const dx = x - focusX;
  const dy = y - focusY;
  return dx * dx + dy * dy <= syncRadius * syncRadius;
}

export class GameRoom {
  /**
   * 새 게임 방 인스턴스 생성
   * @param {string} hostId 방 호스트 플레이어 UUID
   */
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

  /**
   * 방에 플레이어 추가 (최대 4명)
   * @param {string} id 플레이어 UUID
   * @param {string} name 표시 이름 (12자 제한)
   * @returns {boolean} 추가 성공 여부
   */
  addPlayer(id, name, characterId = 'gunner') {
    if (this.players.size >= 4) return false;
    const slot = this.players.size;
    const offset = slot * 100;
    const cid = getCharacter(characterId).id;
    const player = new Player(offset, offset);
    player.id = id;
    player.specialMeter = 0;
    player.specialShield = 0;
    const stats = createStats(cid);
    applyCharacterBase(stats, player, cid);
    this.players.set(id, {
      id,
      name: name.slice(0, 12) || `P${slot + 1}`,
      color: PLAYER_COLORS[slot],
      characterId: cid,
      player,
      stats,
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
      input: { up: false, down: false, left: false, right: false, angle: 0, useSpecial: false },
    });
    return true;
  }

  /**
   * 플레이어 제거 및 호스트 이양
   * @param {string} id
   * @returns {'empty'|'ok'} 방이 비었으면 'empty'
   */
  removePlayer(id) {
    this.players.delete(id);
    if (this.players.size === 0) return 'empty';
    if (this.hostId === id) {
      this.hostId = this.players.keys().next().value;
    }
    return 'ok';
  }

  /**
   * 대기 상태에서 게임 시작 — 플레이어·월드 초기화 후 TICK_RATE 시뮬레이션 루프 가동
   * @returns {boolean} 시작 성공 여부
   */
  startGame() {
    if (this.state !== 'waiting' || this.players.size < 1) return false;
    this.state = 'playing';
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.spawnTimer = 0;
    for (const p of this.players.values()) {
      const cid = p.characterId || p.stats?.characterId || 'gunner';
      p.level = 1;
      p.exp = 0;
      p.kills = 0;
      p.stats = createStats(cid);
      p.characterId = cid;
      p.player.specialMeter = 0;
      p.player.specialShield = 0;
      applyCharacterBase(p.stats, p.player, cid);
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

  /**
   * 시뮬레이션 인터벌 중지 및 waiting 상태로 복귀 (방 폐기 전 정리용)
   */
  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.state = 'waiting';
  }

  /**
   * 라운드 종료 — playing→waiting, 월드·플레이어 전투 상태 리셋, onRoundEnd 콜백 호출
   */
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

  /**
   * 아직 전투 중인 플레이어가 있는지 (playing/boss/bossWarning)
   * @returns {boolean}
   */
  hasActivePlayers() {
    return [...this.players.values()].some(
      (p) => p.alive && (p.gameState === 'playing' || p.gameState === 'boss' || p.gameState === 'bossWarning'),
    );
  }

  /**
   * 플레이어 기권(사망 처리) — 탄환 제거, 활성 플레이어 없으면 endRound
   * @param {string} id
   * @returns {boolean}
   */
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

  /**
   * 클라이언트 입력을 플레이어 input 객체에 병합
   * @param {string} id
   * @param {object} input 이동·angle 등
   */
  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = { ...p.input, ...input };
  }

  /** 플레이어 캐릭터 변경 (로비·대기 중) */
  setCharacter(id, characterId) {
    const p = this.players.get(id);
    if (!p || this.state !== 'waiting') return;
    const cid = getCharacter(characterId).id;
    p.characterId = cid;
    p.stats = createStats(cid);
    p.player.specialMeter = 0;
    applyCharacterBase(p.stats, p.player, cid);
  }

  /**
   * 레벨업 증강 선택 처리 — 스탯 적용, 보스 경고/연속 레벨업 분기
   * @param {string} id
   * @param {string} augmentId
   */
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

  /**
   * 레벨 상승 및 증강 3택1 큐에 추가 (선택지 없으면 tryLevelUp 재귀)
   * @param {object} p 플레이어 래퍼
   */
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

  /**
   * 경험치가 충분하면 levelUpPlayer 호출 (보스 경고·게임오버·승리 중 제외)
   * @param {object} p
   */
  tryLevelUp(p) {
    if (!p.alive) return;
    if (p.gameState === 'bossWarning' || p.gameState === 'gameOver' || p.gameState === 'victory') return;
    if (p.exp >= expForLevel(p.level) && p.level < CONFIG.MAX_LEVEL) {
      p.exp -= expForLevel(p.level);
      this.levelUpPlayer(p);
    }
  }

  /**
   * 적 처치 등으로 경험치 추가 후 레벨업 시도
   * @param {object} p
   * @param {number} amount 기본 경험치량
   */
  addExp(p, amount) {
    if (p.gameState === 'bossWarning') return;
    p.exp += Math.floor(amount * p.stats.expMult * CONFIG.PLAYER.baseExpMult);
    this.tryLevelUp(p);
  }

  /**
   * 월드 레벨에 따른 일반 적 스폰 간격(초) — 레벨↑면 간격 단축
   * @returns {number}
   */
  getSpawnInterval() {
    return spawnIntervalForLevel(getWorldLevel(this.players));
  }

  /**
   * 보스 경고 종료 후 해당 플레이어 위치에 보스 스폰
   * @param {object} p
   */
  spawnBossFor(p) {
    const boss = spawnBoss(p.player, p.level, {
      ownerId: p.id,
      bossType: p.pendingBoss || undefined,
    });
    this.enemies.push(boss);
    p.bossEnemyId = boss.id;
    p.gameState = 'boss';
    p.pendingBoss = null;
  }

  /**
   * 적 처치 시 킬·경험치·보스 클리어/승리 상태 갱신
   * @param {object} killer 플레이어 래퍼
   * @param {import('../js/entities.js').Enemy} enemy
   */
  onEnemyKill(killer, enemy) {
    if (!killer?.alive) return;
    chargeSpecialMeter(killer.stats, killer.player, 'kill');
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

  /**
   * 피격·사망 처리를 일시 중단해야 하는 플레이어 상태인지
   * @param {object} p
   * @returns {boolean}
   */
  isPausedPlayer(p) {
    return p.gameState === 'bossWarning'
      || p.gameState === 'gameOver' || p.gameState === 'victory';
  }

  /**
   * 단일 플레이어 틱 — 이동·사격·근접/궤도 데미지·보스 경고 타이머
   * @param {object} p
   * @param {number} dt 델타 시간(초)
   */
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

    if (p.input.useSpecial) {
      useSpecialAbility(p.player, p.stats, {
        enemies: this.enemies,
        bullets: this.bullets,
        particles: [],
        ownerId: p.id,
        onEnemyKill: (e) => this.onEnemyKill(p, e),
      });
      p.input.useSpecial = false;
    }

    if (p.player.canFire(dt, p.stats)) {
      const newBullets = fireBullets(p.player, p.stats);
      newBullets.forEach((b) => { b.ownerId = p.id; });
      this.bullets.push(...newBullets);

      getPointBlankHits(p.player, p.stats, this.enemies).forEach(({ enemy, amount, angle, knockback, crit }) => {
        if (enemy.dead) return;
        let dmg = crit ? amount * (CONFIG.PLAYER.baseCritMult + p.stats.critMult) : amount;
        dmg *= p.stats.meleeDamageMult || 1;
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

  /**
   * 적에게 데미지 적용 및 사망 시 onEnemyKill
   * @param {import('../js/entities.js').Enemy} enemy
   * @param {number} amount
   * @param {number} angle
   * @param {number} knockback
   * @param {object} killer
   */
  applyHit(enemy, amount, angle, knockback, killer) {
    enemy.takeDamage(amount, angle, knockback);
    if (killer?.stats?.lifeSteal > 0) {
      killer.player.hp = Math.min(
        killer.player.maxHp,
        killer.player.hp + amount * killer.stats.lifeSteal,
      );
    }
    chargeSpecialMeter(killer.stats, killer.player, 'hit');
    if (enemy.dead) this.onEnemyKill(killer, enemy);
  }

  /**
   * 방 전체 시뮬레이션 한 틱 — 플레이어·스폰·보스 미니언·탄환·충돌·라운드 종료
   */
  update() {
    const dt = 1 / TICK_RATE;
    this.tick++;

    if (this.state !== 'playing') return;

    const worldLevel = getWorldLevel(this.players);
    const anchor = getSpawnAnchor(this.players);
    const fakePlayer = { x: anchor.x, y: anchor.y };
    const bulletCull = simCullRadius;

    for (const p of this.players.values()) {
      this.updatePlayer(p, dt);
    }

    const anyPlaying = [...this.players.values()].some(
      (p) => p.alive && (p.gameState === 'playing' || p.gameState === 'boss')
    );

    // 일반 적 스폰: 생존+playing/boss 플레이어가 있을 때 spawnTimer 기준, 앵커·월드레벨 반영
    if (anyPlaying) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.enemies.length < maxSimEnemies) {
        this.enemies.push(spawnEnemy(fakePlayer, VIEW_W, VIEW_H, worldLevel));
        this.spawnTimer = this.getSpawnInterval();
      }
    }

    // 보스 미니언 스폰: 각 플레이어의 보스가 minionTimer마다 추가 적 생성
    for (const p of this.players.values()) {
      if (!p.alive || !p.bossEnemyId) continue;
      const boss = this.enemies.find((e) => e.id === p.bossEnemyId);
      if (boss && !boss.dead) {
        boss.minionTimer -= dt;
        if (boss.minionTimer <= 0) {
          const count = boss.minionCount || 3;
          const room = maxSimEnemies - this.enemies.length;
          const spawnCount = room > 0 ? Math.min(count, room) : 0;
          for (let i = 0; i < spawnCount; i++) {
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
      const target = findTargetForEnemy(e, this.players);
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
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const hitR = b.radius + e.radius;
        if (dx * dx + dy * dy >= hitR * hitR) continue;
        if (!b.canHit(e)) continue;
        const { amount, crit } = b.getDamage();
        this.applyHit(e, amount, b.angle, b.knockback, owner);
        b.registerHit(e);
      }
    }

    this.enemyBullets.forEach((b) => b.update(dt));
    this.enemyBullets = this.enemyBullets.filter((b) => {
      if (b.dead) return false;
      const dx = b.x - anchor.x;
      const dy = b.y - anchor.y;
      if (dx * dx + dy * dy > bulletCull * bulletCull) return false;
      for (const p of this.players.values()) {
        if (!p.alive || this.isPausedPlayer(p)) continue;
        if (Math.hypot(b.x - p.player.x, b.y - p.player.y) < b.radius + p.player.radius) {
          let dmg = b.damage * (1 - (p.stats.damageReduction || 0));
          if (p.player.specialShield > 0) dmg *= 0.5;
          if (p.player.takeDamage(dmg)) {
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
    if (this.enemyBullets.length > maxEnemyBullets) {
      this.enemyBullets.splice(0, this.enemyBullets.length - maxEnemyBullets);
    }

    for (const e of this.enemies) {
      if (e.dead || e.typeKey === 'ranged') continue;
      for (const p of this.players.values()) {
        if (!p.alive || this.isPausedPlayer(p)) continue;
        const dx = e.x - p.player.x;
        const dy = e.y - p.player.y;
        const hitR = e.radius + p.player.radius;
        if (dx * dx + dy * dy >= hitR * hitR) continue;
        const angle = Math.atan2(dy, dx);
        e.knockbackX += Math.cos(angle) * 280 * p.stats.knockbackMult * (1 - e.knockbackResist);
        e.knockbackY += Math.sin(angle) * 280 * p.stats.knockbackMult * (1 - e.knockbackResist);
          if (p.player.contactCooldown <= 0) {
            let dmg = e.damage * (1 - (p.stats.damageReduction || 0));
            if (p.player.specialShield > 0) dmg *= 0.5;
            if (p.player.takeDamage(dmg)) {
            p.player.contactCooldown = 0.4;
            if (p.player.hp <= 0) {
              p.alive = false;
              p.gameState = 'gameOver';
            }
          }
        }
      }
    }

    this.enemies = this.enemies.filter((e) => {
      if (e.dead) return false;
      if (e.typeKey === 'boss') return true;
      return nearAnyPlayer(e.x, e.y, this.players, simCullRadius);
    });

    if (!this.hasActivePlayers()) {
      this.endRound();
    }
  }

  /**
   * 로비 UI용 방 요약 (코드, 호스트, 상태, 플레이어 목록)
   * @returns {object}
   */
  getLobbyInfo() {
    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        characterId: p.characterId,
        characterName: getCharacter(p.characterId).name,
        alive: p.alive,
      })),
    };
  }

  /**
   * 특정 플레이어에게 보낼 전체 게임 상태 스냅샷 (증강 선택은 본인만)
   * @param {string} id 수신 플레이어 UUID
   * @returns {object}
   */
  getStateFor(id) {
    const me = this.players.get(id);
    const focus = me?.alive ? me.player : getSpawnAnchor(this.players);
    const focusX = focus.x;
    const focusY = focus.y;
    const visible = (x, y, always = false) => always || inSyncRange(x, y, focusX, focusY);
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
        characterId: p.characterId,
        characterName: getCharacter(p.characterId).name,
        specialMeter: p.player.specialMeter || 0,
        specialMeterMax: getSpecialMeterMax(p.stats),
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
      enemies: this.enemies.filter((e) => visible(e.x, e.y, e.typeKey === 'boss')).map((e) => ({
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
        ownerId: e.ownerId || null,
        pattern: e.pattern || null,
      })),
      bullets: this.bullets.filter((b) => !b.dead && visible(b.x, b.y)).map((b) => ({
        id: b.id, x: b.x, y: b.y, angle: b.angle, ownerId: b.ownerId,
      })),
      enemyBullets: this.enemyBullets.filter((b) => visible(b.x, b.y)).map((b) => ({
        id: b.id, x: b.x, y: b.y, radius: b.radius,
      })),
      augmentChoices: me?.augmentQueue?.[0]?.choices ?? null,
      pendingAugments: me?.augmentQueue?.length ?? 0,
    };
  }
}

export class RoomManager {
  /** 방 코드 Map과 플레이어→방 코드 역인덱스 초기화 */
  constructor() {
    this.rooms = new Map();
    this.playerRoom = new Map();
  }

  /**
   * 새 방 생성 및 생성자를 첫 플레이어·호스트로 등록
   * @param {string} playerId
   * @param {string} name
   * @returns {GameRoom}
   */
  createRoom(playerId, name, characterId) {
    const room = new GameRoom(playerId);
    room.addPlayer(playerId, name, characterId);
    this.rooms.set(room.code, room);
    this.playerRoom.set(playerId, room.code);
    return room;
  }

  /**
   * 코드로 대기 중인 방에 참가
   * @param {string} playerId
   * @param {string} code
   * @param {string} name
   * @returns {GameRoom|null}
   */
  joinRoom(playerId, code, name, characterId) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.state !== 'waiting') return null;
    if (!room.addPlayer(playerId, name, characterId)) return null;
    this.playerRoom.set(playerId, room.code);
    return room;
  }

  /**
   * 플레이어가 속한 GameRoom 조회
   * @param {string} playerId
   * @returns {GameRoom|null}
   */
  getRoomByPlayer(playerId) {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : null;
  }

  /**
   * 플레이어 방 퇴장 — 빈 방이면 stop 후 삭제, playing 중 전원 비활성 시 endRound
   * @param {string} playerId
   * @returns {GameRoom|null} 남은 방 또는 null
   */
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

  /**
   * 현재 playing 상태인 모든 방 목록 (서버 20Hz 상태 브로드캐스트용)
   * @returns {GameRoom[]}
   */
  getPlayingRooms() {
    return [...this.rooms.values()].filter((r) => r.state === 'playing');
  }
}
