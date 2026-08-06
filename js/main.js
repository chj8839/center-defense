/**
 * main.js — 솔로 플레이 진입점
 *
 * 게임 루프 개요:
 * 1. 로비(LOBBY)에서 시작 버튼 클릭 → initGame()으로 월드 초기화
 * 2. requestAnimationFrame(loop)이 매 프레임 updatePlaying(dt) + draw() 실행
 * 3. PLAYING: 적 스폰, 플레이어 이동·사격, 충돌·경험치·레벨업 처리
 * 4. LEVEL_UP: 증강 선택 후 PLAYING 또는 보스 트리거
 * 5. BOSS_WARNING → BOSS: 보스 등장 및 전투, 처치 시 다음 구간 또는 VICTORY
 * 6. MAX_LEVEL 클리어 → VICTORY / HP 0 → GAME_OVER → 저장 후 로비 복귀 가능
 */
import { CONFIG, STATES, expForLevel, loadSave, writeSave, isBossLevel, getBossType } from './config.js';
import { createStats, getRandomChoices, applyAugment, getAugmentTags } from './augments.js';
import { touchControls } from './touchControls.js';
import {
  Player, spawnEnemy, spawnBoss, fireBullets,
  spawnParticles, OrbitShield,
  separateEnemiesFromPlayer, getPointBlankHits, getMeleeHits,
  drawWorldBackground, worldToScreen, screenToWorld,
} from './entities.js';

/** @type {HTMLCanvasElement} 게임 월드를 그리는 캔버스 */
const canvas = document.getElementById('gameCanvas');
/** @type {CanvasRenderingContext2D} 2D 렌더링 컨텍스트 */
const ctx = canvas.getContext('2d');

/** @type {HTMLElement} 로비(메인 메뉴) 오버레이 */
const lobby = document.getElementById('lobby');
/** @type {HTMLElement} HP·EXP·레벨·킬 수 HUD 패널 */
const hud = document.getElementById('hud');
/** @type {HTMLElement} 레벨업 시 증강 선택 오버레이 */
const levelUpOverlay = document.getElementById('levelUp');
/** @type {HTMLElement} 보스 등장 전 경고 오버레이 */
const bossWarning = document.getElementById('bossWarning');
/** @type {HTMLElement} 최종 클리어(승리) 오버레이 */
const victory = document.getElementById('victory');
/** @type {HTMLElement} 사망(게임 오버) 오버레이 */
const gameOver = document.getElementById('gameOver');
/** @type {HTMLElement} 증강 선택 카드가 들어가는 컨테이너 */
const augmentChoices = document.getElementById('augmentChoices');
/** @type {HTMLElement} HUD에 표시되는 보유 증강 태그 목록 */
const augmentList = document.getElementById('augmentList');
/** @type {HTMLElement} HP 바(너비로 비율 표시) */
const hpBar = document.getElementById('hpBar');
/** @type {HTMLElement} EXP 바(다음 레벨까지 진행률) */
const expBar = document.getElementById('expBar');
/** @type {HTMLElement} 현재 레벨 텍스트 */
const levelText = document.getElementById('levelText');
/** @type {HTMLElement} 누적 킬 수 텍스트 */
const killText = document.getElementById('killText');
/** @type {HTMLElement} 저장된 최고 레벨 표시(로비) */
const bestLevelEl = document.getElementById('bestLevel');
/** @type {HTMLElement} 클리어 횟수 표시(로비) */
const clearCountEl = document.getElementById('clearCount');
/** @type {HTMLElement} 보스 주기·최종 레벨 안내 문구 */
const bossLevelHint = document.getElementById('bossLevelHint');
/** @type {HTMLElement} 보스 경고창의 보스 이름 */
const bossWarningName = document.getElementById('bossWarningName');
/** @type {HTMLElement} 보스 경고창의 보스 설명 */
const bossWarningDesc = document.getElementById('bossWarningDesc');

bossLevelHint.textContent = `${CONFIG.BOSS_INTERVAL}레벨마다 보스 · Lv.${CONFIG.MAX_LEVEL} 클리어!`;

/** @type {{ x: number, y: number }} 화면 좌표 기준 마우스(또는 터치 조준) 위치 */
const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
/** @type {{ x: number, y: number }} 월드 좌표로 변환된 조준점 */
const worldMouse = { x: 0, y: 0 };
/** @type {Set<string>} 현재 눌린 키 코드 집합(WASD 등) */
const keys = new Set();
/** @type {{ x: number, y: number }} 카메라 중심(플레이어 추적) 월드 좌표 */
const camera = { x: 0, y: 0 };

