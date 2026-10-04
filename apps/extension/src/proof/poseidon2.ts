/** Poseidon2 over Goldilocks as qp-poseidon-core computes it: permutation, sponge, byte encodings. */
import { P, add, exp7, fromWord } from './goldilocks.ts';

// Port of qp-poseidon-core 3.1.0 (crates.io): the permutation of src/poseidon2.rs, the sponge of
// src/lib.rs and the two encodings of src/serialization.rs that the block-header hash uses. Line
// numbers refer to that release. Constants are copied verbatim, in the crate's spelling.

/** State width, rate and digest size, in field elements (src/poseidon2.rs:13-22). */
const WIDTH = 12;
const RATE = 8;
const OUTPUT = 4;

/** Constants of the 22 partial rounds (src/poseidon2.rs:38-61). */
const INTERNAL_CONSTANTS: readonly bigint[] = [
  0x97f7798a784ad863n,
  0xd1d2bf082f60d4f0n,
  0x69a377a79f9ad206n,
  0xa9d06906a3858e24n,
  0x295275001eede5b5n,
  0x5874e441117bd746n,
  0x8a084bbba8ed86ccn,
  0x3defd7645cde6425n,
  0x3998cfe6871cc137n,
  0x3e52ef8bca48314an,
  0x964a209f85dc9eccn,
  0x3fcc9ee82cc4577en,
  0x8e79b4a5d0096d6dn,
  0x8492362ad2392556n,
  0xee72f470262574d6n,
  0x1e0e18496da2444an,
  0x0f3a74bf215eaac6n,
  0x1b061b76a1c0ded3n,
  0x192c42d86803d7a6n,
  0xf6d49ff997ae0260n,
  0x3ec372e7a0fa3786n,
  0x5538cdf4f23445d3n,
];

/** Diagonal of the internal matrix (src/poseidon2.rs:66-79). */
const MATRIX_DIAG: readonly bigint[] = [
  0xc3b6c08e23ba9300n,
  0xd84b5de94a324fb6n,
  0x0d0c371c5b35b84fn,
  0x7964f570e7188037n,
  0x5daf18bbd996604bn,
  0x6743bc47b9595257n,
  0x5528b9362c59bb70n,
  0xac45e25b7127b68bn,
  0xa2077d7dfbb606b5n,
  0xf3faac6faee378aen,
  0x0c6388b51545e883n,
  0xd27dbb6944917b60n,
];

/** Constants of the four full rounds before the partial rounds (src/poseidon2.rs:82-139). */
const INITIAL_EXTERNAL_CONSTANTS: readonly (readonly bigint[])[] = [
  [
    0xc002e770975b1607n,
    0xbca51a8dfe14593an,
    0x72938dfbe774f7f9n,
    0xe4f2fe29e03234acn,
    0xd5e0ba2f541b6449n,
    0xec33b868f3cc46c1n,
    0x486dcb55419d475an,
    0x6c1cb2a358cc24f1n,
    0xe3f30d509a1436bbn,
    0xd9a64f068dca7c29n,
    0xe59b3f57aabba1aen,
    0x2a3dd4505b478fdcn,
  ],
  [
    0xada1f8dc7676ed25n,
    0x2711aa8b5509d516n,
    0x4ae6acd0c9c92897n,
    0x56eb3d6b5256d67an,
    0x1f7a9d55923bf51en,
    0x3600427d397a7f68n,
    0xe5076df75b72c3d0n,
    0xfcd59aa12c6090adn,
    0xcd895e8c68b57a9en,
    0x41df7ef9d730ae3en,
    0xee3e2b889abe977dn,
    0xd29bb7edbeb9c405n,
  ],
  [
    0x7d5c08eef608e382n,
    0x89ae889caaf0802cn,
    0xb35a8e976d2af617n,
    0xdb14234eafaf5173n,
    0x78f04462d48b1c98n,
    0x265293b0e47ce88an,
    0x999a649b69b9d32fn,
    0x64b0a186698e01d3n,
    0xee0b22d0dfae8bb8n,
    0x4fd53e50ca04a7een,
    0x5762bfe181f25047n,
    0xf51593e2beb5e3bdn,
  ],
  [
    0x1e5e2b5760e32477n,
    0x622462a1f9aaaeedn,
    0xaa284b3ecdb222aen,
    0x63c8e72f542bf3fcn,
    0x3ba588cacb43b5e0n,
    0x23eda6f3c99150ddn,
    0xaad3bea4baac9a5an,
    0xe9da8d699b94184an,
    0xcdb13f4cd93e024cn,
    0x902cbd0956f655e3n,
    0x5b4e40ffc759532fn,
    0xde795c20a2357af7n,
  ],
];

