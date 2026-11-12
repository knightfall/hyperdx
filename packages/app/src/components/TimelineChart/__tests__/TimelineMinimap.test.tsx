import { fireEvent, screen } from '@testing-library/react';

import type { TimelineViewportController } from '@/components/TimelineChart';
import { TimelineMinimap } from '@/components/TimelineChart/TimelineMinimap';

// jsdom has no layout engine, so getBoundingClientRect returns zeros and
// setPointerCapture is unimplemented. Pin the container to a known 1000px-wide
// box and stub pointer capture so getXFraction math is deterministic
// (clientX / 1000 = fraction).
const CONTAINER_WIDTH = 1000;
const fillRect = jest.fn();
const clearRect = jest.fn();
const setTransform = jest.fn();
const paintedColors: string[] = [];

beforeAll(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        clearRect,
        setTransform,
        fillRect,
        set fillStyle(value: string) {
          paintedColors.push(value);
        },
      }) as unknown as CanvasRenderingContext2D,
  );
  // jsdom doesn't implement PointerEvent, so fireEvent.pointerXxx would drop
  // clientX. Back it with MouseEvent (which honors clientX from init).
  if (typeof window.PointerEvent === 'undefined') {
    // @ts-expect-error minimal polyfill for tests
    window.PointerEvent = class extends MouseEvent {
      constructor(type: string, params: MouseEventInit = {}) {
        super(type, params);
      }
    };
  }
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: CONTAINER_WIDTH,
    bottom: 52,
    width: CONTAINER_WIDTH,
    height: 52,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

beforeEach(() => {
  fillRect.mockClear();
  clearRect.mockClear();
  paintedColors.length = 0;
});

afterAll(() => {
  jest.restoreAllMocks();
});

const rows = [
  {
    events: [
      {
        id: 'a',
        start: 0,
        end: 100,
        tooltip: '',
        color: '#fff',
        backgroundColor: 'rgb(10, 20, 30)',
        minWidthPx: 2,
        body: null,
      },
      {
        id: 'b',
        start: 100,
        end: 300,
        tooltip: '',
        color: '#fff',
        backgroundColor: 'rgb(40, 50, 60)',
        minWidthPx: 2,
        body: null,
      },
    ],
  },
];

function makeController(state: {
  scale: number;
  offsetFrac: number;
  viewportWidthFrac: number;
}): TimelineViewportController {
  return {
    getState: jest.fn(() => state),
    subscribe: jest.fn(() => () => {}),
    zoomToRange: jest.fn(),
    panToOffset: jest.fn(),
    reset: jest.fn(),
  };
}

