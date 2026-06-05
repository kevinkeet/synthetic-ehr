#!/usr/bin/env node
/**
 * rag-ingest.mjs — build the static RAG index for the Teaching Tutor.
 *
 * Reads every .md / .txt file in  data/rag/sources/  and writes
 * data/rag/index.json  (chunked text + per-chunk citation metadata).
 *
 * PROTOTYPE: this only chunks text — no embeddings. Retrieval happens in the
 * browser (TF-IDF, see js/services/rag-store.js). To upgrade to vector RAG
 * later, add an embedding step here and store vectors per chunk; the browser
 * store's scoring layer is the only other thing that changes.
 *
 * Each source file may begin with simple frontmatter so every chunk carries a
 * real citation + link (this is what lets the tutor LINK to landmark studies
 * and frameworks instead of inventing URLs):
 *
 *   ---
 *   title: PREPIC2 Trial (JAMA 2015)
 *   url: https://pubmed.ncbi.nlm.nih.gov/25919526/
 *   type: study            # study | framework | reference
 *   ---
 *   <body text...>
 *
 * Usage:  node tools/rag-ingest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'data', 'rag', 'sources');
const OUT = path.join(ROOT, 'data', 'rag', 'index.json');

const CHUNK_TARGET = 900; // approx chars per chunk
const CHUNK_OVERLAP = 150; // chars of overlap between consecutive chunks

function parseFrontmatter(raw) {
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!m) return { meta: {}, body: raw };
    const meta = {};
    for (const line of m[1].split('\n')) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        const key = line.slice(0, i).trim();
        const val = line.slice(i + 1).trim();
        if (key) meta[key] = val;
    }
    return { meta, body: raw.slice(m[0].length) };
}

// Chunk on paragraph boundaries, packing up to ~CHUNK_TARGET chars, with a
// small overlap so a concept split across a boundary stays retrievable.
function chunkText(body) {
    const paras = body
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const chunks = [];
    let cur = '';
    for (const p of paras) {
        if (cur && (cur.length + 1 + p.length) > CHUNK_TARGET) {
            chunks.push(cur);
            const tail = cur.slice(Math.max(0, cur.length - CHUNK_OVERLAP));
            cur = tail + ' ' + p;
        } else {
            cur = cur ? cur + ' ' + p : p;
        }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
}

function main() {
    if (!fs.existsSync(SRC_DIR)) {
        console.error('No source dir:', SRC_DIR);
        process.exit(1);
    }
    const files = fs
        .readdirSync(SRC_DIR)
        .filter((f) => /\.(md|txt)$/i.test(f))
        .sort();

    const chunks = [];
    let docCount = 0;
    for (const file of files) {
        const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const docTitle = meta.title || file.replace(/\.(md|txt)$/i, '');
        const url = meta.url || '';
        const type = (meta.type || 'reference').toLowerCase();
        const pieces = chunkText(body);
        pieces.forEach((text, idx) => {
            chunks.push({
                id: `${file}#${idx}`,
                docTitle,
                url,
                type,
                text,
            });
        });
        docCount++;
        console.log(`  ${file}: ${pieces.length} chunk(s) [${type}]`);
    }

    const index = { version: 1, generated: 'static-tfidf-prototype', docCount, chunkCount: chunks.length, chunks };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(index, null, 2));
    console.log(`\nWrote ${chunks.length} chunks from ${docCount} doc(s) → ${path.relative(ROOT, OUT)}`);
}

main();
