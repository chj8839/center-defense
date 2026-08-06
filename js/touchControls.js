/**
 * 터치·모바일 조작 UI (멀티터치)
 * - 화면 왼쪽: 가상 조이스틱으로 이동 (WASD 키 입력과 동일한 getKeys/getMovement 제공)
 * - 화면 오른쪽: 드래그로 조준 방향 갱신 (getAimScreenPos, isAiming)
 * - setActive(true) 시 터치 기기 또는 좁은 화면(≤900px)에서만 활성화
 * - 게임 루프는 getMovement, getKeys, getAimScreenPos로 입력을 읽음
 */
export class TouchControls {
  constructor() {
    this.enabled = false;           // 조작 활성화 여부 (setActive로 제어)
    this.visible = false;           // UI 표시 상태 (enabled와 연동)
    this.moveTouchId = null;        // 이동 조이스틱에 할당된 터치 identifier
    this.aimTouchId = null;         // 조준 영역에 할당된 터치 identifier
    this.moveBase = { x: 0, y: 0 }; // 조이스틱 베이스(고정점) 화면 좌표
    this.moveVector = { x: 0, y: 0 }; // 정규화된 이동 방향 (-1~1, deadZone 미만이면 0)
    this.aimPos = null;             // 조준 터치의 현재 화면 좌표 { x, y } 또는 null
    this.maxRadius = 52;            // 조이스틱 노브가 베이스에서 벗어날 수 있는 최대 반경(px)
    this.deadZone = 0.18;           // 이동 입력 무시 구간 (정규화 거리 기준)
    this.moveZoneRatio = 0.46;      // 화면 너비 대비 왼쪽 이동 영역 비율 (나머지는 조준)

    this.root = document.createElement('div');
    this.root.id = 'touchControls';
    this.root.className = 'touch-controls hidden';
    this.root.innerHTML = `
      <div class="touch-aim-zone" aria-hidden="true"></div>
      <div class="touch-move-zone" aria-hidden="true">
        <div class="touch-stick-base hidden">
          <div class="touch-stick-knob"></div>
        </div>
      </div>
    `;
    document.getElementById('app').appendChild(this.root);

    this.stickBase = this.root.querySelector('.touch-stick-base'); // 조이스틱 원형 베이스 DOM
    this.stickKnob = this.root.querySelector('.touch-stick-knob'); // 조이스틱 노브 DOM
    this.bindEvents();
  }

  /**
   * 터치 입력을 지원하는 기기인지 판별
   * @returns {boolean} ontouchstart 또는 maxTouchPoints > 0 이면 true
   */
  isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  /**
   * 터치 조작 UI를 제공할 환경인지 판별
   * @returns {boolean} 터치 기기이거나 뷰포트 너비가 900px 이하이면 true
   */
  shouldOffer() {
    return this.isTouchDevice() || window.innerWidth <= 900;
  }

  /**
   * 터치 조작 활성/비활성 전환
   * @param {boolean} active - true면 shouldOffer() 조건까지 만족할 때만 실제 활성화
   */
  setActive(active) {
    this.enabled = active && this.shouldOffer();
    this.root.classList.toggle('hidden', !this.enabled);
    if (!this.enabled) this.reset();
  }

  /**
   * 터치 상태·조이스틱·조준 좌표를 초기값으로 되돌림
   */
  reset() {
    this.moveTouchId = null;
    this.aimTouchId = null;
    this.moveVector = { x: 0, y: 0 };
    this.aimPos = null;
    this.stickBase.classList.add('hidden');
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
  }

  /**
   * 루트 요소에 touchstart/move/end/cancel 리스너 등록 (passive: false로 preventDefault 가능)
   */
  bindEvents() {
    const opts = { passive: false };

    this.root.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    this.root.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    this.root.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    this.root.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
  }

  /**
   * 화면 X 좌표가 이동(왼쪽) 영역에 해당하는지
   * @param {number} x - clientX
   * @returns {boolean}
   */
  isMoveZone(x) {
    return x < window.innerWidth * this.moveZoneRatio;
  }

  /**
   * 화면 X 좌표가 조준(오른쪽) 영역에 해당하는지
   * @param {number} x - clientX
   * @returns {boolean}
   */
  isAimZone(x) {
    return x >= window.innerWidth * this.moveZoneRatio;
  }

