"use client";
// T-991 (I-18): Entegrasyon — Entegrasyon.dc.html (Kalıp · Form birebir + "YENİ" bölümü, kap `.dzen`). Yalnız kalıp ortak bileşenleri:
// KalipEkran (form), KalipGrup, KalipIzgara, KalipAnahtar (akış aç/kapa), KalipSecenek (yön), KalipPencere + alanlar (Bağlan), KalipOnay (Kes),
// balon + ses (`useKalipToast`, `tone`). Yerel select / confirm / alert yok; her dokunuşta görsel + sesli geri bildirim; ana düğme (BAĞLAN /
// EŞİTLE) hiçbir durumda sessiz değil (yapılacak bir şey yoksa nedenini söyler).
// Bilinçli farklar (DESIGN-PARITY): Bağlan penceresi ve Kes onayı kaynağın `.sx` / `.cfbox`'ının kalıp penceresi uyarlamasıdır (T-974
// KalipPencere / KalipOnay); sesle komut (B-62 Etkin) henüz yok, ipucu satırı kaynaktaki gibi.
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { NICON } from "../../../design/entegrasyon-icons.ts";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAnahtar, KalipGrup, KalipIzgara, KalipSecenek } from "../kalip/form.tsx";
import { KalipOnay, KalipPencere, KalipPencereAlan, KalipPencereDugme } from "../kalip/pencere.tsx";
import { kdz } from "../kalip/tokens.ts";
import { checkIntegrationAction, connectParasutAction, disconnectIntegrationAction, runIntegrationAction, setIntegrationFlowAction } from "./actions.ts";
import { feedback, intlDil } from "@wms/ui";

type Provider = "PARASUT" | "LOGO";
type Flow = "PRODUCTS" | "CONTACTS" | "WAREHOUSES" | "SALES_ORDERS" | "SHIPMENTS" | "STOCK";
type Direction = "PULL" | "PUSH" | "BOTH";

export interface FlowData {
  readonly flow: Flow;
  readonly directions: readonly Direction[];
  readonly enabled: boolean;
  readonly direction: Direction;
  readonly lastRunAt: string | null;
  readonly lastStatus: "SUCCESS" | "PARTIAL" | "FAILED" | null;
  readonly errorCount: number;
  readonly lastErrorCode: string | null;
}
export interface OverviewData {
  readonly demo: boolean;
  readonly outbox: { readonly pending: number; readonly check: number; readonly failed: number };
  readonly providers: readonly {
    readonly provider: Provider;
    readonly available: boolean;
    readonly connection: { readonly status: "CONNECTED" | "ERROR" | "DISCONNECTED"; readonly label: string | null; readonly lastCheckedAt: string | null; readonly lastErrorCode: string | null } | null;
    readonly flows: readonly FlowData[];
  }[];
  readonly runs: readonly { readonly id: string; readonly flow: Flow; readonly trigger: "SCHEDULE" | "MANUAL"; readonly status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED"; readonly startedAt: string; readonly created: number; readonly updated: number; readonly linked: number; readonly skipped: number; readonly failed: number; readonly errorCode: string | null }[];
}

/** Kaynak FL: akış ikonu ve rengi. */
const FLOW_UI: Readonly<Record<Flow, { readonly d: string; readonly color: string }>> = {
  PRODUCTS: { d: LICON.box, color: "9A5B2E" },
  CONTACTS: { d: LICON.people, color: "6C4BD8" },
  WAREHOUSES: { d: LICON.depo, color: "0F6E8C" },
  SALES_ORDERS: { d: LICON.clip, color: "4E6476" },
  SHIPMENTS: { d: NICON.truck, color: "2F7D5B" },
  STOCK: { d: NICON.chart, color: "B07D0B" },
};
const DIR_D: Readonly<Record<Direction, string>> = { PULL: NICON.pull, PUSH: NICON.push, BOTH: NICON.both };
const PROVIDER_COLOR: Readonly<Record<Provider, string>> = { PARASUT: "2F5DA8", LOGO: "30475A" };
const PROVIDER_NAME: Readonly<Record<Provider, string>> = { PARASUT: "Paraşüt", LOGO: "Logo" };
const c = (hex: string): string => kdz("dzf", hex);

const EMPTY_FORM = { companyId: "", clientId: "", clientSecret: "", username: "", password: "" };

export function IntegrationsView({ slug, dark, data }: { slug: string; dark: boolean; data: OverviewData }) {
  const t = useTranslations("integrations");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const ts = useTranslations("serverErrors");
  const router = useRouter();
  const formId = useId();
  const base = `/t/${encodeURIComponent(slug)}`;
  const { say, node: toast } = useKalipToast("form");
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reauth, setReauth] = useState(false);
  // İyimser akış durumu (sunucu yanıtı gelene dek); sunucu verisi değişince sıfırlanır.
  const [local, setLocal] = useState<Partial<Record<Flow, { enabled: boolean; direction: Direction }>>>({});
  useEffect(() => setLocal({}), [data]);

