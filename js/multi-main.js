import { CONFIG } from './config.js';
import { NetworkClient } from './network.js';
import { WS_URL, verifyServer } from './network-config.js';
import { touchControls } from './touchControls.js';
import {
  drawWorldBackground, drawRemotePlayer, drawEnemySnapshot, worldToScreen,
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
const multiStatus = document.getElementById('multiStatus');
const reconnectBtn = document.getElementById('reconnectBtn');

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

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  cx = w / 2;
  cy = h / 2;
  mouse.x = cx;
  mouse.y = cy;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

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

function updateTouchActive(me) {
  const playing = gameState?.roomState === 'playing';
  const canControl = playing && me?.alive && !spectating
    && me.gameState !== 'levelUp' && me.gameState !== 'gameOver' && me.gameState !== 'victory';
  touchControls.setActive(canControl);
}

function handleLocalOverlay(me) {
  hideAllOverlays();
  if (!me || spectating) {
    touchControls.setActive(false);
    return;
  }

  if (me.gameState === 'gameOver') {
    show(gameOver);
    document.getElementById('finalLevel').textContent = me.level;
    document.getElementById('finalKills').textContent = me.kills;
    return;
  }
  if (me.gameState === 'victory') {
    show(victory);
    return;
  }

  show(hud);

  if (me.gameState === 'levelUp' && gameState.augmentChoices) {
    touchControls.setActive(false);
    showLevelUpChoices(gameState.augmentChoices);
  } else if (me.gameState === 'bossWarning' && me.bossWarning) {
    touchControls.setActive(false);
    show(bossWarning);
    document.getElementById('bossWarningName').textContent = me.bossWarning.name;
    document.getElementById('bossWarningDesc').textContent = me.bossWarning.desc;
  } else {
    updateTouchActive(me);
  }
}

function showLevelUpChoices(choices) {
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
    card.addEventListener('click', () => net.pickAugment(aug.id));
    augmentChoices.appendChild(card);
  });
  show(levelUpOverlay);
}

function onState(state) {
  gameState = state;
  if (state.roomState !== 'playing') return;

  hide(multiLobby);
  const me = getLocalPlayer();
  camera.x = me?.x ?? camera.x;
  camera.y = me?.y ?? camera.y;

  updateHudFromState();
  updateTouchActive(me);
  if (!spectating || me?.alive) handleLocalOverlay(me);
}

function onLobby(info) {
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
  document.getElementById('startMultiBtn').classList.toggle('hidden', !isHost);
  multiStatus.textContent = `${info.players.length}/4명 · 방장이 시작합니다`;
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
  if (me && me.alive) {
    camera.x = me.x;
    camera.y = me.y;
  }

  drawWorldBackground(ctx, camera, w, h, cx, cy);

  gameState.enemies.forEach((e) => drawEnemySnapshot(ctx, e, camera, cx, cy));
  gameState.enemyBullets.forEach((b) => drawBulletSnapshot(b, '#f6a'));

  const playerColors = {};
  gameState.players.forEach((p) => { playerColors[p.id] = p.color; });
  gameState.bullets.forEach((b) => drawBulletSnapshot(b, playerColors[b.ownerId] || '#ff8'));

  for (const p of gameState.players) {
    if (p.id === net.playerId && p.alive && !spectating) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.angle);
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
  if (me.gameState === 'levelUp' || me.gameState === 'gameOver' || me.gameState === 'victory') return;

  net.sendInput(getInputState());
}

function loop(timestamp) {
  if (timestamp - lastInputSend > 50) {
    sendInput();
    lastInputSend = timestamp;
  }
  draw();
  requestAnimationFrame(loop);
}

async function initNetwork() {
  reconnectBtn.classList.add('hidden');
  multiStatus.textContent = `서버 연결 중... (${WS_URL})`;

  const baseOk = await verifyServer(WS_URL);
  if (!baseOk) {
    multiStatus.textContent = '게임 서버에 연결할 수 없습니다. Railway에서 npm start 배포가 필요합니다.';
    reconnectBtn.classList.remove('hidden');
    return;
  }

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
  inRoom = false;
  gameState = null;
  spectating = false;
  show(multiLobby);
  show(document.getElementById('multiLobbyActions'));
  hide(roomInfo);
  hideAllOverlays();
  touchControls.setActive(false);
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
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
  net.leaveRoom();
});

document.getElementById('returnLobbyBtn').addEventListener('click', () => {
  net.leaveRoom();
});

document.getElementById('lobbyBtn').addEventListener('click', () => {
  net.leaveRoom();
});

document.getElementById('spectateBtn').addEventListener('click', () => {
  spectating = true;
  hide(gameOver);
  show(hud);
});

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
