import { memo, useEffect, useRef } from 'react';
import { useComputedColorScheme } from '@mantine/core';

import {
  finishWaterfallTask,
  runWaterfallTask,
  WATERFALL_SYNC_ROW_LIMIT,
} from '@/components/waterfallTask';

import type { TTimelineEvent } from './TimelineChartRowEvents';

const TICK_HEIGHT = 18;
const BAR_AREA_HEIGHT = 34;
const BAR_HEIGHT = 2;
export const MINIMAP_HEIGHT = TICK_HEIGHT + BAR_AREA_HEIGHT;

export type MinimapRow = {
  events: Pick<TTimelineEvent, 'start' | 'end' | 'backgroundColor'>[];
};

function getMinimapRowTop(rowIndex: number, rowCount: number) {
  return (
    TICK_HEIGHT +
    2 +
    Math.round((rowIndex / rowCount) * (BAR_AREA_HEIGHT - BAR_HEIGHT - 4))
  );
}

export function TimelineMinimapHighlight({
  row,
  rowCount,
  maxVal,
}: {
  row?: MinimapRow & { index: number };
  rowCount: number;
  maxVal: number;
}) {
  if (!row || row.index < 0 || row.index >= rowCount || maxVal <= 0)
    return null;
  return row.events.map((event, index) => (
    <div
      key={index}
      data-testid="timeline-minimap-highlight"
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        borderRadius: 1,
        left: `${(event.start / maxVal) * 100}%`,
        width: `${Math.max(((event.end - event.start) / maxVal) * 100, 0.15)}%`,
        // Match the canvas bitmap scaling inside the bordered container.
        top: `${(getMinimapRowTop(row.index, rowCount) / MINIMAP_HEIGHT) * 100}%`,
        height: `${(BAR_HEIGHT / MINIMAP_HEIGHT) * 100}%`,
        backgroundColor: event.backgroundColor,
      }}
    />
  ));
}

export const TimelineMinimapBars = memo(function TimelineMinimapBars({
  rows,
  maxVal,
}: {
  rows: MinimapRow[];
  maxVal: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorScheme = useComputedColorScheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let cancelDraw: (() => void) | undefined;
    let previousWidth: number | undefined;
    let previousPixelRatio: number | undefined;
    const draw = () => {
      const width = container.getBoundingClientRect().width;
      const height = MINIMAP_HEIGHT;
      const pixelRatio = window.devicePixelRatio || 1;
      if (width === previousWidth && pixelRatio === previousPixelRatio) return;
      cancelDraw?.();
      const controller = new AbortController();
      cancelDraw = () => controller.abort();
      canvas.dataset.rendering = 'false';
      previousWidth = width;
      previousPixelRatio = pixelRatio;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (width <= 0 || maxVal <= 0) return;

      // Canvas cannot resolve CSS variables or color-mix itself. Resolve each
      // distinct service/status color against the current theme once per draw.
      const colorProbe = document.createElement('span');
      colorProbe.style.display = 'none';
      container.appendChild(colorProbe);
      canvas.dataset.rendering = 'true';
      cancelDraw = () => {
        controller.abort();
        colorProbe.remove();
      };
      const paintContext = context;
      const paintCanvas = canvas;
      function* paint() {
        const colors = new Map<string, string>();
        let previousColor: string | undefined;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const top = getMinimapRowTop(rowIndex, rows.length);
          for (const event of rows[rowIndex].events) {
            let color = colors.get(event.backgroundColor);
            if (!color) {
              colorProbe.style.color = event.backgroundColor;
              color = getComputedStyle(colorProbe).color;
              colors.set(event.backgroundColor, color);
            }
            if (color !== previousColor) {
              paintContext.fillStyle = color;
              previousColor = color;
            }
            paintContext.fillRect(
              (event.start / maxVal) * width,
              top,
              Math.max(
                ((event.end - event.start) / maxVal) * width,
                width * 0.0015,
              ),
              BAR_HEIGHT,
            );
          }
          if ((rowIndex + 1) % 1000 === 0) yield;
        }

        colorProbe.remove();
        paintCanvas.dataset.rendering = 'false';
      }
      if (rows.length <= WATERFALL_SYNC_ROW_LIMIT) finishWaterfallTask(paint());
      else
        void runWaterfallTask(paint(), controller.signal).catch(error => {
          colorProbe.remove();
          if (!controller.signal.aborted) {
            canvas.dataset.rendering = 'false';
            console.error('Could not draw waterfall minimap', error);
          }
        });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => {
      cancelDraw?.();
      observer.disconnect();
    };
  }, [rows, maxVal, colorScheme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
});
