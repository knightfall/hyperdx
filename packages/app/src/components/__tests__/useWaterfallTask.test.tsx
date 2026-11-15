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
  it('keeps the complete view during same-query preparation and releases it for a different query', async () => {
    jest.useFakeTimers();
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
    function* first() {
      yield;
      return ['first'];
    }
    function* next() {
      yield;
      yield;
      return ['next'];
    }
    const scope = {};
    const otherScope = {};
    const { result, rerender } = renderHook(
      ({ task, enabled, scope }) =>
        useWaterfallTask(task, 1002, { enabled, retainPreviousFor: scope }),
      { initialProps: { task: first, enabled: true, scope } },
    );
    await act(async () => jest.runAllTimersAsync());
    expect(result.current).toEqual({ value: ['first'], isPreparing: false });
    rerender({ task: next, enabled: false, scope });
    expect(result.current).toEqual({ value: ['first'], isPreparing: true });
    rerender({ task: next, enabled: true, scope });
    expect(result.current).toEqual({ value: ['first'], isPreparing: true });
    await act(async () => jest.runAllTimersAsync());
    expect(result.current).toEqual({ value: ['next'], isPreparing: false });
    rerender({ task: first, enabled: false, scope: otherScope });
    expect(result.current).toEqual({ value: undefined, isPreparing: true });
  });

  it('retains a synchronous view when its same-query replacement becomes asynchronous', async () => {
    jest.useFakeTimers();
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
    function* small() {
      yield;
      return ['small'];
    }
    function* large() {
      yield;
      return ['large'];
    }
    const scope = {};
    const { result, rerender } = renderHook(
      ({ task, count }) =>
        useWaterfallTask(task, count, { retainPreviousFor: scope }),
      { initialProps: { task: small, count: 1 } },
    );
    rerender({ task: large, count: 1002 });
    expect(result.current).toEqual({ value: ['small'], isPreparing: true });
    await act(async () => jest.runAllTimersAsync());
    expect(result.current).toEqual({ value: ['large'], isPreparing: false });
  });
});
