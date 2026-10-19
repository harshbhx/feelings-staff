/** ULID generator (PRD 8.1): 48-bit time + 80-bit randomness, Crockford base32, monotonic per isolate. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let t = time;
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = (ALPHABET[t % 32] as string) + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function freshRandom(): number[] {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b % 32);
}

function increment(r: number[]): number[] {
  const out = [...r];
  for (let i = out.length - 1; i >= 0; i--) {
    const v = out[i] as number;
    if (v < 31) {
      out[i] = v + 1;
      return out;
    }
    out[i] = 0;
  }
  return freshRandom();
}

/** New ULID. Pass the request clock's `now` so IDs sort with the fake clock in tests. */
export function ulid(now: number = Date.now()): string {
  if (now <= lastTime && lastRandom.length === 16) {
    lastRandom = increment(lastRandom);
  } else {
    lastTime = now;
    lastRandom = freshRandom();
  }
  return encodeTime(Math.max(now, lastTime)) + lastRandom.map((v) => ALPHABET[v]).join('');
}
