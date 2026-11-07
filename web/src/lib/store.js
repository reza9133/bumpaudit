// A very small observable store.
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      for (const fn of [...listeners]) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const prefs = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem("ba." + key);
      return raw === null ? fallback : raw;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem("ba." + key);
      else localStorage.setItem("ba." + key, String(value));
    } catch {
      /* storage unavailable: preferences just are not persisted */
    }
  },
};
