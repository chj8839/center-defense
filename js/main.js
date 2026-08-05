import { CONFIG, STATES, expForLevel, loadSave, writeSave, isBossLevel, getBossType } from './config.js';
import { createStats, getRandomChoices, applyAugment, getAugmentTags } from './augments.js';
import {
  Player, spawnEnemy, spawnBoss, fireBullets,
  spawnParticles, OrbitShield,
  separateEnemiesFromPlayer, getPointBlankHits, getMeleeHits,
  drawWorldBackground, worldToScreen, screenToWorld,
} from './entities.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const lobby = document.getElementById('lobby');
const hud = document.getElementById('hud');
const levelUpOverlay = document.getElementById('levelUp');
const bossWarning = document.getElementById('bossWarning');
const victory = document.getElementById('victory');
const gameOver = document.getElementById('gameOver');
const augmentChoices = document.getElementById('augmentChoices');
const augmentList = document.getElementById('augmentList');
const hpBar = document.getElementById('hpBar');
const expBar = document.getElementById('expBar');
const levelText = document.getElementById('levelText');
const killText = document.getElementById('killText');
const bestLevelEl = document.getElementById('bestLevel');
const clearCountEl = document.getElementById('clearCount');
const bossLevelHint = document.getElementById('bossLevelHint');
const bossWarningName = document.getElementById('bossWarningName');
const bossWarningDesc = document.getElementById('bossWarningDesc');

bossLevelHint.textContent = `${CONFIG.BOSS_INTERVAL}레벨마다 보스 · Lv.${CONFIG.MAX_LEVEL} 클리어!`;

const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const worldMouse = { x: 0, y: 0 };
const keys = new Set();
const camera = { x: 0, y: 0 };

let state = STATES.LOBBY;
let w, h, cx, cy;
let player, stats, enemies, bullets, enemyBullets, particles, orbits;
let level, exp, kills, spawnTimer, bossRef, nextBossLevel;
let saveData = loadSave();
let bossWarningTimer = 0;
let floatingTexts = [];

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  cx = w / 2;
  cy = h / 2;
  updateWorldMouse();
}

function updateWorldMouse() {
  const wm = screenToWorld(mouse.x, mouse.y, camera, cx, cy);
  worldMouse.x = wm.x;
  worldMouse.y = wm.y;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setState(newState) {
  state = newState;
  hide(lobby);
  hide(hud);
  hide(levelUpOverlay);
  hide(bossWarning);
  hide(victory);
  hide(gameOver);

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

function refreshLobby() {
  saveData = loadSave();
  bestLevelEl.textContent = saveData.bestLevel;
  clearCountEl.textContent = saveData.clearCount;
}

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

function rebuildOrbits() {
  orbits = [];
  for (let i = 0; i < stats.orbitCount; i++) {
    orbits.push(new OrbitShield(player, i, stats.orbitCount));
  }
}

function startGame() {
  resize();
  initGame();
  setState(STATES.PLAYING);
}

function addExp(amount) {
  exp += Math.floor(amount * stats.expMult * CONFIG.PLAYER.baseExpMult);
  while (exp >= expForLevel(level)) {
    exp -= expForLevel(level);
    levelUp();
  }
  updateHud();
}

function levelUp() {
  if (level >= CONFIG.MAX_LEVEL) return;
  level++;
  showLevelUpChoices();
}

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

function shouldTriggerBoss() {
  return isBossLevel(level) && level >= nextBossLevel && !bossRef;
}

function triggerBoss() {
  const bossType = getBossType(level);
  if (bossWarningName) bossWarningName.textContent = bossType.name;
  if (bossWarningDesc) bossWarningDesc.textContent = bossType.desc;
  setState(STATES.BOSS_WARNING);
  bossWarningTimer = 2.5;
  enemies = enemies.filter((e) => !e.dead);
}

function spawnBossEntity() {
  bossRef = spawnBoss(player, level);
  enemies.push(bossRef);
  setState(STATES.BOSS);
}

function onVictory() {
  saveData.clearCount = (saveData.clearCount || 0) + 1;
  saveData.bestLevel = Math.max(saveData.bestLevel || 1, level);
  writeSave(saveData);
  setState(STATES.VICTORY);
}

function onGameOver() {
  saveData.bestLevel = Math.max(saveData.bestLevel || 1, level);
  writeSave(saveData);
  setState(STATES.GAME_OVER);
}

function updateHud() {
  if (!player) return;
  hpBar.style.width = `${(player.hp / player.maxHp) * 100}%`;
  expBar.style.width = `${(exp / expForLevel(level)) * 100}%`;
  levelText.textContent = level;
  killText.textContent = kills;
}

function updateAugmentList() {
  augmentList.innerHTML = getAugmentTags(stats)
    .map((t) => `<span class="augment-tag">${t}</span>`)
    .join('');
}

function getSpawnInterval() {
  const reduction = Math.min(level * 0.06, CONFIG.ENEMY.spawnInterval - CONFIG.ENEMY.spawnIntervalMin);
  return Math.max(CONFIG.ENEMY.spawnIntervalMin, CONFIG.ENEMY.spawnInterval - reduction);
}

function addFloatingText(wx, wy, text, color = '#ff8') {
  floatingTexts.push({ x: wx, y: wy, text, color, life: 0.8, vy: -40 });
}

function applyEnemyHit(enemy, amount, angle, knockback, crit = false) {
  enemy.takeDamage(amount, angle, knockback);
  if (crit) addFloatingText(enemy.x, enemy.y - 20, 'CRIT!', '#f44');
  spawnParticles(particles, enemy.x, enemy.y, '#ff8', 3);
  if (enemy.dead) onEnemyKill(enemy);
}

function applyBulletHit(bullet, enemy) {
  if (!bullet.canHit(enemy)) return false;
  const { amount, crit } = bullet.getDamage();
  applyEnemyHit(enemy, amount, bullet.angle, bullet.knockback, crit);
  bullet.registerHit(enemy);
  return true;
}

function updateCamera() {
  camera.x = player.x;
  camera.y = player.y;
  updateWorldMouse();
}

function updatePlaying(dt) {
  player.update(dt, worldMouse, stats, keys);
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

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(mouse.x, mouse.y);
  ctx.strokeStyle = 'rgba(136, 204, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

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

let lastTime = 0;

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

window.addEventListener('resize', resize);
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (player) updateWorldMouse();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('returnLobbyBtn').addEventListener('click', () => setState(STATES.LOBBY));
document.getElementById('retryBtn').addEventListener('click', startGame);
document.getElementById('lobbyBtn').addEventListener('click', () => setState(STATES.LOBBY));

resize();
refreshLobby();
setState(STATES.LOBBY);
requestAnimationFrame(loop);
