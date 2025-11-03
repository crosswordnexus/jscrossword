/**
 * puz-js -- JS port of puzpy
 * License: MIT
 */

import {
  xwGrid
} from "../grid.js";

////////////////////////
// Constants & Enums  //
////////////////////////

const ENCODING_LATIN1 = 'iso-8859-1';
const ENCODING_UTF8 = 'utf-8';
const ENCODING_ERRORS = 'fatal'; // throw on bad chars (closest to Python 'strict')

const ACROSSDOWN = 'ACROSS&DOWN';

const BLACKSQUARE = '.';
const BLACKSQUARE2 = ':';
const BLANKSQUARE = '-';

const MASKSTRING = 'ICHEATED';

const PuzzleType = Object.freeze({
  Normal: 0x0001,
  Diagramless: 0x0401,
});

const SolutionState = Object.freeze({
  Unlocked: 0x0000,
  NotProvided: 0x0002,
  Locked: 0x0004,
});

const GridMarkup = Object.freeze({
  Default: 0x00,
  PreviouslyIncorrect: 0x10,
  Incorrect: 0x20,
  Revealed: 0x40,
  Circled: 0x80,
});

const Extensions = Object.freeze({
  Rebus: 'GRBS', // bytes(4)
  RebusSolutions: 'RTBL',
  RebusFill: 'RUSR',
  Timer: 'LTIM',
  Markup: 'GEXT',
});

////////////////////////
// Utility: encoding  //
////////////////////////

const decoders = new Map();

function getDecoder(label) {
  const key = label.toLowerCase();
  if (!decoders.has(key)) decoders.set(key, new TextDecoder(label, {
    fatal: ENCODING_ERRORS === 'fatal'
  }));
  return decoders.get(key);
}
const utf8Encoder = new TextEncoder(); // utf-8 only
function encodeText(s, encoding) {
  if ((encoding || '').toLowerCase() === ENCODING_LATIN1) {
    // TextEncoder doesn't support latin1. Polyfill simple mapping:
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }
  return utf8Encoder.encode(s);
}

function decodeBytes(bytes, encoding) {
  const label = (encoding || ENCODING_LATIN1).toLowerCase();
  if (label === ENCODING_LATIN1) {
    // latin1 passthrough
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  return getDecoder(label).decode(bytes);
}

////////////////////////
// Binary I/O helper  //
////////////////////////

class Cursor {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    this.pos = 0;
  }
  canRead(n = 1) {
    return this.pos + n <= this.bytes.length;
  }
  slice(n) {
    const s = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
  readU8() {
    return this.slice(1)[0];
  }
  readU16() {
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 2);
    const v = dv.getUint16(0, true);
    this.pos += 2;
    return v;
  }
  readU32() {
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
    const v = dv.getUint32(0, true);
    this.pos += 4;
    return v;
  }
  readU64() { // as BigInt
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8);
    const lo = dv.getUint32(0, true);
    const hi = dv.getUint32(4, true);
    this.pos += 8;
    return (BigInt(hi) << 32n) | BigInt(lo);
  }
  findBytes(needle) {
    const n = typeof needle === 'string' ? encodeASCII(needle) : needle;
    for (let i = this.pos; i + n.length <= this.bytes.length; i++) {
      let ok = true;
      for (let j = 0; j < n.length; j++)
        if (this.bytes[i + j] !== n[j]) {
          ok = false;
          break;
        }
      if (ok) return i;
    }
    return -1;
  }
  readCString(encoding) {
    let end = this.pos;
    while (end < this.bytes.length && this.bytes[end] !== 0) end++;
    const s = decodeBytes(this.bytes.subarray(this.pos, end), encoding);
    this.pos = Math.min(end + 1, this.bytes.length);
    return s;
  }
}

class Builder {
  constructor() {
    this.chunks = [];
    this.size = 0;
  }
  pushBytes(u8) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    this.chunks.push(u8);
    this.size += u8.length;
  }
  pushU8(v) {
    this.pushBytes(U8([v]));
  }
  pushU16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.pushBytes(b);
  }
  pushU32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.pushBytes(b);
  }
  pushU64(vBig) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    const v = BigInt(vBig);
    dv.setUint32(0, Number(v & 0xffffffffn), true);
    dv.setUint32(4, Number((v >> 32n) & 0xffffffffn), true);
    this.pushBytes(b);
  }
  pushCString(s, encoding) {
    this.pushBytes(encodeText(s, encoding));
    this.pushU8(0);
  }
  toUint8Array() {
    const out = new Uint8Array(this.size);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

//////////////////////////////
// Small byte helpers       //
//////////////////////////////

const U8 = (arr) => new Uint8Array(arr);
const encodeASCII = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7F;
  return out;
};

