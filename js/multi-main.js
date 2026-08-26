/**
 * 멀티플레이어 클라이언트 진입점 (multi-main.js)
 *
 * 이 파일은 협동 슈팅 게임의 멀티플레이어 클라이언트를 초기화하고 실행합니다.
 *
 * 주요 역할:
 * - 네트워크(Network): WebSocket을 통해 서버와 연결하고, 방 생성/참가, 입력 전송,
 *   서버 상태(state) 수신, 증강 선택 등을 NetworkClient로 처리합니다.
 * - 클라이언트 예측(Prediction): 로컬 플레이어의 이동을 서버 응답 전에 미리 시뮬레이션하여
 *   입력 지연을 줄입니다. syncLocalSim으로 서버 좌표와 보정합니다.
 * - 보간(Interpolation): 서버 스냅샷 사이의 적·탄환 위치를 lerp로 부드럽게 렌더링합니다.
 * - HUD: HP/EXP/레벨/킬, 팀원 정보, 증강 패널, 게임오버·승리·보스 경고 등 UI를 갱신합니다.
 */

import { CONFIG } from './config.js';
import { NetworkClient } from './network.js';
import { WS_URL } from './network-config.js';
import {
  renderCharacterCards, loadSelectedCharacter, saveSelectedCharacter, getCharacter,
} from './characters.js';
import { touchControls } from './touchControls.js';
import {
  drawWorldBackground, drawRemotePlayer, drawEnemySnapshot, worldToScreen, spawnParticles,
} from './entities.js';

/** @type {HTMLCanvasElement} 게임 렌더링 캔버스 */
const canvas = document.getElementById('gameCanvas');
/** @type {CanvasRenderingContext2D} 2D 드로잉 컨텍스트 */
const ctx = canvas.getContext('2d');
/** @type {NetworkClient} WebSocket 멀티플레이어 네트워크 클라이언트 */
const net = new NetworkClient();

/** @type {HTMLElement} 멀티플레이 로비 화면 컨테이너 */
const multiLobby = document.getElementById('multiLobby');
/** @type {HTMLElement} 방 정보(코드·플레이어 목록) 표시 영역 */
const roomInfo = document.getElementById('roomInfo');
/** @type {HTMLElement} 인게임 HUD(체력·경험치·팀 등) */
const hud = document.getElementById('hud');
/** @type {HTMLElement} 레벨업/증강 선택 오버레이 */
const levelUpOverlay = document.getElementById('levelUp');
/** @type {HTMLElement} 보스 등장 경고 오버레이 */
const bossWarning = document.getElementById('bossWarning');
/** @type {HTMLElement} 승리 화면 오버레이 */
const victory = document.getElementById('victory');
/** @type {HTMLElement} 게임 오버(사망) 오버레이 */
const gameOver = document.getElementById('gameOver');
/** @type {HTMLElement} 증강 선택 카드가 들어가는 컨테이너 */
const augmentChoices = document.getElementById('augmentChoices');
/** @type {HTMLElement} 보유 증강 태그 목록(HUD 내) */
const augmentList = document.getElementById('augmentList');
/** @type {HTMLElement} 팀원 상태 표시 영역 */
const teamHud = document.getElementById('teamHud');
/** @type {HTMLElement} HP 바 요소 */
const hpBar = document.getElementById('hpBar');
/** @type {HTMLElement} EXP 바 요소 */
const expBar = document.getElementById('expBar');
/** @type {HTMLElement} 현재 레벨 텍스트 */
const levelText = document.getElementById('levelText');
/** @type {HTMLElement} 킬 수 텍스트 */
const killText = document.getElementById('killText');
/** @type {HTMLElement} 증강 선택 열기 버튼(HUD) */
const augmentPickBtn = document.getElementById('augmentPickBtn');
/** @type {HTMLElement} HUD 상 대기 중인 증강 개수 */
const augmentPendingCount = document.getElementById('augmentPendingCount');
/** @type {HTMLElement} 증강 패널 내 대기 개수 */
const augmentPanelPending = document.getElementById('augmentPanelPending');
/** @type {HTMLElement} 증강 패널 닫기 버튼 */
const closeAugmentBtn = document.getElementById('closeAugmentBtn');
/** @type {HTMLElement} 사망 후 관전하기 버튼 */
const spectateBtn = document.getElementById('spectateBtn');
/** @type {HTMLElement} 게임 오버 부제(관전 가능 여부 안내) */
const gameOverSubtitle = document.getElementById('gameOverSubtitle');
/** @type {HTMLElement} 로비로 돌아가기 버튼(게임 오버) */
const lobbyBtn = document.getElementById('lobbyBtn');
/** @type {HTMLElement} 게임 포기/로비 복귀 버튼 */
const leaveGameBtn = document.getElementById('leaveGameBtn');
const specialBar = document.getElementById('specialBar');
const specialBtn = document.getElementById('specialBtn');
const characterChoices = document.getElementById('characterChoices');

