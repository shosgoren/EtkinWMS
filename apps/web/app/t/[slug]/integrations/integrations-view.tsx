"use client";
// T-991 (I-18): Entegrasyon — Entegrasyon.dc.html (Kalıp · Form birebir + "YENİ" bölümü, kap `.dzen`). Yalnız kalıp ortak bileşenleri:
// KalipEkran (form), KalipGrup, KalipIzgara, KalipAnahtar (akış aç/kapa), KalipSecenek (yön), KalipPencere + alanlar (Bağlan), KalipOnay (Kes),
// balon + ses (`useKalipToast`, `tone`). Yerel select / confirm / alert yok; her dokunuşta görsel + sesli geri bildirim; ana düğme (BAĞLAN /
// EŞİTLE) hiçbir durumda sessiz değil (yapılacak bir şey yoksa nedenini söyler).
// Bilinçli farklar (DESIGN-PARITY): Bağlan penceresi ve Kes onayı kaynağın `.sx` / `.cfbox`'ının kalıp penceresi uyarlamasıdır (T-974
// KalipPencere / KalipOnay); sesle komut (B-62 Etkin) henüz yok, ipucu satırı kaynaktaki gibi.
// T-1112 (kullanıcı 28 Ekim, tuval StandartAyarlarEntegrasyon — STANDART §5 ayar kalıbı): üstte ayar sekmeleri (Entegrasyonlar), solda alt
// bölümler (`KalipAltBolumler`, adres `?bolum=`), sağda yalnız seçili bölüm (`KalipAyarKart`). Akışlar artık aç/kapa + yön yerine tek satırda
// her zaman görünen yön seçimi (`KalipYonSecimi`): <Sistem>'den al · <Sistem>'e gönder · İki yönlü (yalnız katalogun desteklediği yönler) ·
// Yalnız Etkin WMS (= akış kapalı). Tuvaldeki "Satış faturasından iş" satırı katalogda yok: çizilmez. Alan sahipliğinde veri yok: "Yakında".
// T-1133 (kullanıcı 30 Ekim): Etkin'in TEK ortak Paraşüt uygulaması sunucudadır; müşteri anahtar girmez. Bağlan = 3 adım: BAĞLAN → Paraşüt'te
// giriş yap ve izin ver → şirketini seç (tek şirket kendiliğinden). Kendi uygulamasını kullanmak isteyen için "Gelişmiş" açılır satırı
// (`KalipSatir`): 3 adımlı rehberli kart (1 gerçek dönüş adresi + Kopyala, 2 iki anahtar, 3 BAĞLAN). Eski yetki kodu (OOB) yolu yalnız kendi
// uygulamasında OOB adresini kaydeden müşteri için kalır; sağlayıcı hata kodu `reasons.*` ile gösterilir (genel "tamamlanamadı" değil).
// T-1137 (kullanıcı 30 Ekim): eski "e-posta + parola ile bağlan" penceresi ve girişi kalktı (sunucu eylemi UNSUPPORTED döner); eski yöntemle
// bağlı müşteriye sağlık bandında nazik "Yeni yönteme geç". Bağlantı sağlığı (sunucuda hesaplanır) tek bant: simge + renk + tek cümle + tek
// sonraki adım (`KalipBildirim` + `KalipDugme`). "Bekleyenler ve hatalar"da karar bekleyen kuyruk satırları satır başına çözüm düğmeleriyle;
// geri dönüşü olmayan kararlar (`KalipOnay`) onay ister. Excel, bağlı değilken kaynak listesinde Paraşüt'ün yanında bir veri kaynağı kartıdır.
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { NICON } from "../../../design/entegrasyon-icons.ts";
import { SICON } from "../../../design/standart-icons.ts";
import { KalipAltBolumler, KalipAyarKart, KalipAyarSatir, KalipYonSecimi, type KalipAltBolum, type KalipYon } from "../kalip/ayar.tsx";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAlan, KalipAnahtar, KalipBaglanti, KalipGrup, KalipPerde, KalipSatir } from "../kalip/form.tsx";
import { KalipFormEkran } from "../kalip/form-ekran.tsx";
import type { StTon } from "../kalip/kart.tsx";
import { KalipBos } from "../kalip/liste.tsx";
import { KalipSecim, KalipSekme } from "../kalip/secim.tsx";
import { ayarSekmeleri } from "../settings/sekmeler.ts";
import { entegrasyonSorunSayisi, sonEsitleme, type EntegrasyonBolumu } from "./bolum.ts";
import { donusAdresi } from "./oauth-adres.ts";
import { yonDegisimi, yonOnayAnahtari, yonOnayGerekir, yonSonucAnahtari, type KartAkisi, type YonDegisimi } from "./yon-sonuc.ts";
import { KalipOnay } from "../kalip/pencere.tsx";
import { KalipBildirim, KalipDugme } from "../kalip/belge.tsx";
import { kdz } from "../kalip/tokens.ts";
import { countFlowRecordsAction, checkIntegrationAction, disconnectIntegrationAction, retryIntegrationOutboxAction, resolveIntegrationOutboxAction, pullOpeningStockAction, runIntegrationAction, setIntegrationFlowAction, setOpeningStockAction, setProductBarcodeAction, beginParasutOAuthAction, selectParasutOAuthCompanyAction, saveParasutOAuthSettingsAction, completeParasutOAuthCodeAction } from "./actions.ts";
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
  readonly outbox: { readonly pending: number; readonly check: number; readonly failed: number; readonly parked: number };
  /** T-1137: bağlantı sağlığı (sunucuda, DB saatiyle); bağlı değilse null. */
  readonly health: HealthData | null;
  readonly providers: readonly {
    readonly provider: Provider;
    readonly available: boolean;
    readonly connection: { readonly status: "CONNECTED" | "ERROR" | "DISCONNECTED"; readonly label: string | null; readonly lastCheckedAt: string | null; readonly lastErrorCode: string | null } | null;
    readonly flows: readonly FlowData[];
  }[];
  readonly runs: readonly { readonly id: string; readonly flow: Flow; readonly trigger: "SCHEDULE" | "MANUAL"; readonly status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED"; readonly startedAt: string; readonly created: number; readonly updated: number; readonly linked: number; readonly skipped: number; readonly failed: number; readonly errorCode: string | null }[];
}

