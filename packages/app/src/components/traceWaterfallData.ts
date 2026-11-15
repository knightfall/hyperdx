import TimestampNano from 'timestamp-nano';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { finishWaterfallTask } from './waterfallTask';

const CHUNK_SIZE = 1000;
const SORT_RUN_SIZE = 16_000;
const ISO_TIMESTAMP =
  /^(?:19[7-9]\d|20\d\d)-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d{1,9}))?(?:Z|[+-]\d\d:\d\d)$/;

export type WaterfallTimestamp = {
  seconds: number;
  nanos: number;
  milliseconds: number;
  isValidDate: boolean;
};

export function parseWaterfallTimestamp(value: string): WaterfallTimestamp {
  const nativeMs = Date.parse(value);
  const match = ISO_TIMESTAMP.exec(value);
  if (match && Number.isFinite(nativeMs)) {
    const nanos = Number(((match[1] ?? '') + '000000000').slice(0, 9));
    return {
      seconds: Math.floor(nativeMs / 1000),
      nanos,
      milliseconds: nativeMs + (nanos % 1_000_000) / 1_000_000,
      isValidDate: true,
    };
  }
  // Keep timestamp-nano's behavior for legacy/non-ISO source expressions.
  const timestamp = TimestampNano.fromString(value);
  const nanos = timestamp.getNano();
  return {
    seconds: timestamp.getTimeT(),
    nanos,
    milliseconds:
      timestamp.toDate().getTime() + (nanos % 1_000_000) / 1_000_000,
    isValidDate: Number.isFinite(nativeMs),
  };
}

export function getWaterfallTimestamp(row: {
  Timestamp: string;
  __waterfallTimestamp?: WaterfallTimestamp;
}) {
  return row.__waterfallTimestamp ?? parseWaterfallTimestamp(row.Timestamp);
}

export function* createWaterfallRows<T, R>(rows: T[], prepare: (row: T) => R) {
  const result: R[] = [];
  for (let i = 0; i < rows.length; i++) {
    result.push(prepare(rows[i]));
    if ((i + 1) % CHUNK_SIZE === 0) yield;
  }
  return result;
}

type TreeRow = {
  id: string;
  SpanId: string;
  ParentSpanId?: string;
  type?: string;
  __hdx_hidden?: boolean | 0 | 1;
};

export type WaterfallNode<T extends TreeRow> = T & {
  children: WaterfallNode<T>[];
  level: number;
};

export function sortWaterfallRows<T extends { Timestamp: string }>(rows: T[]) {
  return finishWaterfallTask(createSortedWaterfallRows(rows));
}

export function* createSortedWaterfallRows<T extends { Timestamp: string }>(
  rows: T[],
) {
  const entries: { row: T; time: WaterfallTimestamp }[] = [];
  const compare = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
    a.time.seconds - b.time.seconds || a.time.nanos - b.time.nanos;
  let ordered = true;
  for (let i = 0; i < rows.length; i++) {
    const time = getWaterfallTimestamp(rows[i]);
    // Match traceExtent: timestamp-nano otherwise invents an instant for bad input.
    if (time.isValidDate) {
      entries.push({ row: rows[i], time });
      const last = entries.length - 1;
      if (last > 0 && compare(entries[last - 1], entries[last]) > 0)
        ordered = false;
    }
    if ((i + 1) % CHUNK_SIZE === 0) yield;
  }
  if (!ordered) {
    for (let start = 0; start < entries.length; start += SORT_RUN_SIZE) {
      const run = entries.slice(start, start + SORT_RUN_SIZE).sort(compare);
      for (let i = 0; i < run.length; i++) entries[start + i] = run[i];
      yield;
    }
    let from = entries;
    let to = new Array<(typeof entries)[number]>(entries.length);
    for (let width = SORT_RUN_SIZE; width < entries.length; width *= 2) {
      for (let start = 0; start < entries.length; start += width * 2) {
        const middle = Math.min(start + width, entries.length);
        const end = Math.min(start + width * 2, entries.length);
        let left = start;
        let right = middle;
        for (let index = start; index < end; index++) {
          to[index] =
            right >= end ||
            (left < middle && compare(from[left], from[right]) <= 0)
              ? from[left++]
              : from[right++];
          if ((index + 1) % CHUNK_SIZE === 0) yield;
        }
      }
      [from, to] = [to, from];
    }
    return yield* createWaterfallRows(from, entry => entry.row);
  }
  return yield* createWaterfallRows(entries, entry => entry.row);
}

export function buildWaterfallTree<T extends TreeRow>(
  rows: T[],
  validSpanIDs: Set<string>,
) {
  return finishWaterfallTask(createWaterfallTree(rows, validSpanIDs));
}

export function* createWaterfallTree<T extends TreeRow>(
  rows: T[],
  validSpanIDs: Set<string>,
) {
  const nodesMap = new Map<string, WaterfallNode<T>>();
  const spans = new Map<string, WaterfallNode<T>>();
  const nodes: WaterfallNode<T>[] = [];
  const rootNodes: WaterfallNode<T>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.SpanId || row.type === SourceKind.Log) {
      const node: WaterfallNode<T> = { ...row, children: [], level: 0 };
      nodes.push(node);
      if (row.type === SourceKind.Trace) {
        nodesMap.set(row.id, node);
        if (!spans.has(row.SpanId)) spans.set(row.SpanId, node);
      }
    }
    if ((i + 1) % CHUNK_SIZE === 0) yield;
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const parentSpanId =
      node.type === SourceKind.Log ? node.SpanId : node.ParentSpanId;
    const parent =
      parentSpanId && validSpanIDs.has(parentSpanId)
        ? spans.get(parentSpanId)
        : undefined;
    if (parent) parent.children.push(node);
    else rootNodes.push(node);
    if ((i + 1) % CHUNK_SIZE === 0) yield;
  }
  const parentIdsByLevel = new Map<number, Set<string>>();
  const stack = rootNodes.slice();
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 0) {
      let ids = parentIdsByLevel.get(node.level);
      if (!ids) {
        ids = new Set();
        parentIdsByLevel.set(node.level, ids);
      }
      ids.add(node.id);
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        child.level = node.level + 1;
        stack.push(child);
        if ((i + 1) % CHUNK_SIZE === 0) yield;
      }
    }
    if (++visited % CHUNK_SIZE === 0) yield;
  }
  return { rootNodes, nodesMap, parentIdsByLevel };
}

export function flattenWaterfallTree<T extends TreeRow>(
  roots: WaterfallNode<T>[],
  collapsedIds: Set<string>,
) {
  return finishWaterfallTask(createFlattenedWaterfallRows(roots, collapsedIds));
}

export function* createFlattenedWaterfallRows<T extends TreeRow>(
  roots: WaterfallNode<T>[],
  collapsedIds: Set<string>,
) {
  const flattened: WaterfallNode<T>[] = [];
  const stack = roots.slice().reverse();
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!node.__hdx_hidden) flattened.push(node);
    if (!collapsedIds.has(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
        if (i % CHUNK_SIZE === 0) yield;
      }
    }
    if (++visited % CHUNK_SIZE === 0) yield;
  }
  return flattened;
}

type DescendantNode = { id?: string; children?: DescendantNode[] };

export function getDescendantIds(node: DescendantNode): string[] {
  const ids: string[] = [];
  const stack = node.children?.slice().reverse() ?? [];
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child.id) ids.push(child.id);
    if (child.children) {
      for (let i = child.children.length - 1; i >= 0; i--) {
        stack.push(child.children[i]);
      }
    }
  }
  return ids;
}
