import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Center, Group, Text } from '@mantine/core';
import {
  IconAlertCircleFilled,
  IconAlertTriangleFilled,
  IconChevronDown,
  IconChevronRight,
  IconLogs,
  IconPointer,
} from '@tabler/icons-react';

import type { useBrowserTraceEvents } from '@/hooks/useBrowserTraceEvents';
import type { useFormatTime } from '@/useFormatTime';
import {
  getChartColorError,
  getChartColorSuccess,
  getChartColorWarning,
  parseTimestampToMs,
} from '@/utils';
import { getHttpUrl } from '@/utils/httpUrl';
import { isRpcSpan } from '@/utils/rpcSpanAttributes';

import type { DBTraceWaterfallChartContainer } from './DBTraceWaterfallChart';
import type { WaterfallNode } from './traceWaterfallData';
import {
  barColor,
  getRowSeverity,
  type WaterfallRow,
} from './traceWaterfallModel';

import styles from '@/../styles/LogSidePanel.module.scss';

export function renderWaterfallRow({
  result,
  minOffset,
  formatTime,
  showSpanEvents,
  resourceTimingBySpanId,
  highlightedRowWhere,
  serviceColorMap,
  onClick,
  toggleCollapse,
  collapsedIds,
}: {
  result: WaterfallNode<WaterfallRow> & { level: number };
  minOffset: number;
  formatTime: ReturnType<typeof useFormatTime>;
  showSpanEvents: boolean;
  resourceTimingBySpanId: ReturnType<
    typeof useBrowserTraceEvents
  >['resourceTimingBySpanId'];
  highlightedRowWhere?: string | null;
  serviceColorMap: Map<string, string>;
  onClick: React.ComponentProps<
    typeof DBTraceWaterfallChartContainer
  >['onClick'];
  toggleCollapse: (id: string, event: React.MouseEvent) => void;
  collapsedIds: Set<string>;
}) {
  const tookMs = (result.Duration || 0) * 1000;
  const startOffset = parseTimestampToMs(result.Timestamp);
  const start = startOffset - minOffset;
  const end = start + tookMs;

  const {
    Body: _body,
    ServiceName: serviceName,
    id,
    type,
    aliasWith,
    triggeredBy,
  } = result;
  let body = `${_body}`;
  try {
    body = typeof _body === 'string' ? _body : JSON.stringify(_body);
  } catch (e) {
    console.warn("DBTraceWaterfallChart: Couldn't JSON stringify Body", e);
  }

  const spanAttributes = result.SpanAttributes ?? {};
  const httpUrl = isRpcSpan(spanAttributes)
    ? undefined
    : getHttpUrl(spanAttributes);
  const displayText = triggeredBy ?? (httpUrl ? `${body} ${httpUrl}` : body);
  const startedAt = !isNaN(startOffset)
    ? ` | Started at ${formatTime(new Date(startOffset), { format: 'withMs' })}`
    : '';

  // Process span events into markers (only if showSpanEvents is enabled)
  const markers = showSpanEvents
    ? [
        ...(result.SpanEvents ?? []).map(spanEvent => {
          const epochMs = parseTimestampToMs(spanEvent.Timestamp);
          return {
            timestamp: epochMs - minOffset,
            epochMs,
            name: spanEvent.Name,
            attributes: spanEvent.Attributes || {},
          };
        }),
        // Log rows carry their parent span's SpanId.
        ...(type !== SourceKind.Log
          ? (resourceTimingBySpanId.get(result.SpanId) ?? [])
          : []
        ).map(marker => ({
          ...marker,
          timestamp: marker.epochMs - minOffset,
        })),
      ]
    : [];

  const severity = getRowSeverity(result);
  const isError = severity === 'error';
  const status = result.StatusCode || result.SeverityText;
  const isWarn = severity === 'warn';
  const isHighlighted = highlightedRowWhere === id;

  const barBackgroundColor =
    type === SourceKind.Log
      ? isError
        ? getChartColorError()
        : getChartColorSuccess()
      : serviceName
        ? (serviceColorMap.get(serviceName) ?? '#6A7077')
        : '#6A7077';

  return {
    id,
    type,
    aliasWith,
    label: (
      <div
        className={`${
          isHighlighted && styles.traceTimelineLabelHighlighted
        } text-truncate cursor-pointer ps-2 ${styles.traceTimelineLabel}`}
        role="button"
        onClick={() => {
          onClick?.({ id, type: type ?? '', aliasWith });
        }}
      >
        <div className="d-flex align-items-center" style={{ height: 24 }}>
          <div
            style={{
              width: result.level * 15,
              minWidth: result.level * 15,
              height: '100%',
              flexShrink: 0,
              backgroundImage:
                'repeating-linear-gradient(to right, transparent 0 7px, var(--color-border) 7px 8px, transparent 8px 15px)',
            }}
          />

          <Center
            style={{
              opacity: result.children.length > 0 ? 1 : 0,
            }}
            onClick={
              result.children.length > 0
                ? e => {
                    toggleCollapse(id, e);
                  }
                : undefined
            }
          >
            {collapsedIds.has(id) ? (
              <IconChevronRight size={16} className="me-1" />
            ) : (
              <IconChevronDown size={16} className="me-1" />
            )}{' '}
          </Center>

          <div
            style={{
              width: 3,
              minWidth: 3,
              height: 14,
              backgroundColor: barBackgroundColor,
              borderRadius: 1,
              flexShrink: 0,
              marginRight: 6,
            }}
          />

          {result.children.length > 0 && (
            <Text span size="xxs" c="dimmed" me={4} style={{ flexShrink: 0 }}>
              ({result.children.length})
            </Text>
          )}

          {isError && (
            <IconAlertCircleFilled
              size={12}
              className="me-1 flex-shrink-0"
              style={{ color: getChartColorError() }}
              aria-label="Error"
            />
          )}
          {isWarn && !isError && (
            <IconAlertTriangleFilled
              size={12}
              className="me-1 flex-shrink-0"
              style={{ color: getChartColorWarning() }}
              aria-label="Warning"
            />
          )}

          <Group gap={0} wrap="nowrap">
            {triggeredBy ? (
              <IconPointer
                size={14}
                className="align-middle me-2"
                aria-label="Triggering click"
              />
            ) : type === SourceKind.Log ? (
              <IconLogs
                size={14}
                className="align-middle me-2"
                aria-label="Correlated Log Line"
              />
            ) : null}
            <Text
              size="xxs"
              truncate="end"
              span
              title={
                triggeredBy ??
                `${serviceName}${httpUrl ? ` ${displayText}` : ''}`
              }
              role="button"
            >
              {serviceName && <>{serviceName} </>}
              <Text span inherit c="dimmed">
                {displayText}
              </Text>
            </Text>
          </Group>
        </div>
      </div>
    ),
    isActive: isHighlighted,
    events: [
      {
        id,
        type,
        aliasWith,
        start,
        end,
        tooltip: triggeredBy
          ? `${triggeredBy}${startedAt}`
          : `${displayText} ${tookMs >= 0 ? `took ${tookMs.toFixed(4)}ms` : ''} ${status ? `| Status: ${status}` : ''}${startedAt}`,
        color: 'var(--color-text-inverted)',
        backgroundColor: barColor({
          isHighlighted,
          isError,
          type,
          serviceColor: serviceName
            ? serviceColorMap.get(serviceName)
            : undefined,
        }),
        body: <span>{displayText}</span>,
        minWidthPx: type === SourceKind.Log ? 10 : 2,
        isError,
        markers,
        showDuration: type !== SourceKind.Log,
      },
    ],
  };
}
