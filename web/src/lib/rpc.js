// Client-side limiter for the public Studionet RPC ("30 requests per minute").
// It wraps window.fetch for that one host, so every read, receipt poll and gas estimate is covered.
import { CONFIG } from "../config.js";
import { createStore } from "./store.js";

export const rpcStatus = createStore({ waiting: false, pausedUntil: 0, sent: 0 });

const WINDOW_MS = 60_000;
const PENALTY_MS = 12_000;
const stamps = [];
let queue = Promise.resolve();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function takeSlot() {
  const job = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= WINDOW_MS) stamps.shift();
      if (stamps.length < CONFIG.rpcPerMinute) {
        stamps.push(now);
        rpcStatus.set({ waiting: false });
        return;
      }
      const delay = stamps[0] + WINDOW_MS - now + 25;
      rpcStatus.set({ waiting: true, pausedUntil: now + delay });
      await wait(delay);
    }
  });
  queue = job.catch(() => {});
  return job;
}

let installed = false;
export function installRpcThrottle() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const raw = window.fetch.bind(window);
  window.fetch = async function throttledFetch(input, init) {
    let url = "";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      /* unknown input type */
    }
    if (!url.startsWith(CONFIG.chain.rpc)) return raw(input, init);
    const replayable = typeof input === "string" || input instanceof URL;
    for (let attempt = 0; ; attempt++) {
      await takeSlot();
      rpcStatus.set((s) => ({ sent: s.sent + 1 }));
      const res = await raw(input, init);
      let limited = res.status === 429;
      if (!limited && res.ok) {
        try {
          limited = /rate limit exceeded/i.test((await res.clone().text()).slice(0, 300));
        } catch {
          /* unreadable body: treat as fine */
        }
      }
      if (!limited || !replayable || attempt >= 5) return res;
      const pause = PENALTY_MS + attempt * 4000;
      rpcStatus.set({ waiting: true, pausedUntil: Date.now() + pause });
      await wait(pause);
    }
  };
}