/** @type {string} 멀티 로비에서 선택한 캐릭터 */
let selectedCharacterId = loadSelectedCharacter();
/** @type {boolean} 다음 입력 패킷에 특수 사용 플래그 */
let specialQueued = false;

/** @type {{ x: number, y: number }} 마우스/에임 화면 좌표 */
const mouse = { x: 0, y: 0 };
/** @type {{ up: boolean, down: boolean, left: boolean, right: boolean }} 키보드 이동 입력 상태 */
const keys = { up: false, down: false, left: false, right: false };
/** @type {{ x: number, y: number }} 월드 카메라 중심(플레이어 추적) */
const camera = { x: 0, y: 0 };

/** @type {number} 캔버스 너비(px) */
let w;
/** @type {number} 캔버스 높이(px) */
let h;
/** @type {number} 화면 중심 X */
let cx;
/** @type {number} 화면 중심 Y */
let cy;
/** @type {object|null} 서버에서 수신한 최신 게임 상태 */
let gameState = null;
/** @type {object|null} 로컬 플레이어 객체 캐시(HUD 갱신용) */
let localPlayer = null;
/** @type {boolean} 방에 입장했는지 여부 */
let inRoom = false;
/** @type {boolean} 현재 클라이언트가 방장인지 여부 */
let isHost = false;
/** @type {boolean} 사망 후 다른 플레이어 관전 중인지 */
let spectating = false;
/** @type {number} 마지막 입력 전송 시각(ms, requestAnimationFrame 기준) */
let lastInputSend = 0;
/** @type {number} 이전 프레임 타임스탬프(ms, delta 계산용) */
let lastFrameTime = 0;
/** @type {HTMLElement} 연결 상태·안내 메시지 표시 */
const multiStatus = document.getElementById('multiStatus');
/** @type {HTMLElement} 서버 재연결 버튼 */
const reconnectBtn = document.getElementById('reconnectBtn');
/** @type {HTMLElement} 방장 게임 시작 버튼 */
const startMultiBtn = document.getElementById('startMultiBtn');

/** 서버 state 브로드캐스트 주기(ms) — CONFIG.MULTI.broadcastRate와 동기 */
const SERVER_TICK_MS = 1000 / CONFIG.MULTI.broadcastRate;
/** @type {number} 마지막 서버 state 수신 시각(performance.now) */
let lastStateAt = 0;

/** @type {boolean} 증강 선택 패널이 열려 있는지 */
let augmentPanelOpen = false;
/** @type {string} 마지막으로 렌더한 증강 선택지 키(중복 DOM 갱신 방지) */
let lastAugmentChoicesKey = '';
/** @type {{ x: number, y: number, angle: number, ready: boolean }} 클라이언트 예측용 로컬 시뮬레이션 상태 */
const localSim = { x: 0, y: 0, angle: 0, ready: false };
/** @type {Array} 파티클(적 사망 등) 인스턴스 목록 */
const particles = [];
/** @type {object} 렌더 보간용 이전/현재 스냅샷 및 blend 계수 */
const renderSnap = {
  enemies: [], prevEnemies: [], bullets: [], prevBullets: [],
  enemyBullets: [], prevEnemyBullets: [], players: [], prevPlayers: [], blend: 1,
};
/** @type {Map<string|number, object>} 적 ID → 마지막 위치(사망 파티클 감지용) */
const enemySnapshots = new Map();

