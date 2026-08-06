/**
 * entities.js — 게임 엔티티(개체) 클래스 및 관련 유틸리티
 *
 * 이 파일은 플레이어, 총알, 적, 보스, 궤도 방패, 파티클 등
 * 게임 월드에 존재하는 모든 개체의 정의와 동작을 담당합니다.
 * 각 클래스는 위치·체력·이동·공격·렌더링 로직을 캡슐화하며,
 * 하단의 export 함수들은 스폰, 충돌 판정, 배경 그리기 등
 * 게임 루프에서 호출되는 헬퍼 역할을 합니다.
 */
import { CONFIG, getLevelMults, getBossType, getBossTier } from './config.js';

/** 다음에 생성될 엔티티에 부여할 고유 ID (총알·적 등에서 순차 증가) */
let nextEntityId = 1;

/** 월드 좌표를 화면(캔버스) 좌표로 변환 */
export function worldToScreen(wx, wy, camera, cx, cy) {
  return { x: wx - camera.x + cx, y: wy - camera.y + cy };
}

/** 화면(캔버스) 좌표를 월드 좌표로 변환 */
export function screenToWorld(sx, sy, camera, cx, cy) {
  return { x: sx - cx + camera.x, y: sy - cy + camera.y };
}

/** 플레이어 캐릭터 — 이동, 조준, 발사 쿨다운, 피격·무적 처리 */
export class Player {
  /** @param {number} x - 월드 X 좌표 */
  /** @param {number} y - 월드 Y 좌표 */
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.radius = CONFIG.PLAYER.radius;
    this.maxHp = CONFIG.PLAYER.maxHp;
    this.hp = this.maxHp;
    this.fireCooldown = 0;
    this.invincible = 0;
    this.contactCooldown = 0;
  }

  /** WASD/방향키 이동, 마우스 방향 조준, 무적·재생 처리 */
  update(dt, worldMouse, stats, keys) {
    let mx = 0, my = 0;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;

    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      const speed = CONFIG.PLAYER.baseMoveSpeed * stats.moveSpeedMult;
      this.x += (mx / len) * speed * dt;
      this.y += (my / len) * speed * dt;
    }

    const dx = worldMouse.x - this.x;
    const dy = worldMouse.y - this.y;
    this.angle = Math.atan2(dy, dx);

    if (this.invincible > 0) this.invincible -= dt;
    if (stats.regen > 0) {
      this.hp = Math.min(this.maxHp, this.hp + stats.regen * dt);
    }
  }

  /** 발사 쿨다운이 충족되면 true 반환 및 쿨다운 재설정 */
  canFire(dt, stats) {
    this.fireCooldown -= dt;
    const rate = CONFIG.PLAYER.baseFireRate * stats.fireRateMult;
    if (this.fireCooldown <= 0) {
      this.fireCooldown = 1 / rate;
      return true;
    }
    return false;
  }

  /** 피해 적용 — 무적 중이면 false, 성공 시 짧은 무적 시간 부여 */
  takeDamage(amount) {
    if (this.invincible > 0) return false;
    this.hp -= amount;
    this.invincible = 0.4;
    return true;
  }

  /** 플레이어 원형 몸체와 총구 방향 표시 (로컬 좌표 기준) */
  draw(ctx, cx, cy, color = '#3af') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);

    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.invincible > 0 && Math.floor(Date.now() / 80) % 2 ? '#fff' : color;
    ctx.fill();
    ctx.strokeStyle = '#8cf';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#bdf';
    ctx.fillRect(this.radius - 2, -4, 14, 8);
    ctx.restore();
  }
}

/** 플레이어가 발사하는 총알 — 관통·크리티컬·넉백 지원 */
export class Bullet {
  constructor(x, y, angle, stats) {
    this.id = nextEntityId++;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = CONFIG.PLAYER.baseBulletSpeed * stats.bulletSpeedMult;
    this.damage = CONFIG.PLAYER.baseDamage * stats.damageMult;
    this.radius = 5;
    this.maxHits = 1 + CONFIG.PLAYER.basePierce + stats.pierce;
    this.hitEnemies = new Set();
    this.critChance = CONFIG.PLAYER.baseCritChance + stats.critChance;
    this.critMult = CONFIG.PLAYER.baseCritMult + stats.critMult;
    this.knockback = 120 * stats.knockbackMult;
    this.dead = false;
  }

