/** SHA-512 (FIPS 180-4) for the progressive mint ticket namespace, kept in this package so that
 * the protocol code has no dependency. Its inputs are public: it is not constant time. */

// First 64 bits of the fractional parts of the cube roots of the first 80 primes (FIPS 180-4 4.2.3).
const K = /* @__PURE__ */ [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
  '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
  'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
  '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
  '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
  'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
  '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
  'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
  'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
  '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
  '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
  '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
  '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
  '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
].map((x) => BigInt('0x' + x));
// First 64 bits of the fractional parts of the square roots of the first 8 primes (5.3.5).
const IV = /* @__PURE__ */ [
  '6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1',
  '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179',
].map((x) => BigInt('0x' + x));
const MASK = (1n << 64n) - 1n;
const rotr = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & MASK;

export function sha512(data: Uint8Array): Uint8Array {
  // Padding: 0x80, zeros, then the message length in bits as a 128-bit big-endian integer.
  const blocks = Math.ceil((data.length + 17) / 128);
  const m = new Uint8Array(blocks * 128);
  m.set(data);
  m[data.length] = 0x80;
  let bits = BigInt(data.length) * 8n;
  for (let i = m.length - 1; bits > 0n; i--, bits >>= 8n) m[i] = Number(bits & 255n);
  const h = IV.slice();
  const w: bigint[] = new Array(80);
  for (let off = 0; off < m.length; off += 128) {
    for (let t = 0; t < 16; t++) {
      let v = 0n;
      for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(m[off + 8 * t + j]!);
      w[t] = v;
    }
    for (let t = 16; t < 80; t++) {
      const a = w[t - 15]!, b = w[t - 2]!;
      const s0 = rotr(a, 1n) ^ rotr(a, 8n) ^ (a >> 7n);
      const s1 = rotr(b, 19n) ^ rotr(b, 61n) ^ (b >> 6n);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) & MASK;
    }
    let [a, b, c, d, e, f, g, hh] = h as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    for (let t = 0; t < 80; t++) {
      const t1 = (hh + (rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n)) + ((e & f) ^ (~e & MASK & g)) + K[t]! + w[t]!) & MASK;
      const t2 = ((rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n)) + ((a & b) ^ (a & c) ^ (b & c))) & MASK;
      hh = g; g = f; f = e; e = (d + t1) & MASK; d = c; c = b; b = a; a = (t1 + t2) & MASK;
    }
    [a, b, c, d, e, f, g, hh].forEach((x, i) => {
      h[i] = (h[i]! + x) & MASK;
    });
  }
  const out = new Uint8Array(64);
  h.forEach((x, i) => {
    for (let j = 7; j >= 0; j--, x >>= 8n) out[8 * i + j] = Number(x & 255n);
  });
  return out;
}
