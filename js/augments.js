/**
 * 증강(업그레이드) 정의 및 스탯 적용
 * - 레벨업 시 3택1로 선택
 * - 동일 증강 중복 선택 가능 (maxTier까지)
 */

import { getCharacter, SPECIAL_AUGMENTS } from './characters.js';
/** 증강 목록 (id, 이름, 효과, 최대 티어) */
export const AUGMENTS = [
  {
    id: 'damage',
    name: '공격력',
    icon: '⚔',
    desc: '공격력 +30%',
    apply: (s) => { s.damageMult *= 1.3; },
    maxTier: 16,
  },
  {
    id: 'fireRate',
    name: '공격속도',
    icon: '🔥',
    desc: '공격 속도 +50%',
    apply: (s) => { s.fireRateMult *= 1.5; },
    maxTier: 16,
  },
  {
    id: 'bulletSpeed',
    name: '탄환 속도',
    icon: '💨',
    desc: '탄환 속도 +25%',
    attackStyle: 'ranged',
    apply: (s) => { s.bulletSpeedMult *= 1.25; },
    maxTier: 12,
  },
  {
    id: 'multishot',
    name: '멀티샷',
    icon: '🎯',
    desc: '추가 탄환 +1',
    attackStyle: 'ranged',
    apply: (s) => { s.bulletCount += 1; },
    maxTier: 10,
  },
  {
    id: 'pierce',
    name: '관통',
    icon: '➡',
    desc: '탄환 관통 +1 (모든 탄환 동일 적용)',
    attackStyle: 'ranged',
    apply: (s) => { s.pierce += 1; },
    maxTier: 10,
  },
  {
    id: 'crit',
    name: '치명타',
    icon: '💥',
    desc: '치명타 확률 +10%, 배율 +0.3',
    apply: (s) => { s.critChance += 0.1; s.critMult += 0.3; },
    maxTier: 12,
  },
  {
    id: 'maxHp',
    name: '최대 HP',
    icon: '❤',
    desc: '최대 HP +25, 현재 HP 회복',
    apply: (s, player) => {
      s.maxHpBonus += 25;
      player.maxHp += 25;
      player.hp = Math.min(player.hp + 25, player.maxHp);
    },
    maxTier: 16,
  },
  {
    id: 'regen',
    name: '재생',
    icon: '💚',
    desc: '초당 HP 회복 +2',
    apply: (s) => { s.regen += 2; },
    maxTier: 12,
  },
  {
    id: 'expGain',
    name: 'EXP 획득',
    icon: '✨',
    desc: 'EXP 획득량 +40%',
    apply: (s) => { s.expMult *= 1.4; },
    maxTier: 12,
  },
  {
    id: 'moveSpeed',
    name: '이동속도',
    icon: '👟',
    desc: '이동 속도 +30%',
    apply: (s) => { s.moveSpeedMult *= 1.3; },
    maxTier: 12,
  },
  {
    id: 'knockback',
    name: '넉백',
    icon: '💫',
    desc: '적 넉백 강도 +40%',
    apply: (s) => { s.knockbackMult *= 1.4; },
    maxTier: 10,
  },
  {
    id: 'spread',
    name: '산탄',
    icon: '🌟',
    desc: '탄환 분산 +2 (데미지 -10%)',
    attackStyle: 'ranged',
    apply: (s) => {
      s.bulletCount += 2;
      s.damageMult *= 0.9;
    },
    maxTier: 8,
  },
  {
    id: 'meleeReach',
    name: '길이 연장',
    icon: '📏',
    desc: '근접 사거리 +18%',
    attackStyle: 'melee',
    apply: (s) => { s.meleeRangeMult *= 1.18; },
    maxTier: 10,
  },
  {
    id: 'wideSlash',
    name: '넓은 베기',
    icon: '🌙',
    desc: '공격 각도 +25% (데미지 -10%)',
    attackStyle: 'melee',
    apply: (s) => { s.meleeArcMult *= 1.25; s.damageMult *= 0.9; },
    maxTier: 8,
  },
  {
    id: 'cleave',
    name: '연속 베기',
    icon: '⚔',
    desc: '근접 공격력 +22%',
    attackStyle: 'melee',
    apply: (s) => { s.meleeDamageMult *= 1.22; },
    maxTier: 10,
  },
  {
    id: 'deepCut',
    name: '깊은 일격',
    icon: '➡',
    desc: '사거리 +15%, 넉백 +20%',
    attackStyle: 'melee',
    apply: (s) => { s.meleeRangeMult *= 1.15; s.knockbackMult *= 1.2; },
    maxTier: 10,
  },
  {
    id: 'orbit',
    name: '오비탈',
    icon: '🔮',
    desc: '회전 보호구 +1',
    apply: (s) => { s.orbitCount += 1; },
    maxTier: 10,
  },
];

/** 플레이어 초기 스탯 객체 생성 */
export function createStats(characterId = 'gunner') {
  return {
    characterId: getCharacter(characterId).id,
    damageMult: 1,
    fireRateMult: 1,
    bulletSpeedMult: 1,
    bulletCount: 0,
    pierce: 0,
    critChance: 0,
    critMult: 0,
    maxHpBonus: 0,
    regen: 0,
    expMult: 1,
    moveRadius: 0,
    moveSpeedMult: 1,
    knockbackMult: 1,
    orbitCount: 0,
    specialChargeMult: 1,
    specialPowerMult: 1,
    specialMeterReduction: 0,
    specialExtraBullets: 0,
    specialRadiusMult: 1,
    specialLifeStealBonus: 0,
    meleeDamageMult: 1,
    meleeRangeMult: 1,
    meleeArcMult: 1,
    lifeSteal: 0,
    damageReduction: 0,
    picked: {},
  };
}

/** id로 증강 정의 조회 (일반 + 캐릭터 전용) */
export function getAugmentById(id) {
  return AUGMENTS.find((a) => a.id === id) || SPECIAL_AUGMENTS.find((a) => a.id === id);
}

/**
 * 레벨업 시 랜덤 증강 후보 count개 반환
 * @param {object} stats - 플레이어 스탯
 * @param {number} count - 후보 개수 (기본 3)
 */
export function getRandomChoices(stats, count = 3) {
  const attackStyle = getCharacter(stats.characterId).attackStyle;
  const pool = [...AUGMENTS, ...SPECIAL_AUGMENTS];
  const available = pool.filter((a) => {
    const tier = stats.picked[a.id] || 0;
    if (tier >= a.maxTier) return false;
    if (a.characterId && a.characterId !== stats.characterId) return false;
    if (a.attackStyle && a.attackStyle !== attackStyle) return false;
    return true;
  });

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((a) => ({
    ...a,
    tier: (stats.picked[a.id] || 0) + 1,
  }));
}

/** 증강 적용 및 picked 티어 갱신 */
export function applyAugment(augment, stats, player) {
  augment.apply(stats, player);
  stats.picked[augment.id] = (stats.picked[augment.id] || 0) + 1;
}

/** HUD에 표시할 증강 태그 문자열 배열 */
export function getAugmentTags(stats) {
  return Object.entries(stats.picked).map(([id, tier]) => {
    const aug = getAugmentById(id);
    return aug ? `${aug.name} Lv${tier}` : id;
  });
}
