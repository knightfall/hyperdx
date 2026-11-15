import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { waterfallResultTransform } from '@/components/traceWaterfallAttributes';
import { getBrowserTraceContext } from '@/utils/browserTraceContext';
import { getHttpUrl } from '@/utils/httpUrl';
import { isRpcSpan } from '@/utils/rpcSpanAttributes';

it.each([
  { 'url.full': 'https://example.com/items' },
  {
    'url.scheme': 'https',
    'url.path': '/items',
    'url.query': 'id=1',
    'server.address': 'example.com',
    'server.port': '8443',
  },
  {
    'http.target': '/items',
    'http.scheme': 'https',
    'net.peer.name': 'example.com',
    'net.peer.port': '443',
  },
  {
    'http.url': 'https://example.com/items',
    'rpc.system.name': 'grpc',
    'grpc.method': 'GetItem',
  },
])('preserves URL and RPC label inputs: %p', attributes => {
  const original = {
    ...attributes,
    'db.statement': 'SELECT ' + 'x'.repeat(10000),
  };
  const result = waterfallResultTransform.transform({
    SpanAttributes: original,
  });
  expect(getHttpUrl(result.SpanAttributes)).toBe(getHttpUrl(original));
  expect(isRpcSpan(result.SpanAttributes)).toBe(isRpcSpan(original));
  expect(result.SpanAttributes).toEqual(attributes);
  expect(original['db.statement']).toHaveLength(10007);
});

it.each([
  {
    'browser.document.url.full': 'https://example.com',
    'session.id': 'session',
  },
  {
    browser: { document: { url: { full: 'https://example.com' } } },
    session: { id: 'session' },
  },
])('preserves browser trace context: %p', attributes => {
  const row = {
    Timestamp: '2024-01-01T00:00:00Z',
    Duration: 1,
    ServiceName: 'browser',
    SpanAttributes: { ...attributes, 'benchmark.payload': 'large' },
  };
  expect(
    getBrowserTraceContext([waterfallResultTransform.transform(row)]),
  ).toEqual(getBrowserTraceContext([row]));
  expect(
    getBrowserTraceContext([waterfallResultTransform.transform(row)])
      ?.sessionId,
  ).toBe('session');
});

it('keeps event details, highlighted fields, and row identity inputs', () => {
  const events = [
    {
      Timestamp: '2024-01-01T00:00:00Z',
      Name: 'error',
      Attributes: { message: 'full event details' },
    },
  ];
  const row = {
    SpanId: 'span',
    type: SourceKind.Trace,
    Body: 'body',
    Customer: 'highlighted',
    SpanAttributes: { 'unused.payload': 'large' },
    SpanEvents: events,
  };
  const result = waterfallResultTransform.transform(row);
  expect(result).toEqual({ ...row, SpanAttributes: {} });
  expect(result.SpanEvents).toBe(events);
  expect(row.SpanAttributes).toEqual({ 'unused.payload': 'large' });
});
