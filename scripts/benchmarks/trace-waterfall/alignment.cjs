const fs = require('node:fs');
const path = require('node:path');
exports.checkAlignment = async (browser, base, root) => {
  const results = [];
  for (const variant of ['before', 'after']) {
    for (const dpr of [1, 2]) {
      for (const theme of ['dark', 'light']) {
        const context = await browser.newContext({
          viewport: { width: 1200, height: 530 },
          deviceScaleFactor: dpr,
        });
        const page = await context.newPage();
        page.on('pageerror', error =>
          console.error('Alignment page:', error.message),
        );
        page.on('console', message => {
          if (message.type() === 'error')
            console.error('Alignment console:', message.text());
        });
        await page.goto(
          `${base}/?mode=alignment&variant=${variant}&theme=${theme}`,
        );
        await page.waitForFunction(
          () =>
            window.__loaded &&
            [...document.querySelectorAll('canvas')].every(
              canvas => canvas.dataset.rendering !== 'true',
            ),
        );
        const marks = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid=timeline-minimap]')].map(
            (container, index) => {
              const canvas = container.querySelector('canvas');
              const highlight = container.querySelector(
                '[data-testid=timeline-minimap-highlight]',
              );
              const c = canvas.getBoundingClientRect(),
                h = highlight.getBoundingClientRect();
              const bitmapTop = [20, 34, 48][index];
              const expectedTop = c.top + (bitmapTop / 52) * c.height;
              return {
                row: [0, 500, 1000][index],
                canvasHeight: c.height,
                bitmapHeight: canvas.height,
                errorY: h.top - expectedTop,
                errorHeight: h.height - (2 / 52) * c.height,
              };
            },
          ),
        );
        if (
          variant === 'after' &&
          marks.some(
            m => Math.abs(m.errorY) > 0.03 || Math.abs(m.errorHeight) > 0.03,
          )
        )
          throw new Error('Alignment regression: ' + JSON.stringify(marks));
        await page.screenshot({
          path: path.join(root, `alignment-${variant}-${theme}-dpr${dpr}.png`),
        });
        results.push({ variant, dpr, theme, marks });
        await context.close();
      }
    }
  }
  fs.writeFileSync(
    path.join(root, 'alignment-results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log('Alignment checked in both themes at DPR 1 and 2');
};
