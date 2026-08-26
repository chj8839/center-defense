/**
 * 캐릭터 클래스 · 특수 능력(게이지) · 전용 증강 정의
 */
import { CONFIG } from './config.js';
import { spawnParticles, Bullet } from './entities.js';

/** 플레이어블 캐릭터 목록 */
export const CHARACTERS = [
  {
    id: 'vampire',
    name: '흡혈귀',
    icon: '🩸',
    desc: '근접 흡혈형. 적을 타격해 HP를 회복합니다.',
    color: '#e44',
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

/**
 * 특수 능력 발동
 * @returns {boolean} 사용 성공 여부
 */
export function useSpecialAbility(player, stats, ctx) {
  if (!canUseSpecial(stats, player)) return false;

  const char = getCharacter(stats.characterId);
  const spec = char.special;
  const power = stats.specialPowerMult || 1;
  const { enemies, bullets, particles, onEnemyKill, ownerId } = ctx;

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
      spawnParticles(particles, player.x, player.y, '#f44', 20);
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
      spawnParticles(particles, player.x, player.y, '#48f', 14);
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
      spawnParticles(particles, player.x, player.y, '#8f8', 18);
      break;
    }
    default:
      return false;
  }

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
