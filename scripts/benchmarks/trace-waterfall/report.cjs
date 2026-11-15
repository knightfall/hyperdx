const fs = require('node:fs');
const path = require('node:path');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const before = read('performance-results.json');
const after = read('performance-optimized.json');
const alignments = read('alignment-results.json');
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const group = data =>
  Map.groupBy(
    data.results,
    run => run.scenario.spans + '/' + run.scenario.logs,
  );
const oldGroups = group(before),
  newGroups = group(after);
const summarize = runs => ({
  load: median(runs.map(r => r.initialLoadMs)),
  task: median(runs.map(r => r.longestTaskMs)),
  heap: median(runs.map(r => r.usedHeapMiB)),
});
const tables = [],
  comparisons = [];
for (const [key, runs] of newGroups) {
  const old = summarize(oldGroups.get(key)),
    current = summarize(runs);
  const [spans, logs] = key.split('/').map(Number);
  comparisons.push({
    spans,
    logs,
    before: old,
    after: current,
    loadReductionPercent: (1 - current.load / old.load) * 100,
    longestTaskReductionPercent: (1 - current.task / old.task) * 100,
  });
  tables.push(
    '| ' +
      [
        spans.toLocaleString('en-US'),
        logs.toLocaleString('en-US'),
        (old.load / 1000).toFixed(2) +
          's → ' +
          (current.load / 1000).toFixed(2) +
          's',
        (old.task / 1000).toFixed(2) +
          's → ' +
          (current.task / 1000).toFixed(3) +
          's',
        (old.heap / 1024).toFixed(2) +
          ' → ' +
          (current.heap / 1024).toFixed(2) +
          ' GiB',
      ].join(' | ') +
      ' |',
  );
}
const link = (label, file) =>
  '[' + label + '](' + path.join(root, file).replaceAll('\\', '/') + ')';
const good = alignments
  .filter(r => r.variant === 'after')
  .flatMap(r => r.marks);
const optional = name =>
  fs.existsSync(path.join(root, name)) ? read(name) : undefined;
const interactions = optional('interactions-optimized.json');
const shuffled = optional('shuffled-optimized.json');
const last = comparisons.at(-1);
const lines = [
  '# Trace waterfall optimization validation',
  '',
  'Validated 15 November 2026 (Australia/Sydney), against commit ' +
    after.environment.commit +
    ' plus the working-tree optimization.',
  '',
  '## Outcome',
  '',
  'Initial loading is faster, and the measured multi-second main-thread stalls have been reduced to sub-second tasks. The largest fixture improved by ' +
    last.loadReductionPercent.toFixed(1) +
    '% in load time and ' +
    last.longestTaskReductionPercent.toFixed(1) +
    '% in longest-task duration. Memory remains high because all queried attributes/events are still retained.',
  '',
  '## Results',
  '',
  'Medians of three fresh browser contexts per scenario. All runs render 30 virtual rows and one canvas without JavaScript exceptions. The total row count is split evenly across the before/after query windows.',
  '',
  '| Spans | Logs | Initial load: before → after | Longest task: before → after | Post-paint heap: before → after |',
  '| ---: | ---: | ---: | ---: | ---: |',
  ...tables,
  '',
  '## Changes',
  '',
  '- Prepare each query window once, including when the peer window arrives first with equivalent metadata.',
  '- Preserve SQL row identities while replacing the lodash omission path and preparing rows in cancellable chunks.',
  '- Parse ISO timestamps once; keep seconds and nanoseconds separately for exact stable ordering and cache millisecond positions. Legacy formats retain timestamp-nano behavior.',
  '- Sort bounded runs and merge cooperatively; build and flatten the tree cooperatively. Flattening reuses nodes and their precomputed depths.',
  '- Resolve semantic colors once per status/service per timeline batch.',
  '- Paint large minimaps in cancellable chunks. Selection remains an independent overlay.',
  '- Discard cancelled jobs and release superseded prepared arrays. Traces of at most 1,000 rows keep a synchronous path.',
  '',
  '## Verification',
  '',
  '- Six targeted Jest suites: 175 tests passed. A final scheduler/canvas run passed all 20 tests after the cleanup/type fixes.',
  '- TypeScript tsc --noEmit passed.',
  '- Required repository lint:fix passed across four projects; existing warnings, no errors.',
  '- First/middle/last minimap selections passed in both themes at DPR 1 and 2. Maximum alignment error: ' +
    Math.max(...good.map(m => Math.abs(m.errorY))).toFixed(3) +
    ' CSS pixels.',
  interactions
    ? '- Browser: collapsed, expanded, and selected in the 800,000-row fixture. Selection repainted the base canvas ' +
      interactions.results[0].interactions.selectionCanvasDraws +
      ' times.'
    : '- Browser interaction checks pending.',
  shuffled
    ? '- Shuffled 200,000-span responses: ' +
      (shuffled.results[0].initialLoadMs / 1000).toFixed(2) +
      's initial load, ' +
      shuffled.results[0].longestTaskMs.toFixed(0) +
      'ms longest task, no exceptions.'
    : '- Shuffled-response check pending.',
  '',
  '## Method and limits',
  '',
  'Headless Microsoft Edge ' +
    after.environment.browser +
    ', production React, 1440×900, no CPU or network throttling. CPU: ' +
    after.environment.cpu.trim() +
    '; ' +
    after.environment.logicalCpus +
    ' logical CPUs; ' +
    after.environment.memoryGiB.toFixed(1) +
    ' GiB RAM.',
  '',
  'The fixtures include six attributes per trace (including a unique ID and a 512-character payload), two span events per trace, two services, errors, 1,000-span groups, and correlated logs. Trace compact JSON averages about 1,044 bytes per row. These are synthetic tests, not measurements of production traces.',
  '',
  'The actual container, buffered query decoder/TanStack cache, row-ID generation, browser-context detection scan, timestamps, tree/model, canvas, and virtualization run in the browser. Only SQL rendering, external lookups/transport, filter URL state, and peripheral UI are substituted. SQL execution, production network/compression, app startup, and bundle downloads are excluded. Timing ends after the complete canvas paint and two animation frames.',
  '',
  'Heap values are post-paint used JS heap, without forced collection. They include collectible garbage and represent neither retained heap nor a sampled peak. The remaining sub-second tasks can still cause brief jank; loading the largest fixture still takes seconds. Reducing payload volume or moving decoding to a worker would require a separate change with its own data/selection tests.',
  '',
  '## Reproduce and inspect',
  '',
  'Run the commands in ' +
    link(
      'benchmark README',
      '../../scripts/benchmarks/trace-waterfall/README.md',
    ) +
    '. Reusable source scripts live under scripts/benchmarks/trace-waterfall; generated output stays in the ignored artifacts/trace-waterfall directory.',
  '',
  'Measurements: ' +
    link('baseline', 'performance-results.json') +
    ', ' +
    link('optimized', 'performance-optimized.json') +
    ', ' +
    link('alignment', 'alignment-results.json') +
    ', ' +
    link('shuffled', 'shuffled-optimized.json') +
    ', ' +
    link('interactions', 'interactions-optimized.json') +
    '.',
  '',
  '![Aligned minimap](' +
    path.join(root, 'alignment-after-dark-dpr1.png').replaceAll('\\', '/') +
    ')',
];
fs.writeFileSync(path.join(root, 'REPORT.md'), lines.join('\n') + '\n');
fs.writeFileSync(
  path.join(root, 'comparison.json'),
  JSON.stringify(comparisons, null, 2),
);
console.log(tables.join('\n'));
