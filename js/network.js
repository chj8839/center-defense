import { WS_URL } from './network-config.js';

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.handlers = {};
    this.connected = false;
    this.connectPromise = null;
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  emit(event, data) {
    this.handlers[event]?.(data);
  }

  connect() {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
      }

      this.ws = new WebSocket(WS_URL);
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        this.connected = false;
        reject(err);
      };

      const timeout = setTimeout(() => {
        fail(new Error('서버 응답 시간 초과'));
        this.ws?.close();
      }, 8000);

      this.ws.onopen = () => {
        this.connected = true;
      };

      this.ws.onerror = () => {
        fail(new Error('서버 연결 실패'));
      };

      this.ws.onclose = (ev) => {
        this.connected = false;
        this.connectPromise = null;
        if (!settled) {
          fail(new Error(ev.code === 1006 ? 'WebSocket 서버에 연결할 수 없습니다' : '연결 종료'));
        } else {
          this.emit('disconnected', { code: ev.code });
        }
      };

      this.ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          fail(new Error('잘못된 서버 응답 (게임 서버 URL 확인)'));
          return;
        }
        if (msg.type === 'connected') {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          this.connectPromise = null;
          this.playerId = msg.playerId;
          resolve(msg);
        } else {
          this.emit(msg.type, msg);
        }
      };
    });

    return this.connectPromise;
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  createRoom(name) {
    if (!this.send({ type: 'createRoom', name })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
    }
  }

  joinRoom(code, name) {
    if (!this.send({ type: 'joinRoom', code, name })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
    }
  }

  startGame() {
    this.send({ type: 'startGame' });
  }

  sendInput(input) {
    this.send({ type: 'input', ...input });
  }

  pickAugment(augmentId) {
    this.send({ type: 'pickAugment', augmentId });
  }

  forfeit() {
    if (!this.send({ type: 'forfeit' })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
      return false;
    }
    return true;
  }

  leaveRoom() {
    if (!this.send({ type: 'leaveRoom' })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
      return false;
    }
    return true;
  }

  disconnect() {
    this.connectPromise = null;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
