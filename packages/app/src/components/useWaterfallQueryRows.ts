import { useCallback } from 'react';
import type { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import type { SourceKind } from '@hyperdx/common-utils/dist/types';

import useRowWhere from '@/hooks/useRowWhere';

import {
  createWaterfallRows,
  parseWaterfallTimestamp,
} from './traceWaterfallData';
import type { WaterfallRow } from './traceWaterfallModel';
import useWaterfallTask from './useWaterfallTask';

const EMPTY_ROWS: Record<string, any>[] = [];

export default function useWaterfallQueryRows(
  rows: Record<string, any>[],
  meta: ColumnMetaType[] | undefined,
  aliasMap: Record<string, string>,
  type: SourceKind,
) {
  // Each window keeps its own metadata/callback identity when its peer arrives.
  const getRowWhere = useRowWhere({ meta, aliasMap });
  const prepareRow = useCallback(
    (row: Record<string, any>): WaterfallRow => {
      const {
        SpanAttributes: _attributes,
        SpanEvents: _events,
        __hdx_hidden: _hidden,
        SeverityNumber: _severity,
        ...identity
      } = row ?? {};
      const { where } = getRowWhere(identity);
      return {
        ...row,
        Timestamp: row?.Timestamp,
        SpanId: row?.SpanId,
        ParentSpanId: row?.ParentSpanId,
        Duration: row?.Duration,
        __hdx_hidden: row?.__hdx_hidden,
        type,
        id: where,
        // The WHERE already uses raw expressions; WITH aliases are redundant.
        aliasWith: [],
        __waterfallTimestamp:
          typeof row?.Timestamp === 'string'
            ? parseWaterfallTimestamp(row.Timestamp)
            : undefined,
      };
    },
    [getRowWhere, type],
  );
  const prepare = useCallback(
    () => createWaterfallRows(meta?.length ? rows : EMPTY_ROWS, prepareRow),
    [meta, rows, prepareRow],
  );
  return useWaterfallTask(prepare, meta?.length ? rows.length : 0);
}
