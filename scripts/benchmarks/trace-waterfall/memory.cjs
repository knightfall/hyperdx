const fs = require('node:fs');
const path = require('node:path');
const { SourceMap } = require('node:module');

function summarize(profile, root) {
  const map = new SourceMap(
    JSON.parse(fs.readFileSync(path.join(root, 'after.js.map'), 'utf8')),
  );
  const self = new Map();
  const files = new Map();
  function visit(node, parentLabel, parentSource) {
    const frame = node.callFrame;
    const original = frame.url.includes('/after.js')
      ? map.findEntry(frame.lineNumber, frame.columnNumber)
      : {};
    const source = original.originalSource || parentSource;
    const label = original.originalSource
      ? `${original.originalSource}:${original.originalLine + 1} (${original.name || frame.functionName || 'anonymous'})`
      : parentLabel || frame.functionName || '(browser)';
    self.set(label, (self.get(label) || 0) + node.selfSize);
    files.set(
      source || '(browser)',
      (files.get(source || '(browser)') || 0) + node.selfSize,
    );
    for (const child of node.children) visit(child, label, source);
  }
  visit(profile.head);
  const top = values =>
    [...values]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, bytes]) => ({ name, MiB: bytes / 1048576 }));
  return {
    sampledLiveMiB: [...self.values()].reduce((a, b) => a + b, 0) / 1048576,
    topAllocations: top(self),
    topFiles: top(files),
  };
}

exports.startMemoryRecording = async (
  context,
  page,
  root,
  scenario,
  repetition,
) => {
  const session = await context.newCDPSession(page);
  await session.send('HeapProfiler.enable');
  async function measure() {
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await session.send('HeapProfiler.collectGarbage');
    const heap = await session.send('Runtime.getHeapUsage');
    return {
      retainedMiB: heap.usedSize / 1048576,
      backingStorageMiB: heap.backingStorageSize / 1048576,
    };
  }
  const startup = await measure();
  if (repetition === 1)
    await session.send('HeapProfiler.startSampling', {
      samplingInterval: 65536,
    });
  await page.evaluate(() => {
    window.__heapPeak = 0;
    window.__heapTimer = setInterval(() => {
      window.__heapPeak = Math.max(
        window.__heapPeak,
        performance.memory.usedJSHeapSize,
      );
    }, 20);
  });
  return {
    finish: async () => {
      const peakMiB = await page.evaluate(() => {
        clearInterval(window.__heapTimer);
        return (
          Math.max(window.__heapPeak, performance.memory.usedJSHeapSize) /
          1048576
        );
      });
      const loaded = await measure();
      let allocations;
      if (repetition === 1) {
        const { profile } = await session.send('HeapProfiler.stopSampling');
        const name = `memory-${scenario.spans}-spans-${scenario.logs}-logs`;
        fs.writeFileSync(
          path.join(root, name + '.heapprofile'),
          JSON.stringify(profile),
        );
        allocations = summarize(profile, root);
        fs.writeFileSync(
          path.join(root, name + '-allocations.json'),
          JSON.stringify(allocations, null, 2),
        );
      }
      const queryRows = await page.evaluate(() =>
        window.__queryClient
          .getQueryCache()
          .getAll()
          .map(q => ({
            rows:
              q.state.data?.pages?.reduce(
                (count, p) => count + p.data.length,
                0,
              ) || 0,
            observers: q.getObserversCount(),
          })),
      );
      await page.evaluate(() => window.__stopBenchmark());
      await page.waitForFunction(() => !document.querySelector('canvas'));
      const unmounted = await measure();
      await page.evaluate(() => window.__queryClient.clear());
      const cleared = await measure();
      return {
        startup,
        peakMiB,
        loaded,
        unmounted,
        cleared,
        queryRows,
        allocations,
      };
    },
  };
};
