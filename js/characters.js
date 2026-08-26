/**
 * 캐릭터 클래스 · 특수 능력(게이지) · 전용 증강 정의
 */
import { CONFIG } from './config.js';
import {
  spawnParticles, Bullet, fireBullets, getSlashHits, getPointBlankHits,
  SlashEffect, RingEffect,
} from './entities.js';

/** 플레이어블 캐릭터 목록 */
export const CHARACTERS = [
  {
    id: 'vampire',
    name: '흡혈귀',
    icon: '🩸',
    desc: '근접 흡혈형. 적을 타격해 HP를 회복합니다.',
    color: '#e44',
    attackStyle: 'melee',
    applyBase: (s, p) => {
      s.damageMult *= 0.88;
      s.moveSpeedMult *= 1.12;
      s.maxHpBonus -= 15;
      s.lifeSteal = 0.1;
      s.meleeDamageMult = 1.45;
      p.maxHp = CONFIG.PLAYER.maxHp + s.maxHpBonus;
      p.hp = Math.min(p.hp, p.maxHp);
    },
    special: {
      id: 'bloodNova',
      name: '피의 파동',
      desc: '주변 적에게 피해 + 대량 흡혈',
      maxMeter: 100,
      chargePerHit: 9,
      chargePerKill: 28,
      damage: 95,
      radius: 190,
      lifeStealRatio: 0.65,
    },
  },
  {
    id: 'gunner',
    name: '사수',
    icon: '🔫',
    desc: '원거리 화력형. 빠른 사격과 탄막 특수기.',
    color: '#48f',
    attackStyle: 'ranged',
    applyBase: (s, p) => {
      s.fireRateMult *= 1.38;
      s.bulletSpeedMult *= 1.18;
      s.damageMult *= 0.92;
    },
    special: {
      id: 'bulletStorm',
      name: '탄막 난사',
      desc: '전방 넓은 범위 연속 사격',
      maxMeter: 100,
      chargePerHit: 7,
      chargePerKill: 22,
      bulletCount: 22,
      spread: 0.75,
      damageMult: 1.15,
    },
  },
  {
    id: 'guardian',
    name: '수호자',
    icon: '🛡',
    desc: '탱커형. 높은 체력과 피해 감소.',
    color: '#6a6',
    attackStyle: 'melee',
    applyBase: (s, p) => {
      s.maxHpBonus += 45;
      s.damageMult *= 0.82;
      s.moveSpeedMult *= 0.88;
      s.damageReduction = 0.18;
      p.maxHp = CONFIG.PLAYER.maxHp + s.maxHpBonus;
      p.hp = p.maxHp;
    },
    special: {
      id: 'shockwave',
      name: '충격파',
      desc: '주변 적 강력 넉백 + 피해',
      maxMeter: 100,
      chargePerHit: 11,
      chargePerKill: 32,
      damage: 70,
      radius: 230,
      knockback: 420,
    },
  },
];

