---
'@hyperdx/app': patch
---

Support up to 200,000 spans per trace waterfall query window. Improve large-trace performance by deferring off-screen row details, drawing the minimap on canvas, parsing timestamps once during sorting, and reusing the span tree when collapsing rows.

Buffer waterfall query results until each page is complete, preserve the selected span's minimap highlight without redrawing the base canvas, and handle large correlated-log highlight lists and response chunks without exceeding JavaScript argument limits.

Keep the minimap selection aligned with its canvas bar inside the bordered strip.

Prepare large waterfalls in cancellable chunks, reuse per-window row IDs and parsed timestamps, resolve bulk bar colors once per status/service, and reuse tree nodes when flattening.

Reduce waterfall memory by filtering unused span attributes before caching and releasing inactive query windows. Preserve HTTP/RPC labels, browser context, complete event details, and explicitly highlighted attributes.