describe('TimelineMinimap', () => {
  it('renders service-colored bars from event.backgroundColor', () => {
    const controller = makeController({
      scale: 1,
      offsetFrac: 0,
      viewportWidthFrac: 1,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    expect(fillRect).toHaveBeenCalledTimes(2);
    expect(paintedColors).toEqual(
      expect.arrayContaining(['rgb(10, 20, 30)', 'rgb(40, 50, 60)']),
    );
  });

  it('draws all 200,000 spans on one canvas and keeps bars stable while zooming', () => {
    const largeRows = Array.from({ length: 200_000 }, (_, i) => ({
      events: [{ ...rows[0].events[0], id: String(i), start: i, end: i + 1 }],
    }));
    const controller = makeController({
      scale: 1,
      offsetFrac: 0,
      viewportWidthFrac: 1,
    });
    renderWithMantine(
      <TimelineMinimap rows={largeRows} controller={controller} />,
    );
    const minimap = screen.getByTestId('timeline-minimap');
    expect(minimap.querySelectorAll('canvas')).toHaveLength(1);
    expect(minimap.querySelectorAll('div').length).toBeLessThan(20);
    expect(fillRect).toHaveBeenCalledTimes(200_000);
    expect(fillRect).toHaveBeenLastCalledWith(
      expect.closeTo((199_999 / 220_000) * 1000, 6),
      48,
      1.5,
      2,
    );
    fireEvent.pointerDown(minimap, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(minimap, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(minimap, { pointerId: 1 });
    expect(controller.zoomToRange).toHaveBeenCalledWith(0.1, 0.6);
    expect(fillRect).toHaveBeenCalledTimes(200_000);
  });

  it('hides viewport chrome (reset button) when fully zoomed out', () => {
    const controller = makeController({
      scale: 1,
      offsetFrac: 0,
      viewportWidthFrac: 1,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    expect(
      screen.queryByRole('button', { name: /reset minimap zoom/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the reset button when zoomed and resets on click', () => {
    const controller = makeController({
      scale: 4,
      offsetFrac: 0.25,
      viewportWidthFrac: 0.25,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    const resetBtn = screen.getByRole('button', {
      name: /reset minimap zoom/i,
    });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    expect(controller.reset).toHaveBeenCalledTimes(1);
  });

  it('brush-to-zoom: dragging a range calls zoomToRange with that range', () => {
    const controller = makeController({
      scale: 1,
      offsetFrac: 0,
      viewportWidthFrac: 1,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    const minimap = screen.getByTestId('timeline-minimap');

    fireEvent.pointerDown(minimap, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(minimap, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(minimap, { clientX: 600, pointerId: 1 });

    expect(controller.zoomToRange).toHaveBeenCalledTimes(1);
    const [start, end] = (controller.zoomToRange as jest.Mock).mock.calls[0];
    expect(start).toBeCloseTo(0.2, 5);
    expect(end).toBeCloseTo(0.6, 5);
  });

  it('drag-to-pan: dragging inside the viewport when zoomed calls panToOffset', () => {
    const controller = makeController({
      scale: 4,
      offsetFrac: 0.25,
      viewportWidthFrac: 0.25,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    const minimap = screen.getByTestId('timeline-minimap');

    // viewport spans frac [0.25, 0.5]; start the drag at its middle (0.375).
    fireEvent.pointerDown(minimap, { clientX: 375, pointerId: 1 });
    fireEvent.pointerMove(minimap, { clientX: 475, pointerId: 1 });

    expect(controller.panToOffset).toHaveBeenCalled();
    const lastCall = (controller.panToOffset as jest.Mock).mock.calls.at(-1);
    // moved +0.1 frac → offset 0.25 -> ~0.35
    expect(lastCall[0]).toBeCloseTo(0.35, 5);
    expect(controller.zoomToRange).not.toHaveBeenCalled();
  });

  it('resize handle: dragging the right edge re-zooms to the new range', () => {
    const controller = makeController({
      scale: 4,
      offsetFrac: 0.25,
      viewportWidthFrac: 0.25,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    const minimap = screen.getByTestId('timeline-minimap');

    // right edge at frac 0.5 (px 500); grab it and drag right by 0.2 (200px).
    fireEvent.pointerDown(minimap, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(minimap, { clientX: 700, pointerId: 1 });

    expect(controller.zoomToRange).toHaveBeenCalled();
    const lastCall = (controller.zoomToRange as jest.Mock).mock.calls.at(-1);
    expect(lastCall[0]).toBeCloseTo(0.25, 5); // start unchanged
    expect(lastCall[1]).toBeCloseTo(0.7, 5); // end pushed to 0.7
  });

  it('double-click resets when zoomed', () => {
    const controller = makeController({
      scale: 4,
      offsetFrac: 0.25,
      viewportWidthFrac: 0.25,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    fireEvent.doubleClick(screen.getByTestId('timeline-minimap'));
    expect(controller.reset).toHaveBeenCalledTimes(1);
  });

  it('double-click does nothing when not zoomed', () => {
    const controller = makeController({
      scale: 1,
      offsetFrac: 0,
      viewportWidthFrac: 1,
    });
    renderWithMantine(<TimelineMinimap rows={rows} controller={controller} />);
    fireEvent.doubleClick(screen.getByTestId('timeline-minimap'));
    expect(controller.reset).not.toHaveBeenCalled();
  });
});
