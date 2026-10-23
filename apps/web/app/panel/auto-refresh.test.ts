import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_REFRESH_MS, watchPanelUpdates } from "./auto-refresh.ts";

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const visibility = new EventTarget();
  const connection = new EventTarget();
  const state = { visible: true, online: true, pending: false };
  const refresh = vi.fn();
  const stop = watchPanelUpdates({ visibility, connection, available: () => state.visible && state.online && !state.pending, refresh });
  return { visibility, connection, state, refresh, stop };
}

describe("T-1027 panel güncelliği", () => {
  it("açık ekranı kullanıcı yenilemeden düzenli günceller", () => {
    const s = setup();
    vi.advanceTimersByTime(PANEL_REFRESH_MS - 1);
    expect(s.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PANEL_REFRESH_MS);
    expect(s.refresh).toHaveBeenCalledTimes(2);
    s.stop();
  });
  it("gizli ve çevrimdışı sekmede durur; görünür ve bağlı olunca beklemeden günceller", () => {
    const s = setup();
    s.state.visible = false;
    vi.advanceTimersByTime(PANEL_REFRESH_MS * 3);
    expect(s.refresh).not.toHaveBeenCalled();
    s.state.online = false;
    s.state.visible = true;
    s.visibility.dispatchEvent(new Event("visibilitychange"));
    expect(s.refresh).not.toHaveBeenCalled();
    s.state.online = true;
    s.connection.dispatchEvent(new Event("online"));
    s.visibility.dispatchEvent(new Event("visibilitychange"));
    s.connection.dispatchEvent(new Event("focus"));
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.stop();
  });
  it("devam eden yenilemeyi çoğaltmaz; tamamlanınca sıradaki sorguyu yapar", () => {
    const s = setup();
    s.state.pending = true;
    vi.advanceTimersByTime(PANEL_REFRESH_MS * 2);
    s.connection.dispatchEvent(new Event("focus"));
    expect(s.refresh).not.toHaveBeenCalled();
    s.state.pending = false;
    vi.advanceTimersByTime(PANEL_REFRESH_MS);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.stop();
  });
  it("ekrandan ayrılınca zamanlayıcı ve tüm dinleyiciler temizlenir", () => {
    const s = setup();
    s.stop();
    vi.advanceTimersByTime(PANEL_REFRESH_MS * 3);
    for (const name of ["focus", "online"]) s.connection.dispatchEvent(new Event(name));
    s.visibility.dispatchEvent(new Event("visibilitychange"));
    expect(s.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
