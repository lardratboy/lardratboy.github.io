/* Module worker: one asset's conversion, off the page's thread (convert-core's
   convertGlb). A D = 10 build is seconds to a minute of one call that can't
   yield, so the page would freeze without it, and cancelling is terminating
   this worker. One job a worker: the page makes a new one each asset, which
   also hands the store's memory back between assets.

   The one thing done here rather than in the core: images glb-core can't
   decode itself (JPEG, 16-bit or interlaced PNG) go through the browser's
   own decoder, unpremultiplied and with no colour management, so a texel is
   the file's value as near as the platform allows.

   A .ply comes as the File itself, not its bytes: the page never reads it,
   and this reads it a slice at a time (8 MB), so a 190 MB file is never in
   memory whole, on either thread. While it reads, the fraction read goes to
   the page at most ten times a second. */
import { convertGlb, convertPly } from './convert-core.js';

const SLICE = 8 << 20;
async function* slices(file){
  for (let o = 0; o < file.size; o += SLICE) yield new Uint8Array(await file.slice(o, o + SLICE).arrayBuffer());
}

async function platform(bytes, mimeType){
  const bmp = await createImageBitmap(new Blob([bytes], { type: mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { w: c.width, h: c.height, rgba: new Uint8Array(data.buffer) };
}

self.onmessage = async ({ data }) => {
  const post = (m, transfer) => self.postMessage(m, transfer);
  try {
    if (data.ply){
      let last = 0;
      await convertPly(slices(data.ply), {
        name: data.name, depths: data.depths, bits: data.bits, bake: data.bake, size: data.ply.size,
        onAsset: asset => post({ asset }),
        onStage: (D, stage) => post({ stage: { D, stage } }),
        onProgress: frac => { const now = performance.now(); if (now - last >= 100 || frac === 1){ last = now; post({ stage: { D: null, stage: 'reading', frac } }); } },
        onWorld: world => post({ world }, [world.bytes.buffer, ...(world.thumb ? [world.thumb.rgba.buffer] : [])]),
      });
      post({ done: true });
      return;
    }
    await convertGlb(new Uint8Array(data.glb), {
      name: data.name, depths: data.depths, bits: data.bits, bake: data.bake, files: new Map(data.files ?? []), platform,
      onAsset: asset => post({ asset }),
      onStage: (D, stage) => post({ stage: { D, stage } }),
      onWorld: world => post({ world }, [world.bytes.buffer, ...(world.thumb ? [world.thumb.rgba.buffer] : [])]),
    });
    post({ done: true });
  } catch (e){
    post({ error: String(e?.message ?? e) });
  }
};
