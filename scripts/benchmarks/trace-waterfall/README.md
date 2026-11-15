# Trace waterfall browser benchmark

Builds the real waterfall container as a production React bundle and supplies
synthetic ClickHouse compact-row HTTP responses. It measures decoding, SQL row
IDs, timestamps, tree/model preparation, canvas drawing, and visible rows.

Measure the current checkout and generate a standalone report (no baseline is
required):

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

For a before/after comparison, collect the baseline **before applying the
proposed code change**, using the same browser, machine, fixture settings, and
benchmark scripts:

```sh
node scripts/benchmarks/trace-waterfall/build.cjs
node scripts/benchmarks/trace-waterfall/run.cjs --benchmark-only
# Apply the proposed code change, keeping the artifacts directory.
node scripts/benchmarks/trace-waterfall/build.cjs
node scripts/benchmarks/trace-waterfall/run.cjs --optimized
node scripts/benchmarks/trace-waterfall/report.cjs
```

The first run writes `performance-results.json`; the second writes
`performance-optimized.json`. A baseline checkout can also be supplied through
`WATERFALL_REPO` while keeping `WATERFALL_ARTIFACTS` fixed. Both checkouts need
their dependencies and built common-utils. The report compares matching fixture
settings and reports measured errors, repetitions, and rendering counts. It does
not run Jest, TypeScript, or lint; run those checks separately and retain their
logs.

Options:

- Run without `--optimized` to record `performance-results.json` before a
  change. Rebuild and run with `--optimized` afterward to record
  `performance-optimized.json`. The report compares these files.
- `--alignment-only`: first/middle/last selections, both themes, DPR 1 and 2.
- `--benchmark-only`: skip alignment screenshots.
- `--optimized --shuffle`: one 200,000-span run with shuffled query responses.
- `--optimized --interactions`: collapse, expand, filter, and select in the
  800,000-row fixture; assert chart/canvas identity, zoom/scroll preservation,
  source-tree reuse, and no selection repaint.
- `--optimized --profile --worst`: sample CPU usage for the largest fixture.
  Then run `node scripts/benchmarks/trace-waterfall/profile.cjs --optimized`
  before rebuilding, so its source map still matches the profile.
- `--optimized --smoke`: one run each at 200,000 and 800,000 total rows.

To exercise actual browser-trace folding, build with
`node scripts/benchmarks/trace-waterfall/build.cjs --browser-trace` and run
`node scripts/benchmarks/trace-waterfall/run.cjs --optimized --browser-trace --benchmark-only`.
This uses the real browser hook with a supplied resource-timing query result. It
checks a trace above 1,000 spans and a folded timing log; unrelated selection
must leave sorting, tree preparation, and canvas painting unchanged. Rebuild
without this flag for the standard server fixtures. Use separate artifact
directories to preserve each bundle and its source map.

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
excluded. Filter URL state and peripheral UI are substituted. Standard
server-trace fixtures substitute the browser hook and do not exercise timing-log
folding. The explicit browser-trace mode uses the real hook with the timing
query supplied at its boundary; the trigger query is disabled because the
fixture has no session ID. The transport calls `JSON.parse` for `Row.json()`,
then uses the application's real buffered decoder.

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

Combine `--memory --interactions --benchmark-only --optimized` to compare GC
heap before and after collapse, expand, filters, and selection. This asserts
retained growth below 5 MiB plus 32 bytes per fixture row, allowing UI/JIT
overhead while catching a retained duplicate timeline. The result records both
measurements and the budget. In this mode the sampled peak includes
interactions.