/**
 * 창 크기에 맞게 캔버스를 리사이즈하고 화면 중심·마우스·HUD safe area를 갱신합니다.
 */
function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  cx = w / 2;
  cy = h / 2;
  mouse.x = cx;
  mouse.y = cy;
  updateHudSafeTop();
}

/**
 * HUD 상단 바 높이를 측정해 CSS 변수 --hud-safe-top을 설정합니다.
 * 터치 조준선 등이 HUD에 가리지 않도록 safe area를 확보합니다.
 */
function updateHudSafeTop() {
  const hudTop = document.querySelector('.hud-top');
  if (!hudTop || hud.classList.contains('hidden')) return;
  const safeTop = Math.ceil(hudTop.getBoundingClientRect().bottom + 8);
  document.documentElement.style.setProperty('--hud-safe-top', `${safeTop}px`);
}

/**
 * DOM 요소를 표시합니다(hidden 클래스 제거).
 * @param {HTMLElement} el
 */
function show(el) { el.classList.remove('hidden'); }

/**
 * DOM 요소를 숨깁니다(hidden 클래스 추가).
 * @param {HTMLElement} el
 */
function hide(el) { el.classList.add('hidden'); }

/**
 * 모바일 touchend와 데스크톱 click을 모두 처리하는 탭 바인딩.
 * touchend 직후 발생하는 ghost click을 500ms 동안 무시합니다.
 * @param {HTMLElement} el - 이벤트를 붙일 요소
 * @param {(e: Event) => void} handler - 탭/클릭 시 실행할 콜백
 */
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

/**
 * 인게임 HUD 및 모든 풀스크린 오버레이를 숨깁니다.
 */
function hideAllOverlays() {
  hide(hud);
  hide(levelUpOverlay);
  hide(bossWarning);
  hide(victory);
  hide(gameOver);
}

/**
 * 현재 접속 중인 로컬 플레이어 객체를 gameState에서 찾아 반환합니다.
 * @returns {object|null} 로컬 플레이어 또는 null
 */
function getLocalPlayer() {
  if (!gameState || !net.playerId) return null;
  return gameState.players.find((p) => p.id === net.playerId);
}

/**
 * 관전 가능한 다른 살아 있는 플레이어 목록을 반환합니다.
 * @returns {Array<object>} 관전 대상 후보 플레이어 배열
 */
function getSpectatablePlayers() {
  if (!gameState?.players) return [];
  return gameState.players.filter((p) =>
    p.id !== net.playerId && p.alive
    && (p.gameState === 'playing' || p.gameState === 'boss'),
  );
}

/**
 * 사망 후 다른 플레이어를 관전할 수 있는지 여부를 반환합니다.
 * @returns {boolean}
 */
function canSpectate() {
  return getSpectatablePlayers().length > 0;
}

/**
 * 관전 카메라가 따라갈 첫 번째 대상 플레이어를 반환합니다.
 * @returns {object|null}
 */
function getSpectateTarget() {
  return getSpectatablePlayers()[0] ?? null;
}

/**
 * 게임 오버 UI(관전 버튼·부제·버튼 강조)를 관전 가능 여부에 맞게 갱신합니다.
 */
function updateGameOverUi() {
  const can = canSpectate();
  spectateBtn.classList.toggle('hidden', !can);
  gameOverSubtitle.textContent = can
    ? '다른 플레이어는 계속 전투 중입니다'
    : '다른 플레이어가 없습니다 · 로비로 돌아가세요';
  lobbyBtn.classList.toggle('primary', !can);
  spectateBtn.classList.toggle('primary', can);
}