  /** 발사 각도 방향으로 이동 */
  update(dt) {
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
  }

  /** 해당 적을 아직 맞추지 않았는지 확인 (관통용) */
  canHit(enemy) {
    return !this.hitEnemies.has(enemy.id);
  }

  /** 적 명중 등록 — 최대 관통 수 도달 시 dead 처리 */
  registerHit(enemy) {
    this.hitEnemies.add(enemy.id);
    if (this.hitEnemies.size >= this.maxHits) this.dead = true;
  }

  /** 크리티컬 확률에 따른 최종 피해량 계산 */
  getDamage() {
    const crit = Math.random() < this.critChance;
    return {
      amount: crit ? this.damage * this.critMult : this.damage,
      crit,
    };
  }

  /** 화면 좌표로 변환 후 노란 원형 총알 렌더링 */
  draw(ctx, camera, cx, cy) {
    const s = worldToScreen(this.x, this.y, camera, cx, cy);
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ff8';
    ctx.shadowColor = '#ff0';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/** 적이 발사하는 총알 */
export class EnemyBullet {
  constructor(x, y, angle, speed, damage, radius = 6) {
    this.id = nextEntityId++;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = speed;
    this.damage = damage;
    this.radius = radius;
    this.dead = false;
  }

  /** 발사 각도 방향으로 이동 */
  update(dt) {
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
  }

  /** 분홍색 원형 적 총알 렌더링 */
  draw(ctx, camera, cx, cy) {
    const s = worldToScreen(this.x, this.y, camera, cx, cy);
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f6a';
    ctx.shadowColor = '#f0a';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/** 일반 적 — 근접/원거리 타입, 레벨 스케일, 넉백·체력바 */
export class Enemy {
  constructor(x, y, typeKey, level) {
    const type = CONFIG.ENEMY_TYPES[typeKey] || CONFIG.ENEMY_TYPES.melee;
    const lm = getLevelMults(level);

    this.id = nextEntityId++;
    this.typeKey = typeKey;
    this.type = type;
    this.x = x;
    this.y = y;
    this.level = level;
    this.hp = CONFIG.ENEMY.baseHp * type.hpMult * lm.hp;
    this.maxHp = this.hp;
    this.speed = CONFIG.ENEMY.baseSpeed * type.speedMult * lm.speed;
    this.damage = CONFIG.ENEMY.baseDamage * type.damageMult * lm.damage;
    this.attackSpeedMult = lm.attackSpeed;
    this.radius = type.radius;
    this.exp = Math.floor(CONFIG.ENEMY.baseExp * type.expMult * (1 + (level - 1) * 0.05));
    this.knockbackResist = type.knockbackResist || 0;
    this.dead = false;
    this.flash = 0;
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.meleeCooldown = 0;
    this.fireCooldown = 0.5 + Math.random() * 0.5;
    this.color = type.color;
    this.stroke = type.stroke;
  }

  /** 넉백 감쇠, 플레이어 추적 또는 원거리 AI */
  update(dt, targetX, targetY, enemyBullets) {
    if (this.flash > 0) this.flash -= dt;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    this.x += this.knockbackX * dt;
    this.y += this.knockbackY * dt;
    this.knockbackX *= Math.pow(0.05, dt);
    this.knockbackY *= Math.pow(0.05, dt);

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (this.typeKey === 'ranged') {
      this.updateRanged(dt, dx, dy, dist, targetX, targetY, enemyBullets);
    } else {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }
  }

  /** 원거리 적 — 거리 유지 이동 및 쿨다운 시 총알 발사 */
  updateRanged(dt, dx, dy, dist, targetX, targetY, enemyBullets) {
    const t = this.type;
    const preferred = t.preferredRange;
    const minR = t.minRange;

    if (dist < minR) {
      this.x -= (dx / dist) * this.speed * dt;
      this.y -= (dy / dist) * this.speed * dt;
    } else if (dist > preferred + 40) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }

    if (this.fireCooldown <= 0 && dist < preferred + 120 && dist > minR - 30) {
      const angle = Math.atan2(dy, dx);
      const dmg = this.damage * t.bulletDamageMult;
      enemyBullets.push(new EnemyBullet(this.x, this.y, angle, t.bulletSpeed, dmg));
      this.fireCooldown = 1 / (t.fireRate * this.attackSpeedMult);
    }
  }

  /** 피해·넉백 적용, HP 0 이하 시 dead */
  takeDamage(amount, angle, knockback) {
    this.hp -= amount;
    this.flash = 0.1;
    const kb = knockback * (1 - this.knockbackResist);
    this.knockbackX += Math.cos(angle) * kb;
    this.knockbackY += Math.sin(angle) * kb;
    if (this.hp <= 0) this.dead = true;
  }

  /** 적 원형·체력바 렌더링 (타입별 색상) */
  draw(ctx, camera, cx, cy) {
    const s = worldToScreen(this.x, this.y, camera, cx, cy);
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.flash > 0 ? '#fff' : this.color;
    ctx.fill();
    ctx.strokeStyle = this.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    const barW = this.radius * 2;
    const ratio = this.hp / this.maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(s.x - barW / 2, s.y - this.radius - 8, barW, 4);
    ctx.fillStyle = this.typeKey === 'ranged' ? '#c8f' : '#4f4';
    ctx.fillRect(s.x - barW / 2, s.y - this.radius - 8, barW * ratio, 4);
  }
}

/** 보스 — Enemy 확장, 패턴별 공격·2페이즈·미니언 타이머 */
export class Boss extends Enemy {
  constructor(x, y, level) {
    super(x, y, 'tank', level);
    const lm = getLevelMults(level);
    const tier = getBossTier(level);
    const bossType = getBossType(level);
    const tierScale = 1 + (tier - 1) * 0.55;

    this.typeKey = 'boss';
    this.bossType = bossType;
    this.bossName = bossType.name;
    this.bossDesc = bossType.desc;
    this.bossTier = tier;
    this.pattern = bossType.pattern;
    this.hp = CONFIG.BOSS.hp * bossType.hpMult * tierScale * lm.hp;
    this.maxHp = this.hp;
    this.speed = CONFIG.BOSS.speed * bossType.speedMult * (1 + (tier - 1) * 0.04);
    this.damage = CONFIG.BOSS.damage * bossType.damageMult * lm.damage * (1 + (tier - 1) * 0.1);
    this.radius = CONFIG.BOSS.radius * bossType.radiusMult;
    this.exp = Math.floor(CONFIG.BOSS.exp * tier);
    this.knockbackResist = CONFIG.BOSS.knockbackResist;
    this.minionTimer = CONFIG.BOSS.minionInterval * (bossType.pattern === 'summoner' ? 0.65 : 1);
    this.minionInterval = this.minionTimer;
    this.minionCount = bossType.minionCount;
    this.fireCooldown = 0.6;
    this.pulse = 0;
    this.phase2 = false;
    this.spiralAngle = 0;
    this.chargeTimer = 2;
    this.color = bossType.color;
    this.stroke = bossType.stroke;
  }

  /** 플레이어 방향 기준 부채꼴(fan) 형태 다발 총알 발사 */
  fireFan(enemyBullets, count, spread, damageMult, speed = CONFIG.BOSS.bulletSpeed) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const baseAngle = Math.atan2(dy, dx);
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * spread;
      enemyBullets.push(new EnemyBullet(
        this.x, this.y, baseAngle + offset,
        speed, this.damage * damageMult, 8
      ));
    }
  }

  /** 360도 원형(ring) 총알 발사 */
  fireRing(enemyBullets, count, damageMult, speed = CONFIG.BOSS.bulletSpeed * 0.85) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      enemyBullets.push(new EnemyBullet(
        this.x, this.y, angle,
        speed, this.damage * damageMult, 8
      ));
    }
  }

  /** 플레이어 쪽 이동 — charger 돌진, keepDistance 유지 거리 */
  moveToward(dt, keepDistance = 0) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    let moveSpeed = this.speed;

    if (this.pattern === 'charger' && this.chargeTimer <= 0) {
      moveSpeed *= 2.2;
      this.chargeTimer = 3.5;
    }

    if (keepDistance > 0) {
      if (dist < keepDistance - 40) {
        this.x -= (dx / dist) * moveSpeed * dt;
        this.y -= (dy / dist) * moveSpeed * dt;
        return;
      }
      if (dist > keepDistance + 60) {
        this.x += (dx / dist) * moveSpeed * dt;
        this.y += (dy / dist) * moveSpeed * dt;
        return;
      }
      return;
    }

    this.x += (dx / dist) * moveSpeed * dt;
    this.y += (dy / dist) * moveSpeed * dt;
  }

  /** 보스 패턴(charger, artillery, spiral 등)에 따른 공격 실행 */
  attack(enemyBullets) {
    const p2 = this.phase2 ? 1.25 : 1;

    switch (this.pattern) {
      case 'charger':
        this.fireFan(enemyBullets, this.phase2 ? 7 : 5, 0.16, 0.55 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 1.1 * p2);
        break;
      case 'artillery':
        this.fireFan(enemyBullets, this.phase2 ? 11 : 8, 0.12, 0.7 * p2, CONFIG.BOSS.bulletSpeed * 0.9);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 0.85 * p2);
        break;
      case 'summoner':
        this.fireFan(enemyBullets, 3, 0.22, 0.5 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 1.2 * p2);
        break;
      case 'swift':
        this.fireFan(enemyBullets, this.phase2 ? 4 : 3, 0.1, 0.45 * p2, CONFIG.BOSS.bulletSpeed * 1.15);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 1.6 * p2);
        break;
      case 'fortress':
        if (this.phase2) this.fireRing(enemyBullets, 10, 0.55 * p2);
        else this.fireFan(enemyBullets, 6, 0.2, 0.65 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * (this.phase2 ? 1.1 : 0.75) * p2);
        break;
      case 'commander':
        this.fireFan(enemyBullets, this.phase2 ? 5 : 3, 0.08, 0.6 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 1.8 * p2);
        break;
      case 'spiral':
        for (let i = 0; i < (this.phase2 ? 4 : 3); i++) {
          enemyBullets.push(new EnemyBullet(
            this.x, this.y, this.spiralAngle + i * (Math.PI * 2 / 3),
            CONFIG.BOSS.bulletSpeed, this.damage * 0.5 * p2, 8
          ));
        }
        this.spiralAngle += this.phase2 ? 0.55 : 0.4;
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 2.2 * p2);
        break;
      case 'splitter':
        this.fireFan(enemyBullets, this.phase2 ? 8 : 5, 0.14, 0.6 * p2);
        if (this.phase2) this.fireRing(enemyBullets, 8, 0.35 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * (this.phase2 ? 1.2 : 0.95) * p2);
        break;
      case 'dark':
        this.fireFan(enemyBullets, this.phase2 ? 12 : 9, 0.08, 0.55 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 1.3 * p2);
        break;
      case 'final':
        this.fireFan(enemyBullets, 7, 0.1, 0.65 * p2);
        this.fireRing(enemyBullets, this.phase2 ? 12 : 6, 0.4 * p2);
        this.fireCooldown = 1 / (CONFIG.BOSS.fireRate * 1.4 * p2);
        break;
      default:
        this.fireFan(enemyBullets, 5, 0.18, 0.6);
        this.fireCooldown = 1 / CONFIG.BOSS.fireRate;
    }
  }

  /** 넉백·페이즈2 전환·거리 유지 이동·공격 쿨다운 처리 */
  update(dt, targetX, targetY, enemyBullets) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.pulse += dt * 3;
    this.minionTimer -= dt;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.chargeTimer = Math.max(0, this.chargeTimer - dt);

    this.x += this.knockbackX * dt;
    this.y += this.knockbackY * dt;
    this.knockbackX *= Math.pow(0.02, dt);
    this.knockbackY *= Math.pow(0.02, dt);

    if (!this.phase2 && this.hp / this.maxHp < CONFIG.BOSS.phase2HpRatio) {
      this.phase2 = true;
      this.speed *= 1.25;
    }

    const keepDistance = this.pattern === 'commander' ? 320
      : this.pattern === 'artillery' ? 280
      : this.pattern === 'summoner' ? 240
      : 0;

    this.moveToward(dt, keepDistance);

    if (this.fireCooldown <= 0) {
      this.attack(enemyBullets);
    }
  }

  /** 펄스 크기·그라데이션·보스명·페이즈·체력바 렌더링 */
  draw(ctx, camera, cx, cy) {
    const s = worldToScreen(this.x, this.y, camera, cx, cy);
    ctx.save();
    ctx.translate(s.x, s.y);

    const r = this.radius + Math.sin(this.pulse) * 4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, this.phase2 ? '#fff' : this.color);
    grad.addColorStop(1, this.stroke);
    ctx.fillStyle = this.flash > 0 ? '#fff' : grad;
    ctx.fill();
    ctx.strokeStyle = this.stroke;
    ctx.lineWidth = 3;
    ctx.stroke();

    const barW = Math.max(200, this.radius * 3.2);
    const ratio = this.hp / this.maxHp;
    ctx.fillStyle = '#222';
    ctx.fillRect(-barW / 2, -r - 24, barW, 10);
    ctx.fillStyle = '#f44';
    ctx.fillRect(-barW / 2, -r - 24, barW * ratio, 10);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.bossName} · ${this.bossTier}/10`, 0, -r - 28);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.fillText(this.phase2 ? 'Phase 2' : 'BOSS', 0, -r - 14);
    ctx.restore();
  }
}

/** 플레이어 주위를 공전하는 궤도 방패 — 접촉 시 적에게 피해 */
export class OrbitShield {
  constructor(player, index, total) {
    this.player = player;
    this.index = index;
    this.total = total;
    this.angle = (index / total) * Math.PI * 2;
    this.radius = 55;
    this.orbitRadius = 8;
    this.damage = 15;
    this.speed = 2.5;
  }

  /** 공전 각도 증가 */
  update(dt) {
    this.angle += this.speed * dt;
  }

  /** 현재 월드 좌표상 방패 위치 계산 */
  getPosition() {
    const a = this.angle + (this.index / this.total) * Math.PI * 2;
    return {
      x: this.player.x + Math.cos(a) * this.radius,
      y: this.player.y + Math.sin(a) * this.radius,
    };
  }

  /** 파란 발광 원형 방패 렌더링 */
  draw(ctx, camera, cx, cy) {
    const pos = this.getPosition();
    const s = worldToScreen(pos.x, pos.y, camera, cx, cy);
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.orbitRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#8cf';
    ctx.shadowColor = '#48f';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/** 짧은 수명의 이펙트 파티클 — 폭발·피격 시각 효과 */
export class Particle {
  constructor(x, y, color, speed = 100) {
    this.x = x;
    this.y = y;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.5 + Math.random());
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.life = 0.4 + Math.random() * 0.3;
    this.maxLife = this.life;
    this.color = color;
    this.radius = 2 + Math.random() * 3;
  }

  /** 이동·감속·수명 감소 */
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    this.vx *= 0.95;
    this.vy *= 0.95;
  }

  /** 수명에 비례한 투명도로 원형 파티클 렌더링 */
  draw(ctx, camera, cx, cy) {
    const s = worldToScreen(this.x, this.y, camera, cx, cy);
    const alpha = this.life / this.maxLife;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/**
 * 레벨에 맞는 적 타입을 가중치 랜덤으로 선택
 * (ranged는 Lv3+, tank는 Lv2+ 에서만 풀에 포함)
 */
function pickEnemyType(level) {
  const types = Object.values(CONFIG.ENEMY_TYPES);
  let pool = types.filter((t) => {
    if (t.id === 'ranged' && level < 3) return false;
    if (t.id === 'tank' && level < 2) return false;
    return true;
  });
  const totalWeight = pool.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const t of pool) {
    roll -= t.weight;
    if (roll <= 0) return t.id;
  }
  return 'melee';
}

/** 멀티플레이 원격 플레이어 아바타 및 닉네임 렌더링 */
export function drawRemotePlayer(ctx, x, y, angle, color, name, camera, cx, cy) {
  const s = worldToScreen(x, y, camera, cx, cy);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, CONFIG.PLAYER.radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#bdf';
  ctx.fillRect(CONFIG.PLAYER.radius - 2, -4, 14, 8);
  ctx.restore();
  if (name) {
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, s.x, s.y - CONFIG.PLAYER.radius - 8);
  }
}

/** 네트워크 동기화용 적 스냅샷 데이터로 적·보스 렌더링 */
export function drawEnemySnapshot(ctx, e, camera, cx, cy) {
  const s = worldToScreen(e.x, e.y, camera, cx, cy);
  if (e.typeKey === 'boss') {
    ctx.save();
    ctx.translate(s.x, s.y);
    const r = e.radius;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.strokeStyle = e.stroke || '#f00';
    ctx.lineWidth = 3;
    ctx.stroke();
    const barW = Math.max(200, r * 3.2);
    const ratio = e.hp / e.maxHp;
    ctx.fillStyle = '#222';
    ctx.fillRect(-barW / 2, -r - 24, barW, 10);
    ctx.fillStyle = '#f44';
    ctx.fillRect(-barW / 2, -r - 24, barW * ratio, 10);
    if (e.bossName) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${e.bossName} · ${e.bossTier}/10`, 0, -r - 28);
    }
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.arc(s.x, s.y, e.radius, 0, Math.PI * 2);
  ctx.fillStyle = e.color;
  ctx.fill();
  ctx.strokeStyle = e.stroke || '#000';
  ctx.lineWidth = 2;
  ctx.stroke();
  const barW = e.radius * 2;
  const ratio = e.hp / e.maxHp;
  ctx.fillStyle = '#333';
  ctx.fillRect(s.x - barW / 2, s.y - e.radius - 8, barW, 4);
  ctx.fillStyle = e.typeKey === 'ranged' ? '#c8f' : '#4f4';
  ctx.fillRect(s.x - barW / 2, s.y - e.radius - 8, barW * ratio, 4);
}

