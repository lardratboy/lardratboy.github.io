/* FINGERPRINT VIEW — the focused specimen's filled voxels as one square
   picture (core/fingerprint.js): a pixel per voxel, its grid position as
   RGB. In a panel toggled by the `fingerprint` button or F; the canvas is
   the picture's own size, scaled up for show. Redraws only when the
   focused specimen changes; `png` saves it at one pixel per voxel. */
import { fingerprintRGBA } from '../core/fingerprint.js';
import { Focus } from '../state.js';
import { download, specimenName } from '../export/obj.js';

export class FingerprintView {
  constructor({ virtualiser, toast }){
    this.virtualiser = virtualiser;
    this.toast = toast;
    this.el = document.getElementById('fingerprint');
    this.canvas = this.el.querySelector('canvas');
    this.note = this.el.querySelector('.fpNote');
    this.ctx = this.canvas.getContext('2d');
    this.shown = null;     // { p } last drawn
    this._t = 0;
    document.getElementById('fpPng').addEventListener('click', () => this.savePNG());
    document.getElementById('fpClose').addEventListener('click', () => this.toggle(false));
  }

  get open(){ return !this.el.hidden; }

  toggle(on = !this.open){
    this.el.hidden = !on;
    document.getElementById('fpBtn')?.classList.toggle('on', on);
    this.shown = null;
    if (on) this.refresh();
  }

  refresh(){
    const p = this.virtualiser.at(Focus.i, Focus.j);
    if (this.shown && this.shown.p === p) return;
    this.shown = { p };
    if (!p){
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.note.textContent = `${Focus.i}, ${Focus.j} · minting…`;
      return;
    }
    const { side, data } = fingerprintRGBA(p.inst);
    this.canvas.width = this.canvas.height = side;   // also clears it
    this.ctx.putImageData(new ImageData(data, side, side), 0, 0);
    this.note.textContent = `${Focus.i}, ${Focus.j} · R ${p.R} · ${p.inst.count} voxels · ${side} × ${side}`;
  }

  /* Once per frame; checks a few times a second, like the inspector. */
  tick(dt){
    if (!this.open) return;
    this._t += dt;
    if (this._t < 0.25) return;
    this._t = 0;
    this.refresh();
  }

  savePNG(){
    const p = this.shown?.p;
    if (!p){ this.toast('nothing to save yet'); return; }
    this.canvas.toBlob(blob => {
      download(blob, `${specimenName(p)}_fingerprint.png`);
      this.toast(`fingerprint saved — ${Focus.i}, ${Focus.j}`);
    }, 'image/png');
  }
}