/** @type {string} 현재 게임 상태(STATES: LOBBY, PLAYING, BOSS 등) */
let state = STATES.LOBBY;
/** @type {number} 캔버스 너비, 높이, 화면 중심 cx/cy */
let w, h, cx, cy;
/** @type {Player|null} 플레이어 인스턴스 */
let player;
/** @type {object|null} 증강·스탯 집계(createStats) */
let stats;
/** @type {Array} 적 엔티티 목록(보스 포함) */
let enemies;
/** @type {Array} 플레이어가 발사한 탄환 */
let bullets;
/** @type {Array} 적이 발사한 탄환 */
let enemyBullets;
/** @type {Array} 이펙트 파티클 */
let particles;
/** @type {Array} 궤도 실드(OrbitShield) 인스턴스 */
let orbits;
/** @type {number} 현재 레벨 */
let level;
/** @type {number} 현재 누적 경험치 */
let exp;
/** @type {number} 이번 런 킬 수 */
let kills;
/** @type {number} 다음 일반 적 스폰까지 남은 시간(초) */
let spawnTimer;
/** @type {object|null} 현재 보스 참조(없으면 null) */
let bossRef;
/** @type {number} 다음 보스가 등장할 최소 레벨 */
let nextBossLevel;
/** @type {{ bestLevel: number, clearCount: number }} localStorage 저장 데이터 */
let saveData = loadSave();
/** @type {number} BOSS_WARNING 상태 남은 표시 시간(초) */
let bossWarningTimer = 0;
/** @type {Array<{ x, y, text, color, life, vy }>} 월드 위 떠오르는 데미지·EXP 텍스트 */
let floatingTexts = [];

/**
 * 창 크기에 맞춰 캔버스·뷰포트 중심을 갱신한다.
 */
function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  cx = w / 2;
  cy = h / 2;
  updateWorldMouse();
}

/**
 * 화면 마우스 좌표를 월드 좌표로 변환해 worldMouse에 반영한다.
 */
function updateWorldMouse() {
  const wm = screenToWorld(mouse.x, mouse.y, camera, cx, cy);
  worldMouse.x = wm.x;
  worldMouse.y = wm.y;
}

/**
 * 요소에서 hidden 클래스를 제거해 표시한다.
 * @param {HTMLElement} el
 */
function show(el) { el.classList.remove('hidden'); }

/**
 * 요소에 hidden 클래스를 추가해 숨긴다.
 * @param {HTMLElement} el
 */
function hide(el) { el.classList.add('hidden'); }

/**
 * 게임 상태를 전환하고 해당 UI 오버레이만 보이게 한다.
 * @param {string} newState STATES 상수
 */
function setState(newState) {
  state = newState;
  hide(lobby);
  hide(hud);
  hide(levelUpOverlay);
  hide(bossWarning);
  hide(victory);
  hide(gameOver);

  const touchActive = newState === STATES.PLAYING || newState === STATES.BOSS;
  touchControls.setActive(touchActive);

  switch (newState) {
    case STATES.LOBBY: show(lobby); refreshLobby(); break;
    case STATES.PLAYING:
    case STATES.BOSS: show(hud); break;
    case STATES.LEVEL_UP: show(hud); show(levelUpOverlay); break;
    case STATES.BOSS_WARNING: show(hud); show(bossWarning); break;
    case STATES.VICTORY: show(victory); break;
    case STATES.GAME_OVER:
      show(gameOver);
      document.getElementById('finalLevel').textContent = level;
      document.getElementById('finalKills').textContent = kills;
      break;
  }
}

/**
 * 로비 UI를 저장 데이터 기준으로 새로고침한다.
 */
function refreshLobby() {
  saveData = loadSave();
  bestLevelEl.textContent = saveData.bestLevel;
  clearCountEl.textContent = saveData.clearCount;
}

/**
 * 새 게임 런을 위한 레벨·플레이어·배열·타이머를 초기화한다.
 */
function initGame() {
  level = 1;
  exp = 0;
  kills = 0;
  stats = createStats();
  player = new Player(0, 0);
  camera.x = 0;
  camera.y = 0;
  enemies = [];
  bullets = [];
  enemyBullets = [];
  particles = [];
  orbits = [];
  spawnTimer = 0;
  bossRef = null;
  nextBossLevel = CONFIG.BOSS_INTERVAL;
  floatingTexts = [];
  updateHud();
  updateAugmentList();
}

