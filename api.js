/* Central client for the JARVIS backend. No credentials are ever stored here. */
(function exposeJarvisApi() {
  const DEFAULT_TIMEOUT_MS = 20_000;

  function apiBase() {
    // The Electron shell and local development server serve the UI and API from one origin.
    // A separately hosted frontend can set window.JARVIS_API_BASE before this script loads.
    return (window.JARVIS_API_BASE || '').replace(/\/$/, '');
  }

  async function request(path, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiBase()}${path}`, { ...options, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error?.message || `JARVIS request failed (${response.status})`);
        error.code = payload.error?.code || 'request_failed';
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('JARVIS took too long to respond. Please try again.');
        timeoutError.code = 'timeout';
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  window.JarvisApi = {
    health: () => request('/api/health', { headers: { Accept: 'application/json' } }, 5000),
    sendCommand(message, history = []) {
      return request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message, history })
      });
    },
    analyzeFile(file) {
      const body = new FormData();
      body.append('file', file, file.name);
      return request('/api/files/analyze', { method: 'POST', body }, 45_000);
    }
  };
})();
