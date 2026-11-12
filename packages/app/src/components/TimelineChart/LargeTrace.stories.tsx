import { useCallback, useMemo, useState } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import {
  computeCollapseAll,
  computeToggleCollapse,
} from '@/components/DBTraceWaterfallChart';
import {
  buildWaterfallTree,
  flattenWaterfallTree,
} from '@/components/traceWaterfallData';
import {
  getWaterfallTimelineRows,
  type WaterfallRow,
} from '@/components/traceWaterfallModel';
import { renderWaterfallRow } from '@/components/traceWaterfallRow';
import { useFormatTime } from '@/useFormatTime';
import { COLORS } from '@/utils';

import {
  TimelineChart,
  type TimelineViewportController,
} from './TimelineChart';
import { TimelineMinimap } from './TimelineMinimap';

const START = Date.UTC(2024, 0, 1);
const SERVICE_COLORS = new Map([
  ['api', COLORS[0]],
  ['database', COLORS[1]],
]);
const NO_TIMING_MARKERS = new Map();

function LargeTrace({ spanCount }: { spanCount: number }) {
  const formatTime = useFormatTime();
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const [controller, setController] =
    useState<TimelineViewportController | null>(null);
  const tree = useMemo(() => {
    const rows: WaterfallRow[] = Array.from({ length: spanCount }, (_, i) => ({
      id: `span-${i}`,
      SpanId: `span-${i}`,
      ParentSpanId: i % 1000 === 0 ? '' : `span-${Math.floor(i / 1000) * 1000}`,
      Body: `Operation ${i}`,
      ServiceName: i % 1000 === 0 ? 'api' : 'database',
      Timestamp: new Date(START + i).toISOString(),
      Duration: i % 1000 === 0 ? 1 : 0.001,
      StatusCode: i % 137 === 0 ? 'Error' : 'Ok',
      type: SourceKind.Trace,
      aliasWith: [],
    }));
    return buildWaterfallTree(rows, new Set(rows.map(row => row.SpanId)));
  }, [spanCount]);
  const visible = useMemo(
    () => flattenWaterfallTree(tree.rootNodes, collapsed),
    [tree, collapsed],
  );
  const rows = useMemo(
    () => getWaterfallTimelineRows(visible, START, SERVICE_COLORS),
    [visible],
  );
  const onClick = useCallback(({ id }: { id: string }) => setSelected(id), []);
  const toggleCollapse = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setCollapsed(previous =>
        computeToggleCollapse(
          previous,
          id,
          tree.nodesMap.get(id),
          event.altKey,
        ),
      );
    },
    [tree],
  );
  const renderRow = useCallback(
    (_row: unknown, index: number) =>
      renderWaterfallRow({
        result: visible[index],
        minOffset: START,
        formatTime,
        showSpanEvents: true,
        resourceTimingBySpanId: NO_TIMING_MARKERS,
        highlightedRowWhere: selected,
        serviceColorMap: SERVICE_COLORS,
        onClick,
        toggleCollapse,
        collapsedIds: collapsed,
      }),
    [visible, formatTime, selected, onClick, toggleCollapse, collapsed],
  );

  return (
    <Box p="md">
      <Group mb="sm">
        <Text>
          {spanCount.toLocaleString()} spans, {rows.length.toLocaleString()}{' '}
          visible
        </Text>
        <Button
          variant="secondary"
          onClick={() =>
            setCollapsed(computeCollapseAll(tree.parentIdsByLevel))
          }
        >
          Collapse all
        </Button>
        <Button variant="secondary" onClick={() => setCollapsed(new Set())}>
          Expand all
        </Button>
        <Text role="status">Selected: {selected ?? 'none'}</Text>
      </Group>
      <TimelineMinimap rows={rows} controller={controller} />
      <TimelineChart
        initialScrollRowIndex={-1}
        labelWidth={400}
        maxHeight={600}
        rowHeight={22}
        rows={rows}
        renderRow={renderRow}
        onEventClick={onClick}
        onReady={setController}
      />
    </Box>
  );
}

const meta = {
  title: 'Charts/TimelineChart/Large trace',
  component: LargeTrace,
  parameters: { layout: 'fullscreen' },
  args: { spanCount: 200_000 },
} satisfies Meta<typeof LargeTrace>;

export default meta;
type Story = StoryObj<typeof meta>;
export const TwoHundredThousandSpans: Story = {};
