// Per-browser memory of studios this user hosts (tokens never leave the browser except to our API).

export interface SavedStudio {
  id: string;
  name: string;
  hostToken: string;
  guestToken: string;
  programToken: string;
  matchKey: string | null;
  createdAt: number;
}

const KEY = 'cricstudio.studios';

function safe<T>(fn: () => T, d: T): T {
  try {
    return fn();
  } catch {
    return d;
  }
}

export const studioStore = {
  all(): SavedStudio[] {
    return safe(() => JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedStudio[], []);
  },
  get(id: string): SavedStudio | undefined {
    return this.all().find((s) => s.id === id);
  },
  save(s: SavedStudio) {
    const list = this.all().filter((x) => x.id !== s.id);
    list.unshift(s);
    safe(() => localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))), undefined);
  },
  remove(id: string) {
    safe(() => localStorage.setItem(KEY, JSON.stringify(this.all().filter((s) => s.id !== id))), undefined);
  },
};

export const prefs = {
  get<T>(k: string, d: T): T {
    return safe(() => {
      const v = localStorage.getItem(`cricstudio.${k}`);
      return v === null ? d : (JSON.parse(v) as T);
    }, d);
  },
  set(k: string, v: unknown) {
    safe(() => localStorage.setItem(`cricstudio.${k}`, JSON.stringify(v)), undefined);
  },
};