/**
 * stats.orbitCount에 맞춰 궤도 실드 배열을 다시 만든다.
 */
function rebuildOrbits() {
  orbits = [];
  for (let i = 0; i < stats.orbitCount; i++) {
    orbits.push(new OrbitShield(player, i, stats.orbitCount));
  }
}

/**
 * 리사이즈 후 초기화하고 PLAYING 상태로 게임을 시작한다.
 */
function startGame() {
  resize();
  initGame();
  setState(STATES.PLAYING);
}

/**
 * 경험치를 추가하고 필요 시 연속 레벨업을 처리한다.
 * @param {number} amount 기본 EXP량(적별)
 */
function addExp(amount) {
  exp += Math.floor(amount * stats.expMult * CONFIG.PLAYER.baseExpMult);
  while (exp >= expForLevel(level)) {
    exp -= expForLevel(level);
    levelUp();
  }
  updateHud();
}

/**
 * 레벨을 1 올리고 증강 선택 UI를 연다(MAX_LEVEL 초과 시 무시).
 */
function levelUp() {
  if (level >= CONFIG.MAX_LEVEL) return;
  level++;
  showLevelUpChoices();
}

/**
 * 랜덤 증강 3개 카드를 만들고 LEVEL_UP 상태로 전환한다.
 */
function showLevelUpChoices() {
  const choices = getRandomChoices(stats, 3);
  augmentChoices.innerHTML = '';
  choices.forEach((aug) => {
    const card = document.createElement('div');
    card.className = 'choice-card';
    card.innerHTML = `
      <div class="icon">${aug.icon}</div>
      <h3>${aug.name}</h3>
      <p>${aug.desc}</p>
      <span class="tier">Lv ${aug.tier}</span>
    `;
    card.addEventListener('click', () => pickAugment(aug));
    augmentChoices.appendChild(card);
  });
  setState(STATES.LEVEL_UP);
}

/**
 * 선택한 증강을 적용하고 보스 조건이면 보스를, 아니면 전투 상태로 복귀한다.
 * @param {object} aug 증강 정의
 */
function pickAugment(aug) {
  applyAugment(aug, stats, player);
  if (aug.id === 'orbit') rebuildOrbits();
  updateAugmentList();
  updateHud();

  if (shouldTriggerBoss()) {
    triggerBoss();
  } else {
    setState(bossRef ? STATES.BOSS : STATES.PLAYING);
  }
}

/**
 * 현재 레벨에서 보스 경고·스폰을 시작해야 하는지 판별한다.
 * @returns {boolean}
 */
function shouldTriggerBoss() {
  return isBossLevel(level) && level >= nextBossLevel && !bossRef;
}

/**
 * 보스 경고 UI를 띄우고 BOSS_WARNING 타이머를 시작한다.
 */
function triggerBoss() {
  const bossType = getBossType(level);
  if (bossWarningName) bossWarningName.textContent = bossType.name;
  if (bossWarningDesc) bossWarningDesc.textContent = bossType.desc;
  setState(STATES.BOSS_WARNING);
  bossWarningTimer = 2.5;
  enemies = enemies.filter((e) => !e.dead);
}

/**
 * 보스 엔티티를 스폰해 enemies에 넣고 BOSS 상태로 전환한다.
 */
function spawnBossEntity() {
  bossRef = spawnBoss(player, level);
  enemies.push(bossRef);
  setState(STATES.BOSS);
}

/**
 * 최종 클리어 시 클리어 횟수·최고 레벨을 저장하고 VICTORY UI를 연다.
 */
function onVictory() {
  saveData.clearCount = (saveData.clearCount || 0) + 1;
  saveData.bestLevel = Math.max(saveData.bestLevel || 1, level);
  writeSave(saveData);
  setState(STATES.VICTORY);
}

/**
 * 사망 시 최고 레벨을 갱신·저장하고 GAME_OVER UI를 연다.
 */
function onGameOver() {
  saveData.bestLevel = Math.max(saveData.bestLevel || 1, level);
  writeSave(saveData);
  setState(STATES.GAME_OVER);
}

/**
 * HP·EXP 바와 레벨·킬 텍스트를 현재 값으로 갱신한다.
 */