  const parasut = data.providers.find((p) => p.provider === "PARASUT");
  const conn = parasut?.connection ?? null;
  const connected = conn !== null;
  const pn = PROVIDER_NAME.PARASUT;
  const reasonText = (code: string | null | undefined): string => {
    const k = code ?? "UNKNOWN";
    return t.has(`reasons.${k}`) ? t(`reasons.${k}`) : t("reasons.UNKNOWN");
  };
  const when = (iso: string | null): string => {
    if (iso === null) return "";
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString(intlDil(locale), { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString(intlDil(locale), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  /** Sunucu eylemi sonucu: hata kodu → balon + ses; yeniden giriş gerekiyorsa bant. */
  const failed = (r: { ok: false; error: { code: string; detail?: string } }): void => {
    feedback.error();
    if (r.error.code === "UNAUTHENTICATED" && r.error.detail === "RECENT_AUTH_REQUIRED") {
      setReauth(true);
      say("warn", t("reauth"));
      return;
    }
    const k = r.error.code.toLowerCase();
    say("err", ts.has(k) ? `${ts(k)} ${ts.has(`${k}Action`) ? ts(`${k}Action`) : ""}`.trim() : `${ts("unknown")} ${ts("unknownAction")}`);
  };

  const flowState = (f: FlowData): { enabled: boolean; direction: Direction } => local[f.flow] ?? { enabled: f.enabled, direction: f.direction };

  const setFlow = async (f: FlowData, enabled: boolean, direction: Direction): Promise<void> => {
    const name = t(`flows.${f.flow}.name`);
    setLocal((cur) => ({ ...cur, [f.flow]: { enabled, direction } }));
    setBusy(`flow-${f.flow}`);
    const r = await setIntegrationFlowAction({ slug, provider: "PARASUT", flow: f.flow, enabled, direction });
    setBusy(null);
    if (!r.ok) {
      setLocal((cur) => ({ ...cur, [f.flow]: undefined }));
      failed(r);
      return;
    }
    if (!r.data.ok) {
      setLocal((cur) => ({ ...cur, [f.flow]: undefined }));
      say("err", reasonText(r.data.reason));
      return;
    }
    feedback.minor();
    if (direction !== f.direction && enabled && f.enabled) say("ok", t("dirSet", { name, dir: t(`dirs.${direction}`, { provider: pn }) }));
    else if (enabled) say("ok", r.data.queued ? t("flowOn", { name }) : t("flowOnNoQueue", { name }));
    else say("info", t("flowOff", { name }));
    router.refresh();
  };

  const toggle = (f: FlowData) => (): void => {
    if (f.directions.length === 0) {
      say("warn", t("flowNa", { provider: pn }));
      return;
    }
    if (busy !== null) return;
    const s = flowState(f);
    void setFlow(f, !s.enabled, s.direction);
  };

  const runFlow = async (flow?: Flow): Promise<void> => {
    if (busy !== null) return;
    setBusy(flow === undefined ? "run-all" : `run-${flow}`);
    const r = await runIntegrationAction({ slug, provider: "PARASUT", ...(flow === undefined ? {} : { flow }) });
    setBusy(null);
    if (!r.ok) return failed(r);
    if (!r.data.ok) {
      say("warn", reasonText(r.data.reason));
      return;
    }
    feedback.ok();
    say(r.data.queued ? "ok" : "info", !r.data.queued ? t("runBusy") : flow === undefined ? t("runAllQueued") : t("runQueued", { name: t(`flows.${flow}.name`) }));
    router.refresh();
  };

  const check = async (): Promise<void> => {
    if (busy !== null) return;
    feedback.minor();
    setBusy("check");
    const r = await checkIntegrationAction({ slug, provider: "PARASUT" });
    setBusy(null);
    if (!r.ok) return failed(r);
    if (r.data.ok) {
      say("ok", t("testOk", { label: r.data.label ?? conn?.label ?? pn }));
    } else {
      say("err", reasonText(r.data.reason));
    }
    router.refresh();
  };

  const submitConnect = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy !== null) return;
    if (Object.values(form).some((v) => v.trim() === "")) {
      say("warn", t("form.missing"));
      return;
    }
    setBusy("connect");
    const r = await connectParasutAction({ slug, ...form });
    setBusy(null);
    if (!r.ok) return failed(r);
    if (!r.data.ok) {
      say("err", reasonText(r.data.reason));
      return;
    }
    setForm(EMPTY_FORM); // girilen sır bellekte tutulmaz
    setFormOpen(false);
    say("ok", t("form.connected", { label: r.data.label }));
    router.refresh();
  };

  const cut = async (): Promise<void> => {
    setBusy("cut");
    const r = await disconnectIntegrationAction({ slug, provider: "PARASUT" });
    setBusy(null);
    setCutOpen(false);
    if (!r.ok) return failed(r);
    say("ok", t("cutDone"));
    router.refresh();
  };

  const openForm = (): void => {
    if (data.demo) {
      say("warn", t("demo"));
      return;
    }
    feedback.minor();
    setFormOpen(true);
  };

  const flows = parasut?.flows ?? [];
  const anyOn = flows.some((f) => flowState(f).enabled);
  const main = connected
    ? {
        label: t("mainSync"),
        aria: anyOn ? t("mainSyncAria") : t("mainSyncNone"),
        d: NICON.sync,
        onClick: (): void => {
          if (!anyOn) {
            feedback.error();
            say("info", t("mainSyncNone"));
            return;
          }
          void runFlow();
        },
        testId: "integrations-sync",
      }
    : { label: t("mainConnect"), aria: t("mainConnectAria", { provider: pn }), d: NICON.plug, onClick: openForm, testId: "integrations-connect" };

  const err = conn?.status === "ERROR";
  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={t("title")}
      icon={{ d: NICON.plug, color: "2F5DA8" }}
      testId="integrations"
      bar={{
        back: { href: `${base}/settings`, testId: "kabuk-back" },
        main,
      }}
      overlays={toast}
    >
      <div className={`dzen${dark ? " dz-dark" : ""}`} style={{ display: "contents" }}>
        {reauth ? (
          <div className="lockb" role="alert">
            <i>
              <Ico d={LICON.key} size={20} />
            </i>
            <span>
              <b>{t("reauth")}</b>
              <small>
                <a href={`/login?reauth=1&next=${encodeURIComponent(`${base}/integrations`)}`} style={{ color: "inherit" }}>
                  {t("reauthLink")}
                </a>
              </small>
            </span>
          </div>
        ) : null}
        {data.demo ? (
          <div className="lockb" role="status" data-testid="integrations-demo">
            <i>
              <Ico d={LICON.lock} size={20} />
            </i>
            <span>
              <b>{t("demo")}</b>
              <small>{t("demoSub")}</small>
            </span>
          </div>
        ) : null}
        <KalipBaslik title={t("head")} hint={connected ? t("hintOn") : t("hintNone")} />
        {!connected ? (
          <div className="provs" role="list" aria-label={t("providerList")} data-testid="integrations-providers">
            {data.providers.map((p) => {
              const soon = !p.available;
              return (
                <button
                  key={p.provider}
                  type="button"
                  role="listitem"
                  className={`prov${soon ? " soon" : ""}`}
                  aria-label={`${PROVIDER_NAME[p.provider]}: ${soon ? t("pillSoon") : t("pillConnect")}`}
                  aria-disabled={soon}
                  data-testid={`provider-${p.provider}`}
                  onClick={() => {
                    if (soon) {
                      feedback.error();
                      say("info", t("soonToast"));
                      return;
                    }
                    openForm();
                  }}
                >
                  <span className="plogo" style={{ background: c(PROVIDER_COLOR[p.provider]) }}>
                    {t(`providers.${p.provider}.ini`)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b>{t(`providers.${p.provider}.name`)}</b>
                    <small>{t(`providers.${p.provider}.sub`)}</small>
                  </span>
                  <span className={`pill ${soon ? "soon" : "go"}`}>{soon ? t("pillSoon") : t("pillConnect")}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className={`conn${err ? " err" : ""}`} role="status" data-testid="integrations-conn" data-status={conn.status}>
              <i>
                <Ico d={err ? LICON.warn : LICON.check} size={22} />
              </i>
              <span style={{ minWidth: 0 }}>
                <b>{err ? t("connErrTitle", { provider: pn }) : t("connTitle", { label: conn.label ?? pn })}</b>
                <small>
                  {err
                    ? `${reasonText(conn.lastErrorCode).toLocaleUpperCase(intlDil(locale))} · ${t("connErrSub")}`
                    : conn.lastCheckedAt === null
                      ? t("connSubNever", { provider: pn.toLocaleUpperCase(intlDil(locale)) })
                      : t("connSub", { provider: pn.toLocaleUpperCase(intlDil(locale)), at: when(conn.lastCheckedAt) })}
                </small>
              </span>
              <span className="cact">
                {err ? (
                  <button type="button" className="btn n sm" onClick={openForm} data-testid="integrations-reconnect">
                    <Ico d={NICON.plug} size={20} />
                    {t("reconnect")}
                  </button>
                ) : (
                  <button type="button" className="btn n sm" onClick={() => void check()} aria-busy={busy === "check"} data-testid="integrations-test">
                    <Ico d={NICON.pulse} size={20} />
                    {t("test")}
                  </button>
                )}
                <button
                  type="button"
                  className="rej sm"
                  onClick={() => {
                    feedback.error();
                    setCutOpen(true);
                  }}
                  data-testid="integrations-cut"
                >
                  <Ico d={NICON.unlink} size={20} />
                  {t("cut")}
                </button>
              </span>
            </div>
            {data.outbox.check > 0 || data.outbox.failed > 0 ? (
              <div className="conn err" role="alert" data-testid="integrations-outbox">
                <i>
                  <Ico d={LICON.warn} size={22} />
                </i>
                <span style={{ minWidth: 0 }}>
                  <b>{data.outbox.check > 0 ? t("outboxCheck", { n: data.outbox.check }) : t("outboxFailed", { n: data.outbox.failed })}</b>
                  <small>{data.outbox.check > 0 ? t("outboxCheckSub") : reasonText("ROWS_FAILED").toLocaleUpperCase(intlDil(locale))}</small>
                </span>
              </div>
            ) : null}
            <KalipIzgara
              left={
                <KalipGrup title={t("flowsTitle")} sub={t("flowsSub")} d={NICON.sync} color="2F5DA8" testId="integrations-flows">
                  {flows.map((f) => {
                    const ui = FLOW_UI[f.flow];
                    const s = flowState(f);
                    const na = f.directions.length === 0;
                    const name = t(`flows.${f.flow}.name`);
                    const sub = t(`flows.${f.flow}.sub`, { provider: pn.toLocaleUpperCase(intlDil(locale)) });
                    const bad = f.lastStatus === "FAILED" || f.lastStatus === "PARTIAL";
                    return (
                      <div key={f.flow} className={`flw${s.enabled ? " on" : ""}`} data-testid={`flow-${f.flow}`} data-enabled={s.enabled ? "true" : "false"}>
                        <KalipAnahtar
                          title={name}
                          sub={s.enabled && !na ? `${t(`dirs.${s.direction}`, { provider: pn }).toLocaleUpperCase(intlDil(locale))} · ${sub}` : sub}
                          d={ui.d}
                          color={ui.color}
                          on={s.enabled}
                          locked={na}
                          lockedReason={na ? t("flowNa", { provider: pn }) : undefined}
                          aria={na ? t("flowNaAria", { name, provider: pn }) : s.enabled ? t("flowOnAria", { name }) : t("flowOffAria", { name })}
                          onToggle={toggle(f)}
                          testId={`flow-${f.flow}-toggle`}
                        />
                        {s.enabled && !na ? (
                          <>
                            <div className="fdir">
                              <KalipSecenek
                                label={t("dirAria", { name })}
                                value={s.direction}
                                color={ui.color}
                                onPick={(id) => {
                                  if (busy !== null || id === s.direction) {
                                    feedback.minor();
                                    return;
                                  }
                                  feedback.minor();
                                  void setFlow(f, true, id as Direction);
                                }}
                                options={f.directions.map((d) => ({ id: d, label: t(`dirs.${d}`, { provider: pn }), d: DIR_D[d] }))}
                              />
                            </div>
                            <div className="fmeta">
                              <span className={bad ? "" : "ok"}>
                                {f.lastRunAt === null ? t("never") : bad ? t("lastErr", { at: when(f.lastRunAt), reason: reasonText(f.lastErrorCode).toLocaleUpperCase(intlDil(locale)) }) : t("lastOk", { at: when(f.lastRunAt) })}
                              </span>
                              {f.errorCount > 0 ? (
                                <span className="ebad" data-testid={`flow-${f.flow}-errors`}>
                                  <Ico d={LICON.warn} size={12} />
                                  {t("errBadge", { n: f.errorCount })}
                                </span>
                              ) : null}
                              <button type="button" className="frun" onClick={() => void runFlow(f.flow)} aria-busy={busy === `run-${f.flow}`} data-testid={`flow-${f.flow}-run`}>
                                <Ico d={NICON.sync} size={16} />
                                {t("runNow")}
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </KalipGrup>
              }
              right={
                <KalipGrup title={t("runsTitle")} sub={t("runsSub")} d={LICON.clock} color="30475A" testId="integrations-runs">
                  <div className="runs" role="list">
                    {data.runs.length === 0 ? (
                      <div className="rl" role="listitem">
                        <i style={{ background: c("30475A") }}>
                          <Ico d={LICON.info} size={18} />
                        </i>
                        <span style={{ minWidth: 0 }}>
                          <b>{t("runsEmpty")}</b>
                        </span>
                        <em />
                      </div>
                    ) : (
                      data.runs.map((r) => {
                        const bad = r.status === "FAILED" || r.status === "PARTIAL";
                        const summary = r.errorCode !== null
                          ? reasonText(r.errorCode).toLocaleUpperCase(intlDil(locale))
                          : r.created + r.updated + r.linked === 0 && r.failed === 0
                            ? t("runNoChange")
                            : `${t("runCounts", { created: r.created, updated: r.updated, linked: r.linked })}${r.failed > 0 ? ` · ${t("runFailedRows", { n: r.failed })}` : ""}`;
                        return (
                          <div key={r.id} className={`rl${bad ? " bad" : ""}`} role="listitem" data-testid="integration-run" data-status={r.status}>
                            <i style={{ background: c(bad ? "C62828" : "2F9E6B") }}>
                              <Ico d={bad ? LICON.warn : LICON.check} size={18} />
                            </i>
                            <span style={{ minWidth: 0 }}>
                              <b>{t(`flows.${r.flow}.name`)}</b>
                              <small>{`${t(`trigger.${r.trigger}`)} · ${t("runMeta", { at: when(r.startedAt), summary })}`}</small>
                            </span>
                            <em>{t(`runStatus.${r.status}`)}</em>
                          </div>
                        );
                      })
                    )}
                  </div>
                </KalipGrup>
              }
            />
          </>
        )}
        <KalipPencere
          open={formOpen}
          title={t("form.title", { provider: pn })}
          icon={{ d: NICON.plug, color: "2F5DA8" }}
          onClose={() => {
            setFormOpen(false);
            setForm(EMPTY_FORM);
          }}
          onSubmit={(e) => void submitConnect(e)}
          busy={busy === "connect"}
          testId="integrations-form"
          footer={
            <>
              <KalipPencereDugme
                kind="cancel"
                onClick={() => {
                  feedback.minor();
                  setFormOpen(false);
                  setForm(EMPTY_FORM);
                }}
                disabled={busy === "connect"}
              >
                {t("form.cancel")}
              </KalipPencereDugme>
              <KalipPencereDugme kind="ok" type="submit" loading={busy === "connect"} data-testid="integrations-form-submit">
                <Ico d={NICON.plug} size={20} />
                {t("form.submit")}
              </KalipPencereDugme>
            </>
          }
        >
          <div className="cnote" id={`${formId}-note`}>
            <i>
              <Ico d={LICON.info} size={20} />
            </i>
            <span>{t("form.note")}</span>
          </div>
          <KalipPencereAlan label={t("form.company")} hint={t("form.companyHint")} name="companyId" inputMode="numeric" autoComplete="off" required maxLength={12} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} data-testid="integrations-company" />
          <KalipPencereAlan label={t("form.clientId")} name="clientId" autoComplete="off" required maxLength={200} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} data-testid="integrations-client-id" />
          <KalipPencereAlan label={t("form.clientSecret")} name="clientSecret" type="password" autoComplete="off" required maxLength={200} value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} data-testid="integrations-client-secret" />
          <KalipPencereAlan label={t("form.email")} name="username" type="email" autoComplete="off" required maxLength={254} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="integrations-email" />
          <KalipPencereAlan label={t("form.password")} name="password" type="password" autoComplete="off" required maxLength={200} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="integrations-password" />
        </KalipPencere>
        <KalipOnay
          open={cutOpen}
          title={t("cutTitle")}
          description={t("cutText")}
          confirmLabel={t("cutConfirm")}
          cancelLabel={t("cutCancel")}
          loading={busy === "cut"}
          onConfirm={() => void cut()}
          onCancel={() => {
            feedback.minor();
            setCutOpen(false);
          }}
        />
      </div>
    </KalipEkran>
  );
}
