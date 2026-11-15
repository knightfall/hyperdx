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
const read = name => {
  const filename = path.join(root, name);
  return fs.existsSync(filename)
    ? JSON.parse(fs.readFileSync(filename, 'utf8'))
    : undefined;
};
const after = read('performance-optimized.json');
if (!after?.results?.length)
  throw new Error(
    'No optimized measurements. Run build.cjs and run.cjs --optimized first.',
  );
const before = read('performance-results.json');
const oldGroups = groupResults(before),
  newGroups = groupResults(after);
const summarize = runs => ({
  load: median(runs.map(r => r.initialLoadMs)),
  task: median(runs.map(r => r.longestTaskMs)),
  heap: median(runs.map(r => r.usedHeapMiB)),
});
const comparable = comparableEnvironment(before, after);
const comparisons = [],
  tables = [],
  outcomes = [];
const number = n => (Number.isFinite(n) ? n.toFixed(2) : 'not recorded');
const seconds = n =>
  Number.isFinite(n) ? (n / 1000).toFixed(3) + 's' : 'not recorded';
for (const [fixture, runs] of newGroups) {
  const current = summarize(runs);
  const baselineRuns = comparable ? oldGroups.get(fixture) : undefined;
  const old = baselineRuns?.length ? summarize(baselineRuns) : undefined;
  const { spans, logs, ...settings } = runs[0].scenario;
  const label = `${Number(spans).toLocaleString('en-US')} spans + ${Number(logs).toLocaleString('en-US')} logs (${JSON.stringify(settings)})`;
  if (old && Number.isFinite(old.load) && Number.isFinite(current.load)) {
    const loadReductionPercent =
      old.load > 0 ? (1 - current.load / old.load) * 100 : undefined;
    const longestTaskReductionPercent =
      old.task > 0 ? (1 - current.task / old.task) * 100 : undefined;
    comparisons.push({
      spans,
      logs,
      scenario: runs[0].scenario,
      before: old,
      after: current,
      loadReductionPercent,
      longestTaskReductionPercent,
    });
    const change =
      loadReductionPercent > 0
        ? `decreased by ${loadReductionPercent.toFixed(1)}%`
        : loadReductionPercent < 0
          ? `increased by ${(-loadReductionPercent).toFixed(1)}%`
          : old.load === current.load
            ? 'was unchanged'
            : `changed from ${seconds(old.load)} to ${seconds(current.load)} (percentage unavailable)`;
    outcomes.push(`- ${label}: median load ${change}.`);
  } else
    outcomes.push(
      `- ${label}: No comparable baseline; current measurements only.`,
    );
  tables.push(
    `| ${label} | ${baselineRuns?.length ?? '—'} / ${runs.length} | ${old ? seconds(old.load) + ' → ' : ''}${seconds(current.load)} | ${old ? seconds(old.task) + ' → ' : ''}${seconds(current.task)} | ${old ? number(old.heap) + ' → ' : ''}${number(current.heap)} MiB |`,
  );
}
const runs = after.results;
const values = field => {
  const recorded = [...new Set(runs.map(r => r[field]).filter(v => v != null))];
  return recorded.length ? recorded.join(', ') : 'not recorded';
};
const lines = [
  '# Trace waterfall benchmark',
  '',
  `Report generated: ${new Date().toISOString()}.`,
  `Measurements recorded: ${after.environment?.recordedAt ?? 'not recorded'}.`,
  `Benchmark revision: ${after.environment?.commit ?? 'not recorded'}; working tree: ${after.environment?.workingTreeDirty === undefined ? 'not recorded' : after.environment.workingTreeDirty ? 'modified' : 'clean'}.`,
  '',
  '## Measurements',
  '',
  before
    ? 'Baseline comparisons use matching fixture settings and recorded browser/CPU/mode values.'
    : 'No baseline supplied. Collect performance-results.json on the baseline revision to enable comparisons.',
  '',
  ...outcomes,
  '',
  '| Fixture | Runs: baseline / current | Median initial load | Median longest task | Median post-paint JS heap |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...tables,
  '',
  `Runs: ${runs.length}. Rendered rows: ${values('renderedRows')}. Canvases: ${values('canvasCount')}.`,
  errorSummary(runs),
  '',
  '## Recorded interaction checks',
  '',
];
const alignments = read('alignment-results.json');
const marks =
  alignments?.filter(r => r.variant === 'after').flatMap(r => r.marks) ?? [];
if (
  marks.length &&
  marks.every(m => Number.isFinite(m.errorY) && Number.isFinite(m.errorHeight))
) {
  const failed = marks.filter(
    m => Math.abs(m.errorY) > 0.03 || Math.abs(m.errorHeight) > 0.03,
  ).length;
  lines.push(
    `Alignment samples: ${marks.length}; outside 0.03 CSS pixels: ${failed}; maximum vertical error: ${Math.max(...marks.map(m => Math.abs(m.errorY))).toFixed(3)} CSS pixels.`,
  );
} else lines.push('Complete alignment measurements were not supplied.');
const interactions = read('interactions-optimized.json');
if (interactions?.results?.length) {
  for (const run of interactions.results) {
    const check = run.interactions ?? {};
    lines.push(
      `- ${run.scenario.spans} spans / ${run.scenario.logs} logs: collapse=${check.collapse ?? 'not recorded'}, expand=${check.expand ?? 'not recorded'}, selection=${check.selection ?? 'not recorded'}, viewport preserved=${check.viewportPreserved ?? 'not recorded'}, selection canvas draws=${check.selectionCanvasDraws ?? 'not recorded'}.`,
    );
  }
} else lines.push('Interaction measurements were not supplied.');
lines.push(
  '',
  '## Method and limits',
  '',
  `Browser: ${after.environment?.browser ?? 'not recorded'}; CPU: ${after.environment?.cpu?.trim() ?? 'not recorded'}; mode: ${after.environment?.mode ?? 'not recorded'}.`,
  `Browser trace hook: ${after.environment?.browserTraceHook ?? 'coverage not recorded'}.`,
  '',
  'This synthetic benchmark measures the production React waterfall, buffered decoder, row identities, preparation, minimap paint, and visible rows. SQL execution, production network/compression, authentication, metadata lookups, and application startup are excluded.',
  '',
  'Heap measurements include collectible garbage unless the memory mode explicitly reports a value after collection. These are JavaScript heap measurements, not process memory. Input runs with exceptions or incomplete instrumentation should be investigated before drawing performance conclusions.',
  '',
  'The report summarizes supplied browser results. External test and lint checks require their own logs.',
  '',
  '## Source artifacts',
  '',
  `[Benchmark instructions](${path.join(repo, 'scripts/benchmarks/trace-waterfall/README.md').replaceAll('\\', '/')})`,
);
for (const name of [
  'performance-results.json',
  'performance-optimized.json',
  'alignment-results.json',
  'interactions-optimized.json',
  'shuffled-optimized.json',
]) {
  if (fs.existsSync(path.join(root, name)))
    lines.push(`- [${name}](${path.join(root, name).replaceAll('\\', '/')})`);
}
fs.writeFileSync(path.join(root, 'REPORT.md'), lines.join('\n') + '\n');
fs.writeFileSync(
  path.join(root, 'comparison.json'),
  JSON.stringify(comparisons, null, 2),
);
console.log(tables.join('\n'));
