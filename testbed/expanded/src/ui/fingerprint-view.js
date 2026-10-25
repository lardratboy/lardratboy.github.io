/* FINGERPRINT VIEW — the focused specimen unfolded into its 512² Morton
   image (core/fingerprint.js), in a panel toggled by the `fingerprint`
   button or F. Coloured like the lattice: `color: orbit` paints orbit hues,
   every other mode paints grid position. Redraws only when the focused
   specimen or the colour mode changes; `png` saves the full 512 × 512. */
import { Core } from '../core/bimoblock-core.js';
import { FP_GRID, FP_SIDE, fingerprintRGBA } from '../core/fingerprint.js';
import { State, Focus } from '../state.js';
import { download, specimenName } from '../export/obj.js';

export class FingerprintView {
  constructor({ virtualiser, toast }){
    this.virtualiser = virtualiser;
    this.toast = toast;
    this.el = document.getElementById('fingerprint');
    this.canvas = this.el.querySelector('canvas');
    this.note = this.el.querySelector('.fpNote');
    this.ctx = this.canvas.getContext('2d');
    this.shown = null;     // { p, mode } last drawn
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
    const p = this.virtualiser.at(Focus.i, Focus.j), mode = State.colorMode === 'orbit' ? 'orbit' : 'gamut';
    if (this.shown && this.shown.p === p && this.shown.mode === mode) return;
    this.shown = { p, mode };
    if (!p){
      this.ctx.fillStyle = '#0a0816'; this.ctx.fillRect(0, 0, FP_SIDE, FP_SIDE);
      this.note.textContent = `${Focus.i}, ${Focus.j} · minting…`;
      return;
    }
    const rgba = fingerprintRGBA(p.inst, mode, Core.orbitColor);
    this.ctx.putImageData(new ImageData(rgba, FP_SIDE, FP_SIDE), 0, 0);
    this.note.textContent = `${Focus.i}, ${Focus.j} · R ${p.R}` +
      (p.R === FP_GRID ? ' · one pixel per cell' : FP_GRID % p.R === 0 ? ` · ${(FP_GRID / p.R) ** 3} pixels per cell` : ' · resampled to 64³') +
      ` · ${mode === 'orbit' ? 'orbit hue' : 'position colour'}`;
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
