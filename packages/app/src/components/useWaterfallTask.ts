import { useEffect, useMemo, useState } from 'react';

import {
  finishWaterfallTask,
  runWaterfallTask,
  WATERFALL_SYNC_ROW_LIMIT,
} from './waterfallTask';

// Callers memoize task factories. Retention is opt-in and scoped to one query.
// Obsolete results are released during query changes and navigation.
export default function useWaterfallTask<T>(
  createTask: () => Generator<void, T>,
  rowCount: number,
  {
    enabled = true,
    retainPreviousFor,
  }: { enabled?: boolean; retainPreviousFor?: object } = {},
) {
  const immediate = useMemo(
    () =>
      enabled && rowCount <= WATERFALL_SYNC_ROW_LIMIT
        ? { value: finishWaterfallTask(createTask()) }
        : undefined,
    [createTask, rowCount, enabled],
  );
  const [completed, setCompleted] = useState<
    | {
        task: typeof createTask;
        scope: typeof retainPreviousFor;
        value: T;
        error?: never;
      }
    | {
        task: typeof createTask;
        scope: typeof retainPreviousFor;
        error: unknown;
        value?: never;
      }
  >();

  useEffect(() => {
    if (!enabled || immediate) return;
    const controller = new AbortController();
    void runWaterfallTask(createTask(), controller.signal).then(
      value => {
        if (!controller.signal.aborted)
          setCompleted({ task: createTask, scope: retainPreviousFor, value });
      },
      error => {
        if (!controller.signal.aborted)
          setCompleted({ task: createTask, scope: retainPreviousFor, error });
      },
    );
    return () => controller.abort();
  }, [createTask, immediate, enabled, retainPreviousFor]);

  if (immediate && retainPreviousFor) {
    if (completed?.task !== createTask || completed.scope !== retainPreviousFor)
      setCompleted({
        task: createTask,
        scope: retainPreviousFor,
        value: immediate.value,
      });
  } else if (
    completed &&
    (completed.scope !== retainPreviousFor ||
      (!retainPreviousFor && completed.task !== createTask))
  ) {
    setCompleted(undefined);
  }

  if (immediate) return { value: immediate.value, isPreparing: false };
  if (
    enabled &&
    completed?.task === createTask &&
    completed.scope === retainPreviousFor
  ) {
    if ('error' in completed) throw completed.error;
    return { value: completed.value, isPreparing: false };
  }
  if (
    retainPreviousFor &&
    completed?.scope === retainPreviousFor &&
    'value' in completed
  )
    return { value: completed.value, isPreparing: true };
  return { value: undefined, isPreparing: true };
}
