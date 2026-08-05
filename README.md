# 센터 디펜스

WASD·터치로 이동, 조준·자동 사격으로 적을 처치하는 서바이벌 슈팅 게임입니다.  
레벨업마다 증강을 고르고, **Lv.100 최종 보스**를 처치하면 클리어합니다.

| | |
|---|---|
| **플레이** | [center-defense.vercel.app](https://center-defense.vercel.app/) |
| **솔로** | [/index.html](https://center-defense.vercel.app/) |
| **멀티 (1~4인)** | [/multi.html](https://center-defense.vercel.app/multi.html) |
| **소스** | [github.com/chj8839/center-defense](https://github.com/chj8839/center-defense) |

---

## 조작

| 입력 | 동작 |
|------|------|
| 마우스 / 오른쪽 터치 | 조준 · 자동 사격 |
| WASD · 왼쪽 조이스틱 | 이동 |

모바일은 **왼쪽 이동 + 오른쪽 조준** 멀티터치를 지원합니다.

---

## 게임 규칙

**목표** — Lv.100 보스 **최종 수호자** 처치

**흐름** — 적 처치 → EXP → 레벨업 → 증강 3택1 → (10레벨마다 보스) → 클리어

**적** — 돌진병 · 속공병 · 중갑병(Lv.2~) · 사수(Lv.3~)

**보스** — Lv.10부터 10레벨마다 등장, HP 50% 이하 Phase 2

| Lv | 보스 |
|----|------|
| 10 | 돌진 군주 |
| 20 | 포격 거인 |
| 30 | 소환 군단장 |
| 40 | 속공 재앙 |
| 50 | 중갑 요새 |
| 60 | 사격 사령관 |
| 70 | 회오리 군주 |
| 80 | 분열체 |
| 90 | 암흑 군주 |
| 100 | 최종 수호자 |

**증강** — 공격력 · 공격속도 · 탄환 속도 · 멀티샷 · 관통 · 치명타 · 최대 HP · 재생 · EXP 획득 · 이동속도 · 넉백 · 산탄 · 오비탈 (중복 선택 가능)

**기록** — 최고 레벨 · 클리어 횟수 (`localStorage`, 솔로 모드)

---

## 멀티플레이

| 항목 | 설명 |
|------|------|
| 인원 | 1~4인 |
| EXP / 레벨 / 증강 | 플레이어 개별 |
| 화면 | 각자 카메라 |
| 사망 | 해당 플레이어만 게임 오버 |

1. [multi.html](multi.html) 접속
2. 닉네임 입력 → 방 만들기 또는 4자리 코드로 참가
3. 방장이 **게임 시작**

---

## 로컬 실행

HTML을 직접 열면 실행되지 않습니다 (ES 모듈).

```bash
# 클라이언트
npx serve .
# 또는 start.bat → http://localhost:3456

# 멀티 서버 (별도 터미널)
cd server && npm install && npm start
# → ws://localhost:8080
```

---

## 프로젝트 구조

```
index.html      솔로 플레이
multi.html      멀티 플레이
js/             게임 로직 · 네트워크 · 터치 조작
server/         WebSocket 게임 서버 (Railway)
```

**배포** — 클라이언트: Vercel · 서버: Railway (**저장소 루트**에서 `npm start`, Root Directory를 `server`로 두지 마세요)  
멀티 서버 URL: `js/network-config.js` · 헬스체크: `/health`
