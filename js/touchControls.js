/**
 * 멀티터치 조작: 왼쪽 이동 조이스틱 + 오른쪽 조준
 */
export class TouchControls {
  constructor() {
    this.enabled = false;
    this.visible = false;
    this.moveTouchId = null;
    this.aimTouchId = null;
    this.moveBase = { x: 0, y: 0 };
    this.moveVector = { x: 0, y: 0 };
    this.aimPos = null;
    this.maxRadius = 52;
    this.deadZone = 0.18;
    this.moveZoneRatio = 0.46;

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

    this.stickBase = this.root.querySelector('.touch-stick-base');
    this.stickKnob = this.root.querySelector('.touch-stick-knob');
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
    this.aimPos = null;
    this.stickBase.classList.add('hidden');
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
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
        this.aimPos = { x: t.clientX, y: t.clientY };
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
        this.aimPos = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }
  }

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
    if (this.aimPos) return { x: this.aimPos.x, y: this.aimPos.y };
    return { x: fallbackX, y: fallbackY };
  }

  isAiming() {
    return this.aimTouchId !== null;
  }
}

export const touchControls = new TouchControls();
