"use client";
// T-971 (B-63): Ekip alt ekranlarının (Üyeler, Saha personeli, Cihazlar, Ekibe katılma) kalıp içi ortak küçük parçaları: kart eylem düğmesi
// (kaynak `.btn` / `.btn.n` / `.btn.y` + kaynak paletinden yumuşak / tehlike tonu), QR (qrcode modülleri → SVG; beyaz zemin + lacivert
// modül her iki temada okunur) ve hata satırı (yeniden giriş bağlantısıyla). Renkler yalnız kalıp kaynağının belirteçlerinden (`kdz`).
import { useMemo, type ButtonHTMLAttributes, type ReactNode } from "react";
import { create as createQr } from "qrcode";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico } from "../kalip/ekran.tsx";
import { kdz, type KalipScope } from "../kalip/tokens.ts";

export type BtnKind = "n" | "y" | "soft" | "danger" | "ok";

/** Kart içi eylem düğmesi (`.btn`). Devre dışıyken soluk. */
export function Btn({ kind, scope, d, children, style, disabled, ...rest }: { kind: BtnKind; scope: KalipScope; d?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const c = (hex: string): string => kdz(scope, hex);
  const tone =
    kind === "soft"
      ? { background: c("EEF1F4"), color: c("172E42") }
      : kind === "danger"
        ? { background: c("C62828"), color: c("FFFFFF") }
        : kind === "ok"
          ? { background: c("2F7D5B"), color: c("FFFFFF") }
          : undefined;
  return (
    <button type="button" className={kind === "n" || kind === "y" ? `btn ${kind}` : "btn"} disabled={disabled} style={{ whiteSpace: "normal", textAlign: "center", maxWidth: "100%", ...tone, ...(disabled === true ? { opacity: 0.5, cursor: "not-allowed" } : {}), ...style }} {...rest}>
      {d === undefined ? null : <Ico d={d} size={18} />}
      {children}
    </button>
  );
}

/** QR kodu (yalnız verilen değer; değer bu bileşenin dışına yazılmaz). */
export function QrCode({ value, label, scope, size, testId }: { value: string; label: string; scope: KalipScope; size: number; testId?: string }) {
  const qr = useMemo(() => {
    try {
      const m = createQr(value, { errorCorrectionLevel: "M" }).modules;
      const cells: { x: number; y: number }[] = [];
      for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) cells.push({ x, y });
      return { size: m.size, cells };
    } catch {
      return null;
    }
  }, [value]);
  if (qr === null) return null;
  return (
    <div role="img" aria-label={label} data-testid={testId} style={{ width: size, height: size, maxWidth: "100%", padding: 12, borderRadius: 16, background: kdz(scope, "FFFFFF"), alignSelf: "center", flex: "none" }}>
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true" shapeRendering="crispEdges" style={{ display: "block", width: "100%", height: "100%" }}>
        {qr.cells.map((q) => (
          <rect key={`${q.x}-${q.y}`} x={q.x} y={q.y} width="1" height="1" fill={kdz(scope, "172E42")} />
        ))}
      </svg>
    </div>
  );
}

export type ErrState = { readonly text: string; readonly reauth: boolean } | null;

/** Hata satırı (`role=alert`): neden + gerekiyorsa yeniden giriş bağlantısı. */
export function ErrLine({ err, returnTo, reauthLabel, scope }: { err: ErrState; returnTo: string; reauthLabel: string; scope: KalipScope }) {
  if (err === null) return null;
  return (
    <p role="alert" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: kdz(scope, "C62828"), fontWeight: 700, fontSize: 14 }}>
      <Ico d={LICON.warn} size={18} />
      <span>
        {err.text}
        {err.reauth ? (
          <a href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`} style={{ textDecoration: "underline", marginLeft: 6, color: "inherit" }}>
            {reauthLabel}
          </a>
        ) : null}
      </span>
    </p>
  );
}

/** Bilgi notu (kilit / saat ikonlu kısa açıklama; eski `.ban`). */
export function Note({ d, title, body }: { d: string; title: string; body: string }) {
  return (
    <p style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: 0, fontSize: 13.5, lineHeight: 1.4 }}>
      <span style={{ opacity: 0.75, flex: "none" }}>
        <Ico d={d} size={20} />
      </span>
      <span>
        <b>{title}</b> {body}
      </span>
    </p>
  );
}
