const fs = require('node:fs');
const path = require('node:path');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
const before = JSON.parse(
  fs.readFileSync(path.join(root, 'memory-before/memory-results.json')),
);
const after = JSON.parse(
  fs.readFileSync(path.join(root, 'memory-after/memory-results.json')),
);
const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (const { scenario } of before.results.filter(r => r.repetition === 1)) {
  const select = data =>
    data.results.filter(
      r =>
        r.scenario.spans === scenario.spans &&
        r.scenario.logs === scenario.logs,
    );
  const summarize = data => ({
    retainedMiB: median(data.map(r => r.memory.loaded.retainedMiB)),
    peakMiB: median(data.map(r => r.memory.peakMiB)),
    afterUnmountMiB: median(data.map(r => r.memory.unmounted.retainedMiB)),
    loadMs: median(data.map(r => r.initialLoadMs)),
    longestTaskMs: median(data.map(r => r.longestTaskMs)),
  });
  const baseline = summarize(select(before));
  const optimized = summarize(select(after));
  rows.push({
    scenario,
    baseline,
    optimized,
    retainedReductionPercent:
      (1 - optimized.retainedMiB / baseline.retainedMiB) * 100,
  });
}
fs.writeFileSync(
  path.join(root, 'memory-comparison.json'),
  JSON.stringify(rows, null, 2),
);
const f = n => Math.round(n).toLocaleString('en-US');
const title = r =>
  `${f(r.scenario.spans)} spans${r.scenario.logs ? ' + ' + f(r.scenario.logs) + ' logs' : ''}`;
const table = rows
  .map(
    r =>
      `| ${title(r)} | ${f(r.baseline.retainedMiB)} → ${f(r.optimized.retainedMiB)} MiB | ${r.retainedReductionPercent.toFixed(1)}% | ${f(r.baseline.afterUnmountMiB)} → ${f(r.optimized.afterUnmountMiB)} MiB |`,
  )
  .join('\n');
const peakTable = rows
  .map(
    r =>
      `| ${title(r)} | ${f(r.baseline.peakMiB)} → ${f(r.optimized.peakMiB)} MiB | ${(r.baseline.loadMs / 1000).toFixed(2)} → ${(r.optimized.loadMs / 1000).toFixed(2)}s | ${f(r.baseline.longestTaskMs)} → ${f(r.optimized.longestTaskMs)}ms |`,
  )
  .join('\n');
const body = `# Waterfall memory optimization

Garbage-collected JavaScript heap, medians of three fresh browser contexts per scenario.

| Fixture | Retained after load | Reduction | After closing chart |
| --- | --- | --- | --- |
${table}

| Fixture | Sampled load peak | Initial load | Longest load task |
| --- | --- | --- | --- |
${peakTable}

## What changed

- Filter unrelated SpanAttributes during decoding, before the query cache retains them. Keep HTTP/RPC label namespaces, browser/session context, complete SpanEvents (including attributes), highlighted columns, and all row-identity fields. Explicitly highlighted whole attribute maps keep their complete representation.
- Isolate transformed results with a versioned cache key. Existing consumers retain their original result format and cache lifetime.
- Waterfall query windows use gcTime=0: the last observer leaving releases the query. Simultaneous observers still share their active result; reopening a closed trace fetches again.
- Decode chunks in a loop so completed read frames can be released during loading.

## Findings and remaining costs

The baseline kept roughly 229 MiB (200,000 spans) or 518 MiB (largest fixture) in its five-minute cache after unmount. Explicitly clearing that cache returned both to about 9 MiB. The optimized chart reaches that level automatically after unmount.

Live-allocation samples identify decoded payloads, SQL predicate strings used as row IDs, prepared/tree rows, timeline events, and virtualizer measurements as the main retained allocations. Larger further reductions would require compact internal row keys and/or loading full span events on demand. These require separate selection, filtering, scrolling, and marker validation. Large attributes in the retained HTTP/RPC namespaces and large event arrays still cost memory.

Filtering is client-side: SQL payload volume is unchanged. This preserves source-schema compatibility but still pays network and JSON parsing costs for the original attributes.

## Verification and limits

Environment: ${after.environment.browser}, ${after.environment.cpu}, ${after.environment.logicalCpus} logical CPUs, ${after.environment.memoryGiB.toFixed(1)} GiB RAM. Production React, no CPU/network throttling, 1440×900. Same synthetic fixture as the existing load benchmark: six attributes including a unique 512-character payload, two span events per trace, and optional correlated logs. Full server query execution, production network/compression, authentication, and app startup are excluded.

Loaded/unmounted measurements use HeapProfiler.collectGarbage then Runtime.getHeapUsage. The sampled load peak polls usedJSHeapSize every 20ms and can miss transient peaks during long tasks. These are JS-heap measurements, not process RSS, GPU memory, or network-buffer measurements. Allocation profiles sample live objects at 64 KiB intervals in the first repetition. Initial-load timing from that repetition includes profiler overhead; these timings should not be treated as production estimates.

The raw results, heap profiles, source maps, screenshots and source-mapped allocation summaries live under memory-before/ and memory-after/. Run the memory mode and report command documented in scripts/benchmarks/trace-waterfall/README.md to reproduce.
`;
fs.writeFileSync(path.join(root, 'MEMORY.md'), body);
console.log(JSON.stringify(rows, null, 2));
