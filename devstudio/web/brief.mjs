// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The client's product brief: a file the partner uploads with a new app (or later).
//
// Kept in the project at /work/brief/<name>, on the project's files volume, so it is saved and restored
// with the app (projects/<id>/work.tar.gz). The assistant reads it there.
//
// Types: PDF, DOCX, Markdown and plain text, up to 10 MB. Each is checked by its extension AND its
// content, so a renamed file is refused.
//
// How each reaches the assistant:
//   PDF   Claude Code's Read tool reads PDFs itself (it renders pages with pdftoppm from poppler-utils,
//         which the runner image has). Codex has no PDF reader, so Dev Studio also writes
//         <name>.txt with `pdftotext -layout` in the container. Best effort: a failure is logged and the
//         prompt still points at the PDF.
//   DOCX  Neither assistant reads Word files. Dev Studio extracts the text here (docxText below: a DOCX
//         is a zip with word/document.xml) and writes <name>.txt next to it. No pandoc: it would add
//         about 150 MB to the runner image for one paragraph-and-table extraction.
//   MD/TXT read as they are.
import { inflateRawSync } from 'node:zlib';

export const BRIEF_MAX = 10 * 1024 * 1024;
export const BRIEF_DIR = '/work/brief';
export const BRIEF_TYPES = { pdf: 'PDF', docx: 'Word (DOCX)', md: 'Markdown', txt: 'text' };
const MAX_FILES = 10;

export class BriefError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** A safe file name that keeps the original where it can: letters, digits, space, dot, dash, underscore. */
export function briefName(name) {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFC');
  const safe = base.replace(/[^A-Za-z0-9 ._()-]+/g, '_').replace(/^[.\s]+/, '').trim().slice(-100);
  return safe;
}

const extOf = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();

/**
 * Check one upload. Returns { name, type, size }; throws BriefError with a sentence for the page.
 * @param have  the files the project has already (an upload of the same name replaces it)
 */
export function checkBrief(rawName, buf, have = []) {
  const name = briefName(rawName);
  const type = extOf(name);
  if (!name || !BRIEF_TYPES[type]) throw new BriefError('The brief must be a PDF, Word (DOCX), Markdown or text file.');
  if (!buf?.length) throw new BriefError('The file is empty.');
  if (buf.length > BRIEF_MAX) throw new BriefError('The file is larger than 10 MB. Send a smaller copy, for example without pictures.', 413);
  if (!have.some((b) => b.name === name) && have.length >= MAX_FILES) throw new BriefError(`A project can keep ${MAX_FILES} brief files.`);
  if (type === 'pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BriefError('This file is not a PDF. Save it as a PDF again and send it.');
  if (type === 'docx') {
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new BriefError('This file is not a Word (DOCX) file. Save it as .docx and send it.');
  }
  if (type === 'md' || type === 'txt') {
    if (buf.includes(0)) throw new BriefError('This file is not plain text.');
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { throw new BriefError('This text file is not UTF-8. Save it as UTF-8 and send it.'); }
  }
  return { name, type, size: buf.length };
}

/** One entry of a zip's central directory: { name, method, csize, size, offset }. */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new BriefError('This Word file is damaged. Save it again and send it.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    out.push({
      name: buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function unzipOne(buf, entry, max) {
  const lh = entry.offset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new BriefError('This Word file is damaged. Save it again and send it.');
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new BriefError('This Word file uses a format Dev Studio cannot read. Save it again as .docx.');
  try { return inflateRawSync(data, { maxOutputLength: max }); }
  catch { throw new BriefError('This Word file is too large or damaged to read.'); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? m;
});

/**
 * The text of a DOCX: paragraphs on their own lines, table cells separated by " | ", one row a line.
 * Headers, footers, comments and pictures are left out.
 */
export function docxText(buf) {
  const entry = zipEntries(buf).find((e) => e.name === 'word/document.xml');
  if (!entry) throw new BriefError('This file is not a Word (DOCX) file. Save it as .docx and send it.');
  const xml = unzipOne(buf, entry, 50 * 1024 * 1024).toString('utf8');
  // Only the text runs (w:t) count; field codes and other markup are skipped.
  let body = '';
  let inCell = false;
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>|<w:tc\b/g)) {
    const tag = m[0];
    if (m[1] !== undefined && tag.startsWith('<w:t')) body += decode(m[1]);
    else if (tag === '<w:tab/>') body += '\t';
    else if (tag.startsWith('<w:br') || tag.startsWith('<w:cr')) body += '\n';
    else if (tag === '<w:tc') inCell = true;
    else if (tag === '</w:p>') body += inCell ? ' ' : '\n';
    else if (tag === '</w:tc>') { body = body.trimEnd() + ' | '; inCell = false; }
    else if (tag === '</w:tr>') body += '\n';
  }
  return body.split('\n').map((l) => l.replace(/\s*\|\s*$/, '').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Where the assistant reads a brief file from, and which text copy exists. */
export function briefPaths(b) {
  return { file: `${BRIEF_DIR}/${b.name}`, text: b.text ? `${BRIEF_DIR}/${b.text}` : null };
}
