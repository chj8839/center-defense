import http from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { RoomManager } from './gameRoom.js';

const PORT = process.env.PORT || 8080;
const rooms = new RoomManager();

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

const sockets = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Center Defense multiplayer server');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const playerId = randomUUID();
  ws.playerId = playerId;
  sockets.set(playerId, ws);

  send(ws, { type: 'connected', playerId });

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
        const r = rooms.createRoom(playerId, msg.name || 'Player');
        r.broadcast = () => broadcastLobby(r);
        send(ws, { type: 'roomCreated', code: r.code, ...r.getLobbyInfo() });
        break;
      }
      case 'joinRoom': {
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
        rooms.leave(playerId);
        send(ws, { type: 'left' });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    sockets.delete(playerId);
    const room = rooms.getRoomByPlayer(playerId);
    if (room) {
      rooms.leave(playerId);
      if (room.players.size > 0) broadcastLobby(room);
    }
  });
});

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
});
