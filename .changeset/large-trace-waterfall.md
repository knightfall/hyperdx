---
'@hyperdx/app': patch
---

Support up to 200,000 spans per trace waterfall query window. Improve large-trace performance by deferring off-screen row details, drawing the minimap on canvas, parsing timestamps once during sorting, and reusing the span tree when collapsing rows.

Buffer waterfall query results until each page is complete, preserve the selected span's minimap highlight without redrawing the base canvas, and handle large correlated-log highlight lists and response chunks without exceeding JavaScript argument limits.
