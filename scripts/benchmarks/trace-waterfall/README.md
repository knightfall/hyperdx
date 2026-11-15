# Trace waterfall browser benchmark

Builds the real waterfall container as a production React bundle and supplies
synthetic ClickHouse compact-row HTTP responses. It measures decoding, SQL row
IDs, timestamps, tree/model preparation, canvas drawing, and visible rows.

Install the repository dependencies and build common-utils first:

```sh
yarn install --immutable
yarn build:common-utils
node scripts/benchmarks/trace-waterfall/build.cjs
node scripts/benchmarks/trace-waterfall/run.cjs --optimized
node scripts/benchmarks/trace-waterfall/report.cjs
```

Generated bundles, screenshots, logs, CPU profiles, and JSON/Markdown results go
to `artifacts/trace-waterfall/`, which Git ignores. Keep this source directory
tracked. On Windows the runner uses installed Microsoft Edge. Elsewhere, install
Playwright Chromium first with
`yarn workspace @hyperdx/app exec playwright install chromium`.

Options:

- Run without `--optimized` to record `performance-results.json` before a
  change. Rebuild and run with `--optimized` afterward to record
  `performance-optimized.json`. The report compares these files.
- `--alignment-only`: first/middle/last selections, both themes, DPR 1 and 2.
- `--benchmark-only`: skip alignment screenshots.
- `--optimized --shuffle`: one 200,000-span run with shuffled query responses.
- `--optimized --interactions`: collapse, expand, and select in the 800,000-row
  fixture; assert selection does not repaint the base canvas.
- `--optimized --profile --worst`: sample CPU usage for the largest fixture.
  Then run `node scripts/benchmarks/trace-waterfall/profile.cjs --optimized`
  before rebuilding, so its source map still matches the profile.
- `--optimized --smoke`: one run each at 200,000 and 800,000 total rows.

Optional environment variables:

- `WATERFALL_REPO`: absolute path to another checkout.
- `WATERFALL_ARTIFACTS`: output directory, defaulting to the checkout's
  `artifacts/trace-waterfall/`.
- `WATERFALL_BROWSER_CHANNEL`: another installed Playwright browser channel.

The four repeated scenarios contain 50k, 200k, or 400k total spans, and
optionally 400k correlated logs. Each before/after window returns half the
total. Every trace includes six attributes (one with a 512-character payload)
and two span events. Three fresh browser contexts run each scenario.

Timing starts after bundle startup, when the container mounts. It includes the
complete minimap paint and two animation frames. SQL execution, production
network/compression, authentication/metadata lookups, and app startup are
excluded. Filter URL state and peripheral UI are substituted. Server-trace
fixtures do not make browser-resource timing or trigger queries; the actual
browser-context detection scan remains. The transport calls `JSON.parse` for
`Row.json()`, then uses the application's real buffered decoder.

Heap samples are post-paint used JS heap without forced collection: they include
collectible garbage and are not retained-heap or peak measurements.

Use `--memory --benchmark-only` to measure retained JS heap after garbage
collection, a 20ms sampled load peak, and memory after chart unmount and
query-cache cleanup. It runs three fresh contexts each at 200,000 spans and at
400,000 spans plus 400,000 logs. The first repetition also records live
allocation samples and source-mapped summaries. Set `WATERFALL_ARTIFACTS` to
separate baseline and optimized output directories, then run
`node scripts/benchmarks/trace-waterfall/memory-report.cjs` to compare
`memory-before/` and `memory-after/`. These measurements differ from the
uncollected heap samples above.
