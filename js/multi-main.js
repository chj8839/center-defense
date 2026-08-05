import { CONFIG } from './config.js';
import { NetworkClient } from './network.js';
import { WS_URL } from './network-config.js';
import { touchControls } from './touchControls.js';
import {
  drawWorldBackground, drawRemotePlayer, drawEnemySnapshot, worldToScreen, spawnParticles,
} from './entities.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const net = new NetworkClient();

const multiLobby = document.getElementById('multiLobby');
const roomInfo = document.getElementById('roomInfo');
const hud = document.getElementById('hud');
const levelUpOverlay = document.getElementById('levelUp');
const bossWarning = document.getElementById('bossWarning');
const victory = document.getElementById('victory');
const gameOver = document.getElementById('gameOver');
const augmentChoices = document.getElementById('augmentChoices');
const augmentList = document.getElementById('augmentList');
const teamHud = document.getElementById('teamHud');
const hpBar = document.getElementById('hpBar');
const expBar = document.getElementById('expBar');
const levelText = document.getElementById('levelText');
const killText = document.getElementById('killText');
const augmentPickBtn = document.getElementById('augmentPickBtn');
const augmentPendingCount = document.getElementById('augmentPendingCount');
const augmentPanelPending = document.getElementById('augmentPanelPending');
const closeAugmentBtn = document.getElementById('closeAugmentBtn');
const spectateBtn = document.getElementById('spectateBtn');
const gameOverSubtitle = document.getElementById('gameOverSubtitle');
const lobbyBtn = document.getElementById('lobbyBtn');
const leaveGameBtn = document.getElementById('leaveGameBtn');

const mouse = { x: 0, y: 0 };
const keys = { up: false, down: false, left: false, right: false };
const camera = { x: 0, y: 0 };

let w, h, cx, cy;
let gameState = null;
let localPlayer = null;
let inRoom = false;
let isHost = false;
let spectating = false;
let lastInputSend = 0;
let lastFrameTime = 0;
const multiStatus = document.getElementById('multiStatus');
const reconnectBtn = document.getElementById('reconnectBtn');

let augmentPanelOpen = false;
let lastAugmentChoicesKey = '';
const localSim = { x: 0, y: 0, angle: 0, ready: false };
const particles = [];
const renderSnap = {
  enemies: [], prevEnemies: [], bullets: [], prevBullets: [],
  enemyBullets: [], prevEnemyBullets: [], blend: 1,
};
const enemySnapshots = new Map();

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  cx = w / 2;
  cy = h / 2;
  mouse.x = cx;
  mouse.y = cy;
  updateHudSafeTop();
}