////////////////////////
// Checksums & masks  //
////////////////////////

// data_cksum (Python port)
function dataCksum(data, seed = 0) {
  let cksum = seed & 0xffff;
  for (let b of data) {
    if (typeof b === 'string') b = b.charCodeAt(0);
    const lowbit = cksum & 0x0001;
    cksum = (cksum >>> 1);
    if (lowbit) cksum |= 0x8000;
    cksum = (cksum + (b & 0xff)) & 0xffff;
  }
  return cksum;
}

////////////////////////
// Core Puzzle class  //
////////////////////////

export class PuzzleFormatError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'PuzzleFormatError';
  }
}

export class Puzzle {
  constructor(version = '1.3') {
    this.preamble = U8([]);
    this.postscript = U8([]);
    this.title = '';
    this.author = '';
    this.copyright = '';
    this.width = 0;
    this.height = 0;
    this.version = toBytesVersion(version); // e.g. '1.3' -> bytes
    this.fileversion = concatBytes(this.version, U8([0]));
    this.encoding = ENCODING_LATIN1;

    this.unk1 = U8([0, 0]);
    this.unk2 = U8(new Array(12).fill(0));
    this.scrambled_cksum = 0;

    this.fill = '';
    this.solution = '';
    this.clues = [];
    this.notes = '';
    this.extensions = new Map(); // key: 4-char string, value: Uint8Array
    this._extensionsOrder = [];
    this.puzzletype = PuzzleType.Normal;
    this.solution_state = SolutionState.Unlocked;
    this.helpers = {}; // rebus/markup/numbering caches
  }

  // ----- Loading -----

  static load(bytes, options = {}) {
    const p = new Puzzle();
    p.load(bytes, options);
    return p;
  }

  load(bytes, options = {}) {

    const { lockedHandling = "allow", maskChar = "X" } = options;

    const cur = new Cursor(bytes);

    // Seek to ACROSS&DOWN (with -2 offset in Python). Here we seek and then step back 2 if possible.
    const anchor = cur.findBytes(ACROSSDOWN);
    if (anchor < 0) throw new PuzzleFormatError('Data does not appear to represent a puzzle.');
    cur.pos = Math.max(0, anchor - 2);
    this.preamble = (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).subarray(0, cur.pos);

    // HEADER_FORMAT (packed fields, mirrored from Python)
    // < H 11s xH Q 4s 2s H 12s BBH H H
    // Weâ€™ll read piecemeal in order, little-endian.
    const cksum_gbl = cur.readU16();
    cur.pos += 11; // 11s (unused here); next is xH (skip 1), then H
    cur.pos += 1;
    const cksum_hdr = cur.readU16();
    const cksum_magic = cur.readU64(); // Q
    const filever = cur.slice(4); // 4s
    const unk1 = cur.slice(2); // 2s
    const scrambled = cur.readU16(); // H
    const unk2 = cur.slice(12); // 12s
    const width = cur.readU8(); // B
    const height = cur.readU8(); // B
    const numclues = cur.readU16(); // H
    const puzzletype = cur.readU16(); // H
    const solstate = cur.readU16(); // H

    this.fileversion = concatBytes(filever, U8([0])); // keep trailing \0 for round-trip
    this.version = filever.subarray(0, 3); // first 3 bytes
    this.unk1 = unk1;
    this.scrambled_cksum = scrambled;
    this.unk2 = unk2;
    this.width = width;
    this.height = height;
    this.puzzletype = puzzletype;
    this.solution_state = solstate;

    // Encoding: version < 2 -> latin1, else utf-8
    const vt = this.versionTuple();
    this.encoding = (vt[0] < 2) ? ENCODING_LATIN1 : ENCODING_UTF8;

    const gridCells = width * height;
    this.solution = decodeBytes(cur.slice(gridCells), this.encoding);
    this.fill = decodeBytes(cur.slice(gridCells), this.encoding);

    // deal with locked puzzles
    if (this.solution_state !== SolutionState.Unlocked) {
      if (lockedHandling === "mask") {
        this.solution = this.solution.replace(/[^\:\.\-]/g, maskChar);
      } else if (lockedHandling === "bruteforce") {
        // attempt to brute-force unlock
        this.bruteForceUnlock();
      } else { // the default is to keep as-is
        // keep scrambled solution as-is (default)
      }
    }

    this.title = cur.readCString(this.encoding);
    this.author = cur.readCString(this.encoding);
    this.copyright = cur.readCString(this.encoding);

    this.clues = new Array(numclues);
    for (let i = 0; i < numclues; i++) this.clues[i] = cur.readCString(this.encoding);
    this.notes = cur.readCString(this.encoding);

    // Extensions
    const extChecks = new Map();
    while (cur.canRead(4 + 2 + 2)) {
      const code = decodeBytes(cur.slice(4), ENCODING_LATIN1);
      const len = cur.readU16();
      const cks = cur.readU16();
      if (!cur.canRead(len + 1)) { // if not enough left, break (avoid false parse)
        // rewind the header we just read and stop scanning extensions
        cur.pos -= (4 + 2 + 2);
        break;
      }
      const payload = cur.slice(len);
      const trailing = cur.readU8(); // trailing byte
      this.extensions.set(code, payload);
      this._extensionsOrder.push(code);
      extChecks.set(code, cks);
    }

    if (cur.canRead(1)) this.postscript = cur.slice(cur.bytes.length - cur.pos);

    // Don't bother validating checksums
    /**
    if (cksum_gbl !== this.globalCksum()) throw new PuzzleFormatError('global checksum does not match');
    if (cksum_hdr !== this.headerCksum()) throw new PuzzleFormatError('header checksum does not match');
    //if (cksum_magic !== this.magicCksum()) throw new PuzzleFormatError('magic checksum does not match');
    for (const [code, expected] of extChecks) {
      const got = dataCksum(this.extensions.get(code));
      if (got !== expected) throw new PuzzleFormatError(`extension ${code} checksum does not match`);
    }
    **/
  }

