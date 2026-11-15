// Only the transport and SQL rendering are substituted. The application's real
// buffered query hook still decodes Row.json() values and builds result objects.
export function getClickhouseClient() {
  return {
    query: async ({ query, abort_signal }) => {
      const config = JSON.parse(query);
      const parameters = new URLSearchParams(location.search);
      parameters.set('kind', config.from.tableName);
      parameters.set(
        'part',
        config.dateRangeStartInclusive ? 'before' : 'after',
      );
      const started = performance.now();
      const response = await fetch('/fixture?' + parameters, {
        signal: abort_signal,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let remaining = '';
      let bytes = 0;
      let finished = false;
      return {
        stream: () => ({
          getReader: () => ({
            read: async () => {
              if (finished) return { done: true };
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) {
                  finished = true;
                  window.__requests.push({
                    kind: config.from.tableName,
                    part: parameters.get('part'),
                    bytes,
                    durationMs: performance.now() - started,
                  });
                  if (remaining.trim())
                    return {
                      done: false,
                      value: [{ json: () => JSON.parse(remaining) }],
                    };
                  return { done: true };
                }
                bytes += chunk.value.byteLength;
                remaining += decoder.decode(chunk.value, { stream: true });
                const boundary = remaining.lastIndexOf('\n');
                if (boundary < 0) continue;
                const complete = remaining.slice(0, boundary);
                remaining = remaining.slice(boundary + 1);
                return {
                  done: false,
                  value: complete
                    .split('\n')
                    .map(line => ({ json: () => JSON.parse(line) })),
                };
              }
            },
          }),
        }),
      };
    },
  };
}