function updateHud() {
  if (!player) return;
  hpBar.style.width = `${(player.hp / player.maxHp) * 100}%`;
  expBar.style.width = `${(exp / expForLevel(level)) * 100}%`;
  levelText.textContent = level;
  killText.textContent = kills;
}

/**
 * HUD 증강 태그 목록을 stats 기준으로 다시 그린다.
 */
function updateAugmentList() {
  augmentList.innerHTML = getAugmentTags(stats)
    .map((t) => `<span class="augment-tag">${t}</span>`)
    .join('');
}

/**
 * 현재 레벨에 따른 일반 적 스폰 간격(초)을 계산한다.
 * @returns {number}
 */
function getSpawnInterval() {
  const reduction = Math.min(level * 0.06, CONFIG.ENEMY.spawnInterval - CONFIG.ENEMY.spawnIntervalMin);
  return Math.max(CONFIG.ENEMY.spawnIntervalMin, CONFIG.ENEMY.spawnInterval - reduction);
}

/**
 * 월드 좌표에 잠시 떠오르는 텍스트(크리티컬·EXP 등)를 추가한다.
 * @param {number} wx
 * @param {number} wy
 * @param {string} text
 * @param {string} [color='#ff8']
 */
function addFloatingText(wx, wy, text, color = '#ff8') {
  floatingTexts.push({ x: wx, y: wy, text, color, life: 0.8, vy: -40 });
}

/**
 * 적에게 데미지·넉백을 적용하고 사망 시 onEnemyKill을 호출한다.
 * @param {object} enemy
 * @param {number} amount
 * @param {number} angle
 * @param {number} knockback
 * @param {boolean} [crit=false]
 */
function applyEnemyHit(enemy, amount, angle, knockback, crit = false) {
  enemy.takeDamage(amount, angle, knockback);
  if (crit) addFloatingText(enemy.x, enemy.y - 20, 'CRIT!', '#f44');
  spawnParticles(particles, enemy.x, enemy.y, '#ff8', 3);
  if (enemy.dead) onEnemyKill(enemy);
}

/**
 * 탄환과 적 충돌 시 데미지를 적용하고 관통·히트 등록을 처리한다.
 * @param {object} bullet
 * @param {object} enemy
 * @returns {boolean} 히트 성공 여부
 */
function applyBulletHit(bullet, enemy) {
  if (!bullet.canHit(enemy)) return false;
  const { amount, crit } = bullet.getDamage();
  applyEnemyHit(enemy, amount, bullet.angle, bullet.knockback, crit);
  bullet.registerHit(enemy);
  return true;
}

/**
 * 카메라를 플레이어 위치에 맞추고 월드 마우스 좌표를 갱신한다.
 */
function updateCamera() {
  camera.x = player.x;
  camera.y = player.y;
  updateWorldMouse();
}

/**
 * 키보드 keys와 터치 가상 WASD를 합친 유효 입력 집합을 반환한다.
 * @returns {Set<string>}
 */
function getEffectiveKeys() {
  const k = new Set(keys);
  const t = touchControls.getKeys();
  if (t.up) k.add('w');
  if (t.down) k.add('s');
  if (t.left) k.add('a');
  if (t.right) k.add('d');
  return k;
}

/**
 * PLAYING/BOSS 프레임: 이동·사격·스폰·충돌·파티클·HUD를 한 틱 갱신한다.
 * @param {number} dt 델타 시간(초, 상한 0.05)
 */
