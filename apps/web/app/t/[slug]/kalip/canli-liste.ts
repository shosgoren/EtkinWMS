/** T-1066: visible, idle lists follow background imports without interrupting forms. */
export const LIST_REFRESH_MS = 30_000;
export function watchListUpdates({ visibility, connection, available, refresh }: {
  visibility: EventTarget; connection: EventTarget; available: () => boolean; refresh: () => void;
}): () => void {
  let last = -Infinity;
  const update = (): void => {
    if (!available() || Date.now() - last < 1_000) return;
    last = Date.now();
    refresh();
  };
  const timer = setInterval(update, LIST_REFRESH_MS);
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
