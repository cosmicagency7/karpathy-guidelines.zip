'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPipeline, analyzeFlowMetrics, runCounterfactuals } = require('../src');

test('flow diagnostics flag metrics above configured thresholds', () => {
  const result = analyzeFlowMetrics({ flow: { divergenceResidual: 0.02, enstrophy: 12 } });
  assert.equal(result.status, 'analyzed');
  assert.deepEqual(result.flags, ['divergenceResidual']);
});

test('pipeline runs diagnostics and action-conditioned scenarios', async () => {
  const pipeline = createPipeline({
    transition: (state, action) => ({ position: state.position + action.delta }),
  });
  const input = {
    flow: { divergenceResidual: 0.001 },
    counterfactuals: [{ name: 'forward', initialState: { position: 0 }, actions: [{ delta: 2 }, { delta: 3 }] }],
  };
  const result = await pipeline.run(input);
  assert.equal(result.counterfactuals.runs[0].finalState.position, 5);
  assert.equal(result.telemetry.length, 2);
  assert.equal(input.counterfactuals[0].initialState.position, 0);
});

test('scenario inputs require a transition function', async () => {
  await assert.rejects(
    createPipeline().run({ counterfactuals: [{ initialState: {}, actions: [{}] }] }),
    /transition function is required/,
  );
});

test('scenario and step limits are enforced', async () => {
  const pipeline = createPipeline({ transition: (state) => state, limits: { maxStepsPerScenario: 1 } });
  await assert.rejects(
    pipeline.run({ counterfactuals: [{ initialState: {}, actions: [{}, {}] }] }),
    /step limit/,
  );
});

test('abort signal is respected between rollout steps', async () => {
  const controller = new AbortController();
  const result = await runCounterfactuals(
    [{ initialState: { n: 0 }, actions: [1, 2] }],
    (state, action) => {
      controller.abort();
      return { n: state.n + action };
    },
    { signal: controller.signal },
  ).then(() => null, (error) => error);
  assert.equal(result.name, 'AbortError');
});
