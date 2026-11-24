'use strict';

const DEFAULT_LIMITS = Object.freeze({
  divergenceResidual: 1e-2,
  enstrophy: 1e6,
  maxVorticity: 1e3,
  maxScenarios: 32,
  maxStepsPerScenario: 100,
});

function finiteNonNegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite, non-negative number`);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('Pipeline aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function cloneJsonValue(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new TypeError(`${label} must be JSON-serializable`);
  }
}

/**
 * Summarizes caller-provided measurements. This is a threshold-based diagnostic,
 * not a Navier–Stokes solver, proof of stability, or blow-up predictor.
 */
function analyzeFlowMetrics(input, limits = DEFAULT_LIMITS) {
  const flow = input?.flow;
  if (!isRecord(flow)) {
    return { status: 'not-provided', checks: [], flags: [] };
  }

  const checks = [];
  const flags = [];
  const fields = [
    ['divergenceResidual', limits.divergenceResidual],
    ['enstrophy', limits.enstrophy],
    ['maxVorticity', limits.maxVorticity],
  ];

  for (const [field, threshold] of fields) {
    if (flow[field] === undefined) continue;
    const value = finiteNonNegative(flow[field], `flow.${field}`);
    const passed = value <= threshold;
    checks.push({ metric: field, value, threshold, passed });
    if (!passed) flags.push(field);
  }

  return {
    status: checks.length ? 'analyzed' : 'no-metrics',
    checks,
    flags,
    note: 'Threshold checks on supplied metrics only; not a PDE solver or formal stability result.',
  };
}

/**
 * Rolls each scenario forward using a caller-supplied transition function.
 * State is cloned at the boundary so the harness will not mutate caller input.
 */
async function runCounterfactuals(scenarios, transition, options = {}) {
  const { signal, limits = DEFAULT_LIMITS } = options;
  if (scenarios === undefined || scenarios === null) return { status: 'not-provided', runs: [] };
  if (!Array.isArray(scenarios)) throw new TypeError('counterfactuals must be an array');
  if (scenarios.length > limits.maxScenarios) {
    throw new RangeError(`counterfactuals exceeds the limit of ${limits.maxScenarios}`);
  }
  if (scenarios.length && typeof transition !== 'function') {
    throw new TypeError('A transition function is required when counterfactual scenarios are supplied');
  }

  const runs = [];
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    checkAbort(signal);
    if (!isRecord(scenario)) throw new TypeError(`counterfactuals[${scenarioIndex}] must be an object`);
    if (!Array.isArray(scenario.actions)) {
      throw new TypeError(`counterfactuals[${scenarioIndex}].actions must be an array`);
    }
    if (scenario.actions.length > limits.maxStepsPerScenario) {
      throw new RangeError(`counterfactuals[${scenarioIndex}] exceeds the ${limits.maxStepsPerScenario}-step limit`);
    }

    let state = cloneJsonValue(scenario.initialState, `counterfactuals[${scenarioIndex}].initialState`);
    const trace = [];
    for (const [step, action] of scenario.actions.entries()) {
      checkAbort(signal);
      const nextState = await transition(cloneJsonValue(state, 'state'), cloneJsonValue(action, 'action'), {
        scenario: scenario.name ?? `scenario-${scenarioIndex + 1}`,
        step,
        signal,
      });
      if (nextState === undefined) throw new TypeError('transition must return the next state');
      state = cloneJsonValue(nextState, 'transition result');
      trace.push({ step, action: cloneJsonValue(action, 'action'), state: cloneJsonValue(state, 'state') });
    }
    runs.push({ name: scenario.name ?? `scenario-${scenarioIndex + 1}`, finalState: state, trace });
  }

  return { status: 'simulated', runs };
}

/**
 * Creates an injectable two-stage pipeline: flow metric checks followed by
 * optional action-conditioned simulations. No external model is implied.
 */
function createPipeline({ limits: customLimits = {}, transition, clock = () => performance.now() } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  for (const key of ['maxScenarios', 'maxStepsPerScenario']) {
    if (!Number.isInteger(limits[key]) || limits[key] < 0) throw new TypeError(`${key} must be a non-negative integer`);
  }

  return {
    async run(input, { signal } = {}) {
      if (!isRecord(input)) throw new TypeError('input must be an object');
      const telemetry = [];
      const runStage = async (name, fn) => {
        checkAbort(signal);
        const startedAt = clock();
        try {
          const result = await fn();
          telemetry.push({ stage: name, status: 'completed', durationMs: Math.max(0, clock() - startedAt) });
          return result;
        } catch (error) {
          telemetry.push({ stage: name, status: 'failed', durationMs: Math.max(0, clock() - startedAt), error: error.message });
          throw error;
        }
      };

      const diagnostics = await runStage('flow-metric-diagnostics', async () => analyzeFlowMetrics(input, limits));
      const counterfactuals = await runStage('counterfactual-harness', async () =>
        runCounterfactuals(input.counterfactuals, transition, { signal, limits }));

      return {
        architecture: 'Flow Diagnostics + Counterfactual Harness',
        diagnostics,
        counterfactuals,
        telemetry,
        limitations: [
          'Flow checks only compare provided measurements with configured thresholds.',
          'Counterfactual results depend entirely on the caller-provided transition function.',
          'This package does not provide a validated physical simulator or formal PDE guarantees.',
        ],
      };
    },
  };
}

module.exports = { createPipeline, analyzeFlowMetrics, runCounterfactuals, DEFAULT_LIMITS };