function updatePlaying(dt) {
  const aim = touchControls.getAimScreenPos(mouse.x, mouse.y);
  worldMouse.x = aim.x - cx + camera.x;
  worldMouse.y = aim.y - cy + camera.y;

  player.update(dt, worldMouse, stats, getEffectiveKeys());
  updateCamera();
  player.contactCooldown = Math.max(0, (player.contactCooldown || 0) - dt);

  if (player.canFire(dt, stats)) {
    bullets.push(...fireBullets(player, stats));
    getPointBlankHits(player, stats, enemies).forEach(({ enemy, amount, angle, knockback, crit }) => {
      if (enemy.dead) return;
      const dmg = crit ? amount * (CONFIG.PLAYER.baseCritMult + stats.critMult) : amount;
      applyEnemyHit(enemy, dmg, angle, knockback, crit);
    });
  }

  getMeleeHits(player, stats, enemies, dt).forEach(({ enemy, amount, angle, knockback }) => {
    if (enemy.dead) return;
    applyEnemyHit(enemy, amount, angle, knockback);
  });

  orbits.forEach((o) => o.update(dt));

  if (state === STATES.PLAYING) {
    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < CONFIG.ENEMY.maxOnScreen) {
      enemies.push(spawnEnemy(player, w, h, level));
      spawnTimer = getSpawnInterval();
    }
  }

  if (bossRef && !bossRef.dead) {
    bossRef.minionTimer -= dt;
    if (bossRef.minionTimer <= 0) {
      const count = bossRef.minionCount || 3;
      for (let i = 0; i < count; i++) enemies.push(spawnEnemy(player, w, h, level));
      bossRef.minionTimer = bossRef.minionInterval;
    }
  }

  bullets.forEach((b) => b.update(dt));
  const cullDist = Math.max(w, h) + 200;
  bullets = bullets.filter((b) => {
    if (b.dead) return false;
    return Math.hypot(b.x - player.x, b.y - player.y) < cullDist;
  });

  enemies.forEach((e) => {
    if (!e.dead) {
      if (e.typeKey === 'boss') {
        e.update(dt, player.x, player.y, enemyBullets);
      } else {
        e.update(dt, player.x, player.y, enemyBullets);
      }
    }
  });
  separateEnemiesFromPlayer(player, enemies);

  bullets.forEach((b) => {
    if (b.dead) return;
    enemies.forEach((e) => {
      if (e.dead || b.dead) return;
      const dist = Math.hypot(b.x - e.x, b.y - e.y);
      if (dist < b.radius + e.radius) applyBulletHit(b, e);
    });
  });

  enemyBullets.forEach((b) => b.update(dt));
  enemyBullets = enemyBullets.filter((b) => {
    if (b.dead) return false;
    if (Math.hypot(b.x - player.x, b.y - player.y) > cullDist) return false;
    const dist = Math.hypot(b.x - player.x, b.y - player.y);
    if (dist < b.radius + player.radius) {
      if (player.takeDamage(b.damage)) {
        spawnParticles(particles, player.x, player.y, '#f44', 6);
        if (player.hp <= 0) onGameOver();
      }
      return false;
    }
    return true;
  });

  orbits.forEach((o) => {
    const pos = o.getPosition();
    enemies.forEach((e) => {
      if (e.dead) return;
      const dist = Math.hypot(pos.x - e.x, pos.y - e.y);
      if (dist < o.orbitRadius + e.radius) {
        const angle = Math.atan2(e.y - pos.y, e.x - pos.x);
        e.takeDamage(o.damage * stats.damageMult, angle, 80 * stats.knockbackMult);
        if (e.dead) onEnemyKill(e);
      }
    });
  });

  enemies.forEach((e) => {
    if (e.dead || e.typeKey === 'ranged') return;
    const dist = Math.hypot(e.x - player.x, e.y - player.y);
    if (dist < e.radius + player.radius) {
      const angle = Math.atan2(e.y - player.y, e.x - player.x);
      e.knockbackX += Math.cos(angle) * 280 * stats.knockbackMult * (1 - e.knockbackResist);
      e.knockbackY += Math.sin(angle) * 280 * stats.knockbackMult * (1 - e.knockbackResist);

      if (player.contactCooldown <= 0) {
        if (player.takeDamage(e.damage)) {
          player.contactCooldown = 0.4;
          spawnParticles(particles, player.x, player.y, '#f44', 6);
          if (player.hp <= 0) onGameOver();
        }
      }
    }
  });

  enemies = enemies.filter((e) => !e.dead);

  particles.forEach((p) => p.update(dt));
  particles = particles.filter((p) => p.life > 0);

  floatingTexts.forEach((t) => {
    t.life -= dt;
    t.y += t.vy * dt;
  });
  floatingTexts = floatingTexts.filter((t) => t.life > 0);

  updateHud();
}

/**
 * 적(또는 보스) 처치: 킬·EXP·이펙트·보스 클리어 시 승리/일반 전투 복귀.
 * @param {object} enemy
 */
function onEnemyKill(enemy) {
  kills++;
  addExp(enemy.exp);
  spawnParticles(particles, enemy.x, enemy.y, enemy === bossRef ? '#f84' : enemy.color, 12);
  addFloatingText(enemy.x, enemy.y, `+${Math.floor(enemy.exp * stats.expMult)} EXP`, '#8cf');

  if (bossRef && enemy === bossRef) {
    const clearedLevel = level;
    bossRef = null;
    nextBossLevel += CONFIG.BOSS_INTERVAL;
    if (clearedLevel >= CONFIG.MAX_LEVEL) {
      onVictory();
    } else {
      setState(STATES.PLAYING);
    }
  }
}

