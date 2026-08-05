export const CONFIG = {
  MAX_LEVEL: 100,
  BOSS_INTERVAL: 10,
  WORLD: {
    gridSize: 50,
  },
  PLAYER: {
    radius: 18,
    maxHp: 100,
    baseDamage: 12,
    baseFireRate: 3,
    baseBulletSpeed: 520,
    baseBulletCount: 1,
    baseSpread: 0.08,
    basePierce: 0,
    baseCritChance: 0.05,
    baseCritMult: 2,
    baseExpMult: 1,
    baseMoveSpeed: 220,
  },
  ENEMY: {
    baseHp: 30,
    baseSpeed: 80,
    baseDamage: 10,
    baseExp: 15,
    spawnInterval: 1.2,
    spawnIntervalMin: 0.35,
    maxOnScreen: 45,
    spawnMargin: 100,
  },
  ENEMY_TYPES: {
    melee: {
      id: 'melee',
      name: '돌진병',
      color: '#e44',
      stroke: '#a22',
      radius: 14,
      hpMult: 1,
      speedMult: 1,
      damageMult: 1,
      expMult: 1,
      knockbackResist: 0,
      weight: 40,
    },
    fast: {
      id: 'fast',
      name: '속공병',
      color: '#fc4',
      stroke: '#a80',
      radius: 11,
      hpMult: 0.55,
      speedMult: 1.65,
      damageMult: 0.7,
      expMult: 0.85,
      knockbackResist: 0.1,
      weight: 25,
    },
    tank: {
      id: 'tank',
      name: '중갑병',
      color: '#844',
      stroke: '#522',
      radius: 20,
      hpMult: 2.2,
      speedMult: 0.55,
      damageMult: 1.4,
      expMult: 1.5,
      knockbackResist: 0.65,
      weight: 15,
    },
    ranged: {
      id: 'ranged',
      name: '사수',
      color: '#a6f',
      stroke: '#628',
      radius: 13,
      hpMult: 0.75,
      speedMult: 0.85,
      damageMult: 0.9,
      expMult: 1.2,
      knockbackResist: 0.2,
      weight: 20,
      preferredRange: 300,
      minRange: 180,
      bulletSpeed: 280,
      fireRate: 0.9,
      bulletDamageMult: 0.85,
    },
  },
  BOSS: {
    hp: 12000,
    speed: 55,
    damage: 35,
    radius: 60,
    exp: 800,
    minionInterval: 2.2,
    knockbackResist: 0.88,
    bulletSpeed: 320,
    fireRate: 1.4,
    phase2HpRatio: 0.5,
  },
  BOSS_TYPES: [
    {
      id: 'charger',
      name: '돌진 군주',
      desc: '빠르게 돌진하며 탄막을 퍼붓습니다.',
      color: '#f84',
      stroke: '#a20',
      hpMult: 1,
      speedMult: 1.25,
      damageMult: 1,
      radiusMult: 0.95,
      pattern: 'charger',
      minionCount: 2,
    },
    {
      id: 'artillery',
      name: '포격 거인',
      desc: '느리지만 넓은 범위의 탄막을 쏩니다.',
      color: '#e62',
      stroke: '#820',
      hpMult: 1.35,
      speedMult: 0.65,
      damageMult: 1.15,
      radiusMult: 1.15,
      pattern: 'artillery',
      minionCount: 2,
    },
    {
      id: 'summoner',
      name: '소환 군단장',
      desc: '주변에 적을 계속 소환합니다.',
      color: '#a6f',
      stroke: '#628',
      hpMult: 1.1,
      speedMult: 0.85,
      damageMult: 0.95,
      radiusMult: 1,
      pattern: 'summoner',
      minionCount: 5,
    },
    {
      id: 'swift',
      name: '속공 재앙',
      desc: '매우 빠른 속도로 추격합니다.',
      color: '#fc4',
      stroke: '#a80',
      hpMult: 0.85,
      speedMult: 1.55,
      damageMult: 1.05,
      radiusMult: 0.85,
      pattern: 'swift',
      minionCount: 3,
    },
    {
      id: 'fortress',
      name: '중갑 요새',
      desc: '엄청난 체력과 방어력을 가진 거대 보스.',
      color: '#844',
      stroke: '#522',
      hpMult: 1.8,
      speedMult: 0.45,
      damageMult: 1.25,
      radiusMult: 1.25,
      pattern: 'fortress',
      minionCount: 2,
    },
    {
      id: 'commander',
      name: '사격 사령관',
      desc: '거리를 유지하며 연속 사격합니다.',
      color: '#6af',
      stroke: '#248',
      hpMult: 1.15,
      speedMult: 0.75,
      damageMult: 1.1,
      radiusMult: 1,
      pattern: 'commander',
      minionCount: 3,
    },
    {
      id: 'spiral',
      name: '회오리 군주',
      desc: '회전하는 나선형 탄막을 발사합니다.',
      color: '#4fd',
      stroke: '#286',
      hpMult: 1.2,
      speedMult: 0.9,
      damageMult: 1.05,
      radiusMult: 1.05,
      pattern: 'spiral',
      minionCount: 3,
    },
    {
      id: 'splitter',
      name: '분열체',
      desc: '2페이즈에서 전방위 탄막을 쏩니다.',
      color: '#f4a',
      stroke: '#a48',
      hpMult: 1.25,
      speedMult: 1,
      damageMult: 1.15,
      radiusMult: 1,
      pattern: 'splitter',
      minionCount: 4,
    },
    {
      id: 'dark',
      name: '암흑 군주',
      desc: '조밀한 탄막과 강력한 일격을 사용합니다.',
      color: '#639',
      stroke: '#315',
      hpMult: 1.4,
      speedMult: 0.95,
      damageMult: 1.3,
      radiusMult: 1.1,
      pattern: 'dark',
      minionCount: 4,
    },
    {
      id: 'final',
      name: '최종 수호자',
      desc: '모든 패턴을 사용하는 최종 보스.',
      color: '#fff',
      stroke: '#f44',
      hpMult: 2.2,
      speedMult: 1.1,
      damageMult: 1.45,
      radiusMult: 1.35,
      pattern: 'final',
      minionCount: 5,
    },
  ],
  EXP: {
    baseToLevel: 80,
    levelScale: 1.35,
  },
  PARTICLES: {
    max: 250,
  },
};