/**
 * 서버 상태를 바탕으로 HUD(HP·EXP·레벨·킬·증강·팀원)를 갱신합니다.
 */
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

  if (specialBar && me.specialMeterMax) {
    specialBar.style.width = `${((me.specialMeter || 0) / me.specialMeterMax) * 100}%`;
  }
  if (specialBtn) {
    const ready = (me.specialMeter || 0) >= (me.specialMeterMax || 100);
    specialBtn.classList.toggle('ready', ready);
    specialBtn.classList.toggle('hidden', gameState?.roomState !== 'playing');
    if (me.characterName) specialBtn.title = `${me.characterName} 특수 (Space)`;
  }

  teamHud.innerHTML = gameState.players
    .filter((p) => p.id !== net.playerId)
    .map((p) => `<span class="team-tag" style="border-color:${p.color}">${p.name}${p.characterName ? ` · ${p.characterName}` : ''} Lv${p.level}${p.alive ? '' : ' 💀'}</span>`)
    .join('');
}

/**
 * 게임 진행을 막는 오버레이(보스 경고·승리·게임 오버)만 숨깁니다.
 */
function hideBlockingOverlays() {
  hide(bossWarning);
  hide(victory);
  hide(gameOver);
}

/**
 * 터치/가상 조이스틱 입력 활성화 여부를 플레이 상태에 맞게 설정합니다.
 * @param {object|null} me - 로컬 플레이어
 */
function updateTouchActive(me) {
  const playing = gameState?.roomState === 'playing';
  const canControl = playing && me?.alive && !spectating
    && me.gameState !== 'gameOver' && me.gameState !== 'victory'
    && me.gameState !== 'bossWarning';
  touchControls.setActive(canControl);
}

/**
 * 대기 중인 증강 선택 개수에 따라 HUD·패널 버튼 표시를 갱신합니다.
 * @param {object|null} me - 로컬 플레이어
 */
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

/**
 * 증강 선택 패널을 열고 현재 선택지를 렌더링합니다.
 */
function openAugmentPanel() {
  const choices = gameState?.augmentChoices;
  if (!choices?.length) return;
  showLevelUpChoices(choices);
  augmentPanelOpen = true;
  show(levelUpOverlay);
}

/**
 * 증강 선택 패널을 닫습니다.
 */
function closeAugmentPanel() {
  augmentPanelOpen = false;
  hide(levelUpOverlay);
}

/**
 * 로컬 플레이어 상태에 따라 HUD·오버레이·터치 입력·증강 UI를 통합 갱신합니다.
 * 사망·승리·관전·보스 경고·증강 패널 등을 처리합니다.
 * @param {object|null} me - 로컬 플레이어
 */
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

/**
 * 증강 선택 카드를 DOM에 렌더링하고 레벨업 오버레이를 표시합니다.
 * 선택지가 이전과 동일하면 DOM 재생성을 건너뜁니다.
 * @param {Array<object>} choices - 증강 선택지 배열
 */
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

/**
 * 서버 좌표와 로컬 예측 시뮬레이션(localSim)을 동기화합니다.
 * 오차가 크면 즉시 스냅, 작으면 부드럽게 보정합니다.
 * @param {object|null} me - 로컬 플레이어
 */
function syncLocalSim(me) {
  if (!me?.alive) {
    localSim.ready = false;
    return;
  }
  const err = Math.hypot(me.x - localSim.x, me.y - localSim.y);
  if (!localSim.ready) {
    localSim.x = me.x;
    localSim.y = me.y;
    localSim.angle = me.angle;
    localSim.ready = true;
    return;
  }
  if (err > 120) {
    localSim.x = me.x;
    localSim.y = me.y;
    localSim.angle = me.angle;
    return;
  }
  if (err > 28) {
    localSim.x += (me.x - localSim.x) * 0.12;
    localSim.y += (me.y - localSim.y) * 0.12;
  }
}

/**
 * 클라이언트 측 이동 예측: 입력에 따라 localSim 위치·각도를 dt만큼 진행시킵니다.
 * @param {number} dt - 프레임 간 경과 시간(초)
 */
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

