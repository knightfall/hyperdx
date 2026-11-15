import React, { useEffect, useState } from 'react';
import { Buffer } from 'buffer';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DBTraceWaterfallChartContainer } from '@/components/DBTraceWaterfallChart';
import { TimelineMinimap } from '@/components/TimelineChart/TimelineMinimap';
import '@mantine/core/styles.css';

window.Buffer = Buffer;

const parameters = new URLSearchParams(location.search);
const START = Date.UTC(2024, 0, 1);
const traceSource = {
  id: 'traces',
  kind: 'trace',
  name: 'Synthetic traces',
  from: { databaseName: 'benchmark', tableName: 'traces' },
  connection: 'benchmark',
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  statusCodeExpression: 'StatusCode',
  serviceNameExpression: 'ServiceName',
  spanNameExpression: 'SpanName',
  eventAttributesExpression: 'SpanAttributes',
  spanEventsValueExpression: 'SpanEvents',
  highlightedTraceAttributeExpressions: [{ sqlExpression: 'ServiceName' }],
};
const logSource = {
  id: 'logs',
  kind: 'log',
  name: 'Synthetic correlated logs',
  from: { databaseName: 'benchmark', tableName: 'logs' },
  connection: 'benchmark',
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  bodyExpression: 'Body',
  severityTextExpression: 'SeverityText',
  serviceNameExpression: 'ServiceName',
  highlightedTraceAttributeExpressions: [{ sqlExpression: 'ServiceName' }],
};

window.__phases = {};
window.__longTasks = [];
new PerformanceObserver(list => {
  window.__longTasks.push(
    ...list
      .getEntries()
      .map(e => ({ start: e.startTime, duration: e.duration })),
  );
}).observe({ type: 'longtask', buffered: true });
window.__recordPhase = (name, duration) => {
  const phase = (window.__phases[name] ??= {
    totalMs: 0,
    calls: 0,
    longestMs: 0,
  });
  phase.totalMs += duration;
  phase.calls++;
  phase.longestMs = Math.max(phase.longestMs, duration);
};

function Benchmark() {
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    window.__startBenchmark = () => {
      window.__started = performance.now();
      window.__requests = [];
      window.__phases = {};
      window.__longTasks = [];
      setReady(true);
    };
    window.__loaded = true;
  }, []);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 760,
        padding: 16,
      }}
    >
      {ready && (
        <DBTraceWaterfallChartContainer
          traceTableSource={traceSource}
          logTableSource={Number(parameters.get('logs')) ? logSource : null}
          traceId="synthetic-trace"
          dateRange={[new Date(START), new Date(START + 3_600_000)]}
          focusDate={new Date(START + 1_800_000)}
          highlightedRowWhere={selected}
          onClick={row => setSelected(row.id)}
        />
      )}
    </div>
  );
}

function Alignment() {
  const rows = Array.from({ length: 1001 }, () => ({
    events: [
      { start: 25, end: 75, backgroundColor: 'var(--color-chart-blue)' },
    ],
  }));
  useEffect(() => {
    window.__loaded = true;
  }, []);
  return (
    <div style={{ padding: 24 }}>
      <h2>Minimap selection alignment</h2>
      {[0, 500, 1000].map(index => (
        <div key={index} style={{ marginBottom: 32 }}>
          <p>Selected row {index + 1} of 1,001</p>
          <TimelineMinimap
            rows={rows}
            controller={null}
            highlightedRow={{
              index,
              events: [
                {
                  ...rows[index].events[0],
                  backgroundColor: 'var(--color-chart-error)',
                },
              ],
            }}
          />
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <MantineProvider
    forceColorScheme={parameters.get('theme') === 'light' ? 'light' : 'dark'}
  >
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {parameters.get('mode') === 'alignment' ? <Alignment /> : <Benchmark />}
    </QueryClientProvider>
  </MantineProvider>,
);