function updateHudSafeTop() {
  const hudTop = document.querySelector('.hud-top');
  if (!hudTop || hud.classList.contains('hidden')) return;
  const safeTop = Math.ceil(hudTop.getBoundingClientRect().bottom + 8);
  document.documentElement.style.setProperty('--hud-safe-top', `${safeTop}px`);
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function bindMobileTap(el, handler) {
  let lastTouchAt = 0;
  el.addEventListener('touchend', (e) => {
    e.preventDefault();
    lastTouchAt = Date.now();
    handler(e);
  }, { passive: false });
  el.addEventListener('click', (e) => {
    if (Date.now() - lastTouchAt < 500) return;
    handler(e);
  });
}

function hideAllOverlays() {
  hide(hud);
  hide(levelUpOverlay);
  hide(bossWarning);
  hide(victory);
  hide(gameOver);
}

function getLocalPlayer() {
  if (!gameState || !net.playerId) return null;
  return gameState.players.find((p) => p.id === net.playerId);
}

function getSpectatablePlayers() {
  if (!gameState?.players) return [];
  return gameState.players.filter((p) =>
    p.id !== net.playerId && p.alive
    && (p.gameState === 'playing' || p.gameState === 'boss'),
  );
}

function canSpectate() {
  return getSpectatablePlayers().length > 0;
}

function getSpectateTarget() {
  return getSpectatablePlayers()[0] ?? null;
}

function updateGameOverUi() {
  const can = canSpectate();
  spectateBtn.classList.toggle('hidden', !can);
  gameOverSubtitle.textContent = can
    ? '다른 플레이어는 계속 전투 중입니다'
    : '다른 플레이어가 없습니다 · 로비로 돌아가세요';
  lobbyBtn.classList.toggle('primary', !can);
  spectateBtn.classList.toggle('primary', can);
}

function updateHudFromState() {
  const me = getLocalPlayer();
  if (!me) return;
  localPlayer = me;
  hpBar.style.width = `${(me.hp / me.maxHp) * 100}%`;
  expBar.style.width = `${(me.exp / me.expNeed) * 100}%`;
  levelText.textContent = me.level;
  killText.textContent = me.kills;
  augmentList.innerHTML = (me.augmentTags || [])
    .map((t) => `<span class="augment-tag">${t}</span>`)
    .join('');

  teamHud.innerHTML = gameState.players
    .filter((p) => p.id !== net.playerId)
    .map((p) => `<span class="team-tag" style="border-color:${p.color}">${p.name} Lv${p.level}${p.alive ? '' : ' 💀'}</span>`)
    .join('');
}

function hideBlockingOverlays() {
  hide(bossWarning);
  hide(victory);
  hide(gameOver);
}

function updateTouchActive(me) {
  const playing = gameState?.roomState === 'playing';
  const canControl = playing && me?.alive && !spectating
    && me.gameState !== 'gameOver' && me.gameState !== 'victory'
    && me.gameState !== 'bossWarning';
  touchControls.setActive(canControl);
}

function updateAugmentHud(me) {
  const pending = me?.pendingAugments ?? gameState?.pendingAugments ?? 0;
  if (pending > 0) {
    augmentPickBtn.classList.remove('hidden');
    augmentPendingCount.textContent = pending;
    augmentPanelPending.textContent = pending;
  } else {
    augmentPickBtn.classList.add('hidden');
    augmentPanelOpen = false;
    hide(levelUpOverlay);
    lastAugmentChoicesKey = '';
  }
}

function openAugmentPanel() {
  const choices = gameState?.augmentChoices;
  if (!choices?.length) return;
  showLevelUpChoices(choices);
  augmentPanelOpen = true;
  show(levelUpOverlay);
}

function closeAugmentPanel() {
  augmentPanelOpen = false;
  hide(levelUpOverlay);
}

function handleLocalOverlay(me) {
  hideBlockingOverlays();
  if (!me) {
    hide(hud);
    closeAugmentPanel();
    touchControls.setActive(false);
    return;
  }

  if (spectating) {
    if (!canSpectate()) {
      spectating = false;
    } else {
      show(hud);
      closeAugmentPanel();
      touchControls.setActive(false);
      return;
    }
  }

  if (!me.alive || me.gameState === 'gameOver') {
    closeAugmentPanel();
    hide(hud);
    show(gameOver);
    document.getElementById('finalLevel').textContent = me.level;
    document.getElementById('finalKills').textContent = me.kills;
    updateGameOverUi();
    return;
  }
  if (me.gameState === 'victory') {
    closeAugmentPanel();
    hide(hud);
    show(victory);
    return;
  }

  show(hud);
  updateAugmentHud(me);
  updateHudSafeTop();

  if (augmentPanelOpen && gameState?.augmentChoices?.length) {
    showLevelUpChoices(gameState.augmentChoices);
    show(levelUpOverlay);
  } else if (!gameState?.augmentChoices?.length) {
    closeAugmentPanel();
  }

  if (me.gameState === 'bossWarning' && me.bossWarning) {
    touchControls.setActive(false);
    show(bossWarning);
    document.getElementById('bossWarningName').textContent = me.bossWarning.name;
    document.getElementById('bossWarningDesc').textContent = me.bossWarning.desc;
  } else {
    updateTouchActive(me);
  }
}

function showLevelUpChoices(choices) {
  const key = choices.map((c) => `${c.id}:${c.tier}`).join(',');
  if (key === lastAugmentChoicesKey) {
    show(levelUpOverlay);
    return;
  }
  lastAugmentChoicesKey = key;
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
    card.addEventListener('click', () => {
      lastAugmentChoicesKey = '';
      closeAugmentPanel();
      net.pickAugment(aug.id);
    });
    augmentChoices.appendChild(card);
  });
  show(levelUpOverlay);
}