/** 캐릭터별 무기 업그레이드 — 최대 5랩, 5랩 각성 시 강력한 보너스 */
export const WEAPON_AUGMENTS = [
  {
    id: 'weapon_vampire',
    name: '혈검',
    icon: '🗡',
    characterId: 'vampire',
    isWeaponAugment: true,
    maxTier: 5,
    tierEffects: [
      { desc: '근접 사거리 +12%, 각도 +8%', apply: (s) => { s.meleeRangeMult *= 1.12; s.meleeArcMult *= 1.08; } },
      { desc: '흡혈 +6%', apply: (s) => { s.lifeSteal += 0.06; } },
      { desc: '근접 공격력 +20%', apply: (s) => { s.meleeDamageMult *= 1.2; } },
      { desc: '특수 범위 +25%, 흡혈 +8%', apply: (s) => { s.specialRadiusMult *= 1.25; s.lifeSteal += 0.08; } },
      { desc: '【각성】 전 범위 +55%, 흡혈 40%, 특수 흡혈 극대', apply: (s) => {
        s.meleeRangeMult *= 1.55;
        s.meleeArcMult *= 1.55;
        s.lifeSteal = Math.min(0.65, s.lifeSteal + 0.25);
        s.specialLifeStealBonus += 0.35;
        s.specialRadiusMult *= 1.35;
        s.weaponMastered = true;
      } },
    ],
  },
  {
    id: 'weapon_gunner',
    name: '개조 화기',
    icon: '🔫',
    characterId: 'gunner',
    isWeaponAugment: true,
    maxTier: 5,
    tierEffects: [
      { desc: '공격력 +18%', apply: (s) => { s.damageMult *= 1.18; } },
      { desc: '탄환 +1, 탄속 +15%', apply: (s) => { s.bulletCount += 1; s.bulletSpeedMult *= 1.15; } },
      { desc: '공격 속도 +45%', apply: (s) => { s.fireRateMult *= 1.45; } },
      { desc: '관통 +1, 공격력 +15%', apply: (s) => { s.pierce += 1; s.damageMult *= 1.15; } },
      { desc: '【각성】 공격 딜레이 제거 — 즉시 연사', apply: (s) => {
        s.instantFire = true;
        s.damageMult *= 1.25;
        s.weaponMastered = true;
      } },
    ],
  },
  {
    id: 'weapon_guardian',
    name: '성스러운 방패',
    icon: '🛡',
    characterId: 'guardian',
    isWeaponAugment: true,
    maxTier: 5,
    tierEffects: [
      { desc: '피해 감소 +6%', apply: (s) => { s.damageReduction = Math.min(0.5, s.damageReduction + 0.06); } },
      { desc: '최대 HP +30', apply: (s, p) => { s.maxHpBonus += 30; p.maxHp += 30; p.hp = Math.min(p.hp + 30, p.maxHp); } },
      { desc: '반사 피해 +15%', apply: (s) => { s.thornsReflect = (s.thornsReflect || 0) + 0.15; } },
      { desc: '피해 감소 +10%, 넉백 +25%', apply: (s) => { s.damageReduction = Math.min(0.55, s.damageReduction + 0.10); s.knockbackMult *= 1.25; } },
      { desc: '【각성】 피해감소 50%, 접촉 피해 85% 반사', apply: (s) => {
        s.damageReduction = Math.min(0.75, Math.max(s.damageReduction, 0.5));
        s.thornsReflect = Math.max(s.thornsReflect || 0, 0.85);
        s.weaponMastered = true;
      } },
    ],
  },
];

/** 특수 능력·무기 관련 증강 (일반 + 캐릭터 전용) */
export const SPECIAL_AUGMENTS = [
  {
    id: 'specialCharge',
    name: '게이지 충전',
    icon: '⚡',
    desc: '특수 게이지 충전 +25%',
    apply: (s) => { s.specialChargeMult *= 1.25; },
    maxTier: 8,
  },
  {
    id: 'specialPower',
    name: '특수 위력',
    icon: '💢',
    desc: '특수 능력 피해 +30%',
    apply: (s) => { s.specialPowerMult *= 1.3; },
    maxTier: 8,
  },
  {
    id: 'specialEfficiency',
    name: '효율 강화',
    icon: '🔋',
    desc: '필요 게이지 -12',
    apply: (s) => { s.specialMeterReduction += 12; },
    maxTier: 6,
  },
  {
    id: 'bloodPact',
    name: '혈약',
    icon: '🩸',
    desc: '흡혈 +5%, 특수 흡혈 +15%',
    characterId: 'vampire',
    apply: (s) => { s.lifeSteal += 0.05; s.specialLifeStealBonus += 0.15; },
    maxTier: 6,
  },
  {
    id: 'hemoStrike',
    name: '근접 강화',
    icon: '⚔',
    desc: '근접 공격력 +25%',
    characterId: 'vampire',
    apply: (s) => { s.meleeDamageMult *= 1.25; },
    maxTier: 6,
  },
  {
    id: 'overclock',
    name: '과열 사격',
    icon: '🔥',
    desc: '탄막 특수 탄환 +8',
    characterId: 'gunner',
    apply: (s) => { s.specialExtraBullets += 8; },
    maxTier: 5,
  },
  {
    id: 'focusedBurst',
    name: '집중 사격',
    icon: '🎯',
    desc: '탄막 특수 위력 +20%',
    characterId: 'gunner',
    apply: (s) => { s.specialPowerMult *= 1.2; },
    maxTier: 6,
  },
  {
    id: 'crushingBlow',
    name: '강타',
    icon: '🔨',
    desc: '근접 공격력 +25%, 넉백 +15%',
    characterId: 'guardian',
    apply: (s) => { s.meleeDamageMult *= 1.25; s.knockbackMult *= 1.15; },
    maxTier: 6,
  },
  {
    id: 'ironWall',
    name: '철벽',
    icon: '🛡',
    desc: '피해 감소 +8%',
    characterId: 'guardian',
    apply: (s) => { s.damageReduction = Math.min(0.5, s.damageReduction + 0.08); },
    maxTier: 5,
  },
  {
    id: 'aftershock',
    name: '여진',
    icon: '💫',
    desc: '충격파 범위 +25%',
    characterId: 'guardian',
    apply: (s) => { s.specialRadiusMult *= 1.25; },
    maxTier: 5,
  },
];

