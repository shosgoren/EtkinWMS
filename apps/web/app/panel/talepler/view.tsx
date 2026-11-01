"use client";
// I-18 (DESIGN-PARITY): Yonet.dc.html `talepler` BİREBİR (bant, tek seferlik bağlantı kutusu, tablo; telefonda kartlara dönen satırlar).
// Satırlar gerçek veridir (wms_platform.demo_requests, aktivasyon durumuyla). Kapı ve veri page.tsx'te; eylem actions.ts'te.
// Ekranda teslimde bağlantı yalnız eylem yanıtıyla gelir ve yalnız bu bileşenin durumunda yaşar (yenilemede kaybolur; "Yeni bağlantı").
// T-1144 (kullanıcı kararı 1 Kasım; STANDART pencere kalıbından davranış eki): Onayla, Reddet ve reddedilmiş talepte Geri aç tek soruluk
// ortak onay penceresinden (`KalipOnay`) geçer; her sonuç ortak balon + ses (`useKalipToast`).
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { tarih } from "@wms/ui";
import { C, dz } from "../../design/yonet-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";
import { useKalipToast } from "../../t/[slug]/kalip/ekran.tsx";
import { KalipOnay } from "../../t/[slug]/kalip/pencere.tsx";
import type { TaleplerActionState } from "./actions.ts";

/** Talep satırı (sunucudaki `DemoRequestRow` ile aynı biçim; istemci dosyası sunucu paketini içe aktarmaz — T-127b). */
export interface DemoRequestRow {
  readonly id: string;
  readonly receivedAt: Date;
  readonly name: string;
  readonly company: string;
  readonly email: string;
  readonly sector: string;
  readonly message: string;
  readonly status: "PENDING" | "APPROVED" | "REJECTED";
  readonly decidedAt: Date | null;
  readonly activation: { readonly delivery: "EMAIL" | "SCREEN"; readonly expiresAt: Date } | null;
  readonly activatedAt: Date | null;
}

export interface TaleplerLabels {
  readonly banTitle: string;
  readonly banBody: string;
  readonly linkTitle: string;
  readonly linkBody: string;
  readonly copy: string;
  readonly copied: string;
  readonly colWho: string;
  readonly colSector: string;
  readonly colNeed: string;
  readonly colWhen: string;
  readonly lSector: string;
  readonly lNeed: string;
  readonly lWhen: string;
  readonly reject: string;
  readonly approve: string;
  readonly again: string;
  readonly sentEmail: string;
  readonly sentScreen: string;
  readonly expired: string;
  readonly activated: string;
  readonly rejected: string;
  readonly today: string;
  readonly yesterday: string;
  readonly empty: string;
  /** `{code}` yer tutuculu hata metni. */
  readonly error: string;
  /** T-1144: onay pencereleri (`{name}`, `{email}`, `{company}` yer tutucuları) ve sonuç balonları. */
  readonly reopen: string;
  readonly cancel: string;
  readonly approveAsk: string;
  readonly approveAskBody: string;
  readonly approveSend: string;
  readonly rejectAsk: string;
  readonly rejectAskBody: string;
  readonly reopenAsk: string;
  readonly reopenAskBody: string;
  readonly doneEmail: string;
  readonly doneScreen: string;
  readonly doneRejected: string;
  readonly doneReopened: string;
  readonly doneAgain: string;
  readonly failed: string;
  readonly emailTaken: string;
}

type Ask = "APPROVED" | "REJECTED" | "REOPEN";

/** Yer tutucuları doldurur (`{name}` → değer). */
export function fill(s: string, v: Readonly<Record<string, string>>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
}

/** T-1144: başarılı işlemin balon metni (onayda teslim yoluna göre). */
export function doneText(done: NonNullable<TaleplerActionState["done"]>, t: TaleplerLabels): string {
  if (done.intent === "REJECTED") return t.doneRejected;
  if (done.intent === "REOPEN") return t.doneReopened;
  if (done.intent === "REISSUE") return done.delivery === "EMAIL" ? t.doneEmail : t.doneAgain;
  return done.delivery === "EMAIL" ? t.doneEmail : t.doneScreen;
}

