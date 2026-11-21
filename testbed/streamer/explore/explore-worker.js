/* Module worker: one world of one file, for explore/index.html
   (docs/explore.md). The page posts the File (structured clone, nothing read
   on its side) and which world; this reads it (vdag-core's readVdag,
   colours.js's fields), runs explore-core's analysis, and sends the page the
   keys and the analysis, which the page keeps for everything it can answer
   at once (layouts, references, places, picking, chunks and stamps).

   It stays alive for the world's life to answer what needs the colour field,
   which lives here only (a baked field is built over this side's view, as a
   chunk worker's is):
     { cells: { lod } }          the world's surface cells at a lod, with
                                 each cell's attribute word (cellAttr at
                                 meanDepth 1, the stream viewer's words)
     { nodeColours: { ids } }    each node's mean colour at its first place
                                 (cellMean, meanDepth 1, 8-bit channels)
     { placeColours: { level, list } }  a node's mean colour at each of
                                 the places listed
     { job: { lod, cx, cy, cz, rule } }  one chunk's job: expandChunk with
                                 seams, the streamer's options, its records,
                                 words and counts
   Every reply carries the request's `rq`, so the page drops stale ones. A new
   file or world is a new worker: the page terminates this one. */
import { readVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { storeView, createCounts } from '../dag-core.js';
import { cellAttr, cellMean, expandChunk } from '../chunk-core.js';
import { rgb8 } from '../attr-core.js';
import { analyse, cellsAt } from './explore-core.js';

const post = (m, transfer) => self.postMessage(m, transfer);
let last = 0;
const throttled = m => { const now = performance.now(); if (now - last >= 100){ last = now; post(m); } };
let W = null;   // { w, store, counts, field, A }
const MEAN = new Float64Array(3);

function open({ file, world }){
  return (async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { worlds } = await readVdag(bytes, { colourOf, onPhase: (text, fraction) => throttled({ phase: { text, fraction } }) });
    post({ worlds: worlds.map(w => ({ name: w.name, D: w.D, voxels: w.voxels, nodes: w.nodes, colourStatus: w.colourStatus,
                                      colourKind: w.colour?.kind ?? null, bits: w.colour?.bits ?? null })) });
    const w = worlds[world];
    if (!w) throw new Error(`the file has no world ${world + 1}`);
    const store = storeView({ keys: w.keys }), counts = createCounts(store);
    let field = null, fieldError = null;
    if (w.colour){
      try { field = colourOf(w.colour, { store, counts, D: w.D }); } catch (e){ fieldError = String(e?.message ?? e); }
    }
    post({ phase: { text: 'counting references', fraction: 0.8 } });
    const t = performance.now(), A = analyse(w.keys, w.root, w.D);
    W = { w, store, counts, field, A };
    post({ analysis: { ...A, keys: w.keys, ms: performance.now() - t, field: !!field, fieldError,
                       colourKind: w.colour?.kind ?? null, colourStatus: w.colourStatus, bits: w.colour?.bits ?? null } });
  })();
}

function cells({ lod }){
  const c = cellsAt(W.A, W.w.keys, lod), cs = 2 ** lod;
  let words = null;
  if (W.field){
    words = new Uint32Array(c.shown);
    for (let i = 0; i < c.shown; i++){
      const p = c.xyz[i];
      words[i] = cellAttr(W.store, W.counts, W.field, c.ids[i], lod, 1, (p & 1023) * cs, (p >> 10 & 1023) * cs, (p >> 20) * cs);
      if ((i & 4095) === 0) throttled({ progress: { text: `colouring lod ${lod}`, done: i, total: c.shown } });
    }
  }
  return { reply: { ...c, words }, transfer: [c.xyz.buffer, c.ids.buffer, c.morton.buffer, ...(words ? [words.buffer] : [])] };
}

const meanAt = (id, level, x, y, z) => {
  cellMean(W.store, W.counts, W.field, id, level, Math.min(1, level), x, y, z, MEAN);
  return rgb8(MEAN[0], MEAN[1], MEAN[2]);
};
function nodeColours({ ids }){
  const A = W.A, out = new Uint32Array(ids.length);
  if (W.field) for (let i = 0; i < ids.length; i++){
    const id = ids[i];
    out[i] = meanAt(id, A.level[id], A.px[id], A.py[id], A.pz[id]);
    if ((i & 1023) === 0) throttled({ progress: { text: 'colouring the graph', done: i, total: ids.length } });
  }
  return { reply: { ids, words: out }, transfer: [out.buffer] };
}
function placeColours({ id, list }){
  const A = W.A, out = new Uint32Array(list.length / 3);
  if (W.field) for (let i = 0; i < out.length; i++) out[i] = meanAt(id, A.level[id], list[3 * i], list[3 * i + 1], list[3 * i + 2]);
  return { reply: { id, words: out } };
}
function job({ lod, cx, cy, cz, rule }){
  const t = performance.now();
  const r = expandChunk(W.store, W.w.root, W.w.D, { lod, cx, cy, cz }, { lodRule: rule, counts: W.counts, seams: true, colour: W.field });
  const { records, attrs = null, ...rest } = r;
  return { reply: { ...rest, records, attrs, ms: performance.now() - t }, transfer: [records.buffer, ...(attrs ? [attrs.buffer] : [])] };
}

self.onmessage = async ({ data }) => {
  const rq = data.rq;
  try {
    if (data.open){ await open(data.open); return; }
    if (!W) throw new Error('no world open');
    const fn = data.cells ? cells : data.nodeColours ? nodeColours : data.placeColours ? placeColours : data.job ? job : null;
    if (!fn) throw new Error('unknown request');
    const kind = Object.keys(data).find(k => k !== 'rq');
    const { reply, transfer = [] } = fn(data[kind]);
    post({ rq, [kind]: reply }, transfer);
  } catch (e){
    post({ rq, error: String(e?.message ?? e) });
  }
};
