/* Lines of a text file gathered as Blob parts rather than one string. A
   big sheet runs past the engine's string limit (~512M characters in V8)
   long before it runs out of memory; the browser joins Blob parts in its
   own storage, so no single JS string ever holds more than `chunk` lines.
   blob() is byte-for-byte lines.join("\n"). Pure: no THREE, no DOM. */
export function textSink(chunk = 50000){
  const parts = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    parts.push((parts.length ? "\n" : "") + buf.join("\n"));
    buf = [];
  };
  return {
    push(...lines){ for (const l of lines){ buf.push(l); if (buf.length >= chunk) flush(); } },
    blob(){ flush(); return new Blob(parts, { type:'text/plain' }); }
  };
}
