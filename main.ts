// main.ts is mend, the CLI SPEC.md specifies. Node 22, the standard library alone; run it as
// `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to
// runner.ts (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A file as lines: its line break, its lines, whether it ends with a break (SPEC.md section 3). */
interface FileModel {
  lines: string[];
  br: string;
  final: boolean;
}

function parseFile(text: string): FileModel {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function serializeFile(f: FileModel): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.final ? f.br : '');
}

const leadingWs = (s: string): string => {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0] : '';
};
const rtrimWs = (s: string): string => s.replace(/[ \t]+$/, '');
const trimWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

/** One line of an old/new side: `ctx` lines also appear on the other side (SPEC.md section 5). */
interface OE {
  text: string;
  ctx: boolean;
}

/** Line equality at a matching tier (SPEC.md section 5). */
function lineEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return rtrimWs(a) === rtrimWs(b);
  return trimWs(a) === trimWs(b);
}

/** 0-based positions where O occurs in `lines` at `tier`, at or after `from`. */
function occurrences(lines: string[], o: string[], tier: number, from = 0): number[] {
  const out: number[] = [];
  if (o.length === 0) return out;
  for (let i = from; i + o.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < o.length; j++) {
      if (!lineEq(lines[i + j]!, o[j], tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** First tier (0, then 1, then 2; 0 only with --strict) at which O occurs, with its positions. */
function findTier(lines: string[], o: string[], strict: boolean, from = 0): { tier: number; positions: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const p = occurrences(lines, o, t, from);
    if (p.length > 0) return { tier: t, positions: p };
  }
  return null;
}

/**
 * Replace the lines at `pos` (O's match) with N. Context lines are written as the file's own
 * matched line; at tier 2 every other N line is re-indented from O's first line to the file's
 * first matched line (SPEC.md section 5). The final break is left to the caller.
 */
function replaceLines(model: FileModel, pos: number, O: OE[], N: OE[], tier: number): FileModel {
  const oCtx: number[] = [];
  O.forEach((e, idx) => {
    if (e.ctx) oCtx.push(idx);
  });
  const F = model.lines[pos] !== undefined ? leadingWs(model.lines[pos]!) : '';
  const P = O.length > 0 ? leadingWs(O[0]!.text) : '';
  const out: string[] = [];
  let rank = 0;
  for (const n of N) {
    if (n.ctx) {
      out.push(model.lines[pos + oCtx[rank]!]!);
      rank++;
    } else if (tier === 2) {
      const t = n.text;
      if (t !== '' && t.trim() !== '' && t.startsWith(P)) out.push(F + t.slice(P.length));
      else out.push(t);
    } else {
      out.push(n.text);
    }
  }
  return { lines: [...model.lines.slice(0, pos), ...out, ...model.lines.slice(pos + O.length)], br: model.br, final: model.final };
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  readonly moves: { old: string; new: string }[] = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/* ---------------- Unified diffs (SPEC.md section 6) ---------------- */

interface HunkEntry {
  kind: ' ' | '-' | '+' | '\\';
  text: string;
  raw: string;
}

interface Hunk {
  a: number;
  body: HunkEntry[];
}

interface Section {
  oldPath: string | null; // null: /dev/null
  newPath: string | null; // null: /dev/null
  newFile: boolean;
  deleted: boolean;
  hunks: Hunk[];
}

/** Path after `--- ` / `+++ `: up to the first tab, surrounding spaces removed, a/ or b/ removed. */
function unifiedPath(s: string): string {
  let p = s.split('\t')[0]!.trim();
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

/** `@@ -A[,B] +C[,D] @@` plus optional text; returns A, or null when the line is not one. */
function hunkStart(line: string): number | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!m) return null;
  const rest = line.slice(m[0].length);
  if (rest !== '' && !rest.startsWith(' ')) return null;
  return parseInt(m[1]!, 10);
}

/** A hunk's body, from `start` to the first line that is not one; trailing empty lines are not part of it. */
function hunkBody(lines: string[], start: number): { body: HunkEntry[]; next: number } {
  const body: HunkEntry[] = [];
  let j = start;
  while (j < lines.length) {
    const l = lines[j]!;
    if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
    if (l === '' || l[0] === ' ' || l[0] === '-' || l[0] === '+' || l[0] === '\\') {
      body.push({ kind: l === '' ? ' ' : (l[0] as HunkEntry['kind']), text: l === '' ? '' : l.slice(1), raw: l });
      j++;
    } else break;
  }
  while (body.length > 0 && body[body.length - 1]!.raw === '') body.pop();
  return { body, next: j };
}

/** Whether a `\` line follows the hunk's last body entry of one of `kinds`. */
function hunkNoEol(body: HunkEntry[], kinds: Set<string>): boolean {
  for (let i = body.length - 1; i >= 0; i--) {
    if (kinds.has(body[i]!.kind)) return body[i + 1]?.kind === '\\';
  }
  return false;
}

/** Split a hunk's body into its old (context + `-`) and new (context + `+`) sides. */
function hunkSides(h: Hunk): { O: OE[]; N: OE[] } {
  const O: OE[] = [];
  const N: OE[] = [];
  for (const e of h.body) {
    if (e.kind === ' ') {
      O.push({ text: e.text, ctx: true });
      N.push({ text: e.text, ctx: true });
    } else if (e.kind === '-') O.push({ text: e.text, ctx: false });
    else if (e.kind === '+') N.push({ text: e.text, ctx: false });
  }
  return { O, N };
}

/** Apply a section's hunks in order to a file model (SPEC.md section 6). */
function applyHunks(model: FileModel, hunks: Hunk[], strict: boolean, path: string): FileModel {
  let cur = model;
  let d = 0;
  for (const h of hunks) {
    const { O, N } = hunkSides(h);
    if (O.length > 0) {
      const found = findTier(cur.lines, O.map((x) => x.text), strict);
      if (!found) throw new Fail('no-match', path);
      const target = h.a - 1 + d;
      let best = found.positions[0]!;
      for (const p of found.positions) {
        if (Math.abs(p - target) < Math.abs(best - target)) best = p;
      }
      const matchedToEnd = best + O.length === cur.lines.length;
      const replaced = replaceLines(cur, best, O, N, found.tier);
      replaced.final = matchedToEnd ? !hunkNoEol(h.body, new Set([' ', '+'])) : cur.final;
      cur = replaced;
    } else {
      const ins = Math.max(0, Math.min(h.a + d, cur.lines.length));
      const lines = [...cur.lines.slice(0, ins), ...N.map((x) => x.text), ...cur.lines.slice(ins)];
      cur = { lines, br: cur.br, final: ins === cur.lines.length ? !hunkNoEol(h.body, new Set(['+'])) : cur.final };
    }
    d += N.length - O.length;
  }
  return cur;
}

function unifiedSectionEdit(s: Section, strict: boolean): Edit {
  return (tree) => {
    const oldP = s.oldPath;
    const newP = s.newPath;
    if (oldP !== null && !safe(oldP)) throw new Fail('unsafe', oldP);
    if (newP !== null && !safe(newP)) throw new Fail('unsafe', newP);
    if (oldP === null || s.newFile) {
      // Creation: the file is the `+` lines of all its hunks, in order.
      if (newP === null) return;
      if (tree.get(newP) !== null) throw new Fail('exists', newP);
      const plus: string[] = [];
      let noEol = false;
      for (const h of s.hunks) {
        let hasPlus = false;
        for (const e of h.body) if (e.kind === '+') {
          plus.push(e.text);
          hasPlus = true;
        }
        if (hasPlus) noEol = hunkNoEol(h.body, new Set(['+']));
      }
      tree.now.set(newP, plus.length === 0 ? '' : plus.join('\n') + (noEol ? '' : '\n'));
      return;
    }
    if (newP === null || s.deleted) {
      if (tree.get(oldP) === null) throw new Fail('missing', oldP);
      tree.now.set(oldP, null);
      return;
    }
    if (oldP !== newP) {
      const cur = tree.get(oldP);
      if (cur === null) throw new Fail('missing', oldP);
      if (tree.get(newP) !== null) throw new Fail('exists', newP);
      const model = applyHunks(parseFile(cur), s.hunks, strict, oldP);
      tree.now.set(oldP, null);
      tree.now.set(newP, serializeFile(model));
      tree.moves.push({ old: oldP, new: newP });
      return;
    }
    const cur = tree.get(oldP);
    if (cur === null) throw new Fail('missing', oldP);
    tree.now.set(oldP, serializeFile(applyHunks(parseFile(cur), s.hunks, strict, oldP)));
  };
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  interface RawSection extends Section {
    hasPair: boolean;
    renameFrom: string | null;
    renameTo: string | null;
    diffOld: string | null;
    diffNew: string | null;
  }
  const sections: RawSection[] = [];
  let cur: RawSection | null = null;
  let inHeader = false;
  let i = 0;
  const n = lines.length;
  const fresh = (): RawSection => ({
    oldPath: null,
    newPath: null,
    newFile: false,
    deleted: false,
    hunks: [],
    hasPair: false,
    renameFrom: null,
    renameTo: null,
    diffOld: null,
    diffNew: null,
  });
  while (i < n) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      cur = fresh();
      cur.diffOld = m[1]!;
      cur.diffNew = m[2]!.trimEnd();
      sections.push(cur);
      inHeader = true;
      i++;
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      if (cur !== null && inHeader && !cur.hasPair) {
        cur.oldPath = unifiedPath(line.slice(4));
        cur.newPath = unifiedPath(lines[i + 1]!.slice(4));
        cur.hasPair = true;
        i += 2;
        continue;
      }
      cur = fresh();
      cur.oldPath = unifiedPath(line.slice(4));
      cur.newPath = unifiedPath(lines[i + 1]!.slice(4));
      cur.hasPair = true;
      sections.push(cur);
      inHeader = true;
      i += 2;
      continue;
    }
    if (line.startsWith('--- ') && cur !== null && inHeader) throw new Exit2(`error: parse ${i + 2}`);
    if (line.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const a = hunkStart(line);
      if (a === null) throw new Exit2(`error: parse ${i + 1}`);
      const { body, next } = hunkBody(lines, i + 1);
      cur.hunks.push({ a, body });
      inHeader = false;
      i = next;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('rename from ')) cur.renameFrom = line.slice(12).trim();
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice(10).trim();
      else if (line.startsWith('new file mode')) cur.newFile = true;
      else if (line.startsWith('deleted file mode')) cur.deleted = true;
      i++;
      continue;
    }
    i++;
  }
  const edits: Edit[] = [];
  for (const s of sections) {
    const oldRaw = s.oldPath ?? s.renameFrom ?? s.diffOld;
    const newRaw = s.newPath ?? s.renameTo ?? s.diffNew;
    const oldPath = oldRaw === null ? null : oldRaw === '/dev/null' ? null : oldRaw;
    const newPath = newRaw === null ? null : newRaw === '/dev/null' ? null : newRaw;
    edits.push(unifiedSectionEdit({ oldPath, newPath, newFile: s.newFile, deleted: s.deleted, hunks: s.hunks }, strict));
  }
  return edits;
}

