import { ReactNode, useCallback, useMemo, useState } from 'react';
import _, { omit } from 'lodash';
import { useForm } from 'react-hook-form';
import SqlString from 'sqlstring';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfig,
  ChartConfigWithDateRange,
  SelectList,
  SourceKind,
  TLogSource,
  TSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Box,
  Chip,
  Code,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsRight,
} from '@tabler/icons-react';

import { ContactSupportText } from '@/components/ContactSupportText';
import { ErrorCollapse } from '@/components/Error/ErrorCollapse';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import {
  TimelineChart,
  TimelineMinimap,
  type TimelineViewportController,
} from '@/components/TimelineChart';
import {
  TRACE_WATERFALL_FETCH_LIMIT,
  TRACE_WATERFALL_ROW_LIMIT,
} from '@/components/traceWaterfallLimits';
import { useBrowserTraceEvents } from '@/hooks/useBrowserTraceEvents';
import { useColumns } from '@/hooks/useMetadata';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import {
  RowHighlightHint,
  useRowHighlightHint,
} from '@/hooks/useRowHighlightHint';
import useRowWhere, { WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import {
  getDisplayedTimestampValueExpression,
  getDurationSecondsExpression,
  getEventBody,
  getSpanEventBody,
} from '@/source';
import { useFormatTime } from '@/useFormatTime';
import {
  CATEGORICAL_PALETTE_TOKENS,
  COLORS,
  formatDurationMs,
  parseTimestampToMs,
} from '@/utils';
import {
  getHighlightedAttributesFromData,
  getSelectExpressionsForHighlightedAttributes,
} from '@/utils/highlightedAttributes';

import { DBHighlightedAttributesList } from './DBHighlightedAttributesList';
import {
  buildWaterfallTree,
  flattenWaterfallTree,
  getDescendantIds,
  sortWaterfallRows,
} from './traceWaterfallData';
import {
  getRowSeverity,
  getWaterfallTimelineRows,
  type WaterfallRow,
} from './traceWaterfallModel';
import { renderWaterfallRow } from './traceWaterfallRow';

export { getDescendantIds } from './traceWaterfallData';

export type SpanRow = {
  Body: string;
  Timestamp: string;
  Duration: number; // seconds
  SpanId: string;
  ParentSpanId: string;
  StatusCode?: string;
  ServiceName?: string;
  SeverityText?: string;
  SeverityNumber?: number;
  HyperDXEventType: 'span';
  type?: string;
  SpanAttributes?: Record<string, any>;
  SpanEvents?: Array<{
    Timestamp: string;
    Name: string;
    Attributes: Record<string, any>;
  }>;
  __hdx_hidden?: boolean | 1 | 0;
  triggeredBy?: string;
};

// Per-service span palette: the full categorical palette minus the two hues we
// reserve for semantics — green (correlated log rows) and red (errors) —
// so a service color is never confused with a log or an error. Index-aligned
// with CATEGORICAL_PALETTE_TOKENS, so filtering by token survives reordering.
const SERVICE_COLORS = COLORS.filter(
  (_color, i) =>
    CATEGORICAL_PALETTE_TOKENS[i] !== 'chart-green' &&
    CATEGORICAL_PALETTE_TOKENS[i] !== 'chart-red',
);

// Stable empty fallback. `data ?? []` would allocate a new array every render
// and invalidate every memo downstream of the waterfall rows.
const EMPTY_ROWS: Record<string, any>[] = [];

export function TraceTotalDurationStat({
  totalDurationMs,
  isTruncated,
}: {
  totalDurationMs: number;
  isTruncated: boolean;
}) {
  return (
    <Tooltip
      label={
        isTruncated
          ? `This duration is a lower bound because some spans may not have been loaded. The trace may extend past the loaded time window, or contain more than ${TRACE_WATERFALL_ROW_LIMIT.toLocaleString()} spans.`
          : 'Wall-clock duration from the earliest fetched span start to the latest span end. Independent of the applied filters.'
      }
      position="bottom"
    >
      <span data-testid="trace-total-stats">
        {' '}
        &middot; Total duration: {formatDurationMs(totalDurationMs)}
        {isTruncated ? '+' : ''}
      </span>
    </Tooltip>
  );
}

function getTableBody(tableModel: TSource) {
  if (tableModel?.kind === SourceKind.Trace) {
    return getSpanEventBody(tableModel) ?? '';
  } else if (tableModel?.kind === SourceKind.Log) {
    return getEventBody(tableModel) ?? '';
  } else {
    return '';
  }
}

function getConfig(
  source: TTraceSource | TLogSource,
  traceId: string,
  hiddenRowExpression?: string,
  hiddenRowExpressionLanguage: 'lucene' | 'sql' = 'lucene',
  selectSeverityNumber = false,
) {
  const alias: Record<string, string> = {
    Body: getTableBody(source),
    Timestamp: getDisplayedTimestampValueExpression(source),
    Duration:
      source.kind === SourceKind.Trace && source.durationExpression
        ? getDurationSecondsExpression(source)
        : '',
    TraceId: source.traceIdExpression ?? '',
    SpanId: source.spanIdExpression ?? '',
    ParentSpanId:
      source.kind === SourceKind.Trace
        ? (source.parentSpanIdExpression ?? '')
        : '',
    StatusCode:
      source.kind === SourceKind.Trace
        ? (source.statusCodeExpression ?? '')
        : '',
    ServiceName: source.serviceNameExpression ?? '',
    SeverityText:
      source.kind === SourceKind.Log
        ? (source.severityTextExpression ?? '')
        : '',
    SpanAttributes: source.eventAttributesExpression ?? '',
    SpanEvents:
      source.kind === SourceKind.Trace
        ? (source.spanEventsValueExpression ?? '')
        : '',
  };

  // Aliases for trace attributes must be added here to ensure
  // the returned `alias` object includes them and useRowWhere works.
  if (source.highlightedTraceAttributeExpressions) {
    for (const expr of source.highlightedTraceAttributeExpressions) {
      if (expr.alias) {
        alias[expr.alias] = expr.sqlExpression;
      }
    }
  }

  const select: SelectList = [
    {
      valueExpression: alias.Body,
      alias: 'Body',
    },
    {
      valueExpression: alias.Timestamp,
      alias: 'Timestamp',
    },
    {
      valueExpression: alias.SpanId,
      alias: 'SpanId',
    },
    ...(alias.ServiceName
      ? [
          {
            valueExpression: alias.ServiceName,
            alias: 'ServiceName',
          },
        ]
      : []),
    ...(hiddenRowExpression
      ? [
          {
            valueExpression: hiddenRowExpression,
            valueExpressionLanguage: hiddenRowExpressionLanguage,
            alias: '__hdx_hidden',
          },
        ]
      : []),
  ];

  if (source.kind === SourceKind.Trace || source.kind === SourceKind.Log) {
    select.push(
      ...getSelectExpressionsForHighlightedAttributes(
        source.highlightedTraceAttributeExpressions,
      ),
    );
  }

  if (hiddenRowExpression) {
    alias['__hdx_hidden'] = hiddenRowExpression;
  }

  if (source.kind === SourceKind.Trace) {
    select.push(
      ...[
        {
          // in Seconds, f64 holds ns precision for durations up to ~3 months
          valueExpression: alias.Duration,
          alias: 'Duration',
        },
        {
          valueExpression: alias.ParentSpanId,
          alias: 'ParentSpanId',
        },
        ...(alias.StatusCode
          ? [
              {
                valueExpression: alias.StatusCode,
                alias: 'StatusCode',
              },
            ]
          : []),
        ...(alias.SpanAttributes
          ? [
              {
                valueExpression: alias.SpanAttributes,
                alias: 'SpanAttributes',
              },
            ]
          : []),
        ...(alias.SpanEvents
          ? [
              {
                valueExpression: alias.SpanEvents,
                alias: 'SpanEvents',
              },
            ]
          : []),
      ],
    );
  } else if (source.kind === SourceKind.Log) {
    select.push(
      ...[
        ...(alias.SeverityText
          ? [
              {
                valueExpression: alias.SeverityText,
                alias: 'SeverityText',
              },
            ]
          : []),
        ...(selectSeverityNumber
          ? [
              {
                valueExpression: 'SeverityNumber',
                alias: 'SeverityNumber',
              },
            ]
          : []),
      ],
    );
  }
  const config = {
    select,
    from: source.from,
    timestampValueExpression: source.timestampValueExpression,
    where: `${alias.TraceId} = ${SqlString.escape(traceId)}`,
    limit: { limit: TRACE_WATERFALL_FETCH_LIMIT },
    connection: source.connection,
  };
  return { config, alias, type: source.kind };
}

export function useEventsData({
  config,
  dateRangeStartInclusive,
  dateRange,
  enabled,
}: {
  config: ChartConfig;
  dateRangeStartInclusive: boolean;
  dateRange: [Date, Date];
  enabled: boolean;
}) {
  const query: ChartConfigWithDateRange = useMemo(() => {
    return {
      ...config,
      dateRange,
      dateRangeStartInclusive,
    };
  }, [config, dateRange, dateRangeStartInclusive]);
  return useOffsetPaginatedQuery(query, { enabled });
}

export function useEventsAroundFocus({
  tableSource,
  focusDate,
  dateRange,
  traceId,
  enabled,
  hiddenRowExpression,
  hiddenRowExpressionLanguage = 'lucene',
  selectSeverityNumber = false,
}: {
  tableSource: TTraceSource | TLogSource;
  focusDate: Date;
  dateRange: [Date, Date];
  traceId: string;
  enabled: boolean;
  /** An expression (in `hiddenRowExpressionLanguage`) that identifies rows to be hidden. Hidden rows will be returned with a `__hdx_hidden: true` column. */
  hiddenRowExpression?: string;
  hiddenRowExpressionLanguage?: 'lucene' | 'sql';
  selectSeverityNumber?: boolean;
}) {
  const { config, alias, type } = useMemo(
    () =>
      getConfig(
        tableSource,
        traceId,
        hiddenRowExpression,
        hiddenRowExpressionLanguage,
        selectSeverityNumber,
      ),
    [
      tableSource,
      traceId,
      hiddenRowExpression,
      hiddenRowExpressionLanguage,
      selectSeverityNumber,
    ],
  );

  const {
    data: beforeSpanData,
    isFetching: isBeforeSpanFetching,
    error: beforeSpanError,
  } = useEventsData({
    config,
    dateRangeStartInclusive: true,
    dateRange: [dateRange[0], focusDate],
    enabled,
  });

  const {
    data: afterSpanData,
    isFetching: isAfterSpanFetching,
    error: afterSpanError,
  } = useEventsData({
    config,
    dateRangeStartInclusive: false,
    dateRange: [focusDate, dateRange[1]],
    enabled,
  });

  const isFetching = isBeforeSpanFetching || isAfterSpanFetching;
  const meta = beforeSpanData?.meta ?? afterSpanData?.meta;
  const error = beforeSpanError || afterSpanError;
  // LIMIT+1 is a sentinel: a complete window of exactly TRACE_WATERFALL_ROW_LIMIT
  // rows must not show as a lower bound. Drop the extra row so the chart still
  // renders at most the cap. Trim inside this memo so a parent re-render does
  // not allocate fresh arrays and rebuild the span tree.
  const beforeData = beforeSpanData?.data;
  const afterData = afterSpanData?.data;
  const { isTruncated, trimmedBefore, trimmedAfter } = useMemo(() => {
    const beforeRows = beforeData ?? EMPTY_ROWS;
    const afterRows = afterData ?? EMPTY_ROWS;
    const beforeTruncated = beforeRows.length > TRACE_WATERFALL_ROW_LIMIT;
    const afterTruncated = afterRows.length > TRACE_WATERFALL_ROW_LIMIT;
    return {
      isTruncated: beforeTruncated || afterTruncated,
      trimmedBefore: beforeTruncated
        ? beforeRows.slice(0, TRACE_WATERFALL_ROW_LIMIT)
        : beforeRows,
      trimmedAfter: afterTruncated
        ? afterRows.slice(0, TRACE_WATERFALL_ROW_LIMIT)
        : afterRows,
    };
  }, [beforeData, afterData]);

  const getRowWhere = useRowWhere({ meta, aliasMap: alias });
  const rows = useMemo(() => {
    // Sometimes meta has not loaded yet
    // DO NOT REMOVE, useRowWhere will error if no meta
    if (!meta || meta.length === 0) return [];
    return [...trimmedBefore, ...trimmedAfter].map(cd => {
      // Omit SpanAttributes, SpanEvents, __hdx_hidden and SeverityNumber from rowWhere id generation.
      // SpanAttributes and SpanEvents can be large objects, and __hdx_hidden may be a lucene expression.
      // SeverityNumber is only selected when the column exists; leaving it out keeps row ids stable.
      const rowWhereResult = getRowWhere(
        omit(cd, [
          'SpanAttributes',
          'SpanEvents',
          '__hdx_hidden',
          'SeverityNumber',
        ]),
      );

      return {
        // Keep all fields available for display
        ...cd,
        // Named fields are repeated for typing. Spreading Record<string, any>
        // drops the index signature once explicit keys are set, so Duration
        // would otherwise be missing from the row type.
        Timestamp: cd?.Timestamp,
        SpanId: cd?.SpanId,
        ParentSpanId: cd?.ParentSpanId,
        Duration: cd?.Duration,
        __hdx_hidden: cd?.__hdx_hidden,
        type,
        id: rowWhereResult.where,
        // Don't pass aliasWith for trace waterfall chart - the WHERE clause already uses
        // raw column expressions (e.g., SpanName='value'), and the aliasMap creates
        // redundant WITH clauses like (Timestamp) AS Timestamp that interfere with queries.
        aliasWith: [],
      };
    });
  }, [trimmedAfter, trimmedBefore, meta, getRowWhere, type]);

  return {
    rows,
    meta,
    isFetching,
    error,
    isTruncated,
  };
}

function useFilteredEventsAroundFocus(
  args: Parameters<typeof useEventsAroundFocus>[0],
) {
  const filtered = useEventsAroundFocus(args);

  const filterFailed =
    args.enabled && !!args.hiddenRowExpression && !!filtered.error;

  const fallback = useEventsAroundFocus({
    ...args,
    hiddenRowExpression: undefined,
    enabled: filterFailed,
  });

  if (filterFailed) {
    return {
      rows: fallback.rows,
      meta: fallback.meta,
      isFetching: filtered.isFetching || fallback.isFetching,
      filterError: fallback.error ? undefined : filtered.error,
      fatalError: fallback.error,
      isTruncated: fallback.isTruncated,
    };
  }

  return {
    rows: filtered.rows,
    meta: filtered.meta,
    isFetching: filtered.isFetching,
    filterError: undefined,
    fatalError: filtered.error,
    isTruncated: filtered.isTruncated,
  };
}

/** "Collapse all": every collapsible parent, at every level, becomes collapsed. */
export function computeCollapseAll(
  parentIdsByLevel: Map<number, Set<string>>,
): Set<string> {
  const allParentIds = new Set<string>();
  parentIdsByLevel.forEach(ids => {
    ids.forEach(id => allParentIds.add(id));
  });
  return allParentIds;
}

/**
 * "Expand one level": expand the shallowest level that still has any collapsed
 * parents.
 */
export function computeExpandOneLevel(
  collapsedIds: Set<string>,
  parentIdsByLevel: Map<number, Set<string>>,
): Set<string> {
  if (collapsedIds.size === 0) return collapsedIds;
  const newSet = new Set(collapsedIds);
  // Shallowest first: expanding starts at the top of the tree.
  const sortedLevels = [...parentIdsByLevel.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const ids = parentIdsByLevel.get(level)!;
    const collapsedAtLevel = [...ids].filter(id => newSet.has(id));
    if (collapsedAtLevel.length > 0) {
      collapsedAtLevel.forEach(id => newSet.delete(id));
      break;
    }
  }
  return newSet;
}

export function computeCollapseOneLevel(
  collapsedIds: Set<string>,
  parentIdsByLevel: Map<number, Set<string>>,
): Set<string> {
  const newSet = new Set(collapsedIds);
  // Deepest first: collapsing starts at the bottom of the tree.
  const sortedLevels = [...parentIdsByLevel.keys()].sort((a, b) => b - a);
  for (const level of sortedLevels) {
    const ids = parentIdsByLevel.get(level)!;
    const expandedAtLevel = [...ids].filter(id => !newSet.has(id));
    if (expandedAtLevel.length > 0) {
      expandedAtLevel.forEach(id => newSet.add(id));
      break;
    }
  }
  return newSet;
}

export function computeToggleCollapse(
  collapsedIds: Set<string>,
  id: string,
  node:
    | { id?: string; children?: Array<{ id?: string; children?: any[] }> }
    | undefined,
  includeDescendants: boolean,
): Set<string> {
  const next = new Set(collapsedIds);
  const wasCollapsed = next.has(id);

  if (wasCollapsed) {
    next.delete(id);
  } else {
    next.add(id);
  }

  if (includeDescendants && node?.children?.length) {
    // Match every descendant to the node's new state.
    const descendantIds = getDescendantIds(node);
    if (wasCollapsed) {
      descendantIds.forEach(descId => next.delete(descId));
    } else {
      descendantIds.forEach(descId => next.add(descId));
    }
  }

  return next;
}

export function DBTraceWaterfallChartContainer({
  traceTableSource,
  logTableSource,
  traceId,
  dateRange,
  focusDate,
  onClick,
  highlightedRowWhere,
  initialRowHighlightHint,
  emptyState,
  controlsExtra,
}: {
  traceTableSource: TTraceSource;
  logTableSource: TLogSource | null;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  onClick?: (rowWhere: {
    id: string;
    type: string;
    aliasWith: WithClause[];
  }) => void;
  highlightedRowWhere?: string | null;
  initialRowHighlightHint?: RowHighlightHint;
  emptyState?: ReactNode;
  /** Extra controls rendered in the waterfall controls bar (e.g. the correlated logs source selector). */
  controlsExtra?: ReactNode;
}) {
  const formatTime = useFormatTime();

  const {
    traceWhere,
    logWhere,
    traceWhereLanguage,
    logWhereLanguage,
    clear: clearFilters,
    isFilterActive,
    isFilterExpanded,
    setIsFilterExpanded,
    onSubmit: submitFilters,
  } = useWaterfallSearchState({
    hasLogSource: !!logTableSource,
  });

  // Each filter runs in its own language. Defaults come from the URL (shared
  // link / reload fidelity), falling back to the stored preference.
  const traceFilterLanguage: 'lucene' | 'sql' =
    traceWhereLanguage === 'sql' ? 'sql' : 'lucene';
  const logFilterLanguage: 'lucene' | 'sql' =
    logWhereLanguage === 'sql' ? 'sql' : 'lucene';

  const { control, handleSubmit, setValue } = useForm({
    defaultValues: {
      traceWhere: traceWhere ?? '',
      logWhere: logWhere ?? '',
      // Prefer each input's URL language so a shared link / reload shows the
      // same language the filter runs in; fall back to the stored preference.
      traceWhereLanguage:
        traceWhereLanguage === 'sql' || traceWhereLanguage === 'lucene'
          ? traceWhereLanguage
          : (getStoredLanguage() ?? 'lucene'),
      logWhereLanguage:
        logWhereLanguage === 'sql' || logWhereLanguage === 'lucene'
          ? logWhereLanguage
          : (getStoredLanguage() ?? 'lucene'),
    },
  });

  const onSubmitFilters = useCallback(
    (data: {
      traceWhere: string;
      logWhere: string;
      traceWhereLanguage: string;
      logWhereLanguage: string;
    }) => {
      submitFilters({
        traceWhere: data.traceWhere,
        logWhere: data.logWhere,
        traceWhereLanguage: data.traceWhereLanguage,
        logWhereLanguage: data.logWhereLanguage,
      });
    },
    [submitFilters],
  );

  const onClearFilters = useCallback(() => {
    setValue('traceWhere', '');
    setValue('logWhere', '');
    // Reset the language toggles too, otherwise stale values get re-serialized
    // into the URL on the next submit, undoing the cleared state.
    setValue('traceWhereLanguage', getStoredLanguage() ?? 'lucene');
    setValue('logWhereLanguage', getStoredLanguage() ?? 'lucene');
    clearFilters();
  }, [clearFilters, setValue]);

  const {
    rows: traceRowsData,
    isFetching: traceIsFetching,
    meta: traceRowsMeta,
    filterError: traceFilterError,
    fatalError: traceError,
    isTruncated: traceIsTruncated,
  } = useFilteredEventsAroundFocus({
    tableSource: traceTableSource,
    focusDate,
    dateRange,
    traceId,
    hiddenRowExpression: traceWhere ? `NOT (${traceWhere})` : undefined,
    hiddenRowExpressionLanguage: traceFilterLanguage,
    enabled: true,
  });

  const { data: logColumns, isLoading: isLogColumnsLoading } = useColumns(
    {
      databaseName: logTableSource?.from.databaseName ?? '',
      tableName: logTableSource?.from.tableName ?? '',
      connectionId: logTableSource?.connection ?? '',
    },
    { retry: 1 },
  );
  const hasSeverityNumber =
    logColumns?.some(column => column.name === 'SeverityNumber') ?? false;

  const {
    rows: fetchedLogRows,
    isFetching: logIsFetching,
    meta: logRowsMeta,
    filterError: logFilterError,
    fatalError: logFatalError,
    isTruncated: logIsTruncated,
  } = useFilteredEventsAroundFocus({
    // search data if logTableModel exist
    // search invalid date range if no logTableModel(react hook need execute no matter what)
    tableSource: logTableSource ? logTableSource : traceTableSource,
    focusDate,
    dateRange: logTableSource ? dateRange : [dateRange[1], dateRange[0]], // different query to prevent cache
    traceId,
    hiddenRowExpression: logWhere ? `NOT (${logWhere})` : undefined,
    hiddenRowExpressionLanguage: logFilterLanguage,
    // Wait for the columns (a failed lookup runs without SeverityNumber) so the
    // select doesn't change mid-flight and run the log query twice.
    enabled: !!logTableSource && !isLogColumnsLoading,
    selectSeverityNumber: hasSeverityNumber,
  });

  const isFetching = traceIsFetching || logIsFetching || isLogColumnsLoading;
  // Only a fatal trace failure (bad source / connection) blanks the waterfall.
  // A *filter* error on either side is non-fatal: the offending query falls back
  // to unfiltered data and the error is surfaced inline next to its input, so a
  // bad filter can never hide valid spans or logs. The correlated-log source is
  // secondary, so even a fatal log failure only drops logs — never the chart.
  const error = traceError;
  // Log-side error to surface inline: prefer the filter error (fallback data is
  // shown), otherwise the fatal error (no logs could be loaded at all).
  const logError = logFilterError ?? logFatalError;

  const [showSpanEvents, setShowSpanEvents] = useState(true);
  const [showSpans, setShowSpans] = useState(true);
  const [showLogs, setShowLogs] = useState(true);

  const {
    logRows: logRowsData,
    resourceTimingBySpanId,
    triggerRow,
  } = useBrowserTraceEvents({
    traceRows: traceRowsData,
    logRows: fetchedLogRows,
    logSource: logTableSource,
    traceId,
    highlightedRowWhere,
    initialRowHighlightHint,
    // Only while the dots show. A log filter asks for the rows it matches. A
    // capped list can keep a log that shares a timing log's key and drop the
    // timing log, and the fold would then hide that other log.
    foldTimingRows: showSpans && showSpanEvents && !logWhere && !logIsTruncated,
    enabled: !traceIsFetching,
  });

  const rows = useMemo(
    () =>
      sortWaterfallRows<WaterfallRow>([
        ...(triggerRow ? [triggerRow] : []),
        ...traceRowsData,
        ...logRowsData,
      ]),
    [triggerRow, traceRowsData, logRowsData],
  );

  const validSpanIDs = useMemo(() => {
    return new Set(
      traceRowsData // only spans in traces can define valid span ids
        ?.filter(row => _.isString(row.SpanId) && row.SpanId.length > 0)
        .map(row => row.SpanId) ?? [],
    );
  }, [traceRowsData]);

  const traceExtent = useMemo(() => {
    if (traceRowsData.length === 0) return null;

    const windowEndMs = dateRange[1].getTime();

    let minStartMs = Number.POSITIVE_INFINITY;
    let maxEndMs = Number.NEGATIVE_INFINITY;

    let isStartClipped = false;
    let isEndClipped = false;

    let isAnySpanValid = false;
    for (const row of traceRowsData) {
      // timestamp-nano accepts a non-date as a finite instant, which would
      // stretch the envelope. Skip those before parsing.
      if (
        typeof row.Timestamp !== 'string' ||
        Number.isNaN(Date.parse(row.Timestamp))
      ) {
        continue;
      }

      let startMs: number;
      try {
        startMs = parseTimestampToMs(row.Timestamp);
      } catch {
        continue;
      }
      if (!Number.isFinite(startMs)) continue;

      const durationSec = Number(row.Duration);
      const endMs =
        startMs + (Number.isFinite(durationSec) ? durationSec : 0) * 1000;
      if (startMs < minStartMs) {
        minStartMs = startMs;

        // The start is clipped if the earliest span has a parent that was not fetched
        const parentId =
          typeof row.ParentSpanId === 'string' ? row.ParentSpanId : '';
        isStartClipped = parentId.length > 0 && !validSpanIDs.has(parentId);
      }

      if (endMs > maxEndMs) maxEndMs = endMs;
      if (endMs >= windowEndMs) isEndClipped = true;
      isAnySpanValid = true;
    }
    if (!isAnySpanValid) return null;

    return {
      /** Wall-clock duration across every fetched span (min start to max end) */
      totalDurationMs: maxEndMs - minStartMs,
      /** Whether the trace start or end is clipped by the time range */
      isWindowClipped: isStartClipped || isEndClipped,
    };
  }, [traceRowsData, validSpanIDs, dateRange]);

  // Map each distinct span service to a stable color. Sorting the names first
  // keeps a service's color stable across renders regardless of row ordering.
  const serviceColorMap = useMemo(() => {
    const serviceNames = [
      ...new Set(
        rows
          .filter(
            r =>
              r.ServiceName &&
              r.type !== SourceKind.Log &&
              typeof r.ServiceName === 'string',
          )
          .map(r => r.ServiceName),
      ),
    ].sort();

    const map = new Map<string, string>();
    serviceNames.forEach((name, i) => {
      if (!name) return;
      map.set(name, SERVICE_COLORS[i % SERVICE_COLORS.length]);
    });
    return map;
  }, [rows]);

  const highlightedAttributeValues = useMemo(() => {
    const visibleTraceRowsData = traceRowsData?.filter(
      row => !row.__hdx_hidden,
    );

    const attributes = getHighlightedAttributesFromData(
      traceTableSource,
      traceTableSource.highlightedTraceAttributeExpressions,
      visibleTraceRowsData,
      traceRowsMeta,
    );

    if (logTableSource && logRowsData && logRowsMeta) {
      const visibleLogRowsData = logRowsData?.filter(row => !row.__hdx_hidden);

      attributes.push(
        ...getHighlightedAttributesFromData(
          logTableSource,
          logTableSource.highlightedTraceAttributeExpressions,
          visibleLogRowsData,
          logRowsMeta,
        ),
      );
    }

    return attributes.sort(
      (a, b) =>
        a.displayedKey.localeCompare(b.displayedKey) ||
        a.value.localeCompare(b.value),
    );
  }, [
    traceTableSource,
    traceRowsData,
    traceRowsMeta,
    logTableSource,
    logRowsData,
    logRowsMeta,
  ]);

  useRowHighlightHint({
    traceId,
    initialRowHighlightHint,
    highlightedRowWhere,
    rows,
    onClick,
  });

  const [collapsedIds, setCollapsedIds] = useState(() => new Set<string>());
  const { rootNodes, nodesMap, parentIdsByLevel } = useMemo(
    () => buildWaterfallTree(rows, validSpanIDs),
    [rows, validSpanIDs],
  );
  const flattenedNodes = useMemo(
    () => flattenWaterfallTree(rootNodes, collapsedIds),
    [rootNodes, collapsedIds],
  );

  const toggleCollapse = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation(); // prevent collapsing from selecting row
      // Alt/Option-click toggles the whole subtree along with the node.
      setCollapsedIds(prev =>
        computeToggleCollapse(prev, id, nodesMap.get(id), event.altKey),
      );
    },
    [nodesMap],
  );

  const expandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedIds(computeCollapseAll(parentIdsByLevel));
  }, [parentIdsByLevel]);

  const expandOneLevel = useCallback(() => {
    setCollapsedIds(prev => computeExpandOneLevel(prev, parentIdsByLevel));
  }, [parentIdsByLevel]);

  const collapseOneLevel = useCallback(() => {
    setCollapsedIds(prev => computeCollapseOneLevel(prev, parentIdsByLevel));
  }, [parentIdsByLevel]);

  const hasCollapsibleNodes = parentIdsByLevel.size > 0;

  const visibleNodes = useMemo(() => {
    if (showSpans && showLogs) return flattenedNodes;
    return flattenedNodes.filter(node => {
      // The click belongs with the spans it started, not with the logs.
      if (node.triggeredBy) return showSpans;
      if (node.type === SourceKind.Log) return showLogs;
      return showSpans;
    });
  }, [flattenedNodes, showSpans, showLogs]);

  const { spanCount, logCount, errorCount } = useMemo(() => {
    let spanCount = 0;
    let logCount = 0;
    let errorCount = 0;
    for (const node of visibleNodes) {
      if (node.type !== SourceKind.Log) spanCount++;
      else if (!node.triggeredBy) logCount++;
      if (getRowSeverity(node) === 'error') errorCount++;
    }
    return { spanCount, logCount, errorCount };
  }, [visibleNodes]);

  const countParts: string[] = [];
  if (spanCount > 0) {
    countParts.push(`${spanCount} span${spanCount !== 1 ? 's' : ''}`);
  }
  if (logCount > 0) {
    countParts.push(`${logCount} log${logCount !== 1 ? 's' : ''}`);
  }
  const itemCountString = countParts.join(', ') || '0 items';
  const errorCountString = `${errorCount} error${errorCount !== 1 ? 's' : ''}`;

  // TODO: Add duration filter?
  // TODO: Add backend filters for duration and collapsing?

  // All units in ms!
  const minOffset = useMemo(() => {
    let min = Number.MAX_SAFE_INTEGER;
    for (const row of rows)
      min = Math.min(min, parseTimestampToMs(row.Timestamp));
    return min === Number.MAX_SAFE_INTEGER ? 0 : min;
  }, [rows]);

  const timelineRows = useMemo(
    () => getWaterfallTimelineRows(visibleNodes, minOffset, serviceColorMap),
    [visibleNodes, minOffset, serviceColorMap],
  );
  const renderRow = useCallback(
    (_row: unknown, index: number) =>
      renderWaterfallRow({
        result: visibleNodes[index],
        minOffset,
        formatTime,
        showSpanEvents,
        resourceTimingBySpanId,
        highlightedRowWhere,
        serviceColorMap,
        onClick,
        toggleCollapse,
        collapsedIds,
      }),
    [
      visibleNodes,
      minOffset,
      formatTime,
      showSpanEvents,
      resourceTimingBySpanId,
      highlightedRowWhere,
      serviceColorMap,
      onClick,
      toggleCollapse,
      collapsedIds,
    ],
  );
  const initialScrollRowIndex = useMemo(
    () => visibleNodes.findIndex(v => v.id === highlightedRowWhere),
    [visibleNodes, highlightedRowWhere],
  );

  const { ref: timelineWrapperRef, height: timelineWrapperHeight } =
    useElementSize();

  const [viewportController, setViewportController] =
    useState<TimelineViewportController | null>(null);

  const showMinimap =
    !isFetching && !error && rows != null && visibleNodes.length > 0;

  return (
    <>
      {showMinimap && (
        <TimelineMinimap rows={timelineRows} controller={viewportController} />
      )}
      {isFilterExpanded && (
        <form onSubmit={handleSubmit(onSubmitFilters)}>
          <Stack gap="xs" mt="xs">
            <Box data-testid="trace-spans-filter">
              <Text size="xxs" c="dimmed" mb={2}>
                Spans filter
              </Text>
              <SearchWhereInput
                tableConnection={tcFromSource(traceTableSource)}
                sourceId={traceTableSource.id}
                dateRange={dateRange}
                name="traceWhere"
                languageName="traceWhereLanguage"
                control={control}
                size="xs"
                allowMultiline={false}
                onSubmit={handleSubmit(onSubmitFilters)}
                onLanguageChange={lang =>
                  setValue('traceWhereLanguage', lang, { shouldDirty: true })
                }
                lucenePlaceholder='Filter spans ex. StatusCode:"Error"'
                sqlPlaceholder="Filter spans ex. StatusCode = 'Error'"
                data-testid="trace-search-input"
                // The waterfall lives inside an `overflow: hidden` column, which
                // clips the SQL editor's autocomplete tooltip. Portal it to the
                // document body so suggestions aren't cut off (Lucene mode
                // already renders its dropdown in a portal).
                parentRef={
                  typeof document !== 'undefined' ? document.body : null
                }
              />
              {traceFilterError && (
                <Box mt={4} data-testid="trace-filter-error">
                  <ErrorCollapse
                    summary="Couldn't apply spans filter (showing all spans)"
                    details={traceFilterError.message}
                  />
                </Box>
              )}
            </Box>
            {logTableSource && (
              <Box data-testid="trace-logs-filter">
                <Text size="xxs" c="dimmed" mb={2}>
                  Logs filter
                </Text>
                <SearchWhereInput
                  tableConnection={tcFromSource(logTableSource)}
                  sourceId={logTableSource.id}
                  dateRange={dateRange}
                  name="logWhere"
                  languageName="logWhereLanguage"
                  control={control}
                  size="xs"
                  allowMultiline={false}
                  onSubmit={handleSubmit(onSubmitFilters)}
                  onLanguageChange={lang =>
                    setValue('logWhereLanguage', lang, { shouldDirty: true })
                  }
                  lucenePlaceholder='Filter logs ex. SeverityText:"error"'
                  sqlPlaceholder="Filter logs ex. SeverityText = 'error'"
                  data-testid="log-search-input"
                  parentRef={
                    typeof document !== 'undefined' ? document.body : null
                  }
                />
                {logError && (
                  <Box mt={4} data-testid="log-filter-error">
                    <ErrorCollapse
                      summary={
                        logFilterError
                          ? "Couldn't apply logs filter (showing all logs)"
                          : "Couldn't load correlated logs"
                      }
                      details={logError.message}
                    />
                  </Box>
                )}
              </Box>
            )}
          </Stack>
        </form>
      )}
      <Group my="xs" justify="space-between">
        <Group gap="md">
          {hasCollapsibleNodes && (
            <Group gap={2}>
              <Tooltip label="Expand +1 level" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={expandOneLevel}
                  aria-label="Expand one level"
                >
                  <IconChevronDown size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Collapse +1 level" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={collapseOneLevel}
                  aria-label="Collapse one level"
                >
                  <IconChevronRight size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Expand all" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={expandAll}
                  aria-label="Expand all"
                >
                  <IconChevronsDown size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Collapse all" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={collapseAll}
                  aria-label="Collapse all"
                >
                  <IconChevronsRight size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
          <Text size="xs">
            {itemCountString},{' '}
            <span className={errorCount ? 'text-danger' : ''}>
              {errorCountString}
            </span>
            {traceExtent != null && (
              <TraceTotalDurationStat
                totalDurationMs={traceExtent.totalDurationMs}
                isTruncated={traceIsTruncated || traceExtent.isWindowClipped}
              />
            )}
          </Text>
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Show:
            </Text>
            <Group gap={4}>
              <Chip
                size="xs"
                color="gray"
                checked={showSpans}
                onChange={() => setShowSpans(!showSpans)}
                data-testid="show-spans-chip"
                styles={{
                  label: { paddingInline: 8, height: 22, minHeight: 22 },
                }}
              >
                Spans
              </Chip>
              {logTableSource && (
                <Chip
                  size="xs"
                  color="gray"
                  checked={showLogs}
                  onChange={() => setShowLogs(!showLogs)}
                  data-testid="show-logs-chip"
                  styles={{
                    label: { paddingInline: 8, height: 22, minHeight: 22 },
                  }}
                >
                  Logs
                </Chip>
              )}
              <Chip
                size="xs"
                color="gray"
                checked={showSpanEvents}
                onChange={() => setShowSpanEvents(!showSpanEvents)}
                disabled={!showSpans}
                data-testid="show-span-events-chip"
                styles={{
                  label: { paddingInline: 8, height: 22, minHeight: 22 },
                }}
              >
                Span events
              </Chip>
            </Group>
          </Group>
        </Group>
        <Group gap="sm">
          {controlsExtra}
          <span>
            <Anchor
              underline="always"
              onClick={() => setIsFilterExpanded(prev => !prev)}
              size="xs"
              data-testid="trace-filters-toggle"
            >
              {isFilterExpanded ? 'Hide Filters' : 'Show Filters'}{' '}
              {isFilterActive && '(active)'}
            </Anchor>
            {isFilterActive && (
              <Anchor
                underline="always"
                onClick={onClearFilters}
                size="xs"
                ms="xs"
              >
                Clear Filters
              </Anchor>
            )}
          </span>
        </Group>
      </Group>
      {!isFetching && !error && highlightedAttributeValues?.length > 0 && (
        <Box mb="xs">
          <DBHighlightedAttributesList
            attributes={highlightedAttributeValues}
          />
        </Box>
      )}
      <div
        ref={timelineWrapperRef}
        style={{
          position: 'relative',
          overflow: 'hidden',
          flex: 1,
        }}
      >
        {isFetching ? (
          <div className="my-3">Loading Traces...</div>
        ) : error ? (
          <Box mt="lg">
            <Text my="sm" size="sm">
              An error occurred while fetching trace data:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </Code>
          </Box>
        ) : rows == null ? (
          <div>
            An unknown error occurred. <ContactSupportText />
          </div>
        ) : visibleNodes.length === 0 ? (
          flattenedNodes.length > 0 ? (
            <div className="my-3">All items are hidden by filters</div>
          ) : (
            (emptyState ?? (
              <div className="my-3">No matching spans or logs found</div>
            ))
          )
        ) : (
          <TimelineChart
            maxHeight={timelineWrapperHeight}
            rowHeight={22}
            labelWidth={300}
            onEventClick={event => {
              onClick?.({
                id: event.id,
                type: event.type ?? '',
                aliasWith: [],
              });
            }}
            rows={timelineRows}
            renderRow={renderRow}
            initialScrollRowIndex={initialScrollRowIndex}
            onReady={setViewportController}
          />
        )}
      </div>
    </>
  );
}
