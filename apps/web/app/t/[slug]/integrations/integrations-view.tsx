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
import { KalipAlan, KalipAnahtar, KalipGrup, KalipIzgara, KalipSecenek } from "../kalip/form.tsx";
import { KalipFormEkran } from "../kalip/form-ekran.tsx";
import { KalipSecim } from "../kalip/secim.tsx";
import { KalipOnay, KalipPencere, KalipPencereAlan, KalipPencereDugme } from "../kalip/pencere.tsx";
import { kdz } from "../kalip/tokens.ts";
import { checkIntegrationAction, connectParasutAction, disconnectIntegrationAction, pullOpeningStockAction, runIntegrationAction, setIntegrationFlowAction, setOpeningStockAction, setProductBarcodeAction, beginParasutOAuthAction, selectParasutOAuthCompanyAction, saveParasutOAuthSettingsAction, completeParasutOAuthCodeAction } from "./actions.ts";
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

/** T-1006: açılış stoku ayarı (varsayılan kapalı) + alındı zamanı + yazılabilecek raflar. */
export interface OpeningData {
  readonly enabled: boolean;
  readonly takenAt: string | null;
  readonly locations: readonly { readonly id: string; readonly code: string; readonly name: string; readonly warehouse: string }[];
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

export function IntegrationsView({ slug, dark, data, opening = null, journeyWish = null, pullBarcodes = false, oauth, oauthSelection, oauthResult }: { oauth:{configured:boolean;callbackUrl:string|null}; oauthSelection:readonly {id:string;name:string}[]|null; oauthResult:string|null; slug: string; dark: boolean; data: OverviewData; opening?: OpeningData | null; journeyWish?: boolean | null; pullBarcodes?: boolean }) {
  const t = useTranslations("integrations");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const ts = useTranslations("serverErrors");
  const router = useRouter();
  const formId = useId();
  const base = `/t/${encodeURIComponent(slug)}`;
  const { say, node: toast } = useKalipToast("form");
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen,setConfigOpen]=useState(false);
  const [appForm,setAppForm]=useState({clientId:"",clientSecret:"",callbackUrl:""});
  const [codeFlow,setCodeFlow]=useState<string|null>(null);
  const [authCode,setAuthCode]=useState("");
  const [company,setCompany]=useState("");
  const [copied,setCopied]=useState(false);
  const [selectOpen,setSelectOpen]=useState(oauthSelection!==null);
  useEffect(()=>setSelectOpen(oauthSelection!==null),[oauthSelection]);
  useEffect(()=>{if(oauthResult!==null){say(oauthResult==="connected"?"ok":"warn",t(`oauth.${oauthResult}`));router.replace(`${base}/integrations`);}},[oauthResult,router,base,say,t]);
  const [formOpen, setFormOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reauth, setReauth] = useState(false);
  // İyimser akış durumu (sunucu yanıtı gelene dek); sunucu verisi değişince sıfırlanır.
  const [local, setLocal] = useState<Partial<Record<Flow, { enabled: boolean; direction: Direction }>>>({});
  useEffect(() => setLocal({}), [data]);
  // T-1006: açılış stoku ayarının iyimser durumu ve hedef raf.
  const [barcodeOn, setBarcodeOn] = useState(pullBarcodes);
  useEffect(() => setBarcodeOn(pullBarcodes), [pullBarcodes]);
  const [openingOn, setOpeningOn] = useState<boolean | null>(null);
  useEffect(() => setOpeningOn(null), [opening]);
  const [openingLoc, setOpeningLoc] = useState<string>(opening?.locations[0]?.id ?? "");

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

