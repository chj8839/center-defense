import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { RoomManager } from './gameRoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const rooms = new RoomManager();
const sockets = new Map();

function send(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function broadcastRoom(room) {
  for (const [pid] of room.players) {
    const ws = sockets.get(pid);
    if (ws) send(ws, room.getStateFor(pid));
  }
}

function broadcastLobby(room) {
  const info = room.getLobbyInfo();
  for (const [pid] of room.players) {
    const ws = sockets.get(pid);
    if (ws) send(ws, { type: 'lobby', ...info });
  }
}

function serveStatic(req, res) {
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
      case 'createRoom': {
        if (room) rooms.leave(playerId);
        const r = rooms.createRoom(playerId, msg.name || 'Player');
        r.broadcast = () => broadcastLobby(r);
        send(ws, { type: 'roomCreated', code: r.code, ...r.getLobbyInfo() });
        break;
      }
      case 'joinRoom': {
        if (room) rooms.leave(playerId);
        const r = rooms.joinRoom(playerId, msg.code, msg.name || 'Player');
        if (!r) {
          send(ws, { type: 'error', message: '방을 찾을 수 없거나 이미 시작됐습니다.' });
          break;
        }
        r.broadcast = () => broadcastLobby(r);
        broadcastLobby(r);
        break;
      }
      case 'startGame': {
        if (!room || room.hostId !== playerId) break;
        if (room.startGame()) {
          room.broadcast = () => broadcastRoom(room);
          broadcastRoom(room);
        }
        break;
      }
      case 'input': {
        if (!room || room.state !== 'playing') break;
        room.setInput(playerId, msg);
        break;
      }
      case 'pickAugment': {
        if (!room) break;
        room.pickAugment(playerId, msg.augmentId);
        broadcastRoom(room);
        break;
      }
      case 'leaveRoom': {
        const r = rooms.getRoomByPlayer(playerId);
        rooms.leave(playerId);
        send(ws, { type: 'left' });
        if (r && r.players.size > 0) broadcastLobby(r);
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