  // ----- Saving -----

  tobytes() {
    // let helpers persist changes
    if (this.helpers.rebus?.save) this.helpers.rebus.save();
    if (this.helpers.markup?.save) this.helpers.markup.save();

    const b = new Builder();
    b.pushBytes(this.preamble);

    // Header (recompute checksums)
    b.pushU16(this.globalCksum());
    b.pushBytes(encodeASCII(ACROSSDOWN));
    b.pushU8(0); // pad to match Python's struct layout pre-header? (equivalent to x before H)
    b.pushU16(this.headerCksum());
    b.pushU64(this.magicCksum());
    b.pushBytes(this.fileversion.subarray(0, 4)); // 4s (without extra \0)
    b.pushBytes(this.unk1);
    b.pushU16(this.scrambled_cksum);
    b.pushBytes(this.unk2);
    b.pushU8(this.width);
    b.pushU8(this.height);
    b.pushU16(this.clues.length);
    b.pushU16(this.puzzletype);
    b.pushU16(this.solution_state);

    b.pushBytes(encodeText(this.solution, this.encoding));
    b.pushBytes(encodeText(this.fill, this.encoding));

    b.pushCString(this.title, this.encoding);
    b.pushCString(this.author, this.encoding);
    b.pushCString(this.copyright, this.encoding);

    for (const clue of this.clues) b.pushBytes(encodeText(clue || '', this.encoding)); // no trailing nulls per-field
    // notes included as zstring for >=1.3 during text cksum, but here we roundtrip as in Python:
    b.pushCString(this.notes || '', this.encoding);

    // Extensions in recorded order first
    const ext = new Map(this.extensions);
    for (const code of this._extensionsOrder) {
      if (!ext.has(code)) continue;
      const data = ext.get(code);
      b.pushBytes(encodeASCII(code));
      b.pushU16(data.length);
      b.pushU16(dataCksum(data));
      b.pushBytes(data);
      b.pushU8(0);
      ext.delete(code);
    }
    // Any new/unordered
    for (const [code, data] of ext) {
      b.pushBytes(encodeASCII(code));
      b.pushU16(data.length);
      b.pushU16(dataCksum(data));
      b.pushBytes(data);
      b.pushU8(0);
    }

    // Postscript (bytes). If accidentally a string, encode.
    if (typeof this.postscript === 'string') {
      b.pushBytes(encodeText(this.postscript, this.encoding));
    } else {
      b.pushBytes(this.postscript || U8([]));
    }

    return b.toUint8Array();
  }

  saveToFileSystem(fsWriteFn, filename) {
    // Optional convenience for Node: fsWriteFn should accept (filename, Uint8Array)
    fsWriteFn(filename, this.tobytes());
  }

  // ----- Encoding helpers -----

  encode(s) {
    return encodeText(s, this.encoding);
  }
  encodeZ(s) {
    const u = this.encode(s);
    const out = new Uint8Array(u.length + 1);
    out.set(u);
    out[u.length] = 0;
    return out;
  }

