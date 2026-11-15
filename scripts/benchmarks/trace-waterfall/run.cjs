const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const fromRepo = createRequire(path.join(repo, 'package.json'));
const { chromium } = fromRepo('@playwright/test');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
fs.mkdirSync(root, { recursive: true });
const server = require('./fixture.cjs').createFixtureServer(root);

async function benchmark(browser, base, scenario, repetition) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('Benchmark page:', error.stack);
  });
  page.on('console', message => {
    if (message.type() === 'error')
      console.error('Benchmark console:', message.text());
  });
  await page.goto(`${base}/?` + new URLSearchParams(scenario));
  await page.waitForFunction(() => window.__loaded);
  const memory = process.argv.includes('--memory')
    ? await require('./memory.cjs').startMemoryRecording(
        context,
        page,
        root,
        scenario,
        repetition,
      )
    : undefined;
  let profiler;
  if (process.argv.includes('--profile')) {
    profiler = await context.newCDPSession(page);
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 1000 });
    await profiler.send('Profiler.start');
  }
  await page.evaluate(() => window.__startBenchmark());
  try {
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector(
          '[data-testid=timeline-minimap] canvas',
        );
        return (
          canvas &&
          canvas.dataset.rendering !== 'true' &&
          document.querySelectorAll('[data-index]').length > 0
        );
      },
      undefined,
      { timeout: 180000 },
    );
  } catch (error) {
    console.error(
      await page.evaluate(() => ({
        text: document.body.innerText,
        requests: window.__requests,
        phases: window.__phases,
      })),
    );
    throw error;
  }
  const result = await page.evaluate(async () => {
    await new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const ready = performance.now();
    await new Promise(resolve => setTimeout(resolve, 100));
    const longTasks = window.__longTasks.filter(
      task => task.start >= window.__started && task.start < ready,
    );
    const row = document.querySelector('[data-index="0"]');
    const columns = [...row.children].map(
      el => el.getBoundingClientRect().height,
    );
    return {
      initialLoadMs: ready - window.__started,
      longestTaskMs: Math.max(0, ...longTasks.map(t => t.duration)),
      blockingMs: longTasks.reduce(
        (sum, task) => sum + Math.max(0, task.duration - 50),
        0,
      ),
      longTaskCount: longTasks.length,
      usedHeapMiB: performance.memory?.usedJSHeapSize / 1048576,
      phases: window.__phases,
      requests: window.__requests,
      renderedRows: document.querySelectorAll('[data-index]').length,
      canvasCount: document.querySelectorAll('canvas').length,
      text: document.body.innerText.slice(0, 240),
      rowColumnHeights: columns,
    };
  });
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    fs.writeFileSync(
      path.join(
        root,
        process.argv.includes('--optimized')
          ? 'initial-load-optimized.cpuprofile'
          : 'initial-load.cpuprofile',
      ),
      JSON.stringify(profile),
    );
  }
  if (repetition === 1)
    await page.screenshot({
      path: path.join(
        root,
        `load-${scenario.spans}-spans-${scenario.logs}-logs${process.argv.includes('--optimized') ? '-optimized' : ''}.png`,
      ),
    });
  if (
    process.argv.includes('--interactions') ||
    process.argv.includes('--browser-trace')
  ) {
    await memory?.captureBeforeInteractions();
    result.interactions = await require('./interactions.cjs').checkInteractions(
      page,
      scenario,
      root,
    );
  }
  if (memory) result.memory = await memory.finish();
  await context.close();
  return { scenario, repetition, ...result, errors };
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    channel:
      process.env.WATERFALL_BROWSER_CHANNEL ||
      (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  const output = {
    environment: {
      recordedAt: new Date().toISOString(),
      browserTraceHook: process.argv.includes('--browser-trace')
        ? 'real; resource-timing query substituted'
        : 'substituted; server trace fixture',
      workingTreeDirty:
        require('node:child_process')
          .execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
            encoding: 'utf8',
          })
          .trim().length > 0,
      browser: browser.version(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      memoryGiB: os.totalmem() / 1073741824,
      commit: require('node:child_process')
        .execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        })
        .trim(),
      mode: 'production, no CPU/network throttling',
    },
    results: [],
  };
  try {
    if (!process.argv.includes('--benchmark-only'))
      await require('./alignment.cjs').checkAlignment(browser, base, root);
    if (!process.argv.includes('--alignment-only')) {
      const scenarios = process.argv.includes('--browser-trace')
        ? [
            {
              spans: 1002,
              logs: 1002,
              groupSize: 10,
              browserTrace: '1',
              attributeBytes: 512,
            },
          ]
        : process.argv.includes('--memory')
          ? [
              { spans: 200000, logs: 0, attributeBytes: 512 },
              { spans: 400000, logs: 400000, attributeBytes: 512 },
            ]
          : process.argv.includes('--shuffle')
            ? [{ spans: 200000, logs: 0, attributeBytes: 512, shuffle: '1' }]
            : process.argv.includes('--interactions')
              ? [{ spans: 400000, logs: 400000, attributeBytes: 512 }]
              : process.argv.includes('--profile')
                ? [
                    {
                      spans: process.argv.includes('--worst') ? 400000 : 200000,
                      logs: process.argv.includes('--worst') ? 400000 : 0,
                      attributeBytes: 512,
                    },
                  ]
                : process.argv.includes('--smoke')
                  ? [
                      { spans: 200000, logs: 0, attributeBytes: 512 },
                      { spans: 400000, logs: 400000, attributeBytes: 512 },
                    ]
                  : [
                      { spans: 50000, logs: 0, attributeBytes: 512 },
                      { spans: 200000, logs: 0, attributeBytes: 512 },
                      { spans: 400000, logs: 0, attributeBytes: 512 },
                      { spans: 400000, logs: 400000, attributeBytes: 512 },
                    ];
      for (const scenario of scenarios)
        for (
          let repetition = 1;
          repetition <=
          (process.argv.includes('--profile') ||
          process.argv.includes('--browser-trace') ||
          process.argv.includes('--smoke') ||
          process.argv.includes('--shuffle') ||
          process.argv.includes('--interactions')
            ? 1
            : 3);
          repetition++
        ) {
          const result = await benchmark(browser, base, scenario, repetition);
          output.results.push(result);
          if (result.errors.length) process.exitCode = 1;
          const outputName = process.argv.includes('--memory')
            ? 'memory-results.json'
            : process.argv.includes('--optimized')
              ? process.argv.includes('--interactions') ||
                process.argv.includes('--browser-trace')
                ? 'interactions-optimized.json'
                : process.argv.includes('--shuffle')
                  ? 'shuffled-optimized.json'
                  : process.argv.includes('--profile')
                    ? 'profile-optimized.json'
                    : process.argv.includes('--smoke')
                      ? 'smoke-optimized.json'
                      : 'performance-optimized.json'
              : process.argv.includes('--profile')
                ? 'profile-results.json'
                : 'performance-results.json';
          fs.writeFileSync(
            path.join(root, outputName),
            JSON.stringify(output, null, 2),
          );
          console.log(
            JSON.stringify({
              scenario,
              repetition,
              initialLoadMs: result.initialLoadMs,
              longestTaskMs: result.longestTaskMs,
              usedHeapMiB: result.usedHeapMiB,
              memory: result.memory && {
                peakMiB: result.memory.peakMiB,
                loaded: result.memory.loaded,
                unmounted: result.memory.unmounted,
                cleared: result.memory.cleared,
              },
              renderedRows: result.renderedRows,
              errors: result.errors,
            }),
          );
        }
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