/** 플레이어 주변 화면 밖 네 변 중 한 곳에서 적 스폰 */
export function spawnEnemy(player, w, h, level) {
  const margin = CONFIG.ENEMY.spawnMargin;
  const halfW = w / 2 + margin;
  const halfH = h / 2 + margin;
  const side = Math.floor(Math.random() * 4);
  let x, y;
  switch (side) {
    case 0: x = player.x + (Math.random() - 0.5) * halfW * 2; y = player.y - halfH; break;
    case 1: x = player.x + halfW; y = player.y + (Math.random() - 0.5) * halfH * 2; break;
    case 2: x = player.x + (Math.random() - 0.5) * halfW * 2; y = player.y + halfH; break;
    default: x = player.x - halfW; y = player.y + (Math.random() - 0.5) * halfH * 2;
  }
  return new Enemy(x, y, pickEnemyType(level), level);
}

/** 플레이어 위쪽 고정 거리에 보스 생성 */
export function spawnBoss(player, level) {
  return new Boss(player.x, player.y - 500, level);
}

/** 플레이어 위치·조준각 기준 다중 총알 생성 (스프레드 적용) */
export function fireBullets(player, stats) {
  const bullets = [];
  const count = CONFIG.PLAYER.baseBulletCount + stats.bulletCount;
  const spread = CONFIG.PLAYER.baseSpread + (count > 1 ? 0.12 : 0);
  const startAngle = player.angle - spread * (count - 1) / 2;

  for (let i = 0; i < count; i++) {
    const angle = startAngle + spread * i;
    const bx = player.x + Math.cos(angle) * (player.radius + 4);
    const by = player.y + Math.sin(angle) * (player.radius + 4);
    bullets.push(new Bullet(bx, by, angle, stats));
  }
  return bullets;
}