  versionTuple() {
    const s = decodeBytes(this.version, ENCODING_LATIN1);
    return s.split('.').map(x => parseInt(x, 10));
  }
  setVersion(vstr) {
    this.version = toBytesVersion(vstr);
    this.fileversion = concatBytes(this.version, U8([0]));
  }

  blacksquare() {
    return this.puzzletype === PuzzleType.Diagramless ? BLACKSQUARE2 : BLACKSQUARE;
  }
  isSolutionLocked() {
    return this.solution_state === SolutionState.Locked;
  }

  unlockSolution(key) {
    if (!this.isSolutionLocked()) return true;
    const unscrambled = unscrambleSolution(this.solution, this.width, this.height, key, this.blacksquare());
    if (!this.checkAnswers(unscrambled)) return false;
    this.solution = unscrambled;
    this.scrambled_cksum = 0;
    this.solution_state = SolutionState.Unlocked;
    return true;
  }

  /**
  * Attempt a brute-force unlock
  * Note that this won't always work as written
  * TODO: make it always work
  **/
  bruteForceUnlock() {
    if (!this.isSolutionLocked()) return true;
    for (var key = 1000; key < 10000; key++) {
      if (this.unlockSolution(key)) {
        console.log(`Solution unlocked with key ${key}`);
        return true;
      }
    }
    return false;
  }

  lockSolution(key) {
    if (this.isSolutionLocked()) return;
    this.scrambled_cksum = scrambledCksum(this.solution, this.width, this.height, this.blacksquare(), this.encoding);
    this.solution_state = SolutionState.Locked;
    this.solution = scrambleSolution(this.solution, this.width, this.height, key, this.blacksquare());
  }

  checkAnswers(fill) {
    if (this.isSolutionLocked()) {
      const scr = scrambledCksum(fill, this.width, this.height, this.blacksquare(), this.encoding);
      return scr === this.scrambled_cksum;
    }
    return fill === this.solution;
  }

  // ----- Checksums -----

  headerCksum(seed = 0) {
    // struct HEADER_CKSUM_FORMAT = '<BBH H H ' -> width(B), height(B), numclues(H), puzzletype(H), solution_state(H)
    const b = new Builder();
    b.pushU8(this.width);
    b.pushU8(this.height);
    b.pushU16(this.clues.length);
    b.pushU16(this.puzzletype);
    b.pushU16(this.solution_state);
    return dataCksum(b.toUint8Array(), seed);
  }

  textCksum(seed = 0) {
    let c = seed;
    if (this.title) c = dataCksum(this.encodeZ(this.title), c);
    if (this.author) c = dataCksum(this.encodeZ(this.author), c);
    if (this.copyright) c = dataCksum(this.encodeZ(this.copyright), c);
    for (const clue of this.clues)
      if (clue) c = dataCksum(this.encode(clue), c);
    const vt = this.versionTuple();
    if ((vt[0] > 1 || (vt[0] === 1 && vt[1] >= 3)) && this.notes) c = dataCksum(this.encodeZ(this.notes), c);
    return c;
  }

  globalCksum() {
    let c = this.headerCksum();
    c = dataCksum(this.encode(this.solution), c);
    c = dataCksum(this.encode(this.fill), c);
    c = this.textCksum(c);
    return c;
  }

  magicCksum() {
    const parts = [
      this.headerCksum(),
      dataCksum(this.encode(this.solution)),
      dataCksum(this.encode(this.fill)),
      this.textCksum(),
    ];
    let magic = 0n;
    for (let i = parts.length - 1, j = 0; i >= 0; i--, j++) {
      const c = parts[i];
      magic = (magic << 8n) | BigInt(MASKSTRING[j].charCodeAt(0) ^ (c & 0xff));
      magic = magic | (BigInt(MASKSTRING[j + 4].charCodeAt(0) ^ ((c >> 8) & 0xff)) << 32n);
    }
    return magic;
  }

  // ----- Helpers -----

  hasRebus() {
    return this.rebus().hasRebus();
  }
  rebus() {
    if (!this.helpers.rebus) this.helpers.rebus = new Rebus(this);
    return this.helpers.rebus;
  }
  hasMarkup() {
    return this.markup().hasMarkup();
  }
  markup() {
    if (!this.helpers.markup) this.helpers.markup = new Markup(this);
    return this.helpers.markup;
  }

  clueNumbering() {
    if (!this.helpers.clues) this.helpers.clues = new DefaultClueNumbering(this.fill, this.clues, this.width, this.height);
    return this.helpers.clues;
  }