export interface HealthData {
  readonly level: "ok" | "warn" | "error";
  readonly cause: "AUTH" | "STUCK" | "TIMEOUT" | "FAILING" | "STALE" | null;
  readonly next: "RECONNECT" | "RUN" | "DETAIL" | null;
  readonly flow: Flow | null;
  readonly since: string | null;
  readonly code: string | null;
  readonly legacy: boolean;
}
/** T-1137: kuyrukta karar bekleyen satır (kod/ad yalnız gösterim için). */
export interface IssueData {
  readonly id: string;
  readonly flow: "SHIPMENTS" | "PRODUCTS" | "CONTACTS" | "WAREHOUSES";
  readonly entityType: "DOCUMENT" | "ITEM" | "PARTY" | "WAREHOUSE";
  readonly code: string | null;
  readonly name: string | null;
  readonly status: "CHECK" | "FAILED";
  readonly errorCode: string | null;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly resolvable: boolean;
}
export interface IssuesData { readonly total: number; readonly items: readonly IssueData[] }
type IssueAsk = { readonly kind: "retry" | "SENT" | "SKIP"; readonly issue: IssueData };

/** T-1006: açılış stoku ayarı (varsayılan kapalı) + alındı zamanı + yazılabilecek raflar. */
export interface OpeningData {
  readonly enabled: boolean;
  readonly takenAt: string | null;
  readonly locations: readonly { readonly id: string; readonly code: string; readonly name: string; readonly warehouse: string }[];
}

/** T-1112: akış simgesi ve tonu — tuval StandartAyarlarEntegrasyon satırları (Sipariş tuvalde yok: belge simgesi, gri). */
const FLOW_UI: Readonly<Record<Flow, { readonly d: string; readonly ton: StTon }>> = {
  PRODUCTS: { d: SICON.kutu, ton: "mavi" },
  CONTACTS: { d: SICON.kisi, ton: "yesil" },
  WAREHOUSES: { d: SICON.depo, ton: "lacivert" },
  SALES_ORDERS: { d: SICON.belge, ton: "gri" },
  SHIPMENTS: { d: SICON.kamyon, ton: "turuncu" },
  STOCK: { d: SICON.grafik, ton: "kahve" },
};
/** Yön seçimi: tuvalde seçili "al" Paraşüt turuncusu, "gönder" mavi; iki yönlü STANDART §7 transfer moru. */
const YON_D: Readonly<Record<Direction, string>> = { PULL: SICON.al, PUSH: SICON.gonder, BOTH: SICON.cevrim };
const YON_TON: Readonly<Record<Direction, StTon>> = { PULL: "parasut", PUSH: "mavi", BOTH: "mor" };
const PROVIDER_COLOR: Readonly<Record<Provider, string>> = { PARASUT: "2F5DA8", LOGO: "30475A" };
const PROVIDER_NAME: Readonly<Record<Provider, string>> = { PARASUT: "Paraşüt", LOGO: "Logo" };
const c = (hex: string): string => kdz("dzf", hex);

const EMPTY_APP = { clientId: "", clientSecret: "" };

/** T-1133: ekrana yalnız bayraklar ve dönüş adresi gelir; uygulama kimliği/sırrı hiçbir zaman istemciye inmez. */
export interface OAuthData { readonly configured: boolean; readonly ownApp: boolean; readonly shared: boolean; readonly oob: boolean; readonly callbackUrl: string | null }

