/* Every generator's numeric core, keyed by generator id. Shared by the module
   worker and the main-thread fallback, so it must stay free of DOM/THREE like
   the cores themselves. `build[id](recipe, levels)` returns a BuildResult;
   the analyze job reads occupancy only, so it is generator-independent. */
import { createBimoblockCore } from './bimoblock-core.js';
import { createNeoblockCore } from './neoblock-core.js';
import { createFieldCore } from './field-core.js';
import { createDigitCore } from './digit-core.js';
import { createCarryCore } from './carry-core.js';
import { createClaudegenCore } from './claudegen-core.js';
import { createNestCore } from './nest-core.js';
import { createSpacetimeCore } from './spacetime-core.js';

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing instance (the main thread's `Core`) */
export function createCores(bimo = createBimoblockCore()){
  const neo = createNeoblockCore(bimo), field = createFieldCore(bimo), digit = createDigitCore(bimo), carry = createCarryCore(bimo);
  const claudegen = createClaudegenCore(bimo), nest = createNestCore(bimo), spacetime = createSpacetimeCore(bimo);
  return {
    bimo, neo, field, digit, carry, claudegen, nest, spacetime,
    /** @type {Object<string, (recipe:any, levels:import('../types.js').Level[]) => import('../types.js').BuildResult>} */
    build: {
      bimo: bimo.buildBlock,
      neo:  neo.buildNeo,
      field: field.buildField,
      digit: digit.buildDigit,
      carry: carry.buildCarry,
      claudegen: claudegen.buildClaudegen,
      nest: nest.buildNest,
      spacetime: spacetime.buildSpacetime
    }
  };
}
