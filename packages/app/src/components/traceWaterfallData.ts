import TimestampNano from 'timestamp-nano';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

type TreeRow = {
  id: string;
  SpanId: string;
  ParentSpanId?: string;
  type?: string;
  __hdx_hidden?: boolean | 0 | 1;
};

export type WaterfallNode<T extends TreeRow> = T & {
  children: WaterfallNode<T>[];
};

export function sortWaterfallRows<T extends { Timestamp: string }>(rows: T[]) {
  return rows
    .map(row => {
      const timestamp = TimestampNano.fromString(row.Timestamp);
      return {
        row,
        seconds: timestamp.getTimeT(),
        nanos: timestamp.getNano(),
      };
    })
    .sort((a, b) => a.seconds - b.seconds || a.nanos - b.nanos)
    .map(({ row }) => row);
}

export function buildWaterfallTree<T extends TreeRow>(
  rows: T[],
  validSpanIDs: Set<string>,
) {
  const nodesMap = new Map<string, WaterfallNode<T>>();
  const spans = new Map<string, WaterfallNode<T>>();
  const nodes: WaterfallNode<T>[] = [];
  const rootNodes: WaterfallNode<T>[] = [];

  // Index parents first: spans may arrive after their children, and logs share
  // their span's ID. Only the first trace span can be a parent.
  for (const row of rows) {
    if (!row.SpanId && row.type !== SourceKind.Log) continue;
    const node: WaterfallNode<T> = { ...row, children: [] };
    nodes.push(node);
    if (row.type === SourceKind.Trace) {
      nodesMap.set(row.id, node);
      if (!spans.has(row.SpanId)) spans.set(row.SpanId, node);
    }
  }

  for (const node of nodes) {
    const parentSpanId =
      node.type === SourceKind.Log ? node.SpanId : node.ParentSpanId;
    const parent =
      parentSpanId && validSpanIDs.has(parentSpanId)
        ? spans.get(parentSpanId)
        : undefined;
    if (parent) parent.children.push(node);
    else rootNodes.push(node);
  }

  const parentIdsByLevel = new Map<number, Set<string>>();
  const stack = rootNodes.map(node => ({ node, level: 0 }));
  while (stack.length > 0) {
    const { node, level } = stack.pop()!;
    if (node.children.length > 0) {
      let ids = parentIdsByLevel.get(level);
      if (!ids) {
        ids = new Set();
        parentIdsByLevel.set(level, ids);
      }
      ids.add(node.id);
      for (const child of node.children) {
        stack.push({ node: child, level: level + 1 });
      }
    }
  }
  return { rootNodes, nodesMap, parentIdsByLevel };
}

export function flattenWaterfallTree<T extends TreeRow>(
  roots: WaterfallNode<T>[],
  collapsedIds: Set<string>,
) {
  const flattened: (WaterfallNode<T> & { level: number })[] = [];
  const stack = roots.map(node => ({ node, level: 0 })).reverse();
  while (stack.length > 0) {
    const { node, level } = stack.pop()!;
    // Hidden parents still contribute depth and allow visible descendants.
    if (!node.__hdx_hidden) flattened.push({ ...node, level });
    if (collapsedIds.has(node.id)) continue;
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i], level: level + 1 });
    }
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
