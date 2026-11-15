import type { QueryResultTransform } from '@/hooks/useOffsetPaginatedQuery';

// The waterfall reads these namespaces for HTTP/RPC labels and browser context.
// Full attributes in the details panel come from its own row query.
const LABEL_ATTRIBUTE = /^(?:http|url|net|server|rpc|grpc)\./;

export const waterfallResultTransform: QueryResultTransform = {
  cacheKey: 'waterfall-attributes-v1',
  transform(row) {
    const attributes = row.SpanAttributes;
    if (
      attributes == null ||
      typeof attributes !== 'object' ||
      Array.isArray(attributes)
    )
      return row;
    return {
      ...row,
      SpanAttributes: Object.fromEntries(
        Object.entries(attributes).filter(
          ([key]) =>
            LABEL_ATTRIBUTE.test(key) ||
            key === 'browser.document.url.full' ||
            key === 'session.id' ||
            key === 'browser' ||
            key === 'session',
        ),
      ),
    };
  },
};
