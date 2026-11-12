import { memo, useEffect, useRef } from 'react';
import { useComputedColorScheme } from '@mantine/core';

import type { TTimelineEvent } from './TimelineChartRowEvents';

const TICK_HEIGHT = 18;
const BAR_AREA_HEIGHT = 34;
const BAR_HEIGHT = 2;
export const MINIMAP_HEIGHT = TICK_HEIGHT + BAR_AREA_HEIGHT;

export type MinimapRow = {
  events: Pick<TTimelineEvent, 'start' | 'end' | 'backgroundColor'>[];
};

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

    let previousWidth: number | undefined;
    let previousPixelRatio: number | undefined;
    const draw = () => {
      const width = container.getBoundingClientRect().width;
      const height = MINIMAP_HEIGHT;
      const pixelRatio = window.devicePixelRatio || 1;
      if (width === previousWidth && pixelRatio === previousPixelRatio) return;
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
      const colors = new Map<string, string>();
      let previousColor: string | undefined;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const top =
          TICK_HEIGHT +
          2 +
          Math.round(
            (rowIndex / rows.length) * (BAR_AREA_HEIGHT - BAR_HEIGHT - 4),
          );
        for (const event of rows[rowIndex].events) {
          let color = colors.get(event.backgroundColor);
          if (!color) {
            colorProbe.style.color = event.backgroundColor;
            color = getComputedStyle(colorProbe).color;
            colors.set(event.backgroundColor, color);
          }
          if (color !== previousColor) {
            context.fillStyle = color;
            previousColor = color;
          }
          context.fillRect(
            (event.start / maxVal) * width,
            top,
            Math.max(
              ((event.end - event.start) / maxVal) * width,
              width * 0.0015,
            ),
            BAR_HEIGHT,
          );
        }
      }
      colorProbe.remove();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
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