/**
 * 이전 스냅샷 대비 사라진 적에 대해 사망 파티클을 생성하고 스냅샷 맵을 갱신합니다.
 * @param {Array<object>} enemies - 현재 프레임 적 목록
 */
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

/**
 * 두 값 사이 선형 보간(lerp).
 * @param {number} a - 시작값
 * @param {number} b - 끝값
 * @param {number} t - 보간 계수(0~1)
 * @returns {number}
 */
function lerpVal(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 적 엔티티 위치를 이전·현재 스냅샷 사이에서 보간합니다.
 * @returns {Array<object>} 보간된 적 배열
 */
function getInterpolatedEnemies() {
  const t = renderSnap.blend;
  const prevMap = new Map(renderSnap.prevEnemies.map((e) => [e.id, e]));
  return renderSnap.enemies.map((e) => {
    const p = prevMap.get(e.id);
    if (!p) return e;
    return { ...e, x: lerpVal(p.x, e.x, t), y: lerpVal(p.y, e.y, t) };
  });
}

/**
 * 탄환 엔티티 위치를 이전·현재 스냅샷 사이에서 보간합니다.
 * 순간이동(200px 초과)은 보간하지 않습니다.
 * @param {Array<object>} list - 현재 탄환 목록
 * @param {Array<object>} prevList - 이전 탄환 목록
 * @returns {Array<object>} 보간된 탄환 배열
 */
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

function getInterpolatedPlayers() {
  if (!gameState?.players) return [];
  const t = renderSnap.blend;
  const prevMap = new Map((renderSnap.prevPlayers || []).map((p) => [p.id, p]));
  return gameState.players.map((p) => {
    if (p.id === net.playerId) return p;
    const prev = prevMap.get(p.id);
    if (!prev) return p;
    return {
      ...p,
      x: lerpVal(prev.x, p.x, t),
      y: lerpVal(prev.y, p.y, t),
      angle: lerpVal(prev.angle, p.angle, t),
    };
  });
}

/**
 * 서버 game state 수신 핸들러: 보간 스냅샷·카메라·HUD·오버레이를 갱신합니다.
 * @param {object} state - 서버에서 받은 전체 게임 상태
 */
function onState(state) {
  gameState = state;
  if (state.roomState !== 'playing') return;

  hide(multiLobby);
  show(hud);
  touchControls.setActive(true);
  updateHudSafeTop();

  detectEnemyDeaths(state.enemies);
  renderSnap.prevEnemies = renderSnap.enemies.length ? renderSnap.enemies : state.enemies;
  renderSnap.prevBullets = renderSnap.bullets.length ? renderSnap.bullets : state.bullets;
  renderSnap.prevEnemyBullets = renderSnap.enemyBullets?.length
    ? renderSnap.enemyBullets : state.enemyBullets;
  renderSnap.prevPlayers = renderSnap.players.length ? renderSnap.players : state.players;
  renderSnap.enemies = state.enemies;
  renderSnap.bullets = state.bullets;
  renderSnap.enemyBullets = state.enemyBullets;
  renderSnap.players = state.players;
  lastStateAt = performance.now();
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

/**
 * 메인 로비 화면으로 전환합니다(방 나간 뒤 초기 화면).
 */
function showMainLobby() {
  resetClientForLobby();
  inRoom = false;
  show(multiLobby);
  show(document.getElementById('multiLobbyActions'));
  hide(roomInfo);
  multiStatus.textContent = '연결됨 · 방을 만들거나 참가하세요';
}

/**
 * 전투 중 포기(forfeit)하거나 비플레이 중이면 로비로 복귀합니다.
 */
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

/**
 * 방을 나가고 메인 로비 UI로 돌아갑니다.
 */
function exitRoom() {
  spectating = false;
  augmentPanelOpen = false;
  closeAugmentPanel();
  showMainLobby();
  net.leaveRoom();
}

/**
 * 로비 복귀 시 클라이언트 게임 상태·렌더·UI를 초기화합니다.
 */
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
  renderSnap.players = [];
  renderSnap.prevPlayers = [];
  closeAugmentPanel();
  hideBlockingOverlays();
  hide(hud);
  hide(levelUpOverlay);
  touchControls.setActive(false);
}

/**
 * 방 로비 정보 수신 핸들러: 플레이어 목록·방 코드·시작 버튼 표시를 갱신합니다.
 * @param {object} info - 방 코드, hostId, players, waitingOthers 등
 */
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
    `<li><span style="color:${p.color}">●</span> ${p.name}${p.characterName ? ` · ${p.characterName}` : ''}${p.id === info.hostId ? ' (방장)' : ''}</li>`
  ).join('');
  const canStart = isHost && !info.waitingOthers && info.state !== 'playing';
  startMultiBtn.classList.toggle('hidden', !canStart);
  startMultiBtn.disabled = !canStart;
  multiStatus.textContent = info.waitingOthers
    ? '다른 플레이어 전투 중 · 대기 중'
    : isHost
      ? `${info.players.length}/4명 · 게임 시작을 누르세요`
      : `${info.players.length}/4명 · 방장이 시작합니다`;
}