export function expForLevel(level) {
  return Math.floor(CONFIG.EXP.baseToLevel * Math.pow(CONFIG.EXP.levelScale, level - 1));
}

export function isBossLevel(level) {
  return level > 0 && level % CONFIG.BOSS_INTERVAL === 0 && level <= CONFIG.MAX_LEVEL;
}

export function getBossTier(level) {
  return Math.floor(level / CONFIG.BOSS_INTERVAL);
}

export function getBossType(level) {
  const tier = getBossTier(level);
  return CONFIG.BOSS_TYPES[Math.min(tier - 1, CONFIG.BOSS_TYPES.length - 1)];
}

export function getLevelMults(level) {
  const l = Math.max(1, level);
  return {
    hp: 1 + (l - 1) * 0.12,
    speed: 1 + (l - 1) * 0.04,
    damage: 1 + (l - 1) * 0.08,
    attackSpeed: 1 + (l - 1) * 0.05,
  };
}

export const STATES = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  LEVEL_UP: 'levelUp',
  BOSS_WARNING: 'bossWarning',
  BOSS: 'boss',
  VICTORY: 'victory',
  GAME_OVER: 'gameOver',
};

export const SAVE_KEY = 'centerDefenseSave';

export function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || { bestLevel: 1, clearCount: 0 };
  } catch {
    return { bestLevel: 1, clearCount: 0 };
  }
}

export function writeSave(data) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}