function syncLocalSim(me) {
  if (!me?.alive) {
    localSim.ready = false;
    return;
  }
  const err = Math.hypot(me.x - localSim.x, me.y - localSim.y);
  if (!localSim.ready || err > 120) {
    localSim.x = me.x;
    localSim.y = me.y;
    localSim.angle = me.angle;
    localSim.ready = true;
  } else if (err > 4) {
    localSim.x += (me.x - localSim.x) * 0.2;
    localSim.y += (me.y - localSim.y) * 0.2;
  }
}

function applyLocalSimulation(dt) {
  const me = getLocalPlayer();
  if (!me?.alive || spectating || !localSim.ready) return;
  if (me.gameState !== 'playing' && me.gameState !== 'boss') return;

  const input = getInputState();
  let mx = 0;
  let my = 0;
  if (input.up) my -= 1;
  if (input.down) my += 1;
  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    const speed = CONFIG.PLAYER.baseMoveSpeed * (me.moveSpeedMult ?? 1);
    localSim.x += (mx / len) * speed * dt;
    localSim.y += (my / len) * speed * dt;
  }
  localSim.angle = input.angle;
}

function detectEnemyDeaths(enemies) {
  const aliveIds = new Set(enemies.map((e) => e.id));
  for (const [id, snap] of enemySnapshots) {
    if (!aliveIds.has(id)) {
      const count = snap.bossName ? 14 : 8;
      spawnParticles(particles, snap.x, snap.y, snap.bossName ? '#f84' : snap.color, count);
    }
  }
  enemySnapshots.clear();
  for (const e of enemies) {
    enemySnapshots.set(e.id, { x: e.x, y: e.y, color: e.color, bossName: e.bossName });
  }
}

function lerpVal(a, b, t) {
  return a + (b - a) * t;
}

function getInterpolatedEnemies() {
  const t = renderSnap.blend;
  const prevMap = new Map(renderSnap.prevEnemies.map((e) => [e.id, e]));
  return renderSnap.enemies.map((e) => {
    const p = prevMap.get(e.id);
    if (!p) return e;
    return { ...e, x: lerpVal(p.x, e.x, t), y: lerpVal(p.y, e.y, t) };
  });
}

function getInterpolatedBullets(list, prevList) {
  const t = renderSnap.blend;
  if (!prevList.length) return list;
  const prevMap = new Map(prevList.filter((b) => b.id != null).map((b) => [b.id, b]));
  return list.map((b) => {
    const p = prevMap.get(b.id);
    if (!p) return b;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    if (dx * dx + dy * dy > 200 * 200) return b;
    return { ...b, x: lerpVal(p.x, b.x, t), y: lerpVal(p.y, b.y, t) };
  });
}

function onState(state) {
  gameState = state;
  if (state.roomState !== 'playing') return;

  hide(multiLobby);
  detectEnemyDeaths(state.enemies);
  renderSnap.prevEnemies = renderSnap.enemies.length ? renderSnap.enemies : state.enemies;
  renderSnap.prevBullets = renderSnap.bullets.length ? renderSnap.bullets : state.bullets;
  renderSnap.prevEnemyBullets = renderSnap.enemyBullets?.length
    ? renderSnap.enemyBullets : state.enemyBullets;
  renderSnap.enemies = state.enemies;
  renderSnap.bullets = state.bullets;
  renderSnap.enemyBullets = state.enemyBullets;
  renderSnap.blend = 0;

  const me = getLocalPlayer();
  syncLocalSim(me);
  if (me?.alive && localSim.ready) {
    camera.x = localSim.x;
    camera.y = localSim.y;
  } else {
    camera.x = me?.x ?? camera.x;
    camera.y = me?.y ?? camera.y;
  }

  updateHudFromState();
  handleLocalOverlay(me);
}

function showMainLobby() {
  resetClientForLobby();
  inRoom = false;
  show(multiLobby);
  show(document.getElementById('multiLobbyActions'));
  hide(roomInfo);
  multiStatus.textContent = '연결됨 · 방을 만들거나 참가하세요';
}