export function IntegrationsView({ slug, dark, data, bolum, opening = null, journeyWish = null, pullBarcodes = false, oauth, oauthSelection, oauthResult, oauthReason = null, webhook = null, issues = { total: 0, items: [] } }: { issues?: IssuesData; oauth:OAuthData; oauthSelection:readonly {id:string;name:string}[]|null; oauthResult:string|null; oauthReason?: string | null; slug: string; dark: boolean; data: OverviewData; bolum: EntegrasyonBolumu; opening?: OpeningData | null; journeyWish?: boolean | null; pullBarcodes?: boolean; webhook?: { readonly status: "OFF" | "ACTIVE" | "FAILED"; readonly lastEventAt: string | null } | null }) {
  const t = useTranslations("integrations");
  const tb = useTranslations("baglantilar"); // T-1112: ortak ayar sekmelerinin adları
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const ts = useTranslations("serverErrors");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const { say, node: toast } = useKalipToast("form");
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen,setConfigOpen]=useState(false);
  const [appForm,setAppForm]=useState(EMPTY_APP);
  const [appOob,setAppOob]=useState(oauth.oob);
  useEffect(()=>setAppOob(oauth.oob),[oauth.oob]);
  const [advOpen,setAdvOpen]=useState(false);
  const [codeFlow,setCodeFlow]=useState<string|null>(null);
  const [authCode,setAuthCode]=useState("");
  const [company,setCompany]=useState("");
  const [copied,setCopied]=useState(false);
  const [selectOpen,setSelectOpen]=useState(oauthSelection!==null);
  useEffect(()=>setSelectOpen(oauthSelection!==null),[oauthSelection]);
  // T-1133: callback'ten dönen sabit neden kodu varsa ekran onu söyler (ör. izin verilmedi, Paraşüt çok istek dedi); yoksa genel ileti.
  useEffect(()=>{if(oauthResult!==null){const reason=oauthResult!=="failed"||oauthReason===null?t(`oauth.${oauthResult}`):oauthReason==="DENIED"?t("oauth.denied"):t.has(`reasons.${oauthReason}`)?t(`reasons.${oauthReason}`):t("oauth.failed");say(oauthResult==="connected"?"ok":"warn",reason);router.replace(`${base}/integrations`);}},[oauthResult,oauthReason,router,base,say,t]);
  // T-1137: yolculuk adım 1'deki "Mevcut stoku da alalım mı?" cevabı bağlanınca ayara işlenir (eski parola penceresinden OAuth dönüşüne taşındı).
  useEffect(()=>{if(oauthResult==="connected"&&journeyWish===true)void setOpeningStockAction({slug,provider:"PARASUT",enabled:true,via:"journey"});},[oauthResult,journeyWish,slug]);
  const [cutOpen, setCutOpen] = useState(false);
  const [ask, setAsk] = useState<IssueAsk | null>(null);
  // T-1136: yön değişiminin onay penceresi (yerel kayıt varken yeni "al" ya da yeni "gönder"); metinler açılırken hesaplanır.
  const [onay, setOnay] = useState<{ readonly flow: Flow; readonly dir: Direction; readonly title: string; readonly text: string; readonly evet: string } | null>(null);
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
    // T-1112: önceki durum ekranda görünen (iyimser) durumdur; sunucu verisi henüz yenilenmemiş olabilir (art arda iki seçim).
    const prev = flowState(f);
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
    if (direction !== prev.direction && enabled && prev.enabled) say("ok", t("dirSet", { name, dir: t(`yon.${direction}`, { provider: pn }) }));
    else if (enabled) say("ok", r.data.queued ? t("flowOn", { name }) : t("flowOnNoQueue", { name }));
    else say("info", t("flowOff", { name }));
    router.refresh();
  };

  /** T-1112: yön seçimi — "OFF" (Yalnız Etkin WMS) akışı kapatır, bir yön akışı o yönde açar; aynı seçenek yeniden seçilirse işlem yok. */
  const pickYon = (f: FlowData, id: string): void => {
    if (busy !== null) return;
    const s = flowState(f);
    if (id === "OFF") {
      if (!s.enabled) {
        feedback.minor();
        return;
      }
      void setFlow(f, false, s.direction);
      return;
    }
    const dir = f.directions.find((d) => d === id);
    if (dir === undefined) {
      say("warn", t("flowNa", { provider: pn }));
      return;
    }
    if (s.enabled && s.direction === dir) {
      feedback.minor();
      return;
    }
    const degisim = yonDegisimi(f.flow, s, dir);
    if (degisim === null) {
      void setFlow(f, true, dir);
      return;
    }
    void sorVeKaydet(f, dir, degisim);
  };

  /** T-1136: yerel kayıtları sunucuda sayar; dolu katalogda önce onay penceresi, boşsa doğrudan kaydeder. */
  const sorVeKaydet = async (f: FlowData, dir: Direction, degisim: YonDegisimi): Promise<void> => {
    setBusy(`flow-${f.flow}`);
    const r = await countFlowRecordsAction({ slug, provider: "PARASUT", flow: f.flow });
    setBusy(null);
    if (!r.ok) return failed(r);
    if (!yonOnayGerekir(degisim, r.data)) {
      void setFlow(f, true, dir);
      return;
    }
    const name = t(`flows.${f.flow}.name`);
    feedback.warn();
    setOnay({
      flow: f.flow,
      dir,
      title: t("onayBaslik", { name, dir: t(`yon.${dir}`, { provider: pn }) }),
      text: t(yonOnayAnahtari(f.flow as KartAkisi, dir), { n: r.data.total, m: r.data.unlinked, provider: pn }),
      evet: t(`onayEvet.${dir}`, { provider: pn }),
    });
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
    // T-1133: ortak ya da kendi uygulaması yoksa bağlanılamaz: Gelişmiş satırı açılır, neden söylenir (anahtar alanı gösterilmez).
    if(!oauth.configured){feedback.error();setAdvOpen(true);say("warn",t("oauth.notReady"));return;}
    if(busy!==null)return;
    setBusy("oauth");
    void beginParasutOAuthAction({slug}).then(r=>{
      if(!r.ok){setBusy(null);failed(r);return;}
      if(!r.data.ok){setBusy(null);say("err",reasonText(r.data.reason));return;}
      if(r.data.manual){setBusy(null);setCodeFlow(r.data.authorizationUrl);return;}
      window.location.assign(r.data.authorizationUrl);
    }).catch(()=>{setBusy(null);say("err",t("oauth.failed"));});
  };
  /** T-1133: dönüş adresini kopyala (küçük işlem: sessiz, düğme içinde 2 sn "Kopyalandı"). */
  const copyCallback=(value:string|null=oauth.callbackUrl):void=>{
    if(value===null){say("warn",t("oauth.originMissing"));return;}
    feedback.minor();
    void navigator.clipboard.writeText(value).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>say("warn",t("oauth.copyFailed")));
  };
  const resetApp=():void=>{setAppForm(EMPTY_APP);setAppOob(oauth.oob);};

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

  // T-1133 Gelişmiş: kendi Paraşüt uygulaman — 3 adımlı rehberli kart. 1: gerçek dönüş adresi salt okunur + Kopyala; 2: iki anahtar (sade Türkçe);
  // 3: KAYDET'ten sonra bölümdeki BAĞLAN. Doğrulama ortak `KalipFormEkran` (eksik alan kırmızı + "N alan eksik"). Eski yetki kodu yöntemi (OOB)
  // yalnız anahtarla açılır. T-1137: e-posta + parola ile bağlanma (eski "Eski bağlantı yöntemi" düğmesi) kalktı.
  const stepIcon=(n:number,done:boolean,color:string)=><i style={{background:c(done?"2F9E6B":color)}} aria-hidden="true">{done?<Ico d={LICON.check} size={18}/>:<b style={{font:"inherit",color:"inherit"}}>{n}</b>}</i>;
  // Gösterilen ve kopyalanan adres aynı kaynaktan (seçili yönteme göre: OOB → URN, değilse sunucu callback'i).
  const callbackValue=donusAdresi(appOob,oauth.callbackUrl);
  const callbackShown=callbackValue??t("oauth.originMissing");
  if(configOpen)return <KalipFormEkran dark={dark} title={t("oauth.ownApp")} subtitle={t("oauth.ownAppSub")} icon={{d:LICON.key,color:"2F5DA8"}}
    testId="oauth-settings" values={{...appForm,oob:appOob}} initial={{...EMPTY_APP,oob:oauth.oob}}
    rules={[{name:"clientId",label:t("oauth.id"),required:true,maxLength:200},{name:"clientSecret",label:t("oauth.secret"),required:true,maxLength:200}]}
    onSave={async()=>{const r=await saveParasutOAuthSettingsAction({slug,clientId:appForm.clientId.trim(),clientSecret:appForm.clientSecret.trim(),...(appOob?{oob:true}:{})});if(!r.ok)return formFailure(r);return r.data.ok?{ok:true}:{ok:false,mesaj:reasonText(r.data.reason)};}}
    onDone={()=>{resetApp();setConfigOpen(false);router.refresh();}}
    onBack={()=>{resetApp();setConfigOpen(false);}} savedText={t("oauth.saved")} homeHref={base}
    footer={reauthAction}>
    <KalipGrup title={t("oauth.step1")} sub={appOob?t("oauth.step1Oob"):t("oauth.step1Hint")} d={LICON.globe} color="2F5DA8" testId="oauth-step1">
      <KalipAlan label={t("oauth.callback")} name="callbackUrl" value={callbackShown} readOnly autoComplete="off" onFocus={e=>e.currentTarget.select()} data-testid="oauth-callback" />
      <button type="button" className="btn n" data-testid="oauth-copy" onClick={()=>copyCallback(callbackValue)}><Ico d={copied?LICON.check:LICON.clip} size={20}/>{copied?t("oauth.copied"):t("oauth.copy")}</button>
    </KalipGrup>
    <KalipGrup title={t("oauth.step2")} sub={t("oauth.step2Hint")} d={LICON.key} color="B07D0B" testId="oauth-step2">
      <KalipAlan label={t("oauth.id")} name="clientId" value={appForm.clientId} autoComplete="off" maxLength={200} onChange={e=>setAppForm({...appForm,clientId:e.target.value})} data-testid="oauth-app-id" />
      <KalipAlan label={t("oauth.secret")} hint={t("oauth.secretHint")} name="clientSecret" type="password" autoComplete="new-password" maxLength={200} value={appForm.clientSecret} onChange={e=>setAppForm({...appForm,clientSecret:e.target.value})} data-testid="oauth-app-secret" />
      <KalipAnahtar title={t("oauth.oobToggle")} sub={t("oauth.oobToggleSub")} d={LICON.key} color="4E6476" on={appOob} changed={appOob!==oauth.oob} aria={t("oauth.oobToggle")} onToggle={()=>{feedback.minor();setAppOob(v=>!v);}} testId="oauth-oob-toggle" />
    </KalipGrup>
    <div className="cnote" data-testid="oauth-step3-note"><i><Ico d={NICON.plug} size={20}/></i><span>{t("oauth.step3Hint")}</span></div>
  </KalipFormEkran>;
  if(codeFlow!==null)return <KalipFormEkran dark={dark} title={t("oauth.enterCode")} icon={{d:LICON.key,color:"2F5DA8"}} testId="oauth-code-form"
    values={{code:authCode}} initial={{code:""}} rules={[{name:"code",label:t("oauth.code"),required:true,maxLength:4096}]} saveShort={t("mainConnect")}
    onSave={async()=>{const r=await completeParasutOAuthCodeAction({slug,code:authCode.trim()});setAuthCode("");if(!r.ok)return formFailure(r);if(!r.data.ok)return {ok:false,mesaj:reasonText(r.data.reason)};if(r.data.status==="SELECT"){router.replace(`${base}/integrations?oauth_select=${encodeURIComponent(r.data.id)}`);}return {ok:true};}}
    onDone={()=>{setCodeFlow(null);router.refresh();}} onBack={()=>{setAuthCode("");setCodeFlow(null);}} homeHref={base} savedText={t("oauth.codeAccepted")} footer={reauthAction}>
    <KalipGrup title={t("oauth.enterCode")} d={LICON.key} color="2F5DA8">
      <a className="btn n" href={codeFlow} target="_blank" rel="noopener noreferrer" data-testid="oauth-provider-open"><Ico d={NICON.plug} size={20}/>{t("oauth.openProvider")}</a>
      <KalipAlan label={t("oauth.code")} name="code" value={authCode} type="password" autoComplete="off" maxLength={4096} onChange={e=>setAuthCode(e.target.value)} data-testid="oauth-code" />
    </KalipGrup>
  </KalipFormEkran>;
  if(selectOpen&&oauthSelection!==null)return <KalipFormEkran dark={dark} title={t("oauth.choose")} icon={{d:NICON.plug,color:"2F5DA8"}} testId="oauth-companies"
    values={{companyId:company}} initial={{companyId:""}} rules={[{name:"companyId",label:t("oauth.choose"),required:true}]}
    saveShort={t("mainConnect")} onSave={async()=>{const r=await selectParasutOAuthCompanyAction({slug,companyId:company});if(!r.ok)return formFailure(r);return r.data.ok?{ok:true}:{ok:false,mesaj:reasonText(r.data.reason)};}}
    onDone={()=>{setSelectOpen(false);setCompany("");router.replace(`${base}/integrations`);router.refresh();}} onBack={()=>{setSelectOpen(false);setCompany("");router.replace(`${base}/integrations`);}} savedText={t("oauth.connected")} homeHref={base} footer={reauthAction}>
    <KalipSecim label={t("oauth.choose")} color="2F5DA8" value={company} options={oauthSelection.map(c=>({id:c.id,label:c.name,d:LICON.depo}))} onPick={setCompany} testId="oauth-company" />
  </KalipFormEkran>;
  const err = conn?.status === "ERROR";
  // T-1112 (tuval StandartAyarlarEntegrasyon): ayar sekmeleri + solda alt bölümler, sağda yalnız seçili bölüm. Rozet: kontrol bekleyen /
  // gönderilemeyen kayıt + hatalı akış sayısı (sunucu verisinden; `bolum.ts`).
  const self = `${base}/integrations`;
  const sorun = entegrasyonSorunSayisi({ outbox: data.outbox, flows });
  const son = sonEsitleme(flows, data.runs);
  // T-1137: sağlık sorunu varsa "Bağlantı ve veri kaynağı" da rozet alır (sorun bandı orada ve akış bölümünde).
  const hp = data.health;
  const saglikRozet = hp !== null && hp.level !== "ok" ? { badge: 1, badgeAria: t("bolum.badgeAria", { n: 1 }) } : {};
  const bolumler: KalipAltBolum[] = [
    { id: "baglanti", label: t("bolum.baglanti"), d: SICON.baglanti, ton: "parasut", href: `${self}?bolum=baglanti`, ...saglikRozet },
    { id: "akis", label: t("bolum.akis"), d: SICON.cevrim, ton: "mavi", href: `${self}?bolum=akis` },
    { id: "sahiplik", label: t("bolum.sahiplik"), d: SICON.kilit, ton: "mor", href: `${self}?bolum=sahiplik`, soon: t("pillSoon") },
    { id: "arsiv", label: t("bolum.arsiv"), d: SICON.arsiv, ton: "gri", href: `${self}?bolum=arsiv` },
    { id: "hatalar", label: t("bolum.hatalar"), d: SICON.uyari, ton: "turuncu", href: `${self}?bolum=hatalar`, badge: sorun, badgeAria: t("bolum.badgeAria", { n: sorun }) },
  ];
  const up = (x: string): string => x.toLocaleUpperCase(intlDil(locale));
  const hataliAkislar = flows.filter((f) => f.errorCount > 0);

  // T-1137: bağlantı sağlığı bandı — simge + renk (trafik ışığı) + tek cümle + tek sonraki adım. Neden sunucudan (sabit kod), metin burada.
  const goDetail = (): void => {
    feedback.minor();
    router.push(`${self}?bolum=hatalar`);
  };
  // `inConn`: bağlantı bölümünde bağlantı satırı koptu durumunu zaten kırmızı + "Yeniden bağlan" ile söyler (T-991) — aynı şey iki kez çizilmez.
  const saglikBandi = (testId: string, inConn: boolean): ReactNode => {
    if (hp === null) return null;
    const out: ReactNode[] = [];
    if (hp.level !== "ok" && hp.cause !== null && !(inConn && hp.cause === "AUTH")) {
      const name = hp.flow === null ? pn : t(`flows.${hp.flow}.name`);
      const sub = hp.cause === "AUTH" || hp.cause === "FAILING" ? reasonText(hp.code) : t(`health.${hp.cause}.sub`, { at: hp.since === null ? "" : when(hp.since) });
      const next =
        hp.next === "RECONNECT" ? (
          <KalipDugme tur="ana" d={NICON.plug} onClick={openForm} busy={busy === "oauth"} data-testid={`${testId}-next`} data-next="RECONNECT">{t("health.next.RECONNECT")}</KalipDugme>
        ) : hp.next === "RUN" ? (
          <KalipDugme tur="ana" d={NICON.sync} onClick={() => void runFlow(hp.flow ?? undefined)} busy={busy !== null && busy.startsWith("run")} data-testid={`${testId}-next`} data-next="RUN">{t("health.next.RUN")}</KalipDugme>
        ) : (
          <KalipDugme d={LICON.info} onClick={goDetail} data-testid={`${testId}-next`} data-next="DETAIL">{t("health.next.DETAIL")}</KalipDugme>
        );
      out.push(
        <div key="h" data-testid={testId} data-level={hp.level} data-cause={hp.cause}>
          <KalipBildirim tur={hp.level === "error" ? "hata" : "uyari"} title={t(`health.${hp.cause}.title`, { name, provider: pn })} sub={sub}>
            <span>{next}</span>
          </KalipBildirim>
        </div>,
      );
    } else if (inConn && hp.level === "ok") {
      out.push(
        <div key="h" data-testid={testId} data-level="ok">
          <KalipBildirim tur="tamam" title={t("health.ok")} />
        </div>,
      );
    }
    if (hp.legacy && hp.cause !== "AUTH") {
      out.push(
        <div key="l" data-testid={`${testId}-legacy`}>
          <KalipBildirim tur="bilgi" title={t("health.legacy.title")} sub={t("health.legacy.sub")}>
            <span><KalipDugme d={NICON.plug} onClick={openForm} busy={busy === "oauth"} data-testid={`${testId}-legacy-next`}>{t("health.legacy.next")}</KalipDugme></span>
          </KalipBildirim>
        </div>,
      );
    }
    return out.length === 0 ? null : <>{out}</>;
  };

  // T-1137: kuyrukta karar bekleyen satır — yeniden dene / gönderildi say / gönderme. Çift irsaliye riski olan (CHECK) yeniden gönderim ve
  // elle çözüm kararları onay ister (geri dönüşü yok); kesin reddedilmiş irsaliye ve kart bekletmesi onaysız yeniden denenir.
  const issueTitle = (it: IssueData): string =>
    it.flow === "SHIPMENTS" ? t("issues.doc", { code: it.code ?? "—" }) : `${t(`flows.${it.flow}.name`)} · ${[it.code, it.name].filter((x) => x !== null).join(" ") || "—"}`;
  const doIssue = async (kind: IssueAsk["kind"], it: IssueData): Promise<void> => {
    if (busy !== null) return;
    setBusy(`issue-${it.id}`);
    const r = kind === "retry" ? await retryIntegrationOutboxAction({ slug, id: it.id }) : await resolveIntegrationOutboxAction({ slug, id: it.id, resolution: kind });
    setBusy(null);
    setAsk(null);
    if (!r.ok) return failed(r);
    if (!r.data.ok) {
      say("warn", t(`issues.reasons.${r.data.reason}`));
      router.refresh();
      return;
    }
    say("ok", kind === "retry" ? (r.data.queued ? t("issues.retried") : t("issues.retriedLater")) : kind === "SENT" ? t("issues.markedSent") : t("issues.markedSkip"));
    router.refresh();
  };
  const pickIssue = (kind: IssueAsk["kind"], it: IssueData): void => {
    if (busy !== null) return;
    if (kind === "retry" && !(it.flow === "SHIPMENTS" && it.status === "CHECK")) {
      void doIssue(kind, it);
      return;
    }
    feedback.minor();
    setAsk({ kind, issue: it });
  };
  const askKey = ask === null ? "askResend" : ask.kind === "retry" ? "askResend" : ask.kind === "SENT" ? "askSent" : "askSkip";
  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={t("title")}
      icon={{ d: NICON.plug, color: "2F5DA8" }}
      testId="integrations"
      bar={{
        // T-1112: Entegrasyon, Ayarlar › Entegrasyonlar sekmesinin kendisidir; Geri Ayarlar'a döner (T-1104'te Bağlantılar'a dönüyordu).
        back: { href: `${base}/settings`, testId: "kabuk-back" },
        main,
      }}
      overlays={<>{toast}<KalipPerde open={advOpen} onClose={()=>setAdvOpen(false)} /></>}
    >
      <div className={`dzen${dark ? " dz-dark" : ""}`} style={{ display: "contents" }}>
        <KalipSekme label={tb("tabs")} color="0E7C7B" current="entegrasyon" items={ayarSekmeleri(base, tb)} />
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
        <KalipAltBolumler label={t("bolum.label")} items={bolumler} current={bolum} testId="integrations-bolumler">
          {bolum === "baglanti" ? (
            <KalipAyarKart title={t("baglanti.title")} sub={connected ? (err ? t("connErrTitle", { provider: pn }) : t("connTitle", { label: conn.label ?? pn })) : t("baglanti.sub")} d={SICON.baglanti} ton="parasut" testId="integrations-baglanti">
              {/* T-1134: bağlıyken ipucu yok (eski "AÇ / KAPAT · YÖNÜ SEÇ" akışlar bölümüne aitti ve telefonda kesiliyordu). T-1133: OAuth
                  ayarlıysa bağlanma ipucu OAuth'a göre. */}
              <KalipBaslik title={t("head")} hint={connected ? undefined : oauth.configured ? t("oauth.hintNone") : t("hintNone")} />
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
                  {/* T-1137: Excel birinci sınıf veri kaynağı — mevcut Excel aktarım akışını açar (aktarma mantığı orada; burada tekrar yok). */}
                  <button
                    type="button"
                    role="listitem"
                    className="prov"
                    aria-label={`${t("excelSource.name")}: ${t("excelSource.pill")}`}
                    data-testid="provider-EXCEL"
                    onClick={() => {
                      feedback.minor();
                      router.push(`${base}/settings/baglantilar`);
                    }}
                  >
                    <span className="plogo" style={{ background: c("2F7D5B") }}>
                      <Ico d={LICON.excel} size={28} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <b>{t("excelSource.name")}</b>
                      <small>{t("excelSource.sub")}</small>
                    </span>
                    <span className="pill go">{t("excelSource.pill")}</span>
                  </button>
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
                          ? `${up(reasonText(conn.lastErrorCode))} · ${t("connErrSub")}`
                          : conn.lastCheckedAt === null
                            ? t("connSubNever", { provider: up(pn) })
                            : t("connSub", { provider: up(pn), at: when(conn.lastCheckedAt) })}
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
                  {/* T-1138: anlık bildirim (Paraşüt webhook) durumu — tek satır. */}
                  {webhook !== null && !err ? (
                    <div className="fmeta" role="status" data-testid="integrations-webhook" data-status={webhook.status}>
                      <span className={webhook.status === "ACTIVE" ? "ok" : "ebad"}>
                        <Ico d={webhook.status === "ACTIVE" ? LICON.check : LICON.warn} size={14} />
                        {webhook.status === "ACTIVE"
                          ? webhook.lastEventAt === null ? t("webhook.onNever") : t("webhook.on", { at: when(webhook.lastEventAt) })
                          : webhook.status === "FAILED" ? t("webhook.failed") : t("webhook.pending")}
                      </span>
                    </div>
                  ) : null}
                  {saglikBandi("integrations-health", true)}
                  <KalipAnahtar title={t("barcode.pull")} sub={t("barcode.keep")} d={NICON.pull} color="2F5DA8"
                    on={barcodeOn} aria={t("barcode.pull")} onToggle={() => void toggleBarcodes()} testId="product-barcode-toggle" />
                  {opening !== null ? (
                    <div data-testid="integrations-opening">
                      <div className={`flw${openingEnabled ? " on" : ""}`} data-testid="opening-row" data-enabled={openingEnabled ? "true" : "false"} data-taken={openingTaken === null ? "false" : "true"}>
                        <KalipAnahtar
                          title={t("opening.toggle", { provider: pn })}
                          sub={openingTaken !== null ? up(t("opening.takenAt", { at: when(openingTaken) })) : t("opening.toggleSub", { provider: up(pn) })}
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
                    </div>
                  ) : null}
                </>
              )}
              {/* T-1112: Excel aktarımı (Ayarlar › Entegrasyonlar sekmesinin eski hedefi) bu bölümden açılır. */}
              {/* T-1137: bağlı değilken Excel kaynak listesinde (Paraşüt'ün yanında) kart; bağlıyken ek veri kaynağı satırı. */}
              {connected ? <KalipBaglanti title={t("baglanti.excel")} value={t("baglanti.excelOpen")} d={LICON.excel} color="2F7D5B" href={`${base}/settings/baglantilar`} testId="integrations-excel" /> : null}
              {/* T-1104 (kullanıcı 27 Ekim: "derle topla, pratik olsun"): uygulama bilgileri sık kullanılmaz — bölümün en altında. Bağlı değilken
                  ayrı "Paraşüt ile bağlan" yok (ana BAĞLAN aynı işi yapar); bağlıyken OAuth ile yeniden bağlanma burada kalır. */}
              {/* T-1133 (kullanıcı 30 Ekim): müşteri anahtar girmez — Etkin'in ortak uygulaması. Kendi uygulamasını kullanmak isteyen için "Gelişmiş"
                  açılır satırı: 3 adımlı rehberli kart. Bölümün en altında (sık kullanılmaz, T-1104). */}
              <div className="stak-g" data-testid="integrations-advanced">
                <KalipBaslik title={t("oauth.settings")} hint={oauth.shared&&!oauth.ownApp?t("oauth.sharedHint"):undefined} />
                <KalipSatir id="own-app" title={t("oauth.ownApp")} value={oauth.ownApp?t("oauth.ownAppOn"):oauth.shared?t("oauth.sharedOn"):t("oauth.noneOn")} d={LICON.key} color="2F5DA8" open={advOpen} onToggle={()=>{feedback.minor();setAdvOpen(v=>!v);}} onClose={()=>setAdvOpen(false)} editorTitle={t("oauth.ownApp")} testId="oauth-advanced">
                  <div className="runs" role="list" aria-label={t("oauth.ownApp")} data-testid="oauth-steps">
                    <div className="rl" role="listitem" data-testid="oauth-step-1">
                      {stepIcon(1,oauth.ownApp,"2F5DA8")}
                      <span style={{ minWidth: 0 }}>
                        <b>{t("oauth.step1")}</b>
                        <small data-testid="oauth-callback-url">{oauth.callbackUrl??t("oauth.originMissing")}</small>
                      </span>
                      <button type="button" className="frun" data-testid="oauth-copy-inline" onClick={()=>copyCallback()}><Ico d={copied?LICON.check:LICON.clip} size={16}/>{copied?t("oauth.copied"):t("oauth.copy")}</button>
                    </div>
                    <div className="cnote"><i><Ico d={LICON.info} size={20}/></i><span>{t("oauth.step1Hint")}</span></div>
                    <div className="rl" role="listitem" data-testid="oauth-step-2">
                      {stepIcon(2,oauth.ownApp,"B07D0B")}
                      <span style={{ minWidth: 0 }}>
                        <b>{t("oauth.step2")}</b>
                        <small>{oauth.ownApp?t("oauth.step2Done"):t("oauth.step2Todo")}</small>
                      </span>
                      <button type="button" className="frun" data-testid="oauth-settings-open" onClick={()=>{if(data.demo){feedback.error();say("warn",t("demo"));return;}feedback.minor();setAdvOpen(false);setConfigOpen(true);}}><Ico d={LICON.key} size={16}/>{t(oauth.ownApp?"oauth.change":"oauth.setup")}</button>
                    </div>
                    <div className="rl" role="listitem" data-testid="oauth-step-3">
                      {stepIcon(3,connected&&oauth.ownApp,"2F9E6B")}
                      <span style={{ minWidth: 0 }}>
                        <b>{t("oauth.step3")}</b>
                        <small>{t("oauth.step3Hint")}</small>
                      </span>
                      <button type="button" className="frun" data-testid="oauth-connect" aria-busy={busy==="oauth"} aria-disabled={!oauth.ownApp} onClick={()=>{if(!oauth.ownApp){feedback.error();say("warn",t("oauth.stepsFirst"));return;}openForm();}}><Ico d={NICON.plug} size={16}/>{t("mainConnect")}</button>
                    </div>
                  </div>
                </KalipSatir>
              </div>
            </KalipAyarKart>
          ) : null}
          {bolum === "akis" ? (
            <KalipAyarKart
              title={t("akis.title")}
              sub={!connected ? t("akis.none", { provider: pn }) : son === null ? t("akis.subNever", { provider: pn }) : t("akis.sub", { provider: pn, at: when(son) })}
              d={SICON.cevrim}
              ton="mavi"
              testId="integrations-flows"
            >
              {!connected ? (
                <KalipBos title={t("akis.none", { provider: pn })} hint={t("akis.noneHint")} iconD={NICON.plug} action={{ label: t("akis.go"), href: `${self}?bolum=baglanti`, kind: "go" }} testId="integrations-flows-empty" />
              ) : (
                <>
                {saglikBandi("integrations-health-akis", false)}
                {flows.map((f) => {
                  const ui = FLOW_UI[f.flow];
                  const s = flowState(f);
                  const na = f.directions.length === 0;
                  const name = t(`flows.${f.flow}.name`);
                  const bad = f.lastStatus === "FAILED" || f.lastStatus === "PARTIAL";
                  const sonuc = na ? null : yonSonucAnahtari(f.flow, s.enabled ? s.direction : "OFF");
                  const options: KalipYon[] = [
                    ...f.directions.map((d): KalipYon => ({ id: d, label: t(`yon.${d}`, { provider: pn }), d: YON_D[d], ton: YON_TON[d] })),
                    { id: "OFF", label: t("yon.OFF"), etkin: true, ton: "gri" },
                  ];
                  return (
                    <KalipAyarSatir
                      key={f.flow}
                      title={name}
                      d={ui.d}
                      ton={ui.ton}
                      testId={`flow-${f.flow}`}
                      data={{ "data-enabled": s.enabled ? "true" : "false" }}
                      note={sonuc === null ? undefined : s.enabled ? { text: t(sonuc, { provider: pn }), ton: YON_TON[s.direction], d: YON_D[s.direction], testId: `flow-${f.flow}-sonuc` } : { text: t(sonuc, { provider: pn }), ton: "gri", etkin: true, testId: `flow-${f.flow}-sonuc` }}
                      sub={
                        na ? (
                          t("flowNa", { provider: pn })
                        ) : !s.enabled ? (
                          t(`flows.${f.flow}.sub`, { provider: up(pn) })
                        ) : (
                          <>
                            <span className={bad ? "" : "ok"}>
                              {f.lastRunAt === null ? t("never") : bad ? t("lastErr", { at: when(f.lastRunAt), reason: up(reasonText(f.lastErrorCode)) }) : t("lastOk", { at: when(f.lastRunAt) })}
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
                          </>
                        )
                      }
                    >
                      <KalipYonSecimi label={t("dirAria", { name })} options={options} value={s.enabled && !na ? s.direction : "OFF"} busy={busy === `flow-${f.flow}`} onPick={(id) => pickYon(f, id)} testId={`flow-${f.flow}-toggle`} />
                    </KalipAyarSatir>
                  );
                })}
                </>
              )}
            </KalipAyarKart>
          ) : null}
          {bolum === "sahiplik" ? (
            <KalipAyarKart title={t("sahiplik.title")} sub={t("sahiplik.sub")} d={SICON.kilit} ton="mor" testId="integrations-sahiplik">
              {/* Veri yok (B-200 "Paraşüt alan sahipliği" ayrı iş): sahte denetim çizilmez. T-1134: çıkmaz değil — tek cümle + yön seçimine
                  götüren düğme (ALTIN-KURAL 8); solda "YAKINDA" rozeti. */}
              <KalipBos title={t("sahiplik.text")} hint={t("sahiplik.soonHint")} iconD={SICON.kilit} action={{ label: t("sahiplik.go"), href: `${self}?bolum=akis`, kind: "go" }} testId="integrations-sahiplik-soon" />
            </KalipAyarKart>
          ) : null}
          {bolum === "arsiv" ? (
            <KalipAyarKart title={t("arsiv.title")} sub={t("arsiv.sub", { provider: pn })} d={SICON.arsiv} ton="gri" testId="integrations-arsiv">
              <div className="cnote">
                <i>
                  <Ico d={LICON.info} size={20} />
                </i>
                <span>{t("arsiv.text", { provider: pn })}</span>
              </div>
              <KalipBaglanti title={t("arsiv.archived")} value={t("baglanti.excelOpen")} d={SICON.arsiv} color="4E6476" href={`${base}/items?status=ARCHIVED`} testId="integrations-archived" />
              <KalipBaglanti title={t("arsiv.removed")} value={t("baglanti.excelOpen")} d={LICON.lock} color="4E6476" href={`${base}/items?status=REMOVED`} testId="integrations-removed" />
            </KalipAyarKart>
          ) : null}
          {bolum === "hatalar" ? (
            <KalipAyarKart title={t("hatalar.title")} sub={t("hatalar.sub")} d={SICON.uyari} ton="turuncu" testId="integrations-errors">
              {data.outbox.check > 0 || data.outbox.failed > 0 ? (
                <div className="conn err" role="alert" data-testid="integrations-outbox">
                  <i>
                    <Ico d={LICON.warn} size={22} />
                  </i>
                  <span style={{ minWidth: 0 }}>
                    <b>{data.outbox.check > 0 ? t("outboxCheck", { n: data.outbox.check }) : t("outboxFailed", { n: data.outbox.failed })}</b>
                    <small>{data.outbox.check > 0 ? t("outboxCheckSub") : up(reasonText("ROWS_FAILED"))}</small>
                  </span>
                </div>
              ) : null}
              {data.outbox.check > 0 && data.outbox.failed > 0 ? (
                <div className="conn err" role="status" data-testid="integrations-outbox-failed">
                  <i>
                    <Ico d={LICON.warn} size={22} />
                  </i>
                  <span style={{ minWidth: 0 }}>
                    <b>{t("outboxFailed", { n: data.outbox.failed })}</b>
                    <small>{up(reasonText("ROWS_FAILED"))}</small>
                  </span>
                </div>
              ) : null}
              {data.outbox.pending > 0 ? (
                <div className="conn" role="status" data-testid="integrations-outbox-pending">
                  <i>
                    <Ico d={LICON.clock} size={22} />
                  </i>
                  <span style={{ minWidth: 0 }}>
                    <b>{t("hatalar.pending", { n: data.outbox.pending })}</b>
                    <small>{t("hatalar.pendingSub")}</small>
                  </span>
                </div>
              ) : null}
              {issues.items.length > 0 ? <KalipBaslik title={t("issues.title", { n: issues.total })} hint={issues.total > issues.items.length ? t("issues.more", { n: issues.total - issues.items.length }) : t("issues.hint")} /> : null}
              {issues.items.map((it) => (
                <KalipAyarSatir
                  key={it.id}
                  title={issueTitle(it)}
                  d={FLOW_UI[it.flow].d}
                  ton={FLOW_UI[it.flow].ton}
                  testId="integration-issue"
                  data={{ "data-status": it.status, "data-flow": it.flow, "data-id": it.id }}
                  sub={
                    <>
                      <span className="ebad">
                        <Ico d={LICON.warn} size={12} />
                        {up(reasonText(it.errorCode ?? (it.status === "CHECK" ? "UNCERTAIN" : "UNKNOWN")))}
                      </span>
                      <span>{when(it.updatedAt)}</span>
                    </>
                  }
                >
                  <button type="button" className="frun" onClick={() => pickIssue("retry", it)} aria-busy={busy === `issue-${it.id}`} data-testid="issue-retry">
                    <Ico d={NICON.sync} size={16} />
                    {it.flow === "SHIPMENTS" ? t("issues.resend") : t("issues.retry")}
                  </button>
                  {it.resolvable ? (
                    <>
                      <button type="button" className="frun" onClick={() => pickIssue("SENT", it)} data-testid="issue-sent">
                        <Ico d={LICON.check} size={16} />
                        {t("issues.sent")}
                      </button>
                      <button type="button" className="frun" onClick={() => pickIssue("SKIP", it)} data-testid="issue-skip">
                        <Ico d={NICON.unlink} size={16} />
                        {t("issues.skip")}
                      </button>
                    </>
                  ) : null}
                </KalipAyarSatir>
              ))}
              {hataliAkislar.map((f) => (
                <KalipAyarSatir
                  key={f.flow}
                  title={t(`flows.${f.flow}.name`)}
                  d={FLOW_UI[f.flow].d}
                  ton={FLOW_UI[f.flow].ton}
                  testId={`hata-${f.flow}`}
                  sub={
                    <>
                      <span>{f.lastRunAt === null ? t("never") : t("lastErr", { at: when(f.lastRunAt), reason: up(reasonText(f.lastErrorCode)) })}</span>
                      <span className="ebad">
                        <Ico d={LICON.warn} size={12} />
                        {t("errBadge", { n: f.errorCount })}
                      </span>
                    </>
                  }
                />
              ))}
              {sorun === 0 && data.outbox.pending === 0 ? (
                <div className="conn" role="status" data-testid="integrations-errors-none">
                  <i>
                    <Ico d={LICON.check} size={22} />
                  </i>
                  <span style={{ minWidth: 0 }}>
                    <b>{t("hatalar.none")}</b>
                  </span>
                </div>
              ) : null}
              <KalipBaslik title={t("runsTitle")} hint={t("runsSub")} />
              <div className="runs" role="list" data-testid="integrations-runs">
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
                      ? up(reasonText(r.errorCode))
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
            </KalipAyarKart>
          ) : null}
        </KalipAltBolumler>
        <KalipOnay
          open={ask !== null}
          title={t(`issues.${askKey}.title`, { doc: ask === null ? "" : issueTitle(ask.issue) })}
          description={t(`issues.${askKey}.text`, { provider: pn })}
          confirmLabel={t(`issues.${askKey}.confirm`)}
          cancelLabel={t("issues.cancel")}
          variant={ask?.kind === "retry" ? "danger" : "primary"}
          loading={ask !== null && busy === `issue-${ask.issue.id}`}
          onConfirm={() => {
            if (ask !== null) void doIssue(ask.kind, ask.issue);
          }}
          onCancel={() => {
            feedback.minor();
            setAsk(null);
          }}
        />
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
        <KalipOnay
          open={onay !== null}
          variant="primary"
          title={onay?.title ?? ""}
          description={onay?.text ?? ""}
          confirmLabel={onay?.evet ?? ""}
          cancelLabel={t("onayVazgec")}
          onConfirm={() => {
            // Pencere açıkken ekran verisi yenilenmiş olabilir: akışın GÜNCEL satırı (önceki durum ondan okunur).
            const o = onay;
            setOnay(null);
            const cur = o === null ? undefined : flows.find((x) => x.flow === o.flow);
            if (o !== null && cur !== undefined) void setFlow(cur, true, o.dir);
          }}
          onCancel={() => {
            feedback.minor();
            setOnay(null);
          }}
        />
      </div>
    </KalipEkran>
  );
}
