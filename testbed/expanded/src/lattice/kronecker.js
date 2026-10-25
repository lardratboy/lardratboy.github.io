/* Low-discrepancy picks for a lattice address (newground.md §3b). A page
   (i, j) takes t = fract(i·α + j·β + gen·γ) with α = 1/ρ, β = 1/ρ², ρ the
   plastic number: Roberts' R₂ sequence, the most evenly spread 2D
   sequence known. One step along i moves t by 1/ρ ≡ −0.245, along j by
   0.430 the other way, diagonally by 0.325 and 0.185, so with n ≥ 6
   choices no neighbour, diagonal or not, can make the same pick (n ≥ 5
   for the four orthogonal ones). The floor drifts diagonally instead of
   scattering, and re-minting (gen) slides it by the golden angle.
   Pure: no imports, so Node tests can load it. */
const RHO = 1.324717957244746;                      // x³ = x + 1
export const R2 = [1 / RHO, 1 / (RHO * RHO)];
const GEN = (Math.sqrt(5) - 1) / 2;

/** The R₂ phase t ∈ [0, 1) of page (i, j) at mint generation `gen`. */
export function r2Phase(i, j, gen = 0){
  const t = i * R2[0] + j * R2[1] + gen * GEN;
  return t - Math.floor(t);
}

/** One of n choices for page (i, j). */
export function r2Pick(i, j, gen, n){
  return Math.min(n - 1, Math.floor(n * r2Phase(i, j, gen)));
}
