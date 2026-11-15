import { useEffect, useMemo, useState } from 'react';

import {
  finishWaterfallTask,
  runWaterfallTask,
  WATERFALL_SYNC_ROW_LIMIT,
} from './waterfallTask';

// Task factories are memoized by the caller so selection/resize renders do not
// restart preparation. A changed trace never publishes the previous job's rows.
export default function useWaterfallTask<T>(
  createTask: () => Generator<void, T>,
  rowCount: number,
) {
  const immediate = useMemo(
    () =>
      rowCount <= WATERFALL_SYNC_ROW_LIMIT
        ? { value: finishWaterfallTask(createTask()) }
        : undefined,
    [createTask, rowCount],
  );
  const [completed, setCompleted] = useState<
    | { task: typeof createTask; value: T; error?: never }
    | { task: typeof createTask; error: unknown; value?: never }
  >();

  useEffect(() => {
    if (immediate) return;
    const controller = new AbortController();
    void runWaterfallTask(createTask(), controller.signal).then(
      value => {
        if (!controller.signal.aborted)
          setCompleted({ task: createTask, value });
      },
      error => {
        if (!controller.signal.aborted)
          setCompleted({ task: createTask, error });
      },
    );
    return () => controller.abort();
  }, [createTask, immediate]);

  // Release completed arrays immediately when navigating to another trace.
  if (completed && completed.task !== createTask) setCompleted(undefined);

  if (immediate) return { value: immediate.value, isPreparing: false };
  if (completed?.task === createTask) {
    if ('error' in completed) throw completed.error;
    return { value: completed.value, isPreparing: false };
  }
  return { value: undefined, isPreparing: true };
}