  toTextFormat(textVersion = 'v1') {
    const TAB = '\t';
    const lines = [];
    if (textVersion === 'v1') lines.push('<ACROSS PUZZLE>');
    else if (textVersion) lines.push(`<ACROSS PUZZLE ${textVersion}>`);
    else throw new Error('invalid textVersion');

    lines.push('<TITLE>');
    lines.push(TAB + (this.title || ''));
    lines.push('<AUTHOR>');
    lines.push(TAB + (this.author || ''));
    lines.push('<COPYRIGHT>');
    lines.push(TAB + (this.copyright || ''));
    lines.push('<SIZE>');
    lines.push(TAB + `${this.width}x${this.height}`);
    lines.push('<GRID>');
    for (let r = 0; r < this.height; r++) {
      const row = this.solution.slice(r * this.width, (r + 1) * this.width);
      lines.push(TAB + row);
    }

    const numbering = this.clueNumbering();
    lines.push('<ACROSS>');
    for (const clue of numbering.across) lines.push(TAB + (clue.clue || ''));
    lines.push('<DOWN>');
    for (const clue of numbering.down) lines.push(TAB + (clue.clue || ''));
    lines.push('<NOTEPAD>');
    lines.push(this.notes || '');
    return lines.join('\n');
  }
}

////////////////////////
// Rebus & Markup     //
////////////////////////

class Rebus {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.fill = {};
    this.solutions = {};
    this.table = new Array(puzzle.width * puzzle.height).fill(0);

    // parse table
    if (puzzle.extensions.has(Extensions.Rebus)) {
      this.table = parseBytes(puzzle.extensions.get(Extensions.Rebus));
    }
    if (puzzle.extensions.has(Extensions.RebusSolutions)) {
      const s = decodeBytes(puzzle.extensions.get(Extensions.RebusSolutions), puzzle.encoding);
      const m = parseDict(s);
      for (const [k, v] of Object.entries(m)) this.solutions[parseInt(k, 10)] = v;
    }
    if (puzzle.extensions.has(Extensions.RebusFill)) {
      const s = decodeBytes(puzzle.extensions.get(Extensions.RebusFill), puzzle.encoding);
      const m = parseDict(s);
      for (const [k, v] of Object.entries(m)) this.fill[parseInt(k, 10)] = v;
    }
  }
  hasRebus() {
    return this.puzzle.extensions.has(Extensions.Rebus) || this.table.some(Boolean);
  }
  isRebusSquare(idx) {
    return !!this.table[idx];
  }
  getRebusSquares() {
    return this.table.map((v, i) => v ? i : -1).filter(i => i >= 0);
  }
  getRebusSolution(idx) {
    return this.isRebusSquare(idx) ? this.solutions[this.table[idx] - 1] : null;
  }
  getRebusFill(idx) {
    return this.isRebusSquare(idx) ? this.fill[this.table[idx] - 1] : null;
  }
  setRebusFill(idx, value) {
    if (this.isRebusSquare(idx)) this.fill[this.table[idx] - 1] = value;
  }
  save() {
    if (!this.hasRebus()) return;
    this.puzzle.extensions.set(Extensions.Rebus, packBytes(this.table));
    this.puzzle.extensions.set(Extensions.RebusSolutions, encodeText(dictToString(this.solutions), this.puzzle.encoding));
    this.puzzle.extensions.set(Extensions.RebusFill, encodeText(dictToString(this.fill), this.puzzle.encoding));
  }
}

class Markup {
  constructor(puzzle) {
    this.puzzle = puzzle;
    const payload = puzzle.extensions.get(Extensions.Markup) || U8([]);
    this.markup = parseBytes(payload);
  }
  hasMarkup() {
    return this.markup.some(b => !!b);
  }
  getMarkupSquares() {
    return this.markup.map((v, i) => v ? i : -1).filter(i => i >= 0);
  }
  isMarkupSquare(i) {
    return !!this.markup[i];
  }
  save() {
    if (this.hasMarkup()) this.puzzle.extensions.set(Extensions.Markup, packBytes(this.markup));
  }
}

////////////////////////
// Grid & numbering   //
////////////////////////

