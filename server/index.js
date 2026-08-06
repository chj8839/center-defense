/**
 * Center Defense 게임 서버 진입점
 *
 * HTTP 서버와 WebSocket 서버를 하나의 포트에서 함께 운영합니다.
 * - HTTP: 클라이언트 정적 파일(index.html, js, css 등) 제공 및 /health 헬스체크
 * - WebSocket: 방 생성/참가, 게임 시작, 입력, 증강 선택, 기권/퇴장 등 실시간 게임 룸 라우팅
 *
 * 게임 상태는 gameRoom.js의 GameRoom/RoomManager가 관리하고,
 * 이 파일은 연결·메시지 분기·브로드캐스트·정적 서빙을 담당합니다.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { RoomManager } from './gameRoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 프로젝트 루트(정적 파일 기준 디렉터리) — server/ 상위 폴더 */
const ROOT = path.join(__dirname, '..');

/** HTTP/WebSocket 리스닝 포트 — 환경변수 PORT 우선, 기본 8080 */
const PORT = process.env.PORT || 8080;

/** 확장자별 Content-Type 매핑 — serveStatic에서 응답 헤더에 사용 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 전역 게임 방 관리자 — 방 코드·플레이어-방 매핑 및 RoomManager API */
const rooms = new RoomManager();

/** playerId → WebSocket — 브로드캐스트 시 해당 플레이어 소켓 조회용 */
const sockets = new Map();

/**
 * WebSocket으로 JSON 메시지 전송
 * @param {import('ws').WebSocket} ws 대상 소켓
 * @param {object} data 직렬화할 페이로드
 */
function send(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

/**
 * 방에 라운드 종료 콜백 연결
 * endRound() 호출 시 로비 상태를 모든 플레이어에게 브로드캐스트하도록 설정
 * @param {import('./gameRoom.js').GameRoom} room
 */
function attachRoomHandlers(room) {
  room.onRoundEnd = (r) => {
    r.broadcast = () => broadcastLobby(r);
    broadcastLobby(r);
  };
}

/**
 * 진행 중인 게임 방 상태를 각 플레이어에게 개별 전송
 * getStateFor(pid)로 시점·증강 선택 등 플레이어별 뷰를 맞춤
 * @param {import('./gameRoom.js').GameRoom} room
 */
function broadcastRoom(room) {
  for (const [pid] of room.players) {
    const ws = sockets.get(pid);
    if (ws) send(ws, room.getStateFor(pid));
  }
}

/**
 * 대기(로비) 방 정보를 모든 참가자에게 전송
 * @param {import('./gameRoom.js').GameRoom} room
 */
function broadcastLobby(room) {
  const info = room.getLobbyInfo();
  for (const [pid] of room.players) {
    const ws = sockets.get(pid);
    if (ws) send(ws, { type: 'lobby', ...info });
  }
}

/**
 * CORS 응답 헤더 적용 — 브라우저에서 다른 origin으로 정적 리소스 요청 시 허용
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * 정적 파일 HTTP 서빙
 * OPTIONS 프리플라이트, /health, 경로 탈출 방지 후 ROOT 기준 파일 읽기
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function serveStatic(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let urlPath = req.url?.split('?')[0] || '/';
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'center-defense-server' }));
    return;
  }

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const playerId = randomUUID();
  ws.playerId = playerId;
  ws.isAlive = true;
  sockets.set(playerId, ws);

  send(ws, { type: 'connected', playerId });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const room = rooms.getRoomByPlayer(playerId);

    switch (msg.type) {
      // 새 방 생성 — 기존 방이 있으면 먼저 퇴장, 호스트로 4자리 코드 방 개설
      case 'createRoom': {
        if (room) rooms.leave(playerId);
        const r = rooms.createRoom(playerId, msg.name || 'Player');
        attachRoomHandlers(r);
        r.broadcast = () => broadcastLobby(r);
        send(ws, { type: 'roomCreated', code: r.code, ...r.getLobbyInfo() });
        break;
      }
      // 방 코드로 참가 — 대기 중인 방만 가능, 실패 시 에러 메시지
      case 'joinRoom': {
        if (room) rooms.leave(playerId);
        const r = rooms.joinRoom(playerId, msg.code, msg.name || 'Player');
        if (!r) {
          send(ws, { type: 'error', message: '방을 찾을 수 없거나 이미 시작됐습니다.' });
          break;
        }
        attachRoomHandlers(r);
        r.broadcast = () => broadcastLobby(r);
        broadcastLobby(r);
        break;
      }
      // 게임 시작 — 호스트만 가능, 성공 시 게임 상태 브로드캐스트로 전환
      case 'startGame': {
        if (!room || room.hostId !== playerId) break;
        if (room.startGame()) {
          room.broadcast = () => broadcastRoom(room);
          broadcastRoom(room);
        }
        break;
      }
      // 플레이어 입력(이동·조준) — playing 상태에서만 room.setInput에 반영
      case 'input': {
        if (!room || room.state !== 'playing') break;
        room.setInput(playerId, msg);
        break;
      }
      // 레벨업 증강 선택 — 선택 후 전체 게임 상태 동기화
      case 'pickAugment': {
        if (!room) break;
        room.pickAugment(playerId, msg.augmentId);
        broadcastRoom(room);
        break;
      }
      // 기권 — playing 중 사망 처리; 모두 기권 시 endRound→로비, 아니면 상태+대기 안내
      case 'forfeit': {
        if (!room || room.state !== 'playing') break;
        if (room.forfeitPlayer(playerId)) {
          if (room.state === 'waiting') {
            // endRound → onRoundEnd already broadcast lobby
          } else {
            broadcastRoom(room);
            send(ws, {
              type: 'lobby',
              ...room.getLobbyInfo(),
              waitingOthers: true,
            });
          }
        }
        break;
      }
      // 방 퇴장 — 진행 중이면 기권 처리 후 leave, 남은 인원에게 로비/게임 브로드캐스트
      case 'leaveRoom': {
        const r = rooms.getRoomByPlayer(playerId);
        if (r) {
          if (r.state === 'playing') {
            r.forfeitPlayer(playerId);
          }
          const remaining = rooms.leave(playerId);
          if (remaining) {
            if (remaining.state === 'playing') broadcastRoom(remaining);
            else broadcastLobby(remaining);
          }
        }
        send(ws, { type: 'left' });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    sockets.delete(playerId);
    const r = rooms.getRoomByPlayer(playerId);
    if (r) {
      rooms.leave(playerId);
      if (r.players.size > 0) broadcastLobby(r);
    }
  });
});

/** WebSocket 하트비트 — 30초마다 ping, pong 미응답 소켓 terminate */
setInterval(() => {
  for (const ws of sockets.values()) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

/** 게임 틱 브로드캐스트 — 20Hz(50ms)로 playing 방의 getStateFor를 각 클라이언트에 전송 */
setInterval(() => {
  for (const room of rooms.getPlayingRooms()) {
    for (const [pid] of room.players) {
      const ws = sockets.get(pid);
      if (ws) send(ws, room.getStateFor(pid));
    }
  }
}, 1000 / 20);

server.listen(PORT, () => {
  console.log(`Center Defense server on port ${PORT}`);
  console.log(`Static root: ${ROOT}`);
});
