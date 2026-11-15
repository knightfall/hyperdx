import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = path.join(
  repo,
  'artifacts/trace-waterfall/review-fixes/report-tests',
);
fs.mkdirSync(root, { recursive: true });
const environment = {
  recordedAt: '2026-11-16T01:23:45Z',
  commit: 'fixture',
  browser: 'test',
  cpu: 'test',
  logicalCpus: 1,
  memoryGiB: 8,
};
const run = (load = 1000, extra = {}) => ({
  scenario: { spans: 200000, logs: 0, attributeBytes: 512 },
  repetition: 1,
  initialLoadMs: load,
  longestTaskMs: load,
  usedHeapMiB: 100,
  renderedRows: 30,
  canvasCount: 1,
  errors: [],
  ...extra,
});
function report(t, after, before, script = 'report.cjs') {
  const folder = fs.mkdtempSync(path.join(root, 'report-test-'));
  t.after(() => {
    if (path.dirname(path.resolve(folder)) !== path.resolve(root))
      throw Error('Unexpected fixture path');
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const memory = script === 'memory-report.cjs';
  if (memory) {
    fs.mkdirSync(path.join(folder, 'memory-after'));
    fs.mkdirSync(path.join(folder, 'memory-before'));
  }
  fs.writeFileSync(
    path.join(
      folder,
      memory
        ? 'memory-after/memory-results.json'
        : 'performance-optimized.json',
    ),
    JSON.stringify({ environment, results: after }),
  );
  if (before)
    fs.writeFileSync(
      path.join(
        folder,
        memory
          ? 'memory-before/memory-results.json'
          : 'performance-results.json',
      ),
      JSON.stringify({ environment, results: before }),
    );
  fs.writeFileSync(
    path.join(folder, 'alignment-results.json'),
    JSON.stringify([
      { variant: 'after', marks: [{ errorY: 0, errorHeight: 0 }] },
    ]),
  );
  const result = spawnSync(
    process.execPath,
    [path.join(repo, 'scripts/benchmarks/trace-waterfall', script)],
    { env: { ...process.env, WATERFALL_ARTIFACTS: folder }, encoding: 'utf8' },
  );
  const markdown = memory ? 'MEMORY.md' : 'REPORT.md';
  const comparison = memory ? 'memory-comparison.json' : 'comparison.json';
  return {
    ...result,
    markdown: fs.existsSync(path.join(folder, markdown))
      ? fs.readFileSync(path.join(folder, markdown), 'utf8')
      : '',
    comparisons: fs.existsSync(path.join(folder, comparison))
      ? JSON.parse(fs.readFileSync(path.join(folder, comparison)))
      : [],
  };
}

test('fresh optimized-only runs generate a standalone report', t => {
  const result = report(t, [run()]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /No baseline/i);
  assert.doesNotMatch(
    result.markdown,
    /175 tests passed|tsc --noEmit passed|lint:fix passed/,
  );
});

test('reports slower loads and captured errors without inventing passing checks', t => {
  const result = report(
    t,
    [
      run(2000, {
        renderedRows: 7,
        canvasCount: 2,
        errors: ['failure one', 'failure two'],
      }),
    ],
    [run()],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /increased by 100\.0%/);
  assert.match(result.markdown, /exceptions: 2/);
  assert.match(result.markdown, /Rendered rows: 7/);
  assert.match(result.markdown, /Canvases: 2/);
  assert.doesNotMatch(
    result.markdown,
    /Initial loading is faster|without JavaScript exceptions|175 tests passed|TypeScript.*passed|lint.*passed/,
  );
  assert.match(result.markdown, /2026-11-16/);
});

test('derives repetition counts and medians from the supplied runs', t => {
  const result = report(
    t,
    [run(1000), run(3000, { repetition: 2 }), run(2000, { repetition: 3 })],
    [run(4000)],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /Runs: 3/);
  assert.equal(result.comparisons[0].after.load, 2000);
  assert.equal(result.comparisons[0].loadReductionPercent, 50);
});

test('does not compare different payload fixtures', t => {
  const result = report(
    t,
    [run()],
    [run(4000, { scenario: { spans: 200000, logs: 0, attributeBytes: 256 } })],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.comparisons.length, 0);
  assert.match(result.markdown, /No comparable baseline/i);
});

test('missing error capture is reported as unknown', t => {
  const { errors, ...unrecorded } = run();
  const result = report(t, [unrecorded]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /Error capture missing/);
  assert.doesNotMatch(result.markdown, /exceptions: 0/);
});

test('zero baselines do not produce false unchanged or percentage claims', t => {
  const result = report(t, [run(1000)], [run(0)]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /percentage unavailable/);
  assert.doesNotMatch(
    result.markdown,
    /median load was unchanged|Infinity|NaN/,
  );
});

test('memory reports derive closure, sample counts, and errors from current measurements', t => {
  const before = run(1000, {
    memory: {
      loaded: { retainedMiB: 500 },
      peakMiB: 600,
      unmounted: { retainedMiB: 50 },
    },
  });
  const after = run(2000, {
    errors: ['actual error'],
    memory: {
      loaded: { retainedMiB: 400 },
      peakMiB: 550,
      unmounted: { retainedMiB: 10 },
    },
  });
  const result = report(t, [after], [before], 'memory-report.cjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /Runs: 1/);
  assert.match(result.markdown, /50.00 → 10.00 MiB/);
  assert.match(result.markdown, /exceptions: 1/);
  assert.doesNotMatch(
    result.markdown,
    /three fresh|229 MiB|518 MiB|tests passed|lint.*passed/,
  );
});

test('memory reports also support current-only measurements', t => {
  const after = run(1000, {
    memory: {
      loaded: { retainedMiB: 400 },
      peakMiB: 550,
      unmounted: { retainedMiB: 10 },
    },
  });
  const result = report(t, [after], undefined, 'memory-report.cjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /No baseline/);
});

test('does not compare interaction runs with initial-load runs', t => {
  const result = report(
    t,
    [run(1000, { interactions: { collapse: true } })],
    [run(4000)],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.comparisons.length, 0);
  assert.match(result.markdown, /No comparable baseline/);
});
