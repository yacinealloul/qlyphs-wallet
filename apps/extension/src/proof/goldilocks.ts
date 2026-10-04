/** Goldilocks prime field (p = 2^64 - 2^32 + 1), the arithmetic of the Quantus Poseidon2 hash. */

// Port of qp-poseidon-core 3.1.0 (crates.io), src/goldilocks.rs. The crate stores an element as any
// 64-bit word, reduced or not, and folds every carry and borrow back modulo p, so each of its
// operations is exact modulo p. Here an element is a bigint in [0, p) and every result is reduced:
// the canonical values, which are all the hash ever outputs, are the same.

/** The modulus (src/goldilocks.rs:51). */
export const P = 0xffff_ffff_0000_0001n;

const WORD_MAX = 0xffff_ffff_ffff_ffffn;

/** The element a 64-bit word stands for. The crate takes any word as an element (src/goldilocks.rs:78)
 * and a word in [p, 2^64) stands for word - p (src/goldilocks.rs:90). */
export function fromWord(word: bigint): bigint {
  if (word < 0n || word > WORD_MAX) throw new RangeError('Not a 64-bit word');
  return word >= P ? word - P : word;
}

/** a + b for elements a and b. */
export function add(a: bigint, b: bigint): bigint {
  const sum = a + b;
  return sum >= P ? sum - P : sum;
}

/** a * b for elements a and b. */
export const mul = (a: bigint, b: bigint): bigint => (a * b) % P;

/** The Poseidon2 S-box x^7, as x^3 * x^4 (src/goldilocks.rs:131). */
export function exp7(x: bigint): bigint {
  const x2 = mul(x, x);
  return mul(mul(x2, x), mul(x2, x2));
}
