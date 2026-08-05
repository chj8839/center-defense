/** WebSocket 서버 URL */
export const WS_URL = (() => {
  const params = new URLSearchParams(location.search);
  const custom = params.get('server');
  if (custom) return custom;

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

function wsToHttp(url) {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

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