/** 플레이어와 겹친 적을 밀어내어 겹침 방지 */
export function separateEnemiesFromPlayer(player, enemies) {
  enemies.forEach((e) => {
    if (e.dead) return;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const minDist = player.radius + e.radius * 0.85;
    if (dist < minDist) {
      const push = (minDist - dist) / dist;
      e.x += dx * push;
      e.y += dy * push;
    }
  });
}

/** 근접(포인트 블랭크) 공격 — 전방 부채꼴 또는 접촉 범위 내 적 타격 목록 */
export function getPointBlankHits(player, stats, enemies) {
  const hits = [];
  const damage = CONFIG.PLAYER.baseDamage * stats.damageMult;
  const knockback = 140 * stats.knockbackMult;
  const closeRange = player.radius + 36;
  const halfCone = 0.75;

  enemies.forEach((e) => {
    if (e.dead) return;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const dist = Math.hypot(dx, dy);
    const touchDist = player.radius + e.radius;
    if (dist > closeRange + e.radius && dist > touchDist) return;

    const overlap = dist < touchDist;
    if (!overlap) {
      const angleToEnemy = Math.atan2(dy, dx);
      let diff = angleToEnemy - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > halfCone) return;
    }

    const angle = Math.atan2(dy, dx);
    hits.push({
      enemy: e,
      amount: damage,
      angle,
      knockback,
      crit: Math.random() < CONFIG.PLAYER.baseCritChance + stats.critChance,
    });
  });

  return hits;
}

