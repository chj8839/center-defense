export const AUGMENTS = [
  {
    id: 'damage',
    name: '공격력',
    icon: '⚔',
    desc: '탄환 데미지 +20%',
    apply: (s) => { s.damageMult *= 1.2; },
    maxTier: 16,
  },
  {
    id: 'fireRate',
    name: '공격속도',
    icon: '🔥',
    desc: '발사 속도 +15%',
    apply: (s) => { s.fireRateMult *= 1.15; },
    maxTier: 16,
  },
  {
    id: 'bulletSpeed',
    name: '탄환 속도',
    icon: '💨',
    desc: '탄환 속도 +25%',
    apply: (s) => { s.bulletSpeedMult *= 1.25; },
    maxTier: 12,
  },
  {
    id: 'multishot',
    name: '멀티샷',
    icon: '🎯',
    desc: '추가 탄환 +1',
    apply: (s) => { s.bulletCount += 1; },
    maxTier: 10,
  },
  {
    id: 'pierce',
    name: '관통',
    icon: '➡',
    desc: '탄환 관통 +1 (모든 탄환 동일 적용)',
    apply: (s) => { s.pierce += 1; },
    maxTier: 10,
  },
  {
    id: 'crit',
    name: '치명타',
    icon: '💥',
    desc: '치명타 확률 +8%, 배율 +0.3',
    apply: (s) => { s.critChance += 0.08; s.critMult += 0.3; },
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
    desc: 'EXP 획득량 +20%',
    apply: (s) => { s.expMult *= 1.2; },
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
    apply: (s) => {
      s.bulletCount += 2;
      s.damageMult *= 0.9;
    },
    maxTier: 8,
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

export function createStats() {
  return {
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
    picked: {},
  };
}

export function getRandomChoices(stats, count = 3) {
  const available = AUGMENTS.filter((a) => {
    const tier = stats.picked[a.id] || 0;
    return tier < a.maxTier;
  });

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((a) => ({
    ...a,
    tier: (stats.picked[a.id] || 0) + 1,
  }));
}

export function applyAugment(augment, stats, player) {
  augment.apply(stats, player);
  stats.picked[augment.id] = (stats.picked[augment.id] || 0) + 1;
}

export function getAugmentTags(stats) {
  return Object.entries(stats.picked).map(([id, tier]) => {
    const aug = AUGMENTS.find((a) => a.id === id);
    return aug ? `${aug.name} Lv${tier}` : id;
  });
}
