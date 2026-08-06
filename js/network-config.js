/**
 * 멀티플레이 WebSocket 서버 주소 설정
 * - URL 쿼리 ?server= 로 커스텀 서버 지정 가능
 * - Vercel(정적) + Railway(게임 서버) 분리 배포 시 자동 연결
 */

/** 현재 환경에 맞는 WebSocket URL (즉시 평가) */
export const WS_URL = (() => {
  const params = new URLSearchParams(location.search);
  const custom = params.get('server');
  if (custom) return custom;

  // 로컬 개발
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'ws://localhost:8080';
  }

  // Vercel에서 접속 → Railway 게임 서버
  if (location.hostname.includes('vercel.app')) {
    return 'wss://center-defense-production.up.railway.app';
  }

  // Railway 등 같은 호스트에서 서버+클라이언트 함께 서빙
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
})();

/** ws(s) URL을 http(s) URL로 변환 (헬스체크용) */
function wsToHttp(url) {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/**
 * 게임 서버 생존 여부 확인
 * @param {string} baseUrl - WebSocket 기준 URL
 * @returns {Promise<boolean>} /health 응답이 정상이면 true
 */
export async function verifyServer(baseUrl) {
  try {
    const httpUrl = wsToHttp(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${httpUrl}/health`, { signal: controller.signal, mode: 'cors' });
    clearTimeout(timer);
    const data = await res.json();
    return data?.ok && data?.service === 'center-defense-server';
  } catch {
    return false;
  }
}