  /**
   * touchstart: 왼쪽 터치로 조이스틱 생성·이동 할당, 오른쪽 터치로 조준 할당
   * @param {TouchEvent} e
   */
  onTouchStart(e) {
    if (!this.enabled) return;

    for (const t of e.changedTouches) {
      if (this.moveTouchId === null && this.isMoveZone(t.clientX)) {
        this.moveTouchId = t.identifier;
        this.moveBase = { x: t.clientX, y: t.clientY };
        this.stickBase.classList.remove('hidden');
        this.stickBase.style.left = `${this.moveBase.x}px`;
        this.stickBase.style.top = `${this.moveBase.y}px`;
        this.updateMoveStick(t.clientX, t.clientY);
        e.preventDefault();
      } else if (this.aimTouchId === null && this.isAimZone(t.clientX)) {
        this.aimTouchId = t.identifier;
        this.aimPos = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }
  }

  /**
   * touchmove: 할당된 이동/조준 터치의 좌표를 갱신하고 기본 스크롤 동작 방지
   * @param {TouchEvent} e
   */
  onTouchMove(e) {
    if (!this.enabled) return;

    for (const t of e.changedTouches) {
      if (t.identifier === this.moveTouchId) {
        this.updateMoveStick(t.clientX, t.clientY);
        e.preventDefault();
      } else if (t.identifier === this.aimTouchId) {
        this.aimPos = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }
  }

  /**
   * touchend/touchcancel: 해당 터치 해제 시 이동 벡터·조이스틱 UI 정리 (조준 각도는 aimPos 유지)
   * @param {TouchEvent} e
   */
  onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.moveVector = { x: 0, y: 0 };
        this.stickBase.classList.add('hidden');
        this.stickKnob.style.transform = 'translate(-50%, -50%)';
      }
      if (t.identifier === this.aimTouchId) {
        this.aimTouchId = null;
        // 조준 각도 유지 (손 뗀 후에도 마지막 방향)
      }
    }
  }

  /**
   * 조이스틱 노브 위치와 정규화된 moveVector 갱신 (maxRadius 클램프, deadZone 적용)
   * @param {number} x - 현재 터치 clientX
   * @param {number} y - 현재 터치 clientY
   */
  updateMoveStick(x, y) {
    let dx = x - this.moveBase.x;
    let dy = y - this.moveBase.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxRadius) {
      dx = (dx / dist) * this.maxRadius;
      dy = (dy / dist) * this.maxRadius;
    }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const nx = dx / this.maxRadius;
    const ny = dy / this.maxRadius;
    const len = Math.hypot(nx, ny);
    if (len < this.deadZone) {
      this.moveVector = { x: 0, y: 0 };
    } else {
      this.moveVector = { x: nx / len, y: ny / len };
    }
  }

  /**
   * 정규화된 이동 방향 벡터 복사본 반환
   * @returns {{ x: number, y: number }}
   */
  getMovement() {
    return { ...this.moveVector };
  }

  /**
   * 조이스틱 입력을 키보드 WASD와 동일한 불리언 플래그로 변환
   * @returns {{ up: boolean, down: boolean, left: boolean, right: boolean }}
   */
  getKeys() {
    const m = this.moveVector;
    return {
      up: m.y < -this.deadZone,
      down: m.y > this.deadZone,
      left: m.x < -this.deadZone,
      right: m.x > this.deadZone,
    };
  }

  /**
   * 조준용 화면 좌표 (조준 터치 없으면 마우스/폴백 좌표 사용)
   * @param {number} fallbackX
   * @param {number} fallbackY
   * @returns {{ x: number, y: number }}
   */
  getAimScreenPos(fallbackX, fallbackY) {
    if (this.aimPos) return { x: this.aimPos.x, y: this.aimPos.y };
    return { x: fallbackX, y: fallbackY };
  }

  /**
   * 현재 조준 영역을 터치하고 있는지 (손을 뗀 뒤에도 aimPos는 유지될 수 있음)
   * @returns {boolean}
   */
  isAiming() {
    return this.aimTouchId !== null;
  }
}

/** 앱 전역에서 import하여 사용하는 TouchControls 싱글톤 인스턴스 */
export const touchControls = new TouchControls();