  // Full-screen forms do not render the main screen's toast/banner. Keep the reason and next action visible here too.
  const formFailure = (r: { ok: false; error: { code: string; detail?: string; requestId?: string } }) => {
    failed(r);
    const key = r.error.code.toLowerCase();
    const message = r.error.code === "UNAUTHENTICATED" && r.error.detail === "RECENT_AUTH_REQUIRED"
      ? t("reauth")
      : ts.has(key) ? `${ts(key)} ${ts.has(`${key}Action`) ? ts(`${key}Action`) : ""}`.trim() : ts("unknown");
    return { ok: false as const, mesaj: message };
  };
  const reauthAction = reauth ? <a className="btn n" data-testid="oauth-reauth" href={`/login?reauth=1&next=${encodeURIComponent(`${base}/integrations`)}`}><Ico d={LICON.key} size={20}/>{t("reauthLink")}</a> : null;

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
    // T-1006: yolculuk adım 1'de "Mevcut stok miktarlarını da alalım mı?" cevaplandıysa bağlanınca ayara işlenir ("Hayır" = kapalı kalır).
    if (journeyWish === true) await setOpeningStockAction({ slug, provider: "PARASUT", enabled: true, via: "journey" });
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
    if(!oauth.configured){setConfigOpen(true);return;}
    if(busy!==null)return;
    setBusy("oauth");
    void beginParasutOAuthAction({slug}).then(r=>{
      if(!r.ok){setBusy(null);failed(r);return;}
      if(!r.data.ok){setBusy(null);say("err",t("oauth.failed"));return;}
      if(r.data.manual){setBusy(null);setCodeFlow(r.data.authorizationUrl);return;}
      window.location.assign(r.data.authorizationUrl);
    }).catch(()=>{setBusy(null);say("err",t("oauth.failed"));});
  };

  const openingEnabled = openingOn ?? opening?.enabled === true;
  const openingTaken = opening?.takenAt ?? null;
  const toggleOpening = async (): Promise<void> => {
    if (busy !== null) return;
    if (openingTaken !== null) {
      feedback.error();
      say("warn", t("opening.takenAt", { at: when(openingTaken) }));
      return;
    }
    const next = !openingEnabled;
    setOpeningOn(next);
    setBusy("opening");
    const r = await setOpeningStockAction({ slug, provider: "PARASUT", enabled: next });
    setBusy(null);
    if (!r.ok) {
      setOpeningOn(null);
      return failed(r);
    }
    if (!r.data.ok) {
      setOpeningOn(null);
      say("err", reasonText(r.data.reason));
      return;
    }
    feedback.minor();
    say(next ? "ok" : "info", next ? t("opening.on") : t("opening.off"));
    router.refresh();
  };
  const toggleBarcodes = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("barcode");
    const next = !barcodeOn;
    const result = await setProductBarcodeAction({ slug, enabled: next });
    setBusy(null);
    if (!result.ok) return failed(result);
    setBarcodeOn(next);
    say("ok", t("barcode.saved"));
    router.refresh();
  };

  const pullOpening = async (): Promise<void> => {
    if (busy !== null) return;
    if (openingLoc === "") {
      feedback.error();
      say("warn", t("opening.pickShelf"));
      return;
    }
    setBusy("pull");
    const r = await pullOpeningStockAction({ slug, provider: "PARASUT", locationId: openingLoc });
    setBusy(null);
    if (!r.ok) return failed(r);
    if (!r.data.ok) {
      feedback.error();
      say(r.data.reason === "NOTHING" ? "warn" : "err", t.has(`opening.reasons.${r.data.reason}`) ? t(`opening.reasons.${r.data.reason}`) : reasonText(r.data.reason));
      router.refresh();
      return;
    }
    say("ok", t("opening.done", { n: r.data.lines }));
    router.refresh();
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

  if(configOpen)return <KalipFormEkran dark={dark} title={t("oauth.settings")} icon={{d:NICON.plug,color:"2F5DA8"}}
    testId="oauth-settings" values={appForm} initial={{clientId:"",clientSecret:"",callbackUrl:""}}
    rules={[{name:"clientId",label:t("oauth.id"),required:true,maxLength:200},{name:"clientSecret",label:t("oauth.secret"),required:true,maxLength:200},{name:"callbackUrl",label:t("oauth.callback"),required:true,maxLength:300}]}
    onSave={async()=>{const r=await saveParasutOAuthSettingsAction({slug,...appForm});if(!r.ok)return formFailure(r);return r.data.ok?{ok:true}:{ok:false,mesaj:t("oauth.failed")};}}
    onDone={()=>{setAppForm({clientId:"",clientSecret:"",callbackUrl:""});setConfigOpen(false);router.refresh();}}
    onBack={()=>{setAppForm({clientId:"",clientSecret:"",callbackUrl:""});setConfigOpen(false);}} savedText={t("oauth.saved")} homeHref={base}
    footer={reauthAction??(appForm.clientId!==""||appForm.clientSecret!==""||appForm.callbackUrl!==""?null:<button type="button" className="btn n" data-testid="oauth-legacy" onClick={()=>{setAppForm({clientId:"",clientSecret:"",callbackUrl:""});setConfigOpen(false);setFormOpen(true);}}>{t("oauth.legacy")}</button>)}>
    <KalipGrup title={t("oauth.settings")} d={NICON.plug} color="2F5DA8">
      <KalipAlan label={t("oauth.id")} name="clientId" value={appForm.clientId} autoComplete="off" maxLength={200} onChange={e=>setAppForm({...appForm,clientId:e.target.value})} data-testid="oauth-app-id" />
      <KalipAlan label={t("oauth.secret")} hint={t("oauth.secretHint")} name="clientSecret" type="password" autoComplete="new-password" maxLength={200} value={appForm.clientSecret} onChange={e=>setAppForm({...appForm,clientSecret:e.target.value})} data-testid="oauth-app-secret" />
      <KalipAlan label={t("oauth.callback")} name="callbackUrl" value={appForm.callbackUrl} autoComplete="off" maxLength={300} onChange={e=>setAppForm({...appForm,callbackUrl:e.target.value})} data-testid="oauth-callback" />
      <button type="button" className="btn n" data-testid="oauth-copy" onClick={()=>{if(oauth.callbackUrl===null)return;void navigator.clipboard.writeText(appForm.callbackUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>say("warn",t("oauth.originMissing")));}}><Ico d={LICON.clip} size={20}/>{copied?t("oauth.copied"):t("oauth.copy")}</button>
    </KalipGrup>
  </KalipFormEkran>;
  if(codeFlow!==null)return <KalipFormEkran dark={dark} title={t("oauth.enterCode")} icon={{d:LICON.key,color:"2F5DA8"}} testId="oauth-code-form"
    values={{code:authCode}} initial={{code:""}} rules={[{name:"code",label:t("oauth.code"),required:true,maxLength:4096}]} saveShort={t("mainConnect")}
    onSave={async()=>{const r=await completeParasutOAuthCodeAction({slug,code:authCode.trim()});setAuthCode("");if(!r.ok)return formFailure(r);if(!r.data.ok)return {ok:false,mesaj:t("oauth.failed")};if(r.data.status==="SELECT"){router.replace(`${base}/integrations?oauth_select=${encodeURIComponent(r.data.id)}`);}return {ok:true};}}
    onDone={()=>{setCodeFlow(null);router.refresh();}} onBack={()=>{setAuthCode("");setCodeFlow(null);}} homeHref={base} savedText={t("oauth.codeAccepted")} footer={reauthAction}>
    <KalipGrup title={t("oauth.enterCode")} d={LICON.key} color="2F5DA8">
      <a className="btn n" href={codeFlow} target="_blank" rel="noopener noreferrer" data-testid="oauth-provider-open"><Ico d={NICON.plug} size={20}/>{t("oauth.openProvider")}</a>
      <KalipAlan label={t("oauth.code")} name="code" value={authCode} type="password" autoComplete="off" maxLength={4096} onChange={e=>setAuthCode(e.target.value)} data-testid="oauth-code" />
    </KalipGrup>
  </KalipFormEkran>;
  if(selectOpen&&oauthSelection!==null)return <KalipFormEkran dark={dark} title={t("oauth.choose")} icon={{d:NICON.plug,color:"2F5DA8"}} testId="oauth-companies"
    values={{companyId:company}} initial={{companyId:""}} rules={[{name:"companyId",label:t("oauth.choose"),required:true}]}
    saveShort={t("mainConnect")} onSave={async()=>{const r=await selectParasutOAuthCompanyAction({slug,companyId:company});if(!r.ok)return formFailure(r);return r.data.ok?{ok:true}:{ok:false,mesaj:t("oauth.failed")};}}
    onDone={()=>{setSelectOpen(false);setCompany("");router.replace(`${base}/integrations`);router.refresh();}} onBack={()=>{setSelectOpen(false);setCompany("");router.replace(`${base}/integrations`);}} savedText={t("oauth.connected")} homeHref={base} footer={reauthAction}>
    <KalipSecim label={t("oauth.choose")} color="2F5DA8" value={company} options={oauthSelection.map(c=>({id:c.id,label:c.name,d:LICON.depo}))} onPick={setCompany} testId="oauth-company" />
  </KalipFormEkran>;
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
        <KalipGrup title={t("oauth.settings")} d={NICON.plug} color="2F5DA8">
          <button type="button" className="btn n" data-testid="oauth-settings-open" onClick={()=>{if(data.demo){say("warn",t("demo"));return;}setConfigOpen(true);}}><Ico d={LICON.key} size={20}/>{t(oauth.configured?"oauth.configured":"oauth.setup")}</button>
          {oauth.configured?<button type="button" className="btn n" onClick={openForm} aria-busy={busy==="oauth"} data-testid="oauth-connect"> <Ico d={NICON.plug} size={20}/>{t("oauth.connect")}</button>:null}
        </KalipGrup>
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
                <>
                <KalipGrup title={t("flowsTitle")} sub={t("flowsSub")} d={NICON.sync} color="2F5DA8" testId="integrations-flows">
                  <KalipAnahtar title={t("barcode.pull")} sub={t("barcode.keep")} d={NICON.pull} color="2F5DA8"
                    on={barcodeOn} aria={t("barcode.pull")} onToggle={() => void toggleBarcodes()} testId="product-barcode-toggle" />
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
                  {opening !== null ? (
                    <KalipGrup title={t("opening.title")} sub={t("opening.sub", { provider: pn.toLocaleUpperCase(intlDil(locale)) })} d={NICON.chart} color="B07D0B" testId="integrations-opening">
                      <div className={`flw${openingEnabled ? " on" : ""}`} data-testid="opening-row" data-enabled={openingEnabled ? "true" : "false"} data-taken={openingTaken === null ? "false" : "true"}>
                        <KalipAnahtar
                          title={t("opening.toggle", { provider: pn })}
                          sub={openingTaken !== null ? t("opening.takenAt", { at: when(openingTaken) }).toLocaleUpperCase(intlDil(locale)) : t("opening.toggleSub", { provider: pn.toLocaleUpperCase(intlDil(locale)) })}
                          d={NICON.pull}
                          color="B07D0B"
                          on={openingEnabled}
                          locked={openingTaken !== null}
                          lockedReason={openingTaken !== null ? t("opening.takenAt", { at: when(openingTaken) }) : undefined}
                          aria={openingEnabled ? t("opening.onAria", { provider: pn }) : t("opening.offAria", { provider: pn })}
                          onToggle={() => void toggleOpening()}
                          testId="opening-toggle"
                        />
                        {openingTaken !== null ? (
                          <div className="fmeta">
                            <span className="ok" data-testid="opening-taken">
                              {t("opening.takenAt", { at: when(openingTaken) })}
                            </span>
                          </div>
                        ) : openingEnabled ? (
                          <>
                            {opening.locations.length === 0 ? (
                              <div className="fmeta">
                                <span data-testid="opening-noshelf">{t("opening.noShelf")}</span>
                              </div>
                            ) : (
                              <div className="fdir">
                                <KalipSecim
                                  label={t("opening.shelf")}
                                  value={openingLoc}
                                  color="B07D0B"
                                  list
                                  onPick={(id) => {
                                    feedback.minor();
                                    setOpeningLoc(id);
                                  }}
                                  options={opening.locations.map((l) => ({ id: l.id, label: `${l.code} · ${l.name}`, sub: l.warehouse, keys: [l.code] }))}
                                  testId="opening-shelf"
                                />
                              </div>
                            )}
                            <div className="fmeta">
                              <span>{t("opening.once")}</span>
                              <button type="button" className="frun" onClick={() => void pullOpening()} aria-busy={busy === "pull"} data-tour="opening-pull" data-testid="opening-pull">
                                <Ico d={NICON.pull} size={16} />
                                {t("opening.pull")}
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </KalipGrup>
                  ) : null}
                </>
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
