const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
exports.createFixtureServer = root => {
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
    const groupSize = Number(p.get('groupSize')) || 1000;
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
        const service = ordinal % groupSize === 0 ? 'api' : 'database';
        const row = trace
          ? [
              `SELECT inventory item ${id}`,
              timestamp,
              id,
              service,
              ordinal % groupSize === 0 ? 0.1 : 0.001,
              ordinal % groupSize === 0
                ? ''
                : String(
                    Math.floor(ordinal / groupSize) * groupSize + offset,
                  ).padStart(16, '0'),
              ordinal % 137 === 0 ? 'Error' : 'Ok',
              {
                ...(p.get('browserTrace') === '1' && ordinal + offset === 0
                  ? { 'browser.document.url.full': 'https://example.com/' }
                  : {}),
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
      if (!response.write(lines.join('\n') + '\n'))
        await once(response, 'drain');
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
  return server;
};