const DEFAULT_CHARACTER_ID = 'gunner';

/** 접촉 피해 시 가시(반사) 피해 적용 */
export function applyThornsReflect(enemy, damageTaken, stats, angle, onKill) {
  const ratio = stats.thornsReflect || 0;
  if (ratio <= 0 || enemy.dead) return;
  const reflect = damageTaken * ratio;
  enemy.takeDamage(reflect, angle + Math.PI, 100 * (stats.knockbackMult || 1));
  if (enemy.dead) onKill?.(enemy);
}

/** @param {string} [id] */
export function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER_ID);
}

/** 캐릭터 기본 스탯을 stats·player에 적용 */
export function applyCharacterBase(stats, player, characterId) {
  const baseHp = CONFIG.PLAYER.maxHp + (stats.maxHpBonus || 0);
  player.maxHp = baseHp;
  player.hp = Math.min(player.hp ?? baseHp, player.maxHp);
  getCharacter(characterId).applyBase(stats, player);
}

/** 특수 게이지 최대치 */
export function getSpecialMeterMax(stats) {
  const spec = getCharacter(stats.characterId).special;
  return Math.max(35, spec.maxMeter - (stats.specialMeterReduction || 0));
}

/** 적 타격/처치 시 게이지 충전 */
export function chargeSpecialMeter(stats, player, reason) {
  const char = getCharacter(stats.characterId);
  const spec = char.special;
  const gain = reason === 'kill' ? spec.chargePerKill : spec.chargePerHit;
  const max = getSpecialMeterMax(stats);
  player.specialMeter = Math.min(max, (player.specialMeter || 0) + gain * (stats.specialChargeMult || 1));
}

/** 특수 사용 가능 여부 */
export function canUseSpecial(stats, player) {
  return (player.specialMeter || 0) >= getSpecialMeterMax(stats);
}

/** 근접 공격 베기/방패 강타 시각 이펙트 */
export function createMeleeVisual(actor, characterId, stats) {
  const opts = getMeleeAttackOpts(getCharacter(characterId), stats || {});
  if (characterId === 'vampire') {
    return new SlashEffect(actor.x, actor.y, actor.angle, {
      range: opts.range, arc: opts.arc, color: '#f44', innerColor: '#faa', width: 12,
    });
  }
  return new SlashEffect(actor.x, actor.y, actor.angle, {
    range: opts.range, arc: opts.arc, color: '#9c9', innerColor: '#dfd', width: 16,
  });
}

/** 캐릭터 기본값 + 증강 반영된 근접 공격 수치 */
export function getMeleeAttackOpts(char, stats) {
  const base = char.id === 'vampire'
    ? { range: 78, arc: 1.15, damageMult: 1, knockbackMult: 1 }
    : { range: 62, arc: 1.45, damageMult: 1.1, knockbackMult: 1.35 };
  return {
    ...base,
    range: base.range * (stats.meleeRangeMult || 1),
    arc: base.arc * (stats.meleeArcMult || 1),
  };
}