/** 적의 근접 접촉 피해 — 플레이어와 겹친 적의 meleeCooldown 기반 타격 */
export function getMeleeHits(player, stats, enemies, dt) {
  const hits = [];
  const damage = CONFIG.PLAYER.baseDamage * stats.damageMult * 0.55 * dt * 4;
  const knockback = 200 * stats.knockbackMult;

  enemies.forEach((e) => {
    if (e.dead) return;
    e.meleeCooldown = Math.max(0, (e.meleeCooldown || 0) - dt);
    const dist = Math.hypot(e.x - player.x, e.y - player.y);
    if (dist >= player.radius + e.radius) return;
    if (e.meleeCooldown > 0) return;

    e.meleeCooldown = 0.12;
    const angle = Math.atan2(e.y - player.y, e.x - player.x);
    hits.push({ enemy: e, amount: damage, angle, knockback });
  });

  return hits;
}

/** 지정 위치에 파티클 다수 생성 (최대 개수 초과 시 오래된 것 제거) */
export function spawnParticles(particles, x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= CONFIG.PARTICLES.max) particles.shift();
    particles.push(new Particle(x, y, color));
  }
}

/** 어두운 배경·그리드·장식 점으로 월드 배경 렌더링 */
export function drawWorldBackground(ctx, camera, w, h, cx, cy) {
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, w, h);

  const gridSize = CONFIG.WORLD.gridSize;
  const offX = (-camera.x + cx) % gridSize;
  const offY = (-camera.y + cy) % gridSize;

  ctx.strokeStyle = 'rgba(40, 60, 100, 0.3)';
  ctx.lineWidth = 1;
  for (let x = offX - gridSize; x < w + gridSize; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = offY - gridSize; y < h + gridSize; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const dots = 12;
  for (let i = 0; i < dots; i++) {
    const wx = Math.floor(camera.x / 400) * 400 + (i * 137) % 400 - 200;
    const wy = Math.floor(camera.y / 400) * 400 + (i * 211) % 400 - 200;
    const s = worldToScreen(wx, wy, camera, cx, cy);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(68, 136, 255, 0.12)';
    ctx.fill();
  }
}