/** Kaynaktaki zaman biçimi: "BUGÜN 14:22", "DÜN 09:10", "12.10 16:45" (İstanbul saati). */
export function whenLabel(at: Date, now: Date, today: string, yesterday: string, locale: string): string {
  const tz = "Europe/Istanbul";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hm = tarih(at, locale, { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const d0 = day(at);
  if (d0 === day(now)) return `${today} ${hm}`;
  if (d0 === day(new Date(now.getTime() - 86_400_000))) return `${yesterday} ${hm}`;
  const [, mm, dd] = d0.split("-");
  return `${dd ?? ""}.${mm ?? ""} ${hm}`;
}

type RowState = "open" | "email" | "screen" | "expired" | "activated" | "rejected";

/** Kaynaktaki `RST` eşlemesi: talep + aktivasyon durumundan çip ve "Yeni bağlantı". */
export function rowState(r: DemoRequestRow, now: Date): RowState {
  if (r.status === "PENDING") return "open";
  if (r.status === "REJECTED") return "rejected";
  if (r.activatedAt !== null) return "activated";
  if (r.activation === null || r.activation.expiresAt.getTime() <= now.getTime()) return "expired";
  return r.activation.delivery === "EMAIL" ? "email" : "screen";
}

const CHIP: Readonly<Record<Exclude<RowState, "open">, { bg: string; fg: string; again: boolean }>> = {
  email: { bg: C["ok-bg"], fg: C["ok-fg"], again: false },
  screen: { bg: dz("FFE7A8"), fg: dz("4A3500"), again: true },
  expired: { bg: C.chip, fg: C.fg, again: true },
  activated: { bg: C["ok-bg"], fg: C["ok-fg"], again: false },
  rejected: { bg: C.chip, fg: C.fg, again: false },
};

/** T-1144: reddedilmiş talep geri açılabilir (onaylı/etkinleşmiş talep açılamaz; veritabanı da reddeder). */
export function canReopen(st: RowState): boolean {
  return st === "rejected";
}

export function TaleplerView({
  rows,
  now,
  labels: t,
  initialError,
  action,
}: {
  rows: readonly DemoRequestRow[];
  now: Date;
  labels: TaleplerLabels;
  initialError?: string | undefined;
  action: (prev: TaleplerActionState, form: FormData) => Promise<TaleplerActionState>;
}) {
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const [state, formAction, pending] = useActionState(action, initialError === undefined ? {} : { error: initialError });
  const [copied, setCopied] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ readonly kind: Ask; readonly row: DemoRequestRow } | null>(null);
  const { say } = useKalipToast();
  const told = useRef(state);
  const sent = useRef(false);
  // Her eylem yanıtı yeni bir nesnedir: sonuç bir kez balon + sesle bildirilir (ilk çizimdeki sayfa hatası ve yenilenen etiketler tekrar çalmaz).
  useEffect(() => {
    if (state === told.current) return;
    told.current = state;
    if (state.done !== undefined) say("ok", doneText(state.done, t));
    else if (state.error !== undefined) say("err", state.detail === "DEMO_EMAIL_TAKEN" ? t.emailTaken : t.failed);
  }, [state, say, t]);
  // Pencere sunucu yanıtı gelene dek açık kalır (düğmede dönen gösterge); yanıt gelince kapanır.
  useEffect(() => {
    if (!pending && sent.current) {
      sent.current = false;
      setAsk(null);
    }
  }, [pending]);
  function confirm(): void {
    if (ask === null || pending) return;
    const fd = new FormData();
    fd.set("id", ask.row.id);
    fd.set("intent", ask.kind);
    sent.current = true;
    startTransition(() => formAction(fd));
  }
  const who: Readonly<Record<string, string>> = ask === null ? {} : { name: ask.row.name, email: ask.row.email, company: ask.row.company };
  const chipText: Readonly<Record<Exclude<RowState, "open">, string>> = {
    email: t.sentEmail,
    screen: t.sentScreen,
    expired: t.expired,
    activated: t.activated,
    rejected: t.rejected,
  };
  async function copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
    } catch {
      setCopied(null);
    }
  }
  return (
    <>
      <div className="ban" style={{ background: C.chip }}>
        <svg className="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d={YICON.lock} />
        </svg>
        <span>
          <b>{t.banTitle}</b>
          {t.banBody}
        </span>
      </div>
      {state.link !== undefined ? (
        <div className="ban" role="status" style={{ background: dz("FFE7A8"), color: dz("4A3500") }} data-testid="activation-link">
          <svg className="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d={YICON.link} />
          </svg>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{t.linkTitle}</b>
            {t.linkBody}
            <span className="mono" style={{ display: "block", marginTop: "8px", fontSize: "13px", overflowWrap: "anywhere" }}>
              {state.link}
            </span>
          </span>
          <button type="button" className="btn sm" style={{ background: dz("4A3500"), color: dz("FFFFFF") }} onClick={() => void copy(state.link ?? "")}>
            {copied === state.link ? t.copied : t.copy}
          </button>
        </div>
      ) : null}
      {state.error !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{t.error.replace("{code}", state.error)}</span>
        </div>
      ) : null}
      <div className="card" style={{ background: C.surface, paddingTop: "8px" }}>
        <div className="tbox">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t.colWho}</th>
                <th>{t.colSector}</th>
                <th>{t.colNeed}</th>
                <th>{t.colWhen}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = rowState(r, now);
                return (
                  <tr key={r.id} data-status={r.status} data-state={st}>
                    <td>
                      <span className="tname">
                        <b>{r.name}</b>
                        <span>{`${r.company} · ${r.email}`}</span>
                      </span>
                    </td>
                    <td data-l={t.lSector}>{r.sector}</td>
                    <td data-l={t.lNeed} style={{ maxWidth: "320px" }}>
                      {r.message}
                    </td>
                    <td data-l={t.lWhen} className="mono" style={{ fontSize: "13px" }}>
                      {whenLabel(r.receivedAt, now, t.today, t.yesterday, locale)}
                    </td>
                    <td>
                      {st === "open" ? (
                        <div className="acts" style={{ flexWrap: "nowrap" }}>
                          <button type="button" className="btn sm" style={{ background: C.chip }} disabled={pending} onClick={() => setAsk({ kind: "REJECTED", row: r })}>
                            {t.reject}
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            style={{ background: dz("17804F"), color: dz("FFFFFF") }}
                            disabled={pending}
                            onClick={() => setAsk({ kind: "APPROVED", row: r })}
                          >
                            {t.approve}
                          </button>
                        </div>
                      ) : (
                        <form action={formAction} className="acts" style={{ flexWrap: "nowrap", alignItems: "center" }}>
                          <span className="chip" style={{ background: CHIP[st].bg, color: CHIP[st].fg }}>
                            {chipText[st]}
                          </span>
                          {canReopen(st) ? (
                            <button type="button" className="btn sm" style={{ background: C.chip }} disabled={pending} onClick={() => setAsk({ kind: "REOPEN", row: r })}>
                              {t.reopen}
                            </button>
                          ) : null}
                          {CHIP[st].again ? (
                            <>
                              <input type="hidden" name="id" value={r.id} />
                              <button type="submit" name="intent" value="REISSUE" className="btn sm" style={{ background: C.chip }} disabled={pending}>
                                {t.again}
                              </button>
                            </>
                          ) : null}
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <div className="empty">{t.empty}</div> : null}
      </div>
      <KalipOnay
        open={ask !== null}
        title={ask === null ? "" : fill(ask.kind === "APPROVED" ? t.approveAsk : ask.kind === "REJECTED" ? t.rejectAsk : t.reopenAsk, who)}
        description={ask === null ? "" : fill(ask.kind === "APPROVED" ? t.approveAskBody : ask.kind === "REJECTED" ? t.rejectAskBody : t.reopenAskBody, who)}
        confirmLabel={ask?.kind === "APPROVED" ? t.approveSend : ask?.kind === "REJECTED" ? t.reject : t.reopen}
        cancelLabel={t.cancel}
        variant={ask?.kind === "REJECTED" ? "danger" : "primary"}
        loading={pending && ask !== null}
        onConfirm={confirm}
        onCancel={() => {
          if (!pending) setAsk(null);
        }}
      />
    </>
  );
}
