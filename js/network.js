import { WS_URL } from './network-config.js';

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.handlers = {};
    this.connected = false;
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  emit(event, data) {
    this.handlers[event]?.(data);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => { this.connected = true; };
      this.ws.onerror = () => reject(new Error('서버 연결 실패'));
      this.ws.onclose = () => {
        this.connected = false;
        this.emit('disconnected');
      };
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') {
          this.playerId = msg.playerId;
          resolve(msg);
        } else {
          this.emit(msg.type, msg);
        }
      };
    });
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  createRoom(name) {
    this.send({ type: 'createRoom', name });
  }

  joinRoom(code, name) {
    this.send({ type: 'joinRoom', code, name });
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

  leaveRoom() {
    this.send({ type: 'leaveRoom' });
  }

  disconnect() {
    this.ws?.close();
  }
}
