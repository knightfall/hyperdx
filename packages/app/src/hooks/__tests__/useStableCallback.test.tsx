import { renderHook } from '@testing-library/react';

import { useStableCallback } from '@/hooks/useStableCallback';

it('keeps identity while invoking the latest callback with its arguments', () => {
  const first = jest.fn((a: number, b: number) => a + b);
  const next = jest.fn((a: number, b: number) => a * b);
  const { result, rerender } = renderHook(
    ({ callback }) => useStableCallback(callback),
    { initialProps: { callback: first } },
  );
  const stable = result.current;
  expect(first).not.toHaveBeenCalled();
  expect(stable(2, 3)).toBe(5);
  rerender({ callback: next });
  expect(result.current).toBe(stable);
  expect(stable(2, 3)).toBe(6);
  expect(first).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenLastCalledWith(2, 3);
});

it('forwards asynchronous results without wrapping their promise', () => {
  const promise = Promise.resolve('ready');
  const { result } = renderHook(() => useStableCallback(() => promise));
  expect(result.current()).toBe(promise);
});

it('forwards the original exception', () => {
  const error = new Error('callback failed');
  const { result } = renderHook(() =>
    useStableCallback(() => {
      throw error;
    }),
  );
  expect(result.current).toThrow(error);
});
