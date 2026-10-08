import { createHash, randomUUID } from 'node:crypto';

// Anti-duplicate seed derivation for microstock: the same prompt from different users
// (or the same user at different times) must produce visually different output so
// contributors don't upload near-identical assets (a similarity/ban risk on stock
// platforms). We fold a per-install salt into the job seed.

let cachedSalt: number | undefined;

// A stable per-install salt, derived once from a random UUID persisted in memory.
// (Persisted per job at creation time, so reruns of the same job stay reproducible.)
export function installSalt(): number {
  if (cachedSalt === undefined) {
    cachedSalt = createHash('sha256').update(randomUUID()).digest().readUInt32LE(0);
  }
  return cachedSalt >>> 0;
}

// Combine a base seed with the salt using a large odd multiplier (Knuth) so the
// result stays a well-distributed uint32 for mulberry32.
export function saltedSeed(baseSeed: number, salt: number): number {
  return (baseSeed + Math.imul(salt >>> 0, 2654435761)) >>> 0;
}
