// Canlı yayın kuyruk eşitlemesi (T-411): `release.py` her yayında, önceki sürüm çalışırken, migration imajındaki tek dosya paketini
// (`/queue-installer/sync.mjs`) migration rolüyle koşar. Yalnız eksik kuyrukları oluşturur (`syncQueues`; şema yükseltmesi ve yetki
// değişikliği yok). Yalnızca `DATABASE_URL_DIRECT` kabul edilir; bağlantı bilgisi hiçbir çıktıya yazılmaz (G-09).
import { syncQueues } from "./index.ts";

const url = process.env.DATABASE_URL_DIRECT;
if (url === undefined || url.trim() === "") {
  console.error("queue sync: DATABASE_URL_DIRECT tanımlı değil");
  process.exit(1);
}
try {
  const created = await syncQueues({ url });
  console.log(`queue sync: ${created.length} yeni kuyruk${created.length > 0 ? ` (${created.join(", ")})` : ""}`);
} catch (err) {
  const e = err as { name?: unknown; message?: unknown; sqlstate?: unknown };
  console.error(`queue sync FAILED: ${String(e.name)}${typeof e.sqlstate === "string" ? ` (${e.sqlstate})` : ""}: ${String(e.message)}`);
  process.exit(1);
}
