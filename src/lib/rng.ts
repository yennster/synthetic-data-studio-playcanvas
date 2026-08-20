/**
 * App-wide random number generator with optional seeding.
 *
 * When `?seed=12345` is set in the URL, this module returns a
 * deterministic mulberry32 sequence — so a batch capture run yields the
 * same scene jitter, the same realism noise, the same randomized poses
 * on every page load. Without `?seed`, it falls through to Math.random.
 *
 * One shared sequence — call order matters for reproducibility.
 */

/** Same shape as `Math.random` — uniform [0, 1) — but deterministic
 * when constructed with a seed. */
export type Rng = () => number;

/**
 * Mulberry32 — a 32-bit non-cryptographic PRNG; fast, with good
 * uniformity for scene jitter. The seed is the only state.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parses `?seed=` from the current URL; Math.round-ed integer or null. */
function seedFromUrl(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

let _rng: Rng | null = null;
let _seeded = false;

function ensureRng(): Rng {
  if (_rng) return _rng;
  const seed = seedFromUrl();
  _seeded = seed !== null;
  _rng = seed !== null ? mulberry32(seed) : Math.random;
  return _rng;
}

/** Returns a uniform number in [0, 1). Seeded when `?seed=N` is set. */
export function rng(): number {
  return ensureRng()();
}

/** Returns the underlying RNG function so callers can pass it to helpers. */
export function getRng(): Rng {
  return ensureRng();
}

/** True if the URL set an explicit `?seed=`. Useful for UI badges. */
export function isSeeded(): boolean {
  ensureRng();
  return _seeded;
}

/** Reset for tests. */
export function _resetRngForTest(rng?: Rng): void {
  _rng = rng ?? null;
  _seeded = false;
}
