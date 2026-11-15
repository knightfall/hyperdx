const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const repo = process.env.WATERFALL_REPO || path.resolve(__dirname, '../../..');
const fromRepo = createRequire(path.join(repo, 'package.json'));
const { chromium } = fromRepo('@playwright/test');
const root =
  process.env.WATERFALL_ARTIFACTS ||
  path.join(repo, 'artifacts/trace-waterfall');
fs.mkdirSync(root, { recursive: true });
const START = Date.UTC(2024, 0, 1);
const traceColumns = [
  'Body',
  'Timestamp',
  'SpanId',
  'ServiceName',
  'Duration',
  'ParentSpanId',
  'StatusCode',
  'SpanAttributes',
  'SpanEvents',
];
const traceTypes = [
  'String',
  'DateTime64(9)',
  'String',
  'String',
  'Float64',
  'String',
  'String',
  'Map(String, String)',
  'Array(Tuple(Timestamp DateTime64(9), Name String, Attributes Map(String, String)))',
];
const logColumns = [
  'Body',
  'Timestamp',
  'SpanId',
  'ServiceName',
  'SeverityText',
];
const logTypes = ['String', 'DateTime64(9)', 'String', 'String', 'String'];

async function fixture(url, response) {
  const p = url.searchParams;
  const trace = p.get('kind') === 'traces';
  const total = Number(p.get(trace ? 'spans' : 'logs')) || 0;
  const count = total / 2;
  const before = p.get('part') === 'before';
  const offset = before ? 0 : count;
  const base = START + (before ? 0 : 1_800_000);
  const padding = 'x'.repeat(Number(p.get('attributeBytes')) || 512);
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-store',
  });
  response.write(
    JSON.stringify(trace ? traceColumns : logColumns) +
      '\n' +
      JSON.stringify(trace ? traceTypes : logTypes) +
      '\n',
  );
  for (let index = 0; index < count; index += 256) {
    const lines = [];
    for (let i = index; i < Math.min(index + 256, count); i++) {
      const ordinal = p.get('shuffle') === '1' ? (i * 8191) % count : i;
      const id = String(ordinal + offset).padStart(16, '0');
      const timestamp = new Date(base + ordinal / 10)
        .toISOString()
        .replace('Z', '000000Z');
      const service = ordinal % 1000 === 0 ? 'api' : 'database';
      const row = trace
        ? [
            `SELECT inventory item ${id}`,
            timestamp,
            id,
            service,
            ordinal % 1000 === 0 ? 0.1 : 0.001,
            ordinal % 1000 === 0
              ? ''
              : String(Math.floor(ordinal / 1000) * 1000 + offset).padStart(
                  16,
                  '0',
                ),
            ordinal % 137 === 0 ? 'Error' : 'Ok',
            {
              'http.request.method': 'GET',
              'http.route': '/api/inventory/:id',
              'db.system': 'postgresql',
              'db.operation': 'SELECT',
              'request.id': id,
              'benchmark.payload': id + padding,
            },
            [
              {
                Timestamp: timestamp,
                Name: 'query.started',
                Attributes: { 'db.system': 'postgresql' },
              },
              {
                Timestamp: timestamp,
                Name: 'query.finished',
                Attributes: { 'db.rows': '1' },
              },
            ],
          ]
        : [
            `Inventory query completed for item ${id}`,
            timestamp,
            String(
              (ordinal % (Number(p.get('spans')) / 2)) +
                (before ? 0 : Number(p.get('spans')) / 2),
            ).padStart(16, '0'),
            service,
            ordinal % 173 === 0 ? 'ERROR' : 'INFO',
          ];
      lines.push(JSON.stringify(row));
    }
    if (!response.write(lines.join('\n') + '\n')) await once(response, 'drain');
    if (response.destroyed) return;
  }
  response.end();
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === '/fixture') {
    fixture(url, response).catch(error => response.destroy(error));
    return;
  }
  if (url.pathname === '/') {
    const variant =
      url.searchParams.get('variant') === 'before' ? 'before' : 'after';
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/${variant}.css"><style>
      *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}
      [data-mantine-color-scheme=dark]{color-scheme:dark;--color-border:#45464a;--color-bg-surface:#25262b;--color-bg-body:#1a1b1e;--color-text-muted:#adb5bd;--color-text-primary:#f1f3f5;--color-chart-blue:#437eef;--color-chart-error:#ff725c;--color-chart-success:#3ca951}
      [data-mantine-color-scheme=light]{color-scheme:light;--color-border:#ced4da;--color-bg-surface:#fff;--color-bg-body:#fff;--color-text-muted:#495057;--color-text-primary:#212529;--color-chart-blue:#437eef;--color-chart-error:#ff725c;--color-chart-success:#3ca951}
      .d-flex{display:flex}.align-items-center{align-items:center}.h-100{height:100%}.text-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cursor-pointer{cursor:pointer}
    </style><div id="root"></div><script src="/${variant}.js"></script>`);
    return;
  }
  const name = url.pathname.slice(1);
  if (!['before.js', 'after.js', 'before.css', 'after.css'].includes(name)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/css',
  });
  fs.createReadStream(path.join(root, name)).pipe(response);
});

async function alignment(browser, base) {
  const results = [];
  for (const variant of ['before', 'after']) {
    for (const dpr of [1, 2]) {
      for (const theme of ['dark', 'light']) {
        const context = await browser.newContext({
          viewport: { width: 1200, height: 530 },
          deviceScaleFactor: dpr,
        });
        const page = await context.newPage();
        page.on('pageerror', error =>
          console.error('Alignment page:', error.message),
        );
        page.on('console', message => {
          if (message.type() === 'error')
            console.error('Alignment console:', message.text());
        });
        await page.goto(
          `${base}/?mode=alignment&variant=${variant}&theme=${theme}`,
        );
        await page.waitForFunction(
          () =>
            window.__loaded &&
            [...document.querySelectorAll('canvas')].every(
              canvas => canvas.dataset.rendering !== 'true',
            ),
        );
        const marks = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid=timeline-minimap]')].map(
            (container, index) => {
              const canvas = container.querySelector('canvas');
              const highlight = container.querySelector(
                '[data-testid=timeline-minimap-highlight]',
              );
              const c = canvas.getBoundingClientRect(),
                h = highlight.getBoundingClientRect();
              const bitmapTop = [20, 34, 48][index];
              const expectedTop = c.top + (bitmapTop / 52) * c.height;
              return {
                row: [0, 500, 1000][index],
                canvasHeight: c.height,
                bitmapHeight: canvas.height,
                errorY: h.top - expectedTop,
                errorHeight: h.height - (2 / 52) * c.height,
              };
            },
          ),
        );
        if (
          variant === 'after' &&
          marks.some(
            m => Math.abs(m.errorY) > 0.03 || Math.abs(m.errorHeight) > 0.03,
          )
        )
          throw new Error('Alignment regression: ' + JSON.stringify(marks));
        await page.screenshot({
          path: path.join(root, `alignment-${variant}-${theme}-dpr${dpr}.png`),
        });
        results.push({ variant, dpr, theme, marks });
        await context.close();
      }
    }
  }
  fs.writeFileSync(
    path.join(root, 'alignment-results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log('Alignment checked in both themes at DPR 1 and 2');
}

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
  if (process.argv.includes('--interactions')) {
    await page
      .getByRole('button', { name: 'Collapse all', exact: true })
      .click();
    const roots = Number(scenario.spans) / 1000;
    await page.waitForFunction(
      count =>
        document.body.innerText.includes(`${count} spans`) &&
        document.querySelector('canvas[data-rendering="false"]'),
      roots,
    );
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await page.waitForFunction(
      count =>
        document.body.innerText.includes(`${count} spans`) &&
        document.querySelector('canvas[data-rendering="false"]'),
      Number(scenario.spans),
    );
    await page.evaluate(() => {
      window.__selectionPaints = 0;
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        window.__selectionPaints++;
        return fill.apply(this, args);
      };
    });
    await page.locator('[data-index="0"]').click();
    await page.waitForSelector('[data-testid=timeline-minimap-highlight]');
    const extraPaints = await page.evaluate(() => window.__selectionPaints);
    if (extraPaints !== 0)
      throw new Error(`Selection redrew the base canvas ${extraPaints} times`);
    result.interactions = {
      collapse: true,
      expand: true,
      selection: true,
      selectionCanvasDraws: extraPaints,
    };
    await page.screenshot({ path: path.join(root, 'optimized-selection.png') });
  }
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
      await alignment(browser, base);
    if (!process.argv.includes('--alignment-only')) {
      const scenarios = process.argv.includes('--shuffle')
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
          process.argv.includes('--smoke') ||
          process.argv.includes('--shuffle') ||
          process.argv.includes('--interactions')
            ? 1
            : 3);
          repetition++
        ) {
          const result = await benchmark(browser, base, scenario, repetition);
          output.results.push(result);
          const outputName = process.argv.includes('--optimized')
            ? process.argv.includes('--interactions')
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
