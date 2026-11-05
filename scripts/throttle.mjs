// Client-side rate limiter for the public Studionet RPC, which answers
// "Rate limit exceeded: 30 requests per minute" and then fails every call.
//
// Import this module FIRST (before genlayer-js / viem): it wraps globalThis.fetch,
// the single transport every RPC call, receipt poll and read goes through, so no
// call site has to know about it. A sliding window keeps the run under the limit
// and a response that is still rate limited is retried after a pause.
//
//   BA_RPC_PER_MINUTE   max RPC requests per window   (default 22; the server allows 30)
//   BA_RPC_WINDOW_MS    window length                 (default 60000)
//   BA_RPC_PENALTY_MS   base pause after a limit hit  (default 12000)
const LIMIT = Math.max(1, Number(process.env.BA_RPC_PER_MINUTE) || 22);
const WINDOW_MS = Number(process.env.BA_RPC_WINDOW_MS) || 60_000;
const PENALTY_MS = Number(process.env.BA_RPC_PENALTY_MS) || 12_000;
const MAX_RETRIES = 6;
const EXEMPT_HOSTS = /(^|\.)(github\.com|githubusercontent\.com)$/i;

// Codespaces / CI networks sometimes need more than Node's default 250 ms per address family to connect.
try {
  (await import("node:net")).setDefaultAutoSelectFamilyAttemptTimeout?.(4000);
} catch {
  /* older Node: ignore */
}

const rawFetch = globalThis.fetch;
const CONNECT_CODES = new Set(["ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"]);

/** True when the request never reached the server (connection could not be established), so repeating it is safe. */
function connectFailure(err, depth = 0) {
  if (!err || depth > 5) return false;
  if (CONNECT_CODES.has(err.code)) return true;
  if (Array.isArray(err.errors) && err.errors.some((e) => connectFailure(e, depth + 1))) return true;
  return connectFailure(err.cause, depth + 1);
}

async function realFetch(input, init) {
  const replayable = typeof input === "string" || input instanceof URL;
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawFetch(input, init);
    } catch (err) {
      if (!replayable || attempt >= 5 || !connectFailure(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamps = [];
let queue = Promise.resolve();

function takeSlot() {
  const job = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= WINDOW_MS) stamps.shift();
      if (stamps.length < LIMIT) {
        stamps.push(now);
        return;
      }
      await wait(stamps[0] + WINDOW_MS - now + 25);
    }
  });
  queue = job.catch(() => {});
  return job;
}

globalThis.fetch = async function throttledFetch(input, init) {
  let host = "";
  try {
    host = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url).hostname;
  } catch {
    /* leave the host empty */
  }
  if (EXEMPT_HOSTS.test(host)) return realFetch(input, init);
  const replayable = typeof input === "string" || input instanceof URL; // a Request body can be sent only once

  for (let attempt = 0; ; attempt++) {
    await takeSlot();
    const res = await realFetch(input, init);
    let limited = res.status === 429;
    if (!limited && res.ok) {
      try {
        limited = /rate limit exceeded/i.test((await res.clone().text()).slice(0, 400));
      } catch {
        /* unreadable body: treat as fine */
      }
    }
    if (!limited || !replayable || attempt >= MAX_RETRIES) return res;
    const pause = PENALTY_MS + attempt * 4000;
    process.stdout.write(`\n    (RPC rate limit hit; pausing ${Math.round(pause / 1000)}s) `);
    await wait(pause);
  }
};