export function getGridNumbering(grid, width, height) {
  const isBlack = (ch) => isBlacksquare(ch);
  const col = (i) => i % width;
  const row = (i) => Math.floor(i / width);
  const lenAcross = (i) => {
    let c = 0;
    for (; c < width - col(i); c++)
      if (isBlack(grid[i + c])) return c;
    return c;
  };
  const lenDown = (i) => {
    let c = 0;
    for (; c < height - row(i); c++)
      if (isBlack(grid[i + c * width])) return c;
    return c;
  };

  const a = [],
    d = [];
  let clueIndex = 0,
    num = 1;
  for (let i = 0; i < grid.length; i++) {
    if (!isBlack(grid[i])) {
      const wasClueIndex = clueIndex;
      const acrossStart = (col(i) === 0) || isBlack(grid[i - 1]);
      if (acrossStart && lenAcross(i) > 1) {
        a.push({
          num,
          clue: null,
          clue_index: clueIndex,
          cell: i,
          row: row(i),
          col: col(i),
          len: lenAcross(i),
          dir: 'across'
        });
        clueIndex++;
      }
      const downStart = (row(i) === 0) || isBlack(grid[i - width]);
      if (downStart && lenDown(i) > 1) {
        d.push({
          num,
          clue: null,
          clue_index: clueIndex,
          cell: i,
          row: row(i),
          col: col(i),
          len: lenDown(i),
          dir: 'down'
        });
        clueIndex++;
      }
      if (clueIndex > wasClueIndex) num++;
    }
  }
  return [a, d];
}

export class DefaultClueNumbering {
  constructor(grid, clues, width, height) {
    this.grid = grid;
    this.clues = clues;
    this.width = width;
    this.height = height;
    const [a, d] = getGridNumbering(grid, width, height);
    this.across = a;
    this.down = d;
    for (const e of this.across) e.clue = clues[e.clue_index];
    for (const e of this.down) e.clue = clues[e.clue_index];
  }
}

export class Grid {
  constructor(gridString, width, height) {
    this.grid = gridString;
    this.width = width;
    this.height = height;
    if (this.grid.length !== width * height) throw new Error('grid length mismatch');
  }
  getCell(row, col) {
    return this.grid[this.getCellIndex(row, col)];
  }
  getCellIndex(row, col) {
    return row * this.width + col;
  }
  getRange(row, col, len, dir = 'across') {
    return dir === 'across' ? this.getRangeAcross(row, col, len) : this.getRangeDown(row, col, len);
  }
  getRangeAcross(row, col, len) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(this.grid[this.getCellIndex(row, col + i)]);
    return out;
  }
  getRangeDown(row, col, len) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(this.grid[this.getCellIndex(row + i, col)]);
    return out;
  }
  getRangeForClue(clue) {
    return this.getRange(clue.row, clue.col, clue.len, clue.dir);
  }
  getRow(row) {
    return this.getRangeAcross(row, 0, this.width);
  }
  getColumn(col) {
    return this.getRangeDown(0, col, this.height);
  }
  getString(row, col, len, dir = 'across') {
    return this.getRange(row, col, len, dir).join('');
  }
  getStringAcross(row, col, len) {
    return this.getRangeAcross(row, col, len).join('');
  }
  getStringDown(row, col, len) {
    return this.getRangeDown(row, col, len).join('');
  }
  getStringForClue(clue) {
    return this.getRangeForClue(clue).join('');
  }
}

////////////////////////
// Scramble helpers   //
////////////////////////

function replaceChars(s, chars, replacement = '') {
  let out = s;
  for (const ch of chars) out = out.split(ch).join(replacement);
  return out;
}

function keyDigits(key) {
  return String(key).padStart(4, '0').split('').map(d => parseInt(d, 10));
}

function square(data, w, h) {
  // column-major order conversion (same as Python)
  const rows = [];
  for (let i = 0; i < data.length; i += w) rows.push(data.slice(i, i + w));
  let out = '';
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) out += rows[r][c];
  }
  return out;
}

// normalized modulo helper
function mod(n, m) {
  return ((n % m) + m) % m;
}

function shift(s, keyArr) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const AL = A.length;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const idx = A.indexOf(c);
    if (idx < 0) {
      out += c;
      continue;
    }
    const k = keyArr[i % keyArr.length];
    const newIdx = mod(idx + k, AL);
    out += A[newIdx];
  }
  return out;
}

function unshiftStr(s, keyArr) {
  // map key to negatives, but shift() now handles negatives correctly
  return shift(s, keyArr.map(k => -k));
}

function shuffleDeck(s) {
  const mid = Math.floor(s.length / 2);
  let items = '';
  for (let i = 0; i < mid; i++) items += s[mid + i] + s[i];
  if (s.length % 2) items += s[s.length - 1];
  return items;
}

