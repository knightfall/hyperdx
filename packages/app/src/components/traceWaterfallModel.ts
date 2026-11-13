import { isErrorStatusCode } from '@hyperdx/common-utils/dist/core/spanPredicates';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import type { WithClause } from '@/hooks/useRowWhere';
import {
  getChartColorError,
  getChartColorSuccess,
  getChartColorSuccessHighlight,
  getLogSeverityLevel,
  parseTimestampToMs,
} from '@/utils';

import type { SpanRow } from './DBTraceWaterfallChart';
import type { WaterfallNode } from './traceWaterfallData';

// Bar background color. Error spans and logs are red, other correlated log rows
// are green (success), and every other span takes its per-service color.
export function barColor(condition: {
  isHighlighted: boolean;
  isError?: boolean;
  type: string | undefined;
  serviceColor?: string;
}) {
  const { isHighlighted, isError, type, serviceColor } = condition;

  if (type === SourceKind.Log && !isError) {
    return isHighlighted
      ? getChartColorSuccessHighlight()
      : getChartColorSuccess();
  }

  if (isError) {
    return isHighlighted
      ? `color-mix(in srgb, ${getChartColorError()} 60%, white)`
      : getChartColorError();
  }

  if (serviceColor) {
    return isHighlighted
      ? `color-mix(in srgb, ${serviceColor} 60%, white)`
      : serviceColor;
  }

  return isHighlighted ? '#A9AFB7' : '#6A7077';
}

export type WaterfallRow = Pick<SpanRow, 'Timestamp' | 'SpanId'> &
  Partial<SpanRow> & { id: string; aliasWith: WithClause[] };

// Shared by the error count and the row icons so the two can't disagree.
// OTel spans have no severity; they report errors through StatusCode.
export function getRowSeverity(
  row: Pick<SpanRow, 'type' | 'StatusCode' | 'SeverityNumber' | 'SeverityText'>,
): 'error' | 'warn' | undefined {
  if (row.type === SourceKind.Log) {
    return getLogSeverityLevel({
      severityNumber: row.SeverityNumber,
      severityText: row.SeverityText,
    });
  }
  return isErrorStatusCode(row.StatusCode) ? 'error' : undefined;
}

export function getWaterfallTimelineRows(
  visibleNodes: (WaterfallNode<WaterfallRow> & { level: number })[],
  minOffset: number,
  serviceColorMap: Map<string, string>,
) {
  return visibleNodes.map(result =>
    getWaterfallTimelineRow(result, minOffset, serviceColorMap),
  );
}

export function getWaterfallTimelineRow(
  result: WaterfallNode<WaterfallRow> & { level: number },
  minOffset: number,
  serviceColorMap: Map<string, string>,
  isHighlighted = false,
) {
  const start = parseTimestampToMs(result.Timestamp) - minOffset;
  return {
    id: result.id,
    type: result.type,
    aliasWith: result.aliasWith,
    label: null,
    events: [
      {
        id: result.id,
        start,
        end: start + (result.Duration || 0) * 1000,
        tooltip: '',
        color: 'var(--color-text-inverted)',
        backgroundColor: barColor({
          isHighlighted,
          isError: getRowSeverity(result) === 'error',
          type: result.type,
          serviceColor: result.ServiceName
            ? serviceColorMap.get(result.ServiceName)
            : undefined,
        }),
        body: null,
        minWidthPx: result.type === SourceKind.Log ? 10 : 2,
      },
    ],
  };
}