/** Constants of the four full rounds after the partial rounds (src/poseidon2.rs:142-199). */
const TERMINAL_EXTERNAL_CONSTANTS: readonly (readonly bigint[])[] = [
  [
    0x7b72c539e0ea4c6en,
    0x144573dae2ce9976n,
    0x802028b68f35fc88n,
    0x6d36c5022c4fe7c2n,
    0xa205d0ffa9b9def3n,
    0xf6e7e38b1ea6ba2fn,
    0x34f7909ae5258d64n,
    0xb0464d9d77b97fcan,
    0x64ddb9d5de7e00a6n,
    0x0ed0d75c27975d97n,
    0x1cbb36f11127338bn,
    0x6673e505cfd0b6ban,
  ],
  [
    0x605f902830872e01n,
    0x3fd5eb927e95fe4fn,
    0xe81025b5a24c69cdn,
    0xf7d0ce75de23f74en,
    0xf39942b6a8585089n,
    0x6d808a08f7b71df6n,
    0xf8806b6588f49a8bn,
    0x57df2d8c2a32107an,
    0x16e7c2074d654a2dn,
    0x213de241fcf33835n,
    0xb0f2b8905a0976f6n,
    0xd8e3cf2bbd355417n,
  ],
  [
    0xe498691679d9330fn,
    0x763b45d2a3821b28n,
    0x0908bf65eb0a1f0dn,
    0x7691eb2d194b24f4n,
    0x0e43551233ae13b2n,
    0x93c393dbfc2fe76fn,
    0x98f607485d48cdean,
    0xe3d95f30309819c0n,
    0x1ef581a93eaf6acfn,
    0x0b24c1b7a030fca4n,
    0x624370be5670b327n,
    0x5f1e28615a11e486n,
  ],
  [
    0xfe04051f909e042bn,
    0x7257e5b147fd3803n,
    0xe6ae134bb82f2e78n,
    0x5711fd5cf4784511n,
    0xf83a42660c08c0bcn,
    0x2cd8c96d9a3ce855n,
    0x7d2ffb1bb0e17271n,
    0x85ae1528caea3811n,
    0x52a345d5c7adb0b8n,
    0x504c4c51f3faee94n,
    0xbce34a649cfccaf9n,
    0xe0a3389266fb6dc9n,
  ],
];

/**
 * The external matrix (src/poseidon2.rs:297-330): M4 = [[2,3,1,1],[1,2,3,1],[1,1,2,3],[3,1,1,2]] on
 * each group of four elements, then every element adds the sum of the three elements at its
 * position in the groups. Sums stay unreduced until the end, as only their value mod p matters.
 */
function externalLinearLayer(s: bigint[]): void {
  for (let g = 0; g < WIDTH; g += 4) {
    const a = s[g]!;
    const b = s[g + 1]!;
    const c = s[g + 2]!;
    const d = s[g + 3]!;
    s[g] = 2n * a + 3n * b + c + d;
    s[g + 1] = a + 2n * b + 3n * c + d;
    s[g + 2] = a + b + 2n * c + 3n * d;
    s[g + 3] = 3n * a + b + c + 2n * d;
  }
  for (let k = 0; k < 4; k++) {
    const sum = s[k]! + s[k + 4]! + s[k + 8]!;
    for (let i = k; i < WIDTH; i += 4) s[i] = (s[i]! + sum) % P;
  }
}

