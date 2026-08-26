import { WS_URL } from './network-config.js';

/**
 * 멀티플레이 WebSocket 클라이언트
 * - 서버와 JSON 메시지로 통신
 * - on(type, fn)으로 이벤트 구독 (lobby, state, left, error 등)
 */
export class NetworkClient {
  constructor() {
    this.ws = null;              // WebSocket 인스턴스
    this.playerId = null;        // 서버가 부여한 플레이어 UUID
    this.handlers = {};          // type → 콜백 맵
    this.connected = false;      // 연결 성공 여부
    this.connectPromise = null;  // connect() 중복 호출 방지용 Promise
  }

  /** 이벤트 핸들러 등록 (예: net.on('state', fn)) */
  on(event, fn) {
    this.handlers[event] = fn;
  }

  /** 등록된 핸들러 호출 */
  emit(event, data) {
    this.handlers[event]?.(data);
  }

  /** WebSocket 연결 (connected 메시지 수신 시 resolve) */
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

  /** JSON 메시지 전송 (연결 안 됐으면 false) */
  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /** 방 생성 요청 */
  createRoom(name, characterId) {
    if (!this.send({ type: 'createRoom', name, characterId })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
    }
  }

  /** 4자리 코드로 방 참가 */
  joinRoom(code, name, characterId) {
    if (!this.send({ type: 'joinRoom', code, name, characterId })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
    }
  }

  /** 로비에서 캐릭터 변경 */
  setCharacter(characterId) {
    this.send({ type: 'setCharacter', characterId });
  }

  /** 방장: 게임 시작 */
  startGame() {
    if (!this.send({ type: 'startGame' })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
      return false;
    }
    return true;
  }

  /** 이동·조준 입력 전송 */
  sendInput(input) {
    this.send({ type: 'input', ...input });
  }

  /** 증강 선택 */
  pickAugment(augmentId) {
    this.send({ type: 'pickAugment', augmentId });
  }

  /** 게임 중 포기 (사망 처리 후 방 로비 대기) */
  forfeit() {
    if (!this.send({ type: 'forfeit' })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
      return false;
    }
    return true;
  }

  /** 방 완전 퇴장 */
  leaveRoom() {
    if (!this.send({ type: 'leaveRoom' })) {
      this.emit('error', { message: '서버에 연결되어 있지 않습니다.' });
      return false;
    }
    return true;
  }

  /** 연결 종료 */
  disconnect() {
    this.connectPromise = null;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
