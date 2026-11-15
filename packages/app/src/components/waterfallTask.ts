export const WATERFALL_SYNC_ROW_LIMIT = 1000;
const WORK_BUDGET_MS = 8;

export function finishWaterfallTask<T>(task: Generator<void, T>): T {
  let step = task.next();
  while (!step.done) step = task.next();
  return step.value;
}

export async function runWaterfallTask<T>(
  task: Generator<void, T>,
  signal: AbortSignal,
): Promise<T> {
  while (!signal.aborted) {
    const deadline = performance.now() + WORK_BUDGET_MS;
    do {
      const step = task.next();
      if (step.done) return step.value;
    } while (performance.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new DOMException('Waterfall preparation cancelled', 'AbortError');
}
