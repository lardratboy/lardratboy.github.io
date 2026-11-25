/* The decoders an OpenVDB file needs, written here from the formats' own
   descriptions (no third-party code; vdb/README.md says why): zlib's inflate
   (RFC 1950 and 1951), LZ4's block format, Blosc 1's chunk (its header, its
   block starts, the split streams and the byte shuffle), and IEEE half
   floats. Pure, synchronous, no imports.

   Why not DecompressionStream, as convert/ uses for PNG: an OpenVDB file
   compresses every node's values on its own, so a grid is tens of thousands
   of buffers of 64 bytes to 2 KB. An async stream a buffer was the cost of
   the whole read, and the reader is far simpler synchronous (the next
   buffer's place is only known once this one is read).

   Every decoder takes a source range and an exact output size, and throws
   (never returns short) when the input runs out, overruns the output,
   points back before the start, or doesn't fill the output exactly: a file
   is outside input. vdb/test/codecs.test.js holds inflate to Node's zlib at
   every level and strategy, LZ4 and Blosc to buffers the real OpenVDB wrote
   (the fixtures) and to an encoder of the test's own, and each to damage. */

export class Damaged extends Error {}
const fail = msg => { throw new Damaged(msg); };

/* ---- inflate ---------------------------------------------------------------
   Canonical Huffman decoding the way RFC 1951 §3.2.2 builds the codes: a
   count of codes per length and the symbols in code order, read a bit at a
   time (the "puff" way: every code is the first `len` bits whose value falls
   in that length's range). Slower than a lookup table, but a table costs
   more to build than a 2 KB buffer costs to decode. */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// A code from code lengths: counts per length and symbols in canonical order.
// Over-subscribed sets are damage; incomplete ones are allowed (a single
// distance code is legal), and a symbol that never gets a code can't be read.
function huffman(lengths, n){
  const count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16);
  for (let s = 0; s < n; s++) count[lengths[s]]++;
  count[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++){ left <<= 1; left -= count[len]; if (left < 0) fail('inflate: an over-subscribed code'); }
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let s = 0; s < n; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}
let FIXED = null;
function fixedCodes(){
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  return (FIXED = { lit: huffman(l, 288), dist: huffman(d, 30) });
}

/* zlib-wrapped deflate (what OpenVDB's zip and Blosc's zlib both write):
   src[s0, s1) into exactly `size` bytes, written at dst[d0]. Returns the
   bytes written (always `size`). The Adler-32 at the end is checked. */
