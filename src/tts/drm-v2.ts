// SPDX-License-Identifier: LGPL-3.0-only
/*! @license LGPL-3.0-only
 * Sec-MS-GEC v2 token generator.
 *
 * Derived from edge-tts, src/edge_tts/drm.py (generate_sec_ms_gec_v2),
 * https://github.com/rany2/edge-tts at commit b2ffbdd9f43f28f03cc939b5de0f3964aa62d60e.
 * Original work by rany <ranygh@riseup.net> and the edge-tts contributors
 * (the v2 token support was co-authored by HarryXiaoCN).
 *
 * Modified on 2026-10-14 by Italo Alfaro: ported from Python to TypeScript.
 *
 * This file is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Lesser General Public License version 3 as published by
 * the Free Software Foundation. It is distributed WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See LICENSES/LGPL-3.0.txt and LICENSES/GPL-3.0.txt.
 *
 * Unlike the rest of this repository (MIT), this file is LGPL-3.0-only.
 * See THIRD_PARTY_NOTICES.md.
 */

// FIPS 180-4 initial hash, plus the obfuscated state and schedule from upstream.
const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab,
  0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491,
  0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: [number, number][] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const u32 = (value: number) => value >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
const rotr = (value: number, bits: number) =>
  ((value >>> bits) | (value << (32 - bits))) >>> 0;
const rol16 = (value: number) => ((value << 16) | (value >>> 16)) >>> 0;

const sigma0 = (v: number) => u32(rotr(v, 7) ^ rotr(v, 18) ^ (v >>> 3));
const sigma1 = (v: number) => u32(rotr(v, 17) ^ rotr(v, 19) ^ (v >>> 10));

// Little-endian 32-bit words, zero-padded to an even count.
function wordsLe4Even(data: Buffer): number[] {
  const padded = Buffer.concat([
    data,
    Buffer.alloc((4 - (data.length % 4)) % 4),
  ]);
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i));
  if (words.length % 2) words.push(0);
  return words;
}

// Standard SHA-256 rounds, optionally resuming inside the first block.
function sha256Rounds(
  state: number[],
  words: number[],
  firstRound = 0,
): number[] {
  const constants =
    firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = firstRound; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = g ^ (e & (f ^ g));
    const t1 = u32(h + u32(s1) + u32(ch) + constants[i] + words[i]);
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) | (c & (a | b));
    const t2 = u32(u32(s0) + u32(maj));
    h = g;
    g = f;
    f = e;
    e = u32(d + t1);
    d = c;
    c = b;
    b = a;
    a = u32(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words: number[], firstWord = 16) {
  for (let i = firstWord; i < 64; i++) {
    words.push(
      u32(
        sigma1(words[i - 2]) +
          words[i - 7] +
          sigma0(words[i - 15]) +
          words[i - 16],
      ),
    );
  }
}

const initCache = new Map<string, number[]>();

function sha256Init(data: Buffer): number[] {
  const key = data.toString("hex");
  const cached = initCache.get(key);
  if (cached) return cached;

  const words = [
    ...Array<number>(14).fill(0),
    data.readUIntBE(0, 3),
    data.readUInt32BE(3),
  ];
  for (let i = 16; i < 30; i++) {
    let value = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) {
      value +=
        i === 16
          ? u32(sigma1(words[i - 2]) ^ SHA256_SIGMA1_ADJUSTMENT)
          : sigma1(words[i - 2]);
    }
    if (i - 7 >= 14) value += words[i - 7];
    if (i - 15 >= 14) {
      value +=
        i === 29
          ? u32(sigma0(words[i - 15]) ^ SHA256_SIGMA0_ADJUSTMENT)
          : sigma0(words[i - 15]);
    }
    words.push(u32(value));
  }
  words.push(
    u32(
      sigma1(words[28]) +
        words[23] +
        sigma0(words[15]) +
        words[14] +
        SHA256_ADJUSTMENT -
        SHA256_ROUND_CONSTANTS[14],
    ),
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  const state = SHA256_INITIAL.map((x, i) => u32(x + working[i]));

  initCache.clear();
  initCache.set(key, state);
  return state;
}

function sha256Digest(data: Buffer): Buffer {
  if (data.length < 7)
    throw new Error("Token salt must contain at least seven bytes");
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const bitLength = Buffer.alloc(8);
  bitLength.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([
    data.subarray(7),
    Buffer.from([0x80]),
    Buffer.alloc(zeros),
    bitLength,
  ]);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++)
      words.push(padded.readUInt32BE(offset + i * 4));
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((x, i) => u32(x + working[i]));
  }

  const out = Buffer.alloc(32);
  state.forEach((word, i) => out.writeUInt32BE(word, i * 4));
  return out;
}

function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  const keyA = u32(digest.readUInt32LE(0) | 1);
  const keyB = u32(digest.readUInt32LE(4) | 1);
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) =>
    mul(coefficient, factors[i % 2]),
  );
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);

  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, i) => {
    const even = i % 2 === 0;
    let term = mul(word, even ? keyA : keyB);
    let offset = mul(rol16(word), even ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term += mul(CS64_ADJUSTMENT0, factors[0]);
      offset += CS64_ADJUSTMENT1;
    }
    terms.push(u32(term));
    offsets.push(u32(offset));
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let t = rol16(u32(offsets[i] + x));
    let q = mul(t, 0x76f50f34);
    swapAcc += u32(mul(rol16(q), 0xc3efea97) + q);
    t = rol16(u32(offsets[i + 1] + y));
    q = mul(t, 0x1881ce3c);
    swapLast = u32(mul(rol16(q), 0x35bd1ec9) + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(mul(state, keyA) + x);
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc += state;
    t = u32(mul(state, keyB) + y);
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = u32(acc + state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

// Token format "<16 hex>-<64 hex>": CS64 digest, then the modified SHA-256 digest.
export function generateV2Token(ticks: string, clientToken: string): string {
  const data = Buffer.from(`${ticks}${clientToken}`, "ascii");
  const digest = sha256Digest(data);
  const [c0, c1] = cs64Digest(data, digest);
  const cs64 = Buffer.alloc(8);
  cs64.writeUInt32LE(c0, 0);
  cs64.writeUInt32LE(c1, 4);
  return `${cs64.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}
