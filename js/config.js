export const CONFIG = {
  BOSS_LEVEL: 10,
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