function unshuffleDeck(s) {
  return s.slice(1).split('').filter((_, i) => i % 2 === 0).join('') + s.split('').filter((_, i) => i % 2 === 0).join('');
}
// The above â€œunshuffleDeckâ€ mirrors Pythonâ€™s unshuffle: s[1::2] + s[::2]
function unshuffleExact(s) {
  return s.slice(1).split('').filter((_, i) => i % 2 === 0).join('') + s.split('').filter((_, i) => i % 2 === 0).join('');
}

function unshufflePython(s) {
  return s.slice(1).split('').filter((_, i) => i % 1 === 0);
} // placeholder

function scrambleString(s, key) {
  const k = keyDigits(key);
  for (const digit of k) {
    s = shift(s, k);
    s = s.slice(digit) + s.slice(0, digit);
    s = shuffleDeck(s);
  }
  return s;
}

function unscrambleString(s, key) {
  const k = keyDigits(key);
  const L = s.length;
  for (let i = k.length - 1; i >= 0; i--) {
    s = unshuffle(s); // exact inverse of shuffleDeck
    const digit = k[i];
    s = s.slice(L - digit) + s.slice(0, L - digit);
    s = unshiftStr(s, k);
  }
  return s;
}

// exact Python unshuffle(s): s[1::2] + s[::2]
function unshuffle(s) {
  return s.split('').filter((_, i) => i % 2 === 1).join('') + s.split('').filter((_, i) => i % 2 === 0).join('');
}

function restore(src, tgt) {
  // Replace non-black squares in src with subsequent chars from tgt
  let j = 0;
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!isBlacksquare(c)) {
      out += tgt[j++];
    } else out += c;
  }
  return out;
}

export function scrambleSolution(solution, width, height, key, ignoreChars = BLACKSQUARE) {
  const sq = square(solution, width, height);
  const data = restore(sq, scrambleString(replaceChars(sq, ignoreChars), key));
  return square(data, height, width);
}
export function unscrambleSolution(scrambled, width, height, key, ignoreChars = BLACKSQUARE) {
  const sq = square(scrambled, width, height);
  const data = restore(sq, unscrambleString(replaceChars(sq, ignoreChars), key));
  return square(data, height, width);
}
export function scrambledCksum(scrambled, width, height, ignoreChars = BLACKSQUARE, encoding = ENCODING_LATIN1) {
  const data = replaceChars(square(scrambled, width, height), ignoreChars);
  return dataCksum(encodeText(data, encoding));
}

export function isBlacksquare(c) {
  return c === BLACKSQUARE || c === BLACKSQUARE2;
}

////////////////////////
// Dict & bytes utils //
////////////////////////

export function parseBytes(u8) {
  return Array.from(u8);
}
export function packBytes(a) {
  return U8(a);
}

export function parseDict(s) {
  const out = {};
  for (const part of s.split(';')) {
    if (!part) continue;
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1);
    out[k] = v;
  }
  return out;
}
export function dictToString(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(';') + ';';
}

