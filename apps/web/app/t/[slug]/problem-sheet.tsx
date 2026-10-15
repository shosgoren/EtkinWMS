"use client";
// T-989 (I-18): "Sorun bildir" penceresi. Tasarımda karşılığı olan ekran yoktur; kaynağın kendi pencere bileşenleriyle kurulur
// (`.ovl > .sheet`, `.k3` başlık, `.ucs/.uc` seçim çipleri ve kaynaktaki chipSt seçili stili, `.qfoot` + `.qbtns` + `.big`, kapatma `.qx`).
// Başarıda kaynaktaki tamam ekranı (`.ov.okov`) kısa süre gösterilir. Not alanı isteğe bağlıdır (en çok 500 karakter).
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { C, dz } from "../../design/bakis-tokens.ts";
import { ICON } from "../../design/bakis-icons.ts";
import { reportProblemAction } from "./work-actions.ts";

const REASONS = ["DAMAGED", "MISSING", "WRONG_ITEM", "NO_LABEL", "LOCATION", "OTHER"] as const;
type Reason = (typeof REASONS)[number];

/** Kaynak chipSt(on, col). */
function chipSt(on: boolean, col: string): CSSProperties {
  return on ? { background: col, borderColor: col, color: dz("FFFFFF") } : { background: C.chip, borderColor: "transparent", color: C.fg };
}

export function ProblemSheet({ slug, onClose, subjectKind, subjectId }: { slug: string; onClose: () => void; subjectKind?: string; subjectId?: string }) {
  const t = useTranslations("home.gv.problemSheet");
  const router = useRouter();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const submit = (): void => {
    if (reason === null) return;
    setError(null);
    start(async () => {
      const r = await reportProblemAction({ slug, reason, note: note.trim() === "" ? null : note.trim(), subjectKind: subjectKind ?? null, subjectId: subjectId ?? null });
      if (!r.ok) {
        setError(r.error.code === "FORBIDDEN" ? t("forbidden") : t("failed"));
        return;
      }
      setDone(true);
      router.refresh();
      window.setTimeout(onClose, 1100);
    });
  };

  if (done) {
    return (
      <div className="ov okov" role="status" aria-label={t("sent")}>
        <svg className="ovic" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="54" fill={dz("FFFFFF")} />
          <path className="chk" d="M36 62l16 16 34-36" fill="none" stroke={dz("17804F")} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="ovt">{t("sent")}</p>
      </div>
    );
  }

  return (
    <div className="ovl" onClick={onClose}>
      <div className="sheet" style={{ background: C.surface, color: C.fg }} role="dialog" aria-modal="true" aria-label={t("title")} onClick={(e) => e.stopPropagation()} data-testid="problem-sheet">
        <div className="qh">
          <span className="dmi" style={{ background: dz("C62828"), color: dz("FFFFFF"), width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <svg className="ico" width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
              <path d={ICON.warn} />
            </svg>
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b className="qn2">{t("title")}</b>
            <span className="mono qm">{t("hint")}</span>
          </div>
        </div>
        <div>
          <span className="k3">{t("reason")}</span>
          <div className="ucs" role="radiogroup" aria-label={t("reason")}>
            {REASONS.map((r) => (
              <button key={r} type="button" className="uc" role="radio" aria-checked={reason === r} style={chipSt(reason === r, dz("C62828"))} onClick={() => setReason(r)}>
                {t(`reasons.${r}`)}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className="k3">{t("note")}</span>
          <textarea
            className="mono"
            value={note}
            maxLength={500}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 16, border: "3px solid transparent", background: C.chip, color: C.fg, fontSize: 15, resize: "vertical" }}
          />
        </label>
        {error === null ? null : (
          <p role="alert" className="k3" style={{ color: C.sorun, opacity: 1 }}>
            {error}
          </p>
        )}
        <div className="qfoot" style={{ background: C.surface }}>
          <div className="qbtns">
            <button type="button" className="qx" style={{ background: C.chip, color: C.fg }} onClick={onClose} aria-label={t("cancel")}>
              <svg className="ico" width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 3 }}>
                <path d={ICON.close} />
              </svg>
            </button>
            <button type="button" className="big" style={{ background: dz("C62828"), color: dz("FFFFFF") }} onClick={submit} disabled={reason === null || pending} aria-disabled={reason === null || pending}>
              <svg className="ico" width="1.1em" height="1.1em" viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 2.6 }}>
                <path d={ICON.check} />
              </svg>
              {t("send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