/** The internal matrix (src/poseidon2.rs:336-344): s[i] becomes sum(s) + MATRIX_DIAG[i] * s[i]. */
function internalLinearLayer(s: bigint[]): void {
  let sum = 0n;
  for (const x of s) sum += x;
  for (let i = 0; i < WIDTH; i++) s[i] = (sum + MATRIX_DIAG[i]! * s[i]!) % P;
}

/** A full round (src/poseidon2.rs:264-276): constants and S-box on every element, then the
 * external matrix. */
function fullRound(s: bigint[], constants: readonly bigint[]): void {
  for (let i = 0; i < WIDTH; i++) s[i] = exp7(add(s[i]!, constants[i]!));
  externalLinearLayer(s);
}

/** The permutation in place (src/poseidon2.rs:244-260): the external matrix, four full rounds, 22
 * partial rounds that apply the S-box to the first element only, then four full rounds. */
function permuteInPlace(s: bigint[]): void {
  externalLinearLayer(s);
  for (const constants of INITIAL_EXTERNAL_CONSTANTS) fullRound(s, constants);
  for (const constant of INTERNAL_CONSTANTS) {
    s[0] = exp7(add(s[0]!, constant));
    internalLinearLayer(s);
  }
  for (const constants of TERMINAL_EXTERNAL_CONSTANTS) fullRound(s, constants);
}

const isElement = (x: unknown): x is bigint => typeof x === 'bigint' && x >= 0n && x < P;

/** The Poseidon2 permutation of a state of 12 field elements. */
export function permute(state: readonly bigint[]): bigint[] {
  if (state.length !== WIDTH || !state.every(isElement))
    throw new RangeError('A Poseidon2 state is 12 field elements');
  const s = [...state];
  permuteInPlace(s);
  return s;
}

/**
 * hash_to_bytes (src/lib.rs:153-157), a sponge over the permutation. Elements are added into the
 * first eight of the twelve state elements, eight at a time, after padding the input with a 1 and
 * then zeros to a whole block (src/lib.rs:71-76). The digest is the first four state elements,
 * each as 8 little-endian bytes (src/serialization.rs:308-316).
 */
export function hashToBytes(felts: readonly bigint[]): Uint8Array {
  if (!felts.every(isElement)) throw new RangeError('Not a field element');
  const input = [...felts, 1n];
  while (input.length % RATE !== 0) input.push(0n);
  const state = new Array<bigint>(WIDTH).fill(0n);
  for (let at = 0; at < input.length; at += RATE) {
    for (let i = 0; i < RATE; i++) state[i] = add(state[i]!, input[at + i]!);
    permuteInPlace(state);
  }
  const digest = new Uint8Array(8 * OUTPUT);
  const view = new DataView(digest.buffer);
  for (let i = 0; i < OUTPUT; i++) view.setBigUint64(8 * i, state[i]!, true);
  return digest;
}

/**
 * bytes_to_felts (src/serialization.rs:155-157, encoding at :187-206): each whole group of 4 bytes
 * is one little-endian element, and one last element holds the 0 to 3 remaining bytes followed by
 * a 0x01 terminator, so inputs of different lengths never encode alike.
 */
export function bytesToFelts(bytes: Uint8Array): bigint[] {
  const whole = bytes.length - (bytes.length % 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const felts: bigint[] = [];
  for (let at = 0; at < whole; at += 4) felts.push(BigInt(view.getUint32(at, true)));
  const last = new Uint8Array(4);
  last.set(bytes.subarray(whole));
  last[bytes.length - whole] = 1;
  felts.push(BigInt(new DataView(last.buffer).getUint32(0, true)));
  return felts;
}

/**
 * bytes_to_digest_lossy (src/serialization.rs:351-357): four 8-byte little-endian words, each taken
 * mod p. Not injective: a word w below 2^32 - 1 and the word w + p give the same element.
 */
export function bytesToDigestLossy(bytes: Uint8Array): bigint[] {
  if (bytes.length !== 32) throw new RangeError('A digest is 32 bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [0, 8, 16, 24].map((at) => fromWord(view.getBigUint64(at, true)));
}
