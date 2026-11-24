# Flow Diagnostics + Counterfactual Harness

A small Node.js starter project combining two ideas from the supplied concept: checking flow-related measurements and testing action-conditioned alternate scenarios before a real-world action is taken.

## What it does

- Checks optional `flow` metrics against configurable thresholds and reports flags.
- Runs optional counterfactual scenarios through a transition function supplied by your application.
- Clones scenario states at the boundary, supports `AbortSignal`, applies scenario/step limits, and records per-stage timing telemetry.
- Has no model, cloud service, or external dependency hidden behind the API.

## What it does not do

This is not a Navier–Stokes solver, a proof of PDE stability, or a validated physical simulator. Threshold checks describe only the measurements supplied by the caller. Rollout quality and physical fidelity depend on the caller's `transition` implementation. Validate any simulator independently and do not use this sample as the sole basis for safety-critical decisions.

## Quick start

```js
const { createPipeline } = require('./src');

const pipeline = createPipeline({
  transition: (state, action) => ({ x: state.x + action.dx }),
  limits: { maxScenarios: 10, maxStepsPerScenario: 50 },
});

const result = await pipeline.run({
  flow: { divergenceResidual: 0.003, enstrophy: 100 },
  counterfactuals: [{
    name: 'test-action',
    initialState: { x: 0 },
    actions: [{ dx: 1 }, { dx: -0.25 }],
  }],
});

console.log(result.diagnostics, result.counterfactuals, result.telemetry);
```

Run tests with `npm test` (Node.js 18+).

## API

- `createPipeline({ transition, limits, clock })` creates the pipeline. `transition(state, action, context)` returns the next JSON-serializable state.
- `pipeline.run(input, { signal })` accepts optional `input.flow` metrics and optional `input.counterfactuals` scenarios.
- `analyzeFlowMetrics(input, limits)` and `runCounterfactuals(scenarios, transition, options)` are also exported for focused use.

Default thresholds: divergence residual `0.01`, enstrophy `1,000,000`, and maximum vorticity `1,000`. These are example configurable thresholds, not universal physical criteria. Scenario defaults are capped at 32 scenarios and 100 actions per scenario.