/** 네트워크 FX 이벤트 → 클라이언트 이펙트 생성 */
export function applyFxEvent(fx, effects, particles) {
  if (!fx) return;
  switch (fx.kind) {
    case 'slash':
      effects?.push(createMeleeVisual(fx, fx.characterId || 'guardian'));
      break;
    case 'bloodNova': {
      effects?.push(new RingEffect(fx.x, fx.y, fx.radius, '#c22', 0.55, 14));
      effects?.push(new RingEffect(fx.x, fx.y, fx.radius * 0.65, '#f88', 0.4, 8));
      effects?.push(new SlashEffect(fx.x, fx.y, 0, {
        range: fx.radius * 0.5, arc: Math.PI * 2, color: '#f44', innerColor: '#800',
        width: 6, life: 0.35, maxLife: 0.35,
      }));
      spawnParticles(particles, fx.x, fx.y, '#f44', 40);
      break;
    }
    case 'bulletStorm': {
      effects?.push(new SlashEffect(fx.x, fx.y, fx.angle, {
        range: 120, arc: fx.spread || 0.75, color: '#48f', innerColor: '#bdf',
        width: 8, life: 0.15, maxLife: 0.15,
      }));
      spawnParticles(particles, fx.x, fx.y, '#48f', 20);
      break;
    }
    case 'shockwave': {
      effects?.push(new RingEffect(fx.x, fx.y, fx.radius, '#9f9', 0.55, 14));
      effects?.push(new RingEffect(fx.x, fx.y, fx.radius * 0.55, '#dfd', 0.35, 6));
      spawnParticles(particles, fx.x, fx.y, '#8f8', 30);
      break;
    }
    default:
      break;
  }
}

/** 특수기 시각 이펙트 + 멀티 동기화용 FX 이벤트 */
export function spawnSpecialVisuals(player, stats, effects, particles) {
  const char = getCharacter(stats.characterId);
  const spec = char.special;
  const fxEvents = [];

  switch (spec.id) {
    case 'bloodNova': {
      const radius = spec.radius * (stats.specialRadiusMult || 1);
      applyFxEvent({ kind: 'bloodNova', x: player.x, y: player.y, radius }, effects, particles);
      fxEvents.push({ kind: 'bloodNova', x: player.x, y: player.y, radius });
      break;
    }
    case 'bulletStorm': {
      applyFxEvent({
        kind: 'bulletStorm', x: player.x, y: player.y, angle: player.angle, spread: spec.spread,
      }, effects, particles);
      fxEvents.push({
        kind: 'bulletStorm', x: player.x, y: player.y, angle: player.angle, spread: spec.spread,
      });
      break;
    }
    case 'shockwave': {
      const radius = spec.radius * (stats.specialRadiusMult || 1);
      applyFxEvent({ kind: 'shockwave', x: player.x, y: player.y, radius }, effects, particles);
      fxEvents.push({ kind: 'shockwave', x: player.x, y: player.y, radius });
      break;
    }
    default:
      break;
  }
  return fxEvents;
}

/**
 * 기본 공격 — 사수는 총알, 근접 캐릭터는 부채꼴 베기/강타
 * @returns {object[]} 멀티 동기화용 FX 이벤트
 */
export function performPlayerAttack(player, stats, ctx) {
  const { enemies, bullets, effects, particles, onEnemyHit } = ctx;
  const char = getCharacter(stats.characterId);
  const fxEvents = [];

  if (char.attackStyle === 'ranged') {
    const newBullets = fireBullets(player, stats);
    if (bullets) bullets.push(...newBullets);
    getPointBlankHits(player, stats, enemies).forEach(({ enemy, amount, angle, knockback, crit }) => {
      if (enemy.dead) return;
      let dmg = crit ? amount * (CONFIG.PLAYER.baseCritMult + stats.critMult) : amount;
      dmg *= stats.meleeDamageMult || 1;
      onEnemyHit?.(enemy, dmg, angle, knockback, crit);
    });
    return fxEvents;
  }

  const opts = getMeleeAttackOpts(char, stats);

  getSlashHits(player, stats, enemies, opts).forEach(({ enemy, amount, angle, knockback, crit }) => {
    if (enemy.dead) return;
    let dmg = crit ? amount * (CONFIG.PLAYER.baseCritMult + stats.critMult) : amount;
    onEnemyHit?.(enemy, dmg, angle, knockback, crit);
  });

  if (effects) effects.push(createMeleeVisual(player, char.id, stats));
  if (particles) {
    const px = player.x + Math.cos(player.angle) * 42;
    const py = player.y + Math.sin(player.angle) * 42;
    spawnParticles(particles, px, py, char.id === 'vampire' ? '#f55' : '#afa', 6);
  }
  fxEvents.push({
    kind: 'slash', x: player.x, y: player.y, angle: player.angle, characterId: char.id,
  });
  return fxEvents;
}