function forfeitToLobby() {
  spectating = false;
  augmentPanelOpen = false;
  closeAugmentPanel();
  if (gameState?.roomState === 'playing') {
    net.forfeit();
  } else {
    showMainLobby();
    net.leaveRoom();
  }
}

function exitRoom() {
  spectating = false;
  augmentPanelOpen = false;
  closeAugmentPanel();
  showMainLobby();
  net.leaveRoom();
}

function resetClientForLobby() {
  spectating = false;
  augmentPanelOpen = false;
  localSim.ready = false;
  lastAugmentChoicesKey = '';
  gameState = null;
  enemySnapshots.clear();
  particles.length = 0;
  renderSnap.enemies = [];
  renderSnap.prevEnemies = [];
  renderSnap.bullets = [];
  renderSnap.prevBullets = [];
  renderSnap.enemyBullets = [];
  renderSnap.prevEnemyBullets = [];
  closeAugmentPanel();
  hideBlockingOverlays();
  hide(hud);
  hide(levelUpOverlay);
  touchControls.setActive(false);
}

function onLobby(info) {
  resetClientForLobby();
  inRoom = true;
  isHost = info.hostId === net.playerId;
  show(multiLobby);
  hide(document.getElementById('multiLobbyActions'));
  show(roomInfo);
  document.getElementById('roomCodeDisplay').textContent = info.code;
  const list = document.getElementById('playerList');
  list.innerHTML = info.players.map((p) =>
    `<li><span style="color:${p.color}">●</span> ${p.name}${p.id === info.hostId ? ' (방장)' : ''}</li>`
  ).join('');
  document.getElementById('startMultiBtn').classList.toggle('hidden', !isHost || info.waitingOthers);
  multiStatus.textContent = info.waitingOthers
    ? '다른 플레이어 전투 중 · 대기 중'
    : `${info.players.length}/4명 · 방장이 시작합니다`;
}

function drawBulletSnapshot(b, color) {
  const s = worldToScreen(b.x, b.y, camera, cx, cy);
  ctx.beginPath();
  ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = color || '#ff8';
  ctx.fill();
}

