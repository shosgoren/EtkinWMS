/** T-1027: açık paneli beş saniyede bir güncelle; arka plan/çevrimdışı sekmede sorgulama yapma. */
export const PANEL_REFRESH_MS = 5_000;

export function watchPanelUpdates({
  visibility,
  connection,
  available,
  refresh,
}: {
  visibility: EventTarget;
  connection: EventTarget;
  available: () => boolean;
  refresh: () => void;
}): () => void {
  let last = -Infinity;
  const update = (): void => {
    // focus + visibilitychange + online aynı uyanışta gelebilir: tek sorgu.
    if (!available() || Date.now() - last < 1_000) return;
    last = Date.now();
    refresh();
  };
  const timer = setInterval(update, PANEL_REFRESH_MS);
  visibility.addEventListener("visibilitychange", update);
  connection.addEventListener("focus", update);
  connection.addEventListener("online", update);
  return () => {
    clearInterval(timer);
    visibility.removeEventListener("visibilitychange", update);
    connection.removeEventListener("focus", update);
    connection.removeEventListener("online", update);
  };
}
