import { fireEvent, screen } from '@testing-library/react';

import { TimelineChart } from '@/components/TimelineChart/TimelineChart';
import type { TTimelineEvent } from '@/components/TimelineChart/TimelineChartRowEvents';

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () => [
      { index: 0, start: 0, size: 22 },
      { index: count - 1, start: (count - 1) * 22, size: 22 },
    ],
    measureElement: jest.fn(),
    scrollToIndex: jest.fn(),
  }),
}));

function makeRow(id: string, start: number, end: number) {
  const event: TTimelineEvent = {
    id,
    start,
    end,
    tooltip: id,
    color: 'white',
    backgroundColor: 'gray',
    body: <span>{id}</span>,
    minWidthPx: 1,
  };
  return { id, label: <span>{id}</span>, events: [event] };
}

describe('TimelineChart', () => {
  it('renders details only for virtual rows in a 200,000-span trace', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) =>
      makeRow(`span-${i}`, i, i + 1),
    );
    const renderRow = jest.fn((row, _index: number) => row);
    const onEventClick = jest.fn();
    renderWithMantine(
      <TimelineChart
        initialScrollRowIndex={-1}
        labelWidth={300}
        maxHeight={400}
        rowHeight={22}
        rows={rows}
        renderRow={renderRow}
        onEventClick={onEventClick}
      />,
    );
    expect(renderRow.mock.calls.map(([, index]) => index)).toEqual([
      0, 199_999,
    ]);
    expect(screen.queryByText('span-100000')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('span-199999')[0]);
    expect(onEventClick).toHaveBeenCalledWith(rows[199_999]);
  });

  it('shows the zoom hint in the corner above the labels, inside the chart', () => {
    renderWithMantine(
      <TimelineChart
        initialScrollRowIndex={-1}
        labelWidth={300}
        maxHeight={400}
        rowHeight={22}
        rows={[makeRow('root', 0, 100), makeRow('child', 10, 40)]}
        onEventClick={jest.fn()}
      />,
    );

    const hint = screen.getByTestId('timeline-zoom-hint');
    expect(hint).toHaveTextContent('⌘/Ctrl + scroll to zoom');
    // Lives in the corner cell above the span labels rather than in a row of
    // its own above the chart.
    expect(hint.closest('[data-testid="timeline-corner"]')).toBeInTheDocument();
  });
});
