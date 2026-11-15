/* Module worker: one asset's conversion, off the page's thread (convert-core's
   convertGlb). A D = 10 build is seconds to a minute of one call that can't
   yield, so the page would freeze without it, and cancelling is terminating
   this worker. One job a worker: the page makes a new one each asset, which
   also hands the store's memory back between assets.

   The one thing done here rather than in the core: images glb-core can't
   decode itself (JPEG, 16-bit or interlaced PNG) go through the browser's
   own decoder, unpremultiplied and with no colour management, so a texel is
   the file's value as near as the platform allows. */
import { convertGlb } from './convert-core.js';

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
