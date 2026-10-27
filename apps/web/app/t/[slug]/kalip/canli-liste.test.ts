import { afterEach, describe, expect, it, vi } from "vitest";
import { watchListUpdates } from "./canli-liste.ts";
afterEach(() => vi.useRealTimers());
describe("background list updates", () => {
 it("polls at thirty seconds, skips unavailable lists and coalesces wakeup events", () => {
  vi.useFakeTimers();
  const visibility=new EventTarget(), connection=new EventTarget(), refresh=vi.fn();
  let available=true;
  const stop=watchListUpdates({visibility,connection,available:()=>available,refresh});
  vi.advanceTimersByTime(29_999); expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(1);
  available=false; vi.advanceTimersByTime(60_000); connection.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
  available=true; visibility.dispatchEvent(new Event("visibilitychange"));connection.dispatchEvent(new Event("focus"));connection.dispatchEvent(new Event("online"));
  expect(refresh).toHaveBeenCalledTimes(2);
  stop(); vi.advanceTimersByTime(60_000); connection.dispatchEvent(new Event("focus"));visibility.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(2);
 });
});
