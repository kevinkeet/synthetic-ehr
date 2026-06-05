/**
 * RagStore — static, dependency-free retrieval for the Teaching Tutor.
 *
 * PROTOTYPE retriever: loads a prebuilt chunk index (data/rag/index.json),
 * builds an in-memory TF-IDF model in the browser, and returns the top-k
 * chunks for a query by cosine similarity. No API keys, no model downloads,
 * fully static — fits GitHub Pages.
 *
 * The scoring layer is deliberately isolated (see _score / search) so it can
 * later be swapped for real embeddings (transformers.js in-browser, or Voyage)
 * WITHOUT changing the Tutor UI or the grounding/citation plumbing.
 *
 * index.json shape (produced by tools/rag-ingest.mjs):
 *   {
 *     "version": 1,
 *     "chunks": [
 *       { "id": "...", "docTitle": "...", "url": "...", "type": "study|framework|reference", "text": "..." }
 *     ]
 *   }
 *
 * Global: window.RagStore
 */

const RagStore = (function () {
    'use strict';

    const INDEX_URL = 'data/rag/index.json';

    // Common English + clinical filler stopwords (kept short on purpose).
    const STOP = new Set(
        ('a an and are as at be by for from has have how i in is it its of on or that the to was were ' +
            'what when where which who why will with would you your this these those then than do does ' +
            'about into over under can could should may might patient patients clinical')
            .split(' ')
    );

    let _loaded = false;
    let _loading = null;
    let _chunks = []; // [{id, docTitle, url, type, text, _tf:Map, _norm:number}]
    let _idf = new Map(); // token -> idf
    let _available = false;

    function _tokenize(text) {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 2 && !STOP.has(t));
    }

    function _termFreq(tokens) {
        const tf = new Map();
        for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
        return tf;
    }

    // Build the TF-IDF model over the loaded chunks.
    function _buildModel() {
        const N = _chunks.length;
        const df = new Map();
        for (const c of _chunks) {
            c._tf = _termFreq(_tokenize(c.text));
            for (const term of c._tf.keys()) df.set(term, (df.get(term) || 0) + 1);
        }
        _idf = new Map();
        for (const [term, d] of df) _idf.set(term, Math.log(1 + N / d));
        // Precompute each chunk's TF-IDF norm for cosine.
        for (const c of _chunks) {
            let sumSq = 0;
            for (const [term, f] of c._tf) {
                const w = f * (_idf.get(term) || 0);
                sumSq += w * w;
            }
            c._norm = Math.sqrt(sumSq) || 1;
        }
    }

    async function load() {
        if (_loaded) return _available;
        if (_loading) return _loading;
        _loading = (async () => {
            try {
                const base = (window.__CACHE_V ? `${INDEX_URL}` : INDEX_URL);
                const res = await fetch(base, { cache: 'no-cache' });
                if (!res.ok) throw new Error('index ' + res.status);
                const data = await res.json();
                _chunks = (data && data.chunks) || [];
                if (_chunks.length) {
                    _buildModel();
                    _available = true;
                }
            } catch (e) {
                console.warn('RagStore: no index loaded —', e.message);
                _available = false;
            }
            _loaded = true;
            return _available;
        })();
        return _loading;
    }

    // Cosine similarity between a query TF map and a chunk.
    function _score(queryTf, queryNorm, chunk) {
        let dot = 0;
        // iterate the smaller map
        const [small, big] = queryTf.size < chunk._tf.size ? [queryTf, chunk._tf] : [chunk._tf, queryTf];
        for (const [term, f] of small) {
            const other = big.get(term);
            if (other == null) continue;
            const idf = _idf.get(term) || 0;
            dot += f * idf * other * idf;
        }
        return dot / (queryNorm * chunk._norm);
    }

    /**
     * Retrieve the top-k most relevant chunks for a query.
     * @returns {Array<{docTitle,url,type,text,score}>}
     */
    async function search(query, k = 4) {
        await load();
        if (!_available) return [];
        const qtf = _termFreq(_tokenize(query));
        let qNormSq = 0;
        for (const [term, f] of qtf) {
            const w = f * (_idf.get(term) || 0);
            qNormSq += w * w;
        }
        const qNorm = Math.sqrt(qNormSq) || 1;
        const scored = _chunks
            .map((c) => ({ docTitle: c.docTitle, url: c.url, type: c.type, text: c.text, score: _score(qtf, qNorm, c) }))
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        return scored;
    }

    function isAvailable() {
        return _available;
    }
    function count() {
        return _chunks.length;
    }

    return { load, search, isAvailable, count };
})();

window.RagStore = RagStore;
