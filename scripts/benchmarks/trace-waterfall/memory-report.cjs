const fs = require('node:fs');
const path = require('node:path');
const {
  median,
  groupResults,
  comparableEnvironment,
  errorSummary,
} = require('./results.cjs');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
const read = filename =>
  fs.existsSync(filename)
    ? JSON.parse(fs.readFileSync(filename, 'utf8'))
    : undefined;
const before = read(path.join(root, 'memory-before/memory-results.json'));
const after =
  read(path.join(root, 'memory-after/memory-results.json')) ||
  read(path.join(root, 'memory-results.json'));
if (!after?.results?.length)
  throw Error(
    'No memory measurements. Run run.cjs --memory --benchmark-only first.',
  );
const baselineGroups = groupResults(before),
  currentGroups = groupResults(after);
const environmentMatches = comparableEnvironment(before, after);
const summarize = runs => ({
  retainedMiB: median(runs.map(r => r.memory?.loaded?.retainedMiB)),
  peakMiB: median(runs.map(r => r.memory?.peakMiB)),
  afterUnmountMiB: median(runs.map(r => r.memory?.unmounted?.retainedMiB)),
  loadMs: median(runs.map(r => r.initialLoadMs)),
  longestTaskMs: median(runs.map(r => r.longestTaskMs)),
});
const format = n => (Number.isFinite(n) ? n.toFixed(2) : 'not recorded');
const rows = [],
  table = [],
  timing = [];
for (const [key, runs] of currentGroups) {
  const previous = environmentMatches ? baselineGroups.get(key) : undefined;
  const baseline = previous?.length ? summarize(previous) : undefined;
  const optimized = summarize(runs);
  const scenario = runs[0].scenario;
  const change =
    baseline?.retainedMiB > 0 && Number.isFinite(optimized.retainedMiB)
      ? (1 - optimized.retainedMiB / baseline.retainedMiB) * 100
      : undefined;
  rows.push({
    scenario,
    baseline,
    optimized,
    baselineRuns: previous?.length ?? 0,
    currentRuns: runs.length,
    retainedReductionPercent: change,
  });
  const label = `${scenario.spans} spans + ${scenario.logs} logs`;
  const pair = field =>
    (baseline ? format(baseline[field]) + ' → ' : '') +
    format(optimized[field]);
  table.push(
    `| ${label} | ${previous?.length ?? '—'} / ${runs.length} | ${pair('retainedMiB')} MiB | ${pair('afterUnmountMiB')} MiB |`,
  );
  timing.push(
    `| ${label} | ${pair('peakMiB')} MiB | ${pair('loadMs')}ms | ${pair('longestTaskMs')}ms |`,
  );
}
const lines = [
  '# Waterfall memory comparison',
  '',
  `Report generated: ${new Date().toISOString()}.`,
  `Measurements recorded: ${after.environment?.recordedAt ?? 'not recorded'}.`,
  `Benchmark revision: ${after.environment?.commit ?? 'not recorded'}.`,
  '',
  before
    ? 'Medians use matching fixture settings and recorded browser/CPU/mode values.'
    : 'No baseline supplied; current memory measurements only.',
  '',
  '| Fixture | Runs: baseline / current | Retained after load | After closing chart |',
  '| --- | ---: | ---: | ---: |',
  ...table,
  '',
  '| Fixture | Sampled peak | Initial load | Longest load task |',
  '| --- | ---: | ---: | ---: |',
  ...timing,
  '',
  `Runs: ${after.results.length}.`,
  errorSummary(after.results),
  '',
  '## Method and limits',
  '',
  'Retained values come from HeapProfiler.collectGarbage followed by Runtime.getHeapUsage. The sampled peak polls usedJSHeapSize every 20ms and can miss transient peaks during long tasks. These are JavaScript heap measurements, not process RSS or GPU memory.',
  '',
  'The first repetition records sampled live allocations. Initial-load timing in that repetition includes profiler overhead. If interaction flags were also supplied, the retained sample and peak include those interactions. Compare equivalent scenarios and run modes.',
  '',
  `Browser: ${after.environment?.browser ?? 'not recorded'}; CPU: ${after.environment?.cpu?.trim() ?? 'not recorded'}; mode: ${after.environment?.mode ?? 'not recorded'}.`,
  `Browser trace hook: ${after.environment?.browserTraceHook ?? 'coverage not recorded'}.`,
  '',
  'The report summarizes supplied measurements. External tests and lint checks require their own logs. Inspect the saved allocation profiles to investigate retaining paths.',
  '',
  `[Benchmark instructions](${path.join(repo, 'scripts/benchmarks/trace-waterfall/README.md').replaceAll('\\', '/')})`,
];
fs.writeFileSync(path.join(root, 'MEMORY.md'), lines.join('\n') + '\n');
fs.writeFileSync(
  path.join(root, 'memory-comparison.json'),
  JSON.stringify(rows, null, 2),
);
console.log(table.join('\n'));