export function inflate(src, s0, s1, dst, d0, size){
  if (s1 - s0 < 6) fail('zlib: shorter than its header and check');
  const cmf = src[s0], flg = src[s0 + 1];
  if ((cmf & 15) !== 8 || (cmf >> 4) > 7) fail('zlib: not deflate');
  if (((cmf << 8) | flg) % 31) fail('zlib: a bad header check');
  if (flg & 32) fail('zlib: a preset dictionary');
  let pos = s0 + 2, bitbuf = 0, bitcnt = 0, out = d0;
  // The bit buffer is filled a byte at a time and never holds more than 7
  // bits between reads, so where the stream ends `pos` is the byte after its
  // last, and the check follows there.
  const end = d0 + size, limit = s1;
  const bits = need => {
    while (bitcnt < need){
      if (pos >= limit) fail('inflate: ran out of input');
      bitbuf |= src[pos++] << bitcnt; bitcnt += 8;
    }
    const v = bitbuf & ((1 << need) - 1);
    bitbuf >>>= need; bitcnt -= need;
    return v;
  };
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++){
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    fail('inflate: a code that isn\'t in the table');
  };
  const codes = (lit, dist) => {
    for (;;){
      let sym = decode(lit);
      if (sym < 256){ if (out >= end) fail('inflate: more bytes than the buffer holds'); dst[out++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) fail('inflate: a bad length symbol');
      const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
      const ds = decode(dist);
      if (ds >= 30) fail('inflate: a bad distance symbol');
      const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
      if (d > out - d0) fail('inflate: a distance before the start');
      if (out + len > end) fail('inflate: more bytes than the buffer holds');
      for (let i = 0; i < len; i++, out++) dst[out] = dst[out - d];
    }
  };
  const lengths = new Uint8Array(320);
  for (let last = 0; !last;){
    last = bits(1);
    const type = bits(2);
    if (type === 0){
      bitbuf = 0; bitcnt = 0;                       // to a byte boundary
      if (pos + 4 > limit) fail('inflate: a stored block runs out');
      const len = src[pos] | src[pos + 1] << 8, nlen = src[pos + 2] | src[pos + 3] << 8;
      pos += 4;
      if (len !== (~nlen & 0xffff)) fail('inflate: a stored block\'s length check');
      if (pos + len > limit) fail('inflate: a stored block runs out');
      if (out + len > end) fail('inflate: more bytes than the buffer holds');
      dst.set(src.subarray(pos, pos + len), out); pos += len; out += len;
    } else if (type === 1){
      const f = fixedCodes(); codes(f.lit, f.dist);
    } else if (type === 2){
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) fail('inflate: too many codes');
      lengths.fill(0, 0, 19);
      for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i]] = bits(3);
      const cl = huffman(lengths, 19);
      lengths.fill(0);
      for (let i = 0; i < nlen + ndist;){
        const sym = decode(cl);
        if (sym < 16){ lengths[i++] = sym; continue; }
        let rep, v = 0;
        if (sym === 16){ if (!i) fail('inflate: a repeat with nothing before it'); v = lengths[i - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nlen + ndist) fail('inflate: code lengths run over');
        while (rep--) lengths[i++] = v;
      }
      if (!lengths[256]) fail('inflate: no end-of-block code');
      const lit = huffman(lengths.subarray(0, nlen), nlen), dist = huffman(lengths.subarray(nlen, nlen + ndist), ndist);
      codes(lit, dist);
    } else fail('inflate: block type 3');
  }
  if (out !== end) fail(`inflate: ${out - d0} bytes, not ${size}`);
  // Adler-32, big-endian, after the stream.
  let a = 1, b = 0;
  for (let i = d0; i < end;){
    const stop = Math.min(end, i + 3800);
    for (; i < stop; i++){ a += dst[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  if (pos + 4 > s1) fail('zlib: no Adler-32 after the stream');
  const want = ((src[pos] << 24) | (src[pos + 1] << 16) | (src[pos + 2] << 8) | src[pos + 3]) >>> 0;
  if ((((b << 16) | a) >>> 0) !== want) fail('zlib: the Adler-32 check fails');
  return size;
}

/* ---- LZ4 ---------------------------------------------------------------------
   The block format (lz4's lz4_Block_format.md): a token (literal length in
   the high nibble, match length − 4 in the low, 15 meaning more bytes follow,
   each added until one isn't 255), the literals, a little-endian 16-bit
   offset back, and the match, which may overlap what it writes. The last
   sequence is literals alone. */
export function lz4Block(src, s0, s1, dst, d0, size){
  let s = s0, d = d0;
  const end = d0 + size;
  while (s < s1){
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15){ let b; do { if (s >= s1) fail('lz4: ran out of input'); b = src[s++]; lit += b; } while (b === 255); }
    if (s + lit > s1) fail('lz4: literals run out');
    if (d + lit > end) fail('lz4: more bytes than the buffer holds');
    dst.set(src.subarray(s, s + lit), d); s += lit; d += lit;
    if (s >= s1) break;
    if (s + 2 > s1) fail('lz4: ran out of input');
    const off = src[s] | src[s + 1] << 8; s += 2;
    if (!off || off > d - d0) fail('lz4: an offset before the start');
    let ml = token & 15;
    if (ml === 15){ let b; do { if (s >= s1) fail('lz4: ran out of input'); b = src[s++]; ml += b; } while (b === 255); }
    ml += 4;
    if (d + ml > end) fail('lz4: more bytes than the buffer holds');
    for (let i = 0; i < ml; i++, d++) dst[d] = dst[d - off];
  }
  if (d !== end) fail(`lz4: ${d - d0} bytes, not ${size}`);
  return size;
}

/* ---- Blosc 1 ---------------------------------------------------------------------
   The chunk OpenVDB's bloscToStream writes (c-blosc 1.x): 16 bytes of
   header (version, codec version, flags, type size, then uncompressed,
   block and compressed sizes as uint32), and unless the data was stored
   as is (flag 2), one int32 start a block, each block one stream or, split,
   `typesize` streams (each an int32 size then its bytes, raw when the size
   is the stream's whole length). Flag 1 is the byte shuffle (each element's
   k-th bytes together), undone after the block is decompressed. Flags' top
   three bits are the codec: LZ4 (1, what OpenVDB asks for, and LZ4HC's
   blocks are the same) and zlib (3) are read here.

   Whether a block was split isn't in older headers: newer Blosc sets flag
   0x10 when it didn't, older split whenever typesize ≤ 16 and a block held
   at least 128 elements. So the block is read the way those rules say and,
   if the streams don't fill it exactly, the other way: a wrong guess can't
   pass, since every stream must give exactly its share of the block. */
const CODECS = ['blosclz', 'lz4', 'snappy', 'zlib', 'zstd'];
export function bloscDecode(src, s0, s1, dst, d0, size){
  if (s1 - s0 < 16) fail('blosc: shorter than its header');
  const u32 = o => (src[o] | src[o + 1] << 8 | src[o + 2] << 16 | src[o + 3] << 24) >>> 0;
  const version = src[s0], flags = src[s0 + 2], ts = src[s0 + 3] || 1;
  const nbytes = u32(s0 + 4), blocksize = u32(s0 + 8), cbytes = u32(s0 + 12);
  if (version < 1 || version > 3) fail(`blosc: version ${version}`);
  if (nbytes !== size) fail(`blosc: ${nbytes} bytes inside, ${size} expected`);
  if (cbytes > s1 - s0 || cbytes < 16) fail('blosc: its length runs past the buffer');
  if (flags & 4) fail('blosc: bit shuffle (not written by OpenVDB, not read here)');
  if (!nbytes) return 0;
  if (flags & 2){
    if (cbytes < 16 + nbytes) fail('blosc: stored data runs out');
    dst.set(src.subarray(s0 + 16, s0 + 16 + nbytes), d0);
    return size;
  }
  const codec = flags >> 5, name = CODECS[codec] ?? `codec ${codec}`;
  const run = codec === 1 ? lz4Block : codec === 3 ? inflate : null;
  if (!run) fail(`blosc: the ${name} codec isn't read here (OpenVDB writes lz4)`);
  if (!blocksize) fail('blosc: a block size of 0');
  const nblocks = Math.ceil(nbytes / blocksize), leftover = nbytes % blocksize, end = s0 + cbytes;
  if (16 + 4 * nblocks > cbytes) fail('blosc: block starts run out');
  const shuffle = (flags & 1) && ts > 1, tmp = new Uint8Array(blocksize);
  const tryBlock = (from, to, bsize, splits, into) => {
    const share = bsize / splits;
    let p = from;
    for (let j = 0; j < splits; j++){
      if (p + 4 > to) return false;
      const c = (src[p] | src[p + 1] << 8 | src[p + 2] << 16 | src[p + 3] << 24); p += 4;
      if (c <= 0 || p + c > to) return false;
      if (c === share) into.set(src.subarray(p, p + c), j * share);
      else { try { run(src, p, p + c, into, j * share, share); } catch (e){ if (e instanceof Damaged) return false; throw e; } }
      p += c;
    }
    return p === to || (to === end && p <= to);
  };
  for (let i = 0; i < nblocks; i++){
    const from = s0 + u32(s0 + 16 + 4 * i), to = i + 1 < nblocks ? s0 + u32(s0 + 20 + 4 * i) : end;
    if (from < s0 + 16 + 4 * nblocks || to > end || from > to) fail('blosc: a block start out of place');
    const last = i === nblocks - 1 && leftover, bsize = last ? leftover : blocksize;
    const canSplit = !last && ts <= 16 && bsize % ts === 0 && bsize / ts >= 128 && ts > 1;
    const first = canSplit && !(flags & 0x10) ? ts : 1, other = first === 1 ? (canSplit ? ts : 0) : 1;
    const into = shuffle ? tmp : dst.subarray(d0 + i * blocksize, d0 + i * blocksize + bsize);
    if (!tryBlock(from, to, bsize, first, into) && !(other && tryBlock(from, to, bsize, other, into)))
      fail(`blosc: block ${i} doesn't decode to its ${bsize} bytes`);
    if (shuffle){
      const o = d0 + i * blocksize, q = Math.floor(bsize / ts);
      for (let j = 0; j < ts; j++) for (let k = 0; k < q; k++) dst[o + k * ts + j] = tmp[j * q + k];
      for (let k = q * ts; k < bsize; k++) dst[o + k] = tmp[k];
    }
  }
  return size;
}

/* ---- half floats --------------------------------------------------------------
   IEEE 754 binary16 to a JS number: a sign, five bits of exponent (bias 15)
   and ten of fraction; zero exponent subnormal, 31 infinity or NaN. */
const HALF = new Float32Array(65536);
for (let h = 0; h < 65536; h++){
  const s = h & 0x8000 ? -1 : 1, e = h >> 10 & 31, f = h & 1023;
  HALF[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
}
export const halfToFloat = h => HALF[h & 0xffff];
