import TimestampNano from 'timestamp-nano';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  buildWaterfallTree,
  flattenWaterfallTree,
  getDescendantIds,
  sortWaterfallRows,
} from '@/components/traceWaterfallData';
import {
  TRACE_WATERFALL_FETCH_LIMIT,
  TRACE_WATERFALL_ROW_LIMIT,
} from '@/components/traceWaterfallLimits';
import { getWaterfallTimelineRows } from '@/components/traceWaterfallModel';

const row = (id: string, ParentSpanId = '', hidden = false) => ({
  id,
  SpanId: id,
  ParentSpanId,
  type: SourceKind.Trace,
  __hdx_hidden: hidden,
});

it('loads 200,000 spans plus a truncation sentinel per window', () => {
  expect(TRACE_WATERFALL_ROW_LIMIT).toBe(200_000);
  expect(TRACE_WATERFALL_FETCH_LIMIT).toBe(200_001);
});

it('sorts timestamps once per row while preserving nanosecond order and ties', () => {
  const rows = [
    { id: 'later', Timestamp: '2024-01-01T00:00:00.000000002Z' },
    { id: 'trigger', Timestamp: '2024-01-01T00:00:00.000000001Z' },
    { id: 'span', Timestamp: '2024-01-01T00:00:00.000000001Z' },
    { id: 'earlier', Timestamp: '2023-12-31T23:59:59.999999999Z' },
  ];
  const parse = jest.spyOn(TimestampNano, 'fromString');
  expect(sortWaterfallRows(rows).map(row => row.id)).toEqual([
    'earlier',
    'trigger',
    'span',
    'later',
  ]);
  expect(rows[0].id).toBe('later');
  expect(parse).toHaveBeenCalledTimes(4);
  parse.mockRestore();
});

it('prepares timeline positions without reading off-screen span bodies', () => {
  const tree = buildWaterfallTree(
    [
      {
        ...row('root'),
        Timestamp: '2024-01-01T00:00:00.001Z',
        Duration: 0.002,
        aliasWith: [],
      },
    ],
    new Set(['root']),
  );
  const visible = flattenWaterfallTree(tree.rootNodes, new Set());
  Object.defineProperty(visible[0], 'Body', {
    get() {
      throw new Error('Off-screen body was read');
    },
  });
  const rows = getWaterfallTimelineRows(
    visible,
    Date.UTC(2024, 0, 1),
    new Map(),
  );
  expect(rows[0]).toMatchObject({
    id: 'root',
    label: null,
    events: [{ start: 1, end: 3, body: null, tooltip: '' }],
  });
});

it('flattens 200,000 nested spans and collapses without rebuilding the tree', () => {
  const rows = Array.from({ length: 200_000 }, (_, i) =>
    row(String(i), i === 0 ? '' : String(i - 1)),
  );
  const tree = buildWaterfallTree(rows, new Set(rows.map(row => row.SpanId)));
  const expanded = flattenWaterfallTree(tree.rootNodes, new Set());
  expect(expanded).toHaveLength(200_000);
  expect(expanded[199_999]).toMatchObject({ id: '199999', level: 199_999 });
  expect(tree.parentIdsByLevel.get(199_998)).toEqual(new Set(['199998']));
  expect(flattenWaterfallTree(tree.rootNodes, new Set(['0']))).toMatchObject([
    { id: '0', level: 0 },
  ]);
  const descendants = getDescendantIds(tree.rootNodes[0]);
  expect(descendants).toHaveLength(199_999);
  expect(descendants.at(-1)).toBe('199999');
});

it('handles 200,000 siblings without spreading them onto the call stack', () => {
  const rows = [
    row('root'),
    ...Array.from({ length: 199_999 }, (_, i) => row(String(i), 'root')),
  ];
  const tree = buildWaterfallTree(rows, new Set(rows.map(row => row.SpanId)));
  const expanded = flattenWaterfallTree(tree.rootNodes, new Set());
  expect(expanded).toHaveLength(200_000);
  expect(expanded.at(-1)).toMatchObject({ id: '199998', level: 1 });
  expect(getDescendantIds(tree.rootNodes[0])).toHaveLength(199_999);
});

it('keeps hidden descendants, late parents, duplicate spans and orphan logs', () => {
  const rows = [
    row('child', 'root'),
    row('root', '', true),
    { ...row('duplicate'), SpanId: 'root' },
    { ...row('log', 'ignored'), SpanId: 'root', type: SourceKind.Log },
    { ...row('orphan'), SpanId: 'missing', type: SourceKind.Log },
    { ...row('unplaced'), SpanId: '' },
  ];
  const tree = buildWaterfallTree(rows, new Set(['root', 'child']));
  expect(
    flattenWaterfallTree(tree.rootNodes, new Set()).map(n => n.id),
  ).toEqual(['child', 'log', 'duplicate', 'orphan']);
  expect(tree.nodesMap.get('root')?.children.map(n => n.id)).toEqual([
    'child',
    'log',
  ]);
});