/* ---------------- SEARCH/REPLACE blocks (SPEC.md section 7) ---------------- */

function srEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevEnd = 0;
  let prevPath: string | null = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const searchLine = i;
    let path: string | null = null;
    for (let j = i - 1; j >= prevEnd; j--) {
      const t = lines[j]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) {
      if (prevPath === null) throw new Exit2(`error: parse ${searchLine + 1}`);
      path = prevPath;
    }
    let eq = -1;
    for (let k = i + 1; k < n; k++) {
      if (lines[k]!.trimEnd() === '=======') {
        eq = k;
        break;
      }
      if (lines[k]!.trimEnd() === '>>>>>>> REPLACE') break;
    }
    if (eq === -1) throw new Exit2(`error: parse ${searchLine + 1}`);
    let rep = -1;
    for (let k = eq + 1; k < n; k++) {
      if (lines[k]!.trimEnd() === '>>>>>>> REPLACE') {
        rep = k;
        break;
      }
    }
    if (rep === -1) throw new Exit2(`error: parse ${searchLine + 1}`);
    const oldLines = lines.slice(i + 1, eq);
    const newLines = lines.slice(eq + 1, rep);
    const p = path;
    edits.push((tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (oldLines.length === 0) {
        if (tree.get(p) !== null) throw new Fail('exists', p);
        tree.now.set(p, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
        return;
      }
      const cur = tree.get(p);
      if (cur === null) throw new Fail('missing', p);
      const model = parseFile(cur);
      const found = findTier(model.lines, oldLines, strict);
      if (!found) throw new Fail('no-match', p);
      if (found.positions.length > 1) throw new Fail('ambiguous', p);
      const O: OE[] = oldLines.map((t) => ({ text: t, ctx: false }));
      const N: OE[] = newLines.map((t) => ({ text: t, ctx: false }));
      tree.now.set(p, serializeFile(replaceLines(model, found.positions[0]!, O, N, found.tier)));
    });
    prevPath = p;
    prevEnd = rep + 1;
    i = rep + 1;
  }
  return edits;
}