function toBytesVersion(version) {
  const s = typeof version === 'string' ? version : String(version);
  const u = encodeASCII(s);
  const out = new Uint8Array(3);
  out.set(u.subarray(0, 3));
  return out;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/////////////////////////////
// Across Lite TXT support //
/////////////////////////////

export function textFileAsDict(s) {
  const d = {};
  let k = null;
  let v = [];
  for (const lineRaw of s.split(/\r?\n/)) {
    const line = lineRaw.trimEnd();
    if (line.startsWith('<') && line.endsWith('>')) {
      if (k) d[k] = v.join('\n');
      k = line.slice(1, -1);
      v = [];
    } else {
      v.push(line);
    }
  }
  if (k) d[k] = v.join('\n');
  return d;
}

export function fromTextFormat(s) {
  const d = textFileAsDict(s);
  const hasV1 = !!d['ACROSS PUZZLE'];
  const hasV2 = !!d['ACROSS PUZZLE v2'];
  if (!hasV1 && !hasV2) throw new PuzzleFormatError('Not a valid Across Lite text puzzle');

  const p = new Puzzle();
  const acrossClues = [];
  const downClues = [];

  if (d.TITLE) p.title = d.TITLE;
  if (d.AUTHOR) p.author = d.AUTHOR;
  if (d.COPYRIGHT) p.copyright = d.COPYRIGHT;

  if (d.SIZE) {
    const [w, h] = d.SIZE.split('x').map(x => parseInt(x, 10));
    p.width = w;
    p.height = h;
  }
  if (d.GRID) {
    const lines = d.GRID.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    p.solution = lines.join('');
  }
  if (d.ACROSS) acrossClues.push(...d.ACROSS.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  if (d.DOWN) downClues.push(...d.DOWN.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  if (d.NOTEPAD) p.notes = d.NOTEPAD;

  if (p.solution) {
    p.fill = p.solution.split('').map(c => (c === BLACKSQUARE ? BLACKSQUARE : BLANKSQUARE)).join('');
    const [across, down] = getGridNumbering(p.fill, p.width, p.height);
    p.clues = new Array(across.length + down.length).fill('');
    for (let i = 0; i < across.length; i++) {
      const clue = i < acrossClues.length ? acrossClues[i] : '';
      across[i].clue = clue;
      p.clues[across[i].clue_index] = clue;
    }
    for (let i = 0; i < down.length; i++) {
      const clue = i < downClues.length ? downClues[i] : '';
      down[i].clue = clue;
      p.clues[down[i].clue_index] = clue;
    }
  }
  return p;
}

// Convenient wrappers mirroring Python API
export function read(uint8) {
  return Puzzle.load(uint8);
}
export function load(uint8) {
  return Puzzle.load(uint8);
}
export function readText(str) {
  return fromTextFormat(str);
}
export function loadText(str) {
  return fromTextFormat(str);
}

// ==== JSCrossword adapter starts ====

// If not already in scope, import xwGrid from your grid.js
// import { xwGrid } from "./grid.js";

function jscrossword_from_puz(puzzle, options) {
  const {
    width,
    height,
    title,
    author,
    copyright,
    notes,
    solution,
    fill,
    clues = []
  } = puzzle;

  const metadata = {
    title: title || "",
    author: author || "",
    copyright: copyright || "",
    description: notes || "",
    height,
    width,
    crossword_type: (puzzle.puzzletype === PuzzleType.Diagramless ? "diagramless": "crossword"),
  };

  // --- build cells (x,y, solution/value/type) ---
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sol = solution[idx];
      const fillChar = fill[idx];
      const isBlock = sol === puzzle.blacksquare();

      cells.push({
        x,
        y,
        solution: isBlock ? null : sol,
        number: null,
        type: isBlock ? "block" : null,
        value: isBlock ? null : (fillChar && fillChar !== "-" ? fillChar : null),
      });
    }
  }

  // --- use grid.js for numbering + entries ---
  const grid = new xwGrid(cells);

  // assign per-cell numbers from grid.numbers (2D)
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const num = grid.numbers[y][x];
      if (num > 0) grid.cellAt(x, y).number = String(num);
    }
  }

  // entry maps keyed by number: { word, cells: [[x,y], ...] }
  const acrossMap = grid.acrossEntries();
  const downMap = grid.downEntries();

  // Build unified list: number + direction + entry
  const allEntries = [];
  for (const [numStr, entry] of Object.entries(acrossMap)) {
    allEntries.push({
      number: Number(numStr),
      dir: "Across",
      kind: "across",
      entry
    });
  }
  for (const [numStr, entry] of Object.entries(downMap)) {
    allEntries.push({
      number: Number(numStr),
      dir: "Down",
      kind: "down",
      entry
    });
  }

  // Sort by number ascending, then direction (Across before Down)
  allEntries.sort((a, b) => (a.number - b.number) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));

  // --- build words & clues, consuming puzzle.clues in that order ---
  const words = [];
  const cluesOut = [{
      title: "ACROSS",
      clue: []
    },
    {
      title: "DOWN",
      clue: []
    },
  ];

  let wordId = 1;
  let clueIdx = 0;

  for (const item of allEntries) {
    const id = String(wordId++);
    const text = clues[clueIdx++] ?? "";

    words.push({
      id,
      cells: item.entry.cells
    });

    const clueObj = {
      word: id,
      number: String(item.number),
      text,
    };

    if (item.kind === "across") {
      cluesOut[0].clue.push(clueObj);
    } else {
      cluesOut[1].clue.push(clueObj);
    }
  }

  // Optional: warn if clue count mismatch
  if (clueIdx !== clues.length) {
    console.warn(`PUZ clue count mismatch: consumed ${clueIdx} of ${clues.length}`);
  }

  return {
    metadata,
    cells,
    words,
    clues: cluesOut
  };
}


export function xw_read_puz(data, options = {}) {
  let bytes;

  if (data instanceof Uint8Array) {
    bytes = data;
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    throw new Error("Unsupported input to xw_read_puz: must be Uint8Array or ArrayBuffer");
  }

  const puzzle = Puzzle.load(bytes, options);
  return jscrossword_from_puz(puzzle, options);
}


// ==== JSCrossword adapter ends ====
