const path = require('node:path');

exports.checkInteractions = async (page, scenario, root) => {
  const ready = async (spans, logs) => {
    await page.waitForFunction(
      ({ spans, logs }) => {
        const viewport = document.querySelector(
          '[data-testid=trace-waterfall-viewport]',
        );
        return (
          viewport?.getAttribute('aria-busy') !== 'true' &&
          document.querySelector('canvas[data-rendering="false"]') &&
          (spans == null ||
            document.body.innerText.includes(spans + ' spans')) &&
          (logs == null || document.body.innerText.includes(logs + ' logs'))
        );
      },
      { spans, logs },
      { timeout: 15000 },
    );
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  await page.evaluate(async () => {
    const container = document.querySelector('[data-testid=timeline-corner]')
      .parentElement.parentElement;
    window.__interactionChart = container;
    window.__interactionCanvas = document.querySelector('canvas');
    container.dispatchEvent(
      new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -100,
        clientX: 700,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    container.scrollTop = 220;
    container.scrollLeft = 180;
    container.dispatchEvent(new Event('scroll'));
  });
  const capture = () =>
    page.evaluate(() => {
      const chart = document.querySelector('[data-testid=timeline-corner]')
        .parentElement.parentElement;
      return {
        sameChart: chart === window.__interactionChart,
        sameCanvas:
          document.querySelector('canvas') === window.__interactionCanvas,
        zoom: chart.firstElementChild.style.width || '100%',
        left: chart.scrollLeft,
        top: chart.scrollTop,
        maxTop: chart.scrollHeight - chart.clientHeight,
        sortCalls: window.__phases.createSortedWaterfallRows?.calls,
        treeCalls: window.__phases.createWaterfallTree?.calls,
      };
    });
  const before = await capture();
  const assertViewport = async (label, allowSourceChange = false) => {
    const current = await capture();
    if (
      !current.sameChart ||
      !current.sameCanvas ||
      current.zoom !== before.zoom ||
      Math.abs(current.left - before.left) > 1 ||
      Math.abs(current.top - Math.min(before.top, current.maxTop)) > 1
    )
      throw Error(
        label + ' reset the viewport: ' + JSON.stringify({ before, current }),
      );
    if (
      !allowSourceChange &&
      (current.sortCalls !== before.sortCalls ||
        current.treeCalls !== before.treeCalls)
    )
      throw Error(
        label +
          ' rebuilt the source tree: ' +
          JSON.stringify({ before, current }),
      );
    return current;
  };
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  const roots =
    2 *
    Math.ceil(
      Number(scenario.spans) / 2 / (Number(scenario.groupSize) || 1000),
    );
  await ready(roots);
  const collapsed = await assertViewport('Collapse');
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  const logs = Number(scenario.logs) - (scenario.browserTrace === '1' ? 1 : 0);
  await ready(Number(scenario.spans), logs || null);
  const expanded = await assertViewport('Expand');
  let filters;
  if (Number(scenario.logs) > 0) {
    await page.getByText('Logs', { exact: true }).click();
    await ready(Number(scenario.spans));
    const hidden = await assertViewport('Hide logs');
    await page.getByText('Logs', { exact: true }).click();
    await ready(Number(scenario.spans), logs);
    const restored = await assertViewport('Show logs');
    await page.getByText('Spans', { exact: true }).click();
    await ready(null, Number(scenario.logs));
    const spansHidden = await assertViewport(
      'Hide spans',
      scenario.browserTrace === '1',
    );
    await page.getByText('Spans', { exact: true }).click();
    await ready(Number(scenario.spans), logs);
    const spansRestored = await assertViewport(
      'Show spans',
      scenario.browserTrace === '1',
    );
    await page.getByText('Span events', { exact: true }).click();
    await ready(Number(scenario.spans), Number(scenario.logs));
    const eventsHidden = await assertViewport(
      'Hide span events',
      scenario.browserTrace === '1',
    );
    await page.getByText('Span events', { exact: true }).click();
    await ready(Number(scenario.spans), logs);
    const eventsRestored = await assertViewport(
      'Show span events',
      scenario.browserTrace === '1',
    );
    filters = {
      hidden,
      restored,
      spansHidden,
      spansRestored,
      eventsHidden,
      eventsRestored,
    };
  }
  await page.evaluate(() => {
    window.__selectionPaints = 0;
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      window.__selectionPaints++;
      return fill.apply(this, args);
    };
  });
  const selectionBefore = await capture();
  const index = await page.evaluate(() => {
    const chart = window.__interactionChart.getBoundingClientRect();
    return [...document.querySelectorAll('[data-index]')].find(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= chart.top + 40 && rect.bottom <= chart.bottom;
    }).dataset.index;
  });
  await page.locator('[data-index="' + index + '"]').click();
  await page.waitForSelector('[data-testid=timeline-minimap-highlight]');
  await ready(Number(scenario.spans), logs || null);
  const selected = await capture();
  const paints = await page.evaluate(() => window.__selectionPaints);
  if (
    !selected.sameChart ||
    !selected.sameCanvas ||
    selected.zoom !== before.zoom ||
    Math.abs(selected.left - before.left) > 1 ||
    selected.sortCalls !== selectionBefore.sortCalls ||
    selected.treeCalls !== selectionBefore.treeCalls ||
    paints !== 0
  )
    throw Error(
      'Selection restarted preparation or painting: ' +
        JSON.stringify({ before: selectionBefore, selected, paints }),
    );
  await page.screenshot({ path: path.join(root, 'optimized-selection.png') });
  await page.evaluate(() => {
    delete window.__interactionChart;
    delete window.__interactionCanvas;
  });
  return {
    collapse: true,
    expand: true,
    selection: true,
    viewportPreserved: true,
    selectionCanvasDraws: paints,
    before,
    collapsed,
    expanded,
    filters,
    selected,
    browserTraceHook: scenario.browserTrace === '1' ? 'real' : 'substituted',
  };
};