/* ---------------- V4A patches (SPEC.md section 8) ---------------- */

interface VChunk {
  anchor: string | null; // null: no anchor
  eof: boolean;
  O: OE[];
  N: OE[];
}

const SECTION_START = /^\*\*\* (Add File|Delete File|Update File): (.*)$/;

function v4aUpdateEdit(path: string, moveTo: string | null, chunks: VChunk[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const cur = tree.get(path);
    if (cur === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    let model = parseFile(cur);
    let cursor = 0;
    for (const ch of chunks) {
      if (ch.anchor !== null && ch.anchor !== '') {
        const tiers = strict ? [0] : [0, 1, 2];
        let found = -1;
        for (const t of tiers) {
          for (let i = cursor; i < model.lines.length; i++) {
            if (lineEq(model.lines[i]!, ch.anchor, t)) {
              found = i;
              break;
            }
          }
          if (found >= 0) break;
        }
        if (found < 0) throw new Fail('no-match', path);
        cursor = found + 1;
      }
      if (ch.O.length > 0) {
        const oTexts = ch.O.map((x) => x.text);
        const tiers = strict ? [0] : [0, 1, 2];
        let hit: { tier: number; pos: number } | null = null;
        for (const t of tiers) {
          const occ = occurrences(model.lines, oTexts, t, cursor);
          const cand = ch.eof ? occ.filter((p) => p + oTexts.length === model.lines.length) : occ;
          if (cand.length > 0) {
            hit = { tier: t, pos: cand[0]! };
            break;
          }
        }
        if (!hit) throw new Fail('no-match', path);
        model = replaceLines(model, hit.pos, ch.O, ch.N, hit.tier);
        cursor = hit.pos + ch.N.length;
      } else {
        const ins = ch.eof ? model.lines.length : cursor;
        const nTexts = ch.N.map((x) => x.text);
        model = { lines: [...model.lines.slice(0, ins), ...nTexts, ...model.lines.slice(ins)], br: model.br, final: model.final };
        cursor = ins + nTexts.length;
      }
    }
    const text = serializeFile(model);
    if (moveTo !== null) {
      tree.now.set(path, null);
      tree.now.set(moveTo, text);
      tree.moves.push({ old: path, new: moveTo });
    } else {
      tree.now.set(path, text);
    }
  };
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!blank(lines[i]!)) {
      last = i;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const m = SECTION_START.exec(line);
    if (!m) throw new Exit2(`error: parse ${i + 1}`);
    const kind = m[1]!;
    const path = m[2]!.trim();
    const start = i + 1;
    let j = start;
    while (j < last && !SECTION_START.test(lines[j]!)) j++;
    const raw = lines.slice(start, j);
    while (raw.length > 0 && blank(raw[raw.length - 1]!)) raw.pop();
    if (kind === 'Add File') {
      const fileLines: string[] = [];
      for (let k = 0; k < raw.length; k++) {
        const l = raw[k]!;
        if (l === '') fileLines.push('');
        else if (l.startsWith('+')) fileLines.push(l.slice(1));
        else throw new Exit2(`error: parse ${start + k + 1}`);
      }
      const fl = fileLines;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) !== null) throw new Fail('exists', path);
        tree.now.set(path, fl.length === 0 ? '' : fl.join('\n') + '\n');
      });
    } else if (kind === 'Delete File') {
      for (let k = 0; k < raw.length; k++) {
        if (!blank(raw[k]!)) throw new Exit2(`error: parse ${start + k + 1}`);
      }
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) === null) throw new Fail('missing', path);
        tree.now.set(path, null);
      });
    } else {
      let moveTo: string | null = null;
      const chunks: VChunk[] = [];
      let curChunk: VChunk | null = null;
      const finishChunk = () => {
        if (curChunk !== null) {
          chunks.push(curChunk);
          curChunk = null;
        }
      };
      for (let k = 0; k < raw.length; k++) {
        const l = raw[k]!;
        const ln = start + k + 1;
        if (l.startsWith('*** Move to: ')) {
          if (moveTo !== null || curChunk !== null || chunks.length > 0) throw new Exit2(`error: parse ${ln}`);
          moveTo = l.slice('*** Move to: '.length).trim();
          continue;
        }
        if (l === '*** End of File') {
          if (curChunk === null) throw new Exit2(`error: parse ${ln}`);
          curChunk.eof = true;
          finishChunk();
          continue;
        }
        if (l.startsWith('@@')) {
          finishChunk();
          curChunk = { anchor: l.slice(2).trim(), eof: false, O: [], N: [] };
          continue;
        }
        if (curChunk === null) {
          if (chunks.length > 0) throw new Exit2(`error: parse ${ln}`);
          curChunk = { anchor: null, eof: false, O: [], N: [] };
        }
        if (l === '') {
          curChunk.O.push({ text: '', ctx: true });
          curChunk.N.push({ text: '', ctx: true });
        } else if (l.startsWith(' ')) {
          const t = l.slice(1);
          curChunk.O.push({ text: t, ctx: true });
          curChunk.N.push({ text: t, ctx: true });
        } else if (l.startsWith('-')) curChunk.O.push({ text: l.slice(1), ctx: false });
        else if (l.startsWith('+')) curChunk.N.push({ text: l.slice(1), ctx: false });
        else throw new Exit2(`error: parse ${ln}`);
      }
      finishChunk();
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${i + 1}`);
      edits.push(v4aUpdateEdit(path, moveTo, chunks, strict));
    }
    i = j;
  }
  return edits;
}

/* ---------------- Invocation, output and exit codes (SPEC.md sections 1, 2, 10) ---------------- */

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = unifiedEdits(lines, strict);
    else if (kind === 'search-replace') edits = srEdits(lines, strict);
    else edits = v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // A move whose old path existed before the patch and does not after it, and whose new path
  // did not exist before it and does after it, is one `R <old> -> <new>` line, sorting by <new>.
  const rPairs = tree.moves.filter(
    (m) => tree.original(m.old) !== null && tree.now.get(m.old) === null && tree.original(m.new) === null && tree.now.get(m.new) !== null,
  );
  const rOlds = new Set(rPairs.map((m) => m.old));
  const rByNew = new Map(rPairs.map((m) => [m.new, m.old]));
  const rows: { key: string; text: string }[] = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    if (rOlds.has(p)) continue;
    const old = rByNew.get(p);
    if (old !== undefined) rows.push({ key: p, text: `R ${old} -> ${p}` });
    else rows.push({ key: p, text: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) {
    for (const p of [...tree.now.keys()]) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r.text), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