/**
 * 현재 state에 맞게 배경·엔티티·조준선·보스명·플로팅 텍스트를 그린다.
 */
function draw() {
  if (state === STATES.LOBBY) {
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  drawWorldBackground(ctx, camera, w, h, cx, cy);

  particles.forEach((p) => p.draw(ctx, camera, cx, cy));
  enemies.forEach((e) => e.draw(ctx, camera, cx, cy));
  enemyBullets.forEach((b) => b.draw(ctx, camera, cx, cy));
  bullets.forEach((b) => b.draw(ctx, camera, cx, cy));
  orbits.forEach((o) => o.draw(ctx, camera, cx, cy));
  player.draw(ctx, cx, cy);

  if (state === STATES.PLAYING || state === STATES.BOSS) {
    const aim = touchControls.getAimScreenPos(mouse.x, mouse.y);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(aim.x, aim.y);
    ctx.strokeStyle = 'rgba(136, 204, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  floatingTexts.forEach((t) => {
    const s = worldToScreen(t.x, t.y, camera, cx, cy);
    ctx.globalAlpha = t.life / 0.8;
    ctx.fillStyle = t.color;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, s.x, s.y);
    ctx.globalAlpha = 1;
  });

  if (state === STATES.BOSS && bossRef) {
    ctx.fillStyle = '#f66';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${bossRef.bossName} (${bossRef.bossTier}/10)`, w / 2, 40);
  }
}

/** @type {number} requestAnimationFrame 이전 타임스탬프(ms) */
let lastTime = 0;

/**
 * 메인 게임 루프: dt 계산 → 상태별 업데이트 → draw → 다음 프레임 예약.
 * @param {number} timestamp DOMHighResTimeStamp
 */
function loop(timestamp) {
  try {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    if (state === STATES.PLAYING || state === STATES.BOSS) {
      updatePlaying(dt);
    } else if (state === STATES.BOSS_WARNING) {
      bossWarningTimer -= dt;
      if (bossWarningTimer <= 0) {
        hide(bossWarning);
        spawnBossEntity();
      }
    }

    draw();
  } catch (err) {
    console.error(err);
    showBootError(err.message || String(err));
  }
  requestAnimationFrame(loop);
}

/**
 * 모듈 로드·루프 오류 시 사용자에게 안내 오버레이를 표시한다.
 * @param {string} msg 오류 메시지
 */
function showBootError(msg) {
  let el = document.getElementById('bootError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bootError';
    el.className = 'overlay';
    el.innerHTML = `<div class="panel"><h2>게임 로드 오류</h2><p id="bootErrorMsg"></p><p style="margin-top:1rem;color:#889">index.html을 직접 열면 실행되지 않습니다.<br><strong>start.bat</strong>을 실행하거나<br><code>python -m http.server 3456</code> 후<br><a href="http://localhost:3456" style="color:#8cf">http://localhost:3456</a> 접속</p></div>`;
    document.getElementById('app').appendChild(el);
  }
  document.getElementById('bootErrorMsg').textContent = msg;
  show(el);
}

// --- 이벤트 리스너 ---

/** 창 크기 변경 시 캔버스·좌표계 재계산 */
window.addEventListener('resize', resize);

/** 마우스 이동: 조준점 갱신(플레이 중 월드 좌표 동기화) */
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (player) updateWorldMouse();
});

/** 우클릭 컨텍스트 메뉴 방지 */
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** 키보드 입력: WASD 등 이동 키 추적 */
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

/** 로비: 게임 시작 */
document.getElementById('startBtn').addEventListener('click', startGame);

/** 승리 화면: 로비로 복귀 */
document.getElementById('returnLobbyBtn').addEventListener('click', () => setState(STATES.LOBBY));

/** 게임 오버: 같은 설정으로 재시작 */
document.getElementById('retryBtn').addEventListener('click', startGame);

/** 게임 오버: 로비로 복귀 */
document.getElementById('lobbyBtn').addEventListener('click', () => setState(STATES.LOBBY));

// --- 부트스트랩: 초기 레이아웃·로비·게임 루프 시작 ---
resize();
refreshLobby();
setState(STATES.LOBBY);
requestAnimationFrame(loop);
