/* Worker jobs contain only numeric input. Rendering objects never cross threads.
   Shared by the module worker and the main-thread 'compatibility' fallback. */
/** @param {ReturnType<typeof import('./cores.js').createCores>} cores
 *  @param {import('../types.js').JobMessage} job
 *  @returns {import('../types.js').BuildResult | {aut:number, analysisMs:number}} */
export function runNumericJob(cores, job){
  if (job.type === 'build'){
    const build = cores.build[job.generator];
    if (!build) throw new Error('Unknown generator: ' + job.generator);
    return build(job.recipe, job.levels);
  }
  if (job.type === 'analyze'){
    const started = performance.now();
    return { aut: cores.bimo.autOrder(job.occ, job.R), analysisMs: performance.now() - started };
  }
  throw new Error('Unknown generation job: ' + job.type);
}