function draw() {
  if (!gameState || gameState.roomState !== 'playing') {
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const me = getLocalPlayer();
  const spectateTarget = spectating ? getSpectateTarget() : null;
  const useLocal = me && me.id === net.playerId && me.alive && !spectating && localSim.ready
    && (me.gameState === 'playing' || me.gameState === 'boss');
  if (useLocal) {
    camera.x = localSim.x;
    camera.y = localSim.y;
  } else if (spectateTarget) {
    camera.x = spectateTarget.x;
    camera.y = spectateTarget.y;
  } else if (me && me.alive) {
    camera.x = me.x;
    camera.y = me.y;
  }

  drawWorldBackground(ctx, camera, w, h, cx, cy);

  const renderEnemies = getInterpolatedEnemies();
  renderEnemies.forEach((e) => drawEnemySnapshot(ctx, e, camera, cx, cy));

  const enemyBullets = getInterpolatedBullets(
    gameState.enemyBullets,
    renderSnap.prevEnemyBullets || [],
  );
  enemyBullets.forEach((b) => drawBulletSnapshot(b, '#f6a'));

  const playerColors = {};
  gameState.players.forEach((p) => { playerColors[p.id] = p.color; });
  const renderBullets = getInterpolatedBullets(gameState.bullets, renderSnap.prevBullets);
  renderBullets.forEach((b) => drawBulletSnapshot(b, playerColors[b.ownerId] || '#ff8'));

  particles.forEach((p) => p.draw(ctx, camera, cx, cy));

  for (const p of gameState.players) {
    if (p.id === net.playerId && p.alive && !spectating) {
      const pang = useLocal ? localSim.angle : p.angle;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(pang);
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.PLAYER.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#bdf';
      ctx.fillRect(CONFIG.PLAYER.radius - 2, -4, 14, 8);
      ctx.restore();
    } else if (p.alive) {
      drawRemotePlayer(ctx, p.x, p.y, p.angle, p.color, p.name, camera, cx, cy);
    }
  }

  if (me?.alive && !spectating) {
    const aim = touchControls.getAimScreenPos(mouse.x, mouse.y);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(aim.x, aim.y);
    ctx.strokeStyle = 'rgba(136, 204, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const myBoss = gameState.enemies.find((e) => e.bossName && me?.gameState === 'boss');
  if (myBoss) {
    ctx.fillStyle = '#f66';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${myBoss.bossName} (${myBoss.bossTier}/10)`, w / 2, 40);
  }
}

function getInputState() {
  const touchKeys = touchControls.getKeys();
  const aim = touchControls.getAimScreenPos(mouse.x, mouse.y);
  const angle = Math.atan2(aim.y - cy, aim.x - cx);
  return {
    up: keys.up || touchKeys.up,
    down: keys.down || touchKeys.down,
    left: keys.left || touchKeys.left,
    right: keys.right || touchKeys.right,
    angle,
  };
}

function sendInput() {
  if (!gameState || gameState.roomState !== 'playing') return;
  const me = getLocalPlayer();
  if (!me?.alive || spectating) return;
  if (me.gameState === 'gameOver' || me.gameState === 'victory' || me.gameState === 'bossWarning') return;

  net.sendInput(getInputState());
}

function loop(timestamp) {
  const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.05) : 0;
  lastFrameTime = timestamp;

  renderSnap.blend = Math.min(1, renderSnap.blend + dt * 20);
  particles.forEach((p) => p.update(dt));
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }

  applyLocalSimulation(dt);

  if (timestamp - lastInputSend > 16) {
    sendInput();
    lastInputSend = timestamp;
  }
  draw();
  requestAnimationFrame(loop);
}

async function initNetwork() {
  reconnectBtn.classList.add('hidden');
  multiStatus.textContent = `서버 연결 중... (${WS_URL})`;

  try {
    await net.connect();
    multiStatus.textContent = '연결됨 · 방을 만들거나 참가하세요';
  } catch (err) {
    multiStatus.textContent = err.message || '서버 연결 실패';
    reconnectBtn.classList.remove('hidden');
  }
}

net.on('lobby', onLobby);
net.on('roomCreated', (msg) => {
  onLobby(msg);
});
net.on('state', onState);
net.on('left', () => {
  showMainLobby();
});
net.on('error', (msg) => {
  multiStatus.textContent = msg.message;
});
net.on('disconnected', () => {
  multiStatus.textContent = '서버 연결이 끊어졌습니다.';
  reconnectBtn.classList.remove('hidden');
  show(document.getElementById('multiLobbyActions'));
  hide(roomInfo);
  inRoom = false;
});

reconnectBtn.addEventListener('click', () => {
  net.disconnect();
  initNetwork();
});

document.getElementById('createRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Player';
  net.createRoom(name);
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Player';
  const code = document.getElementById('roomCode').value.trim();
  if (code.length < 4) {
    multiStatus.textContent = '4자리 방 코드를 입력하세요.';
    return;
  }
  net.joinRoom(code, name);
});

document.getElementById('startMultiBtn').addEventListener('click', () => {
  net.startGame();
  hide(multiLobby);
  show(hud);
  touchControls.setActive(true);
  updateHudSafeTop();
});

bindMobileTap(document.getElementById('leaveRoomBtn'), exitRoom);
bindMobileTap(document.getElementById('returnLobbyBtn'), exitRoom);
bindMobileTap(document.getElementById('lobbyBtn'), exitRoom);
bindMobileTap(leaveGameBtn, forfeitToLobby);

document.getElementById('spectateBtn').addEventListener('click', () => {
  if (!canSpectate()) return;
  spectating = true;
  hide(gameOver);
  show(hud);
});

bindMobileTap(augmentPickBtn, openAugmentPanel);
bindMobileTap(closeAugmentBtn, closeAugmentPanel);

window.addEventListener('resize', resize);
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.up = true;
  if (k === 's' || k === 'arrowdown') keys.down = true;
  if (k === 'a' || k === 'arrowleft') keys.left = true;
  if (k === 'd' || k === 'arrowright') keys.right = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.up = false;
  if (k === 's' || k === 'arrowdown') keys.down = false;
  if (k === 'a' || k === 'arrowleft') keys.left = false;
  if (k === 'd' || k === 'arrowright') keys.right = false;
});

resize();
initNetwork();
requestAnimationFrame(loop);