/**
 * 특수 능력 발동
 * @returns {boolean} 사용 성공 여부
 */
export function useSpecialAbility(player, stats, ctx) {
  if (!canUseSpecial(stats, player)) return false;

  const char = getCharacter(stats.characterId);
  const spec = char.special;
  const power = stats.specialPowerMult || 1;
  const { enemies, bullets, particles, effects, fxEvents, onEnemyKill, ownerId } = ctx;

  switch (spec.id) {
    case 'bloodNova': {
      const radius = spec.radius * (stats.specialRadiusMult || 1);
      const dmg = spec.damage * power * stats.damageMult;
      const stealRatio = (spec.lifeStealRatio + (stats.specialLifeStealBonus || 0));
      let healed = 0;
      enemies.forEach((e) => {
        if (e.dead) return;
        const dist = Math.hypot(e.x - player.x, e.y - player.y);
        if (dist > radius + e.radius) return;
        const angle = Math.atan2(e.y - player.y, e.x - player.x);
        const wasAlive = !e.dead;
        e.takeDamage(dmg, angle, 220 * stats.knockbackMult);
        if (!e.dead) healed += dmg * stealRatio;
        if (e.dead && wasAlive) onEnemyKill?.(e);
      });
      player.hp = Math.min(player.maxHp, player.hp + healed);
      break;
    }
    case 'bulletStorm': {
      const count = spec.bulletCount + (stats.specialExtraBullets || 0);
      const spread = spec.spread;
      const startAngle = player.angle - spread / 2;
      const stormStats = {
        ...stats,
        damageMult: stats.damageMult * spec.damageMult * power,
      };
      for (let i = 0; i < count; i++) {
        const angle = count <= 1 ? player.angle : startAngle + (spread * i) / (count - 1);
        const bx = player.x + Math.cos(angle) * (player.radius + 4);
        const by = player.y + Math.sin(angle) * (player.radius + 4);
        const b = new Bullet(bx, by, angle, stormStats);
        if (ownerId) b.ownerId = ownerId;
        bullets.push(b);
      }
      break;
    }
    case 'shockwave': {
      const radius = spec.radius * (stats.specialRadiusMult || 1);
      const dmg = spec.damage * power * stats.damageMult;
      const kb = spec.knockback * stats.knockbackMult;
      enemies.forEach((e) => {
        if (e.dead) return;
        const dist = Math.hypot(e.x - player.x, e.y - player.y);
        if (dist > radius + e.radius) return;
        const angle = Math.atan2(e.y - player.y, e.x - player.x);
        const wasAlive = !e.dead;
        e.takeDamage(dmg, angle, kb);
        if (e.dead && wasAlive) onEnemyKill?.(e);
      });
      player.specialShield = Math.max(player.specialShield || 0, 1.8);
      break;
    }
    default:
      return false;
  }

  const specialFx = spawnSpecialVisuals(player, stats, effects, particles);
  if (fxEvents && specialFx.length) fxEvents.push(...specialFx);

  player.specialMeter = 0;
  return true;
}

/** localStorage에서 마지막 선택 캐릭터 */
export function loadSelectedCharacter() {
  try {
    const id = localStorage.getItem('selectedCharacter');
    return getCharacter(id).id;
  } catch {
    return DEFAULT_CHARACTER_ID;
  }
}

export function saveSelectedCharacter(id) {
  try {
    localStorage.setItem('selectedCharacter', id);
  } catch { /* ignore */ }
}

/** 캐릭터 선택 카드 DOM 생성 */
export function renderCharacterCards(container, onPick, selectedId, options = {}) {
  container.innerHTML = '';
  CHARACTERS.forEach((c) => {
    const card = document.createElement('div');
    card.className = `choice-card character-card${selectedId === c.id ? ' selected' : ''}`;
    card.innerHTML = `
      <div class="icon">${c.icon}</div>
      <h3>${c.name}</h3>
      <p>${c.desc}</p>
      <p class="special-hint">특수: ${c.special.name} — ${c.special.desc}</p>
    `;
    card.addEventListener('click', () => {
      if (options.selectOnly) {
        onPick(c.id);
        renderCharacterCards(container, onPick, c.id, options);
      } else {
        onPick(c.id);
      }
    });
    container.appendChild(card);
  });
}
