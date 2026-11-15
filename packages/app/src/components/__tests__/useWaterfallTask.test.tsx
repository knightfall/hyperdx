import { act, renderHook } from '@testing-library/react';

import useWaterfallTask from '@/components/useWaterfallTask';

describe('useWaterfallTask', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('prepares small traces synchronously', () => {
    function* prepare() {
      yield;
      return ['ready'];
    }
    const { result } = renderHook(() => useWaterfallTask(prepare, 2));
    expect(result.current).toEqual({ value: ['ready'], isPreparing: false });
  });

  it('yields large jobs and discards a cancelled trace before processing more rows', async () => {
    jest.useFakeTimers();
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
    const visit = jest.fn();
    function* oldTrace() {
      visit('first chunk');
      yield;
      visit('cancelled chunk');
      return ['old trace'];
    }
    function* newTrace() {
      yield;
      return ['new trace'];
    }
    const { result, rerender } = renderHook(
      ({ task, count }) => useWaterfallTask(task, count),
      { initialProps: { task: oldTrace, count: 200_000 } },
    );
    expect(result.current.isPreparing).toBe(true);
    expect(visit.mock.calls).toEqual([['first chunk']]);
    rerender({ task: newTrace, count: 1 });
    await act(async () => jest.runAllTimersAsync());
    expect(visit.mock.calls).toEqual([['first chunk']]);
    expect(result.current).toEqual({
      value: ['new trace'],
      isPreparing: false,
    });
  });

  it('publishes a completed large job once, after yielding to the browser', async () => {
    jest.useFakeTimers();
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
    function* prepare() {
      yield;
      yield;
      return ['complete'];
    }
    const { result } = renderHook(() => useWaterfallTask(prepare, 200_000));
    expect(result.current.value).toBeUndefined();
    await act(async () => jest.runAllTimersAsync());
    expect(result.current).toEqual({ value: ['complete'], isPreparing: false });
  });
});
