/** Railway 배포 후 WebSocket URL을 여기에 설정하세요 */
export const WS_URL = (() => {
  const params = new URLSearchParams(location.search);
  const custom = params.get('server');
  if (custom) return custom;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'ws://localhost:8080';
  }
  // Railway 서버 URL (배포 후 수정)
  return 'wss://center-defense-server-production.up.railway.app';
})();