/** 방장: 서버에 게임 시작 요청 (실제 전환은 onState에서 처리) */
function startMultiGame() {
  if (!isHost) {
    multiStatus.textContent = '방장만 게임을 시작할 수 있습니다.';
    return;
  }
  if (!net.playerId) {
    multiStatus.textContent = '서버 연결을 기다리는 중입니다.';
    return;
  }
  if (!net.startGame()) return;
  multiStatus.textContent = '게임 시작 중...';
}

/**
 * 월드 좌표 탄환 하나를 화면에 원으로 그립니다.
 * @param {object} b - 탄환 { x, y }
 * @param {string} [color] - 채우기 색
 */
function drawBulletSnapshot(b, color) {
  const s = worldToScreen(b.x, b.y, camera, cx, cy);
  ctx.beginPath();
  ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = color || '#ff8';
  ctx.fill();
}

/**
 * 한 프레임 렌더: 배경·보간된 적/탄·파티클·플레이어·에임선·보스 UI.
 */
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

  for (const p of getInterpolatedPlayers()) {
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

  const myBoss = gameState.enemies.find((e) => e.ownerId === net.playerId)
    || gameState.enemies.find((e) => e.bossName && me?.gameState === 'boss');
  if (myBoss) {
    ctx.fillStyle = '#f66';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${myBoss.bossName} (${myBoss.bossTier}/10)`, w / 2, 40);
  }
}

/**
 * 키보드·터치 입력을 합쳐 이동 플래그와 조준 각도를 반환합니다.
 * @returns {{ up: boolean, down: boolean, left: boolean, right: boolean, angle: number }}
 */
function queueSpecial() {
  const me = getLocalPlayer();
  if (!me?.alive || spectating) return;
  if (gameState?.roomState !== 'playing') return;
  specialQueued = true;
}

function getInputState() {
  const touchKeys = touchControls.getKeys();
  const aim = touchControls.getAimScreenPos(mouse.x, mouse.y);
  const angle = Math.atan2(aim.y - cy, aim.x - cx);
  const input = {
    up: keys.up || touchKeys.up,
    down: keys.down || touchKeys.down,
    left: keys.left || touchKeys.left,
    right: keys.right || touchKeys.right,
    angle,
  };
  if (specialQueued) {
    input.useSpecial = true;
    specialQueued = false;
  }
  return input;
}

/**
 * 플레이 중이고 조작 가능할 때만 서버로 입력 상태를 전송합니다.
 */
function sendInput() {
  if (!gameState || gameState.roomState !== 'playing') return;
  const me = getLocalPlayer();
  if (!me?.alive || spectating) return;
  if (me.gameState === 'gameOver' || me.gameState === 'victory' || me.gameState === 'bossWarning') return;

  net.sendInput(getInputState());
}

/**
 * 메인 게임 루프: delta·보간 blend·파티클·로컬 예측·입력 전송·렌더.
 * @param {number} timestamp - requestAnimationFrame 타임스탬프(ms)
 */
function loop(timestamp) {
  const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.05) : 0;
  lastFrameTime = timestamp;

  if (lastStateAt > 0) {
    renderSnap.blend = Math.min(1, (performance.now() - lastStateAt) / SERVER_TICK_MS);
  }

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

/**
 * WebSocket 서버에 연결하고 연결 상태 UI를 갱신합니다.
 */
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

/** 네트워크: 방 로비 상태 갱신 */
net.on('lobby', onLobby);
/** 네트워크: 방 생성 완료 → 로비 UI 갱신 */
net.on('roomCreated', (msg) => {
  onLobby(msg);
});
/** 네트워크: 게임 state 스냅샷 수신 */
net.on('state', onState);
/** 네트워크: 방 퇴장 완료 → 메인 로비 표시 */
net.on('left', () => {
  showMainLobby();
});
/** 네트워크: 서버 오류 메시지 표시 */
net.on('error', (msg) => {
  multiStatus.textContent = msg.message;
});
/** 네트워크: 연결 끊김 → 재연결 버튼 및 로비 액션 복원 */
net.on('disconnected', () => {
  multiStatus.textContent = '서버 연결이 끊어졌습니다.';
  reconnectBtn.classList.remove('hidden');
  show(document.getElementById('multiLobbyActions'));
  hide(roomInfo);
  inRoom = false;
});

/** 재연결 버튼: 기존 연결 종료 후 initNetwork 재시도 */
reconnectBtn.addEventListener('click', () => {
  net.disconnect();
  initNetwork();
});

/** 방 만들기: 플레이어 이름으로 createRoom 요청 */
document.getElementById('createRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Player';
  net.createRoom(name, selectedCharacterId);
});

/** 방 참가: 4자리 코드·이름으로 joinRoom 요청 */
document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Player';
  const code = document.getElementById('roomCode').value.trim();
  if (code.length < 4) {
    multiStatus.textContent = '4자리 방 코드를 입력하세요.';
    return;
  }
  net.joinRoom(code, name, selectedCharacterId);
});

specialBtn?.addEventListener('click', queueSpecial);

function initCharacterSelect() {
  if (!characterChoices) return;
  renderCharacterCards(characterChoices, (id) => {
    selectedCharacterId = id;
    saveSelectedCharacter(id);
    if (inRoom) net.setCharacter(id);
  }, selectedCharacterId, { selectOnly: true });
}
initCharacterSelect();

/** 게임 시작(방장): 서버 확인 후 onState에서 HUD 전환 */
startMultiBtn.addEventListener('click', startMultiGame);
bindMobileTap(startMultiBtn, startMultiGame);

/** 로비/게임 오버 등에서 방 나가기 */
bindMobileTap(document.getElementById('leaveRoomBtn'), exitRoom);
bindMobileTap(document.getElementById('returnLobbyBtn'), exitRoom);
bindMobileTap(document.getElementById('lobbyBtn'), exitRoom);
/** 전투 중 포기(forfeit) */
bindMobileTap(leaveGameBtn, forfeitToLobby);

/** 게임 오버 후 살아 있는 팀원 관전 시작 */
document.getElementById('spectateBtn').addEventListener('click', () => {
  if (!canSpectate()) return;
  spectating = true;
  hide(gameOver);
  show(hud);
});

/** 증강 선택 패널 열기/닫기 */
bindMobileTap(augmentPickBtn, openAugmentPanel);
bindMobileTap(closeAugmentBtn, closeAugmentPanel);

/** 창 리사이즈 시 캔버스·HUD safe area 갱신 */
window.addEventListener('resize', resize);
/** 마우스 이동 → 에임 좌표 갱신 */
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
/** 우클릭 컨텍스트 메뉴 방지 */
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** 키보드 이동 입력(keydown) */
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    queueSpecial();
  }
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.up = true;
  if (k === 's' || k === 'arrowdown') keys.down = true;
  if (k === 'a' || k === 'arrowleft') keys.left = true;
  if (k === 'd' || k === 'arrowright') keys.right = true;
});
/** 키보드 이동 입력(keyup) */
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
