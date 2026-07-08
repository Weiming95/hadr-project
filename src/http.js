// Real HTTP fetcher — the injected edge the pipeline talks to in production.
// Polite by default (user story 25): identifies itself, honours conditional
// GETs the caller sets, and times out rather than hanging on a slow feed.

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'hadr-monitor/0.1 (+https://github.com/; contact: operator)';

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {object} [opts.headers]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{status:number, headers:object, body:string}>}
 */
export async function httpGet(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    // 304 has no body; other statuses may or may not — read defensively.
    const body = res.status === 304 ? '' : await res.text();
    return { status: res.status, headers: Object.fromEntries(res.headers), body };
  } finally {
    clearTimeout(timer);
  }
}
