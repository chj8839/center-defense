/**
 * 터치·모바일 조작 UI (멀티터치)
 * - 화면 왼쪽: 가상 조이스틱으로 이동 (WASD 키 입력과 동일한 getKeys/getMovement 제공)
 * - 화면 오른쪽: 가상 조이스틱으로 조준·공격 방향 (getAimScreenPos, isAiming)
 * - setActive(true) 시 터치 기기 또는 좁은 화면(≤900px)에서만 활성화
 * - 게임 루프는 getMovement, getKeys, getAimScreenPos로 입력을 읽음
 */
export class TouchControls {
  constructor() {
    this.enabled = false;
    this.visible = false;
    this.moveTouchId = null;
    this.aimTouchId = null;
    this.moveBase = { x: 0, y: 0 };
    this.moveVector = { x: 0, y: 0 };
    this.aimBase = { x: 0, y: 0 };
    this.aimVector = { x: 1, y: 0 };
    this.aimEngaged = false;
    this.maxRadius = 52;
    this.aimReach = 220;
    this.deadZone = 0.18;
    this.moveZoneRatio = 0.46;

    this.root = document.createElement('div');
    this.root.id = 'touchControls';
    this.root.className = 'touch-controls hidden';
    this.root.innerHTML = `
      <div class="touch-aim-zone" aria-hidden="true">
        <div class="touch-stick-base touch-aim-stick-base hidden">
          <div class="touch-stick-knob touch-aim-stick-knob"></div>
        </div>
      </div>
      <div class="touch-move-zone" aria-hidden="true">
        <div class="touch-stick-base hidden">
          <div class="touch-stick-knob"></div>
        </div>
      </div>
    `;
    document.getElementById('app').appendChild(this.root);

    this.stickBase = this.root.querySelector('.touch-move-zone .touch-stick-base');
    this.stickKnob = this.root.querySelector('.touch-move-zone .touch-stick-knob');
    this.aimStickBase = this.root.querySelector('.touch-aim-stick-base');
    this.aimStickKnob = this.root.querySelector('.touch-aim-stick-knob');
    this.bindEvents();
  }

  isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  shouldOffer() {
    return this.isTouchDevice() || window.innerWidth <= 900;
  }

  setActive(active) {
    this.enabled = active && this.shouldOffer();
    this.root.classList.toggle('hidden', !this.enabled);
    if (!this.enabled) this.reset();
  }

  reset() {
    this.moveTouchId = null;
    this.aimTouchId = null;
    this.moveVector = { x: 0, y: 0 };
    this.aimVector = { x: 1, y: 0 };
    this.aimEngaged = false;
    this.hideMoveStick();
    this.hideAimStick();
  }

  hideMoveStick() {
    this.stickBase.classList.add('hidden');
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
  }

  hideAimStick() {
    this.aimStickBase.classList.add('hidden');
    this.aimStickKnob.style.transform = 'translate(-50%, -50%)';
  }

  bindEvents() {
    const opts = { passive: false };

    this.root.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    this.root.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    this.root.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    this.root.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
  }

  isMoveZone(x) {
    return x < window.innerWidth * this.moveZoneRatio;
  }

  isAimZone(x) {
    return x >= window.innerWidth * this.moveZoneRatio;
  }

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
        this.aimBase = { x: t.clientX, y: t.clientY };
        this.aimStickBase.classList.remove('hidden');
        this.aimStickBase.style.left = `${this.aimBase.x}px`;
        this.aimStickBase.style.top = `${this.aimBase.y}px`;
        this.updateAimStick(t.clientX, t.clientY);
        e.preventDefault();
      }
    }
  }

  onTouchMove(e) {
    if (!this.enabled) return;

    for (const t of e.changedTouches) {
      if (t.identifier === this.moveTouchId) {
        this.updateMoveStick(t.clientX, t.clientY);
        e.preventDefault();
      } else if (t.identifier === this.aimTouchId) {
        this.updateAimStick(t.clientX, t.clientY);
        e.preventDefault();
      }
    }
  }

  onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.moveVector = { x: 0, y: 0 };
        this.hideMoveStick();
      }
      if (t.identifier === this.aimTouchId) {
        this.aimTouchId = null;
        this.hideAimStick();
      }
    }
  }

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

  updateAimStick(x, y) {
    let dx = x - this.aimBase.x;
    let dy = y - this.aimBase.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxRadius) {
      dx = (dx / dist) * this.maxRadius;
      dy = (dy / dist) * this.maxRadius;
    }
    this.aimStickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const nx = dx / this.maxRadius;
    const ny = dy / this.maxRadius;
    const len = Math.hypot(nx, ny);
    if (len < this.deadZone) return;

    this.aimEngaged = true;
    this.aimVector = { x: nx / len, y: ny / len };
  }

  getMovement() {
    return { ...this.moveVector };
  }

  getKeys() {
    const m = this.moveVector;
    return {
      up: m.y < -this.deadZone,
      down: m.y > this.deadZone,
      left: m.x < -this.deadZone,
      right: m.x > this.deadZone,
    };
  }

  getAimScreenPos(fallbackX, fallbackY) {
    if (this.aimEngaged || this.aimTouchId !== null) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      return {
        x: cx + this.aimVector.x * this.aimReach,
        y: cy + this.aimVector.y * this.aimReach,
      };
    }
    return { x: fallbackX, y: fallbackY };
  }

  isAiming() {
    return this.aimTouchId !== null || this.aimEngaged;
  }
}

export const touchControls = new TouchControls();
