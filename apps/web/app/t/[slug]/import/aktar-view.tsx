"use client";
// T-427 (I-18): Aktar.dc.html "Excel'den aktar" BİREBİR — 1 Tür → 2 Dosya → 3 Eşleştir (BULDUM / DOĞRU MU? / SEÇMEN GEREK) → 4 Kontrol → 5 Bitti.
// Sınıf adları, öğe sırası, ikon yolları kaynaktan; CSS `design/aktar.css` (üretilmiş). Dosya TARAYICIDA okunur (lib/sheet: .xlsx/.csv, yeni
// bağımlılık yok), sütunlar otomatik eşlenir, kullanıcı eksikleri tek dokunuşla seçer. Sunucuya mevcut içe aktarma biçiminde düz CSV gider; ayrıştırma,
// doğrulama, yetki ve idempotans sunucudadır (previewImportAction / applyImportChunkAction). Dosya içeriği yalnız bellekte tutulur (G-09).
// Bilinçli farklar (DESIGN-PARITY): Cari kartlar T-428 ile açılır (o zamana dek kart kapalı); eski ikili .xls okunmaz (".xlsx olarak kaydet");
// Etkin (sesle eşleme) T-424; eşleştirme hafızası tarayıcıda (alan + başlık imzası); "Kritik stok (en az)" alanı minimum stok aktarımıyla gelir.
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useModalFocus } from "../kalip/odak.ts";
import { dz } from "../../../design/aktar-tokens.ts";
import { AICON } from "../../../design/aktar-icons.ts";
import { readWorkbook, SheetError, type Workbook } from "../../../../lib/sheet/read.ts";
import { FIELDS, autoMap, buildCsv, buildRecords, colLetter, detectHeader, headerSignature, samples, setColumn, waiting, type ImportKindKey, type Mapping } from "../../../../lib/sheet/mapping.ts";
import { applyImportChunkAction, previewImportAction } from "./actions.ts";
import { importPartiesAction } from "../parties/actions.ts";
import { KabukBar } from "../kabuk/kabuk-bar.tsx";
import { buyukHarf, feedback, sayi } from "@wms/ui";


type PreviewResult = Awaited<ReturnType<typeof previewImportAction>>;
type ImportPreview = Extract<PreviewResult, { ok: true }>["data"];
type ApplyResult = Awaited<ReturnType<typeof applyImportChunkAction>>;
type ChunkReport = Extract<ApplyResult, { ok: true }>["data"];
type PartyResult = Awaited<ReturnType<typeof importPartiesAction>>;
type PartyReport = Extract<PartyResult, { ok: true }>["data"];
type PartyRec = { row: number } & Partial<Record<"code" | "name" | "kind" | "taxNo" | "taxOffice" | "phone" | "email" | "city" | "address", string>>;
const PARTY_CHUNK = 500;

export interface AktarViewProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly maxRows: number;
  readonly chunkSize: number;
}

interface Loaded {
  readonly name: string;
  readonly wb: Workbook;
  readonly sheet: number;
  readonly header: number;
}
interface Check {
  /** Ürün / açılış stoku önizlemesi; cari kartlarda null. */
  readonly preview: ImportPreview | null;
  /** Cari kartlar: yazılacak (geçerli) kayıtlar. */
  readonly records?: readonly PartyRec[];
  readonly text: string;
  readonly rowMap: readonly number[];
  readonly nNew: number;
  readonly nUpd: number;
  readonly bad: readonly { readonly row: number; readonly code: string; readonly params: Record<string, string | number> }[];
  readonly badRows: number;
  readonly blocked: boolean;
}

const MEM = (slug: string, kind: ImportKindKey, sig: string): string => `etkin-aktar:${slug}:${kind}:${sig}`;
const RECENT = (slug: string, kind: ImportKindKey): string => `etkin-aktar-son:${slug}:${kind}`;

function Ico({ d, size, style }: { d: readonly string[] | string; size: number; style?: CSSProperties }) {
  const list = typeof d === "string" ? [d] : d;
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {list.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

function store<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) {
      window.localStorage.setItem(key, JSON.stringify(value));
      return value;
    }
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function AktarView({ slug, dark, maxRows, chunkSize }: AktarViewProps) {
  const t = useTranslations("aktar");
  const ti = useTranslations("import");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const base = `/t/${encodeURIComponent(slug)}`;
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<ImportKindKey>("stok");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [skip, setSkip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [reports, setReports] = useState<readonly ChunkReport[]>([]);
  const [partyReports, setPartyReports] = useState<readonly PartyReport[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cf, setCf] = useState(false);
  // T-436 (ALTIN-KURAL 11): Esc kapatır, odak perdede kalır, kapanınca açan düğmeye döner.
  const pickRef = useRef<HTMLElement>(null);
  const cfRef = useRef<HTMLDivElement>(null);
  useModalFocus(pick !== null, pickRef, { onClose: () => setPick(null), initial: "first" });
  useModalFocus(cf, cfRef, { onClose: () => setCf(false), initial: "first" });
  const [recent, setRecent] = useState<{ name: string; rows: number; cols: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecent(store<{ name: string; rows: number; cols: number }>(RECENT(slug, kind)));
  }, [slug, kind]);

  // T-436 (ALTIN-KURAL 5): ortak balon.
  const flash = (msg: string): void => feedback.info(msg);

  const sheet = loaded === null ? null : (loaded.wb.sheets[loaded.sheet] ?? null);
  const rows = useMemo(() => sheet?.rows ?? [], [sheet]);
  const head = loaded === null ? [] : (rows[loaded.header] ?? []);
  const dataRows = loaded === null ? 0 : Math.max(0, rows.length - loaded.header - 1);
  const fields = FIELDS[kind];
  const kindTitle = t(`kind.${kind}.title`);
  const fmt = (n: number): string => sayi(n, locale);

  async function onFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setError(null);
    setBusy(true);
    try {
      const wb = await readWorkbook(file, maxRows + 10);
      const first = wb.sheets[0];
      if (first === undefined) throw new SheetError("EMPTY");
      const header = detectHeader(first.rows, kind);
      const sig = headerSignature(first.rows[header] ?? []);
      const mem = store<Record<string, number | null>>(MEM(slug, kind, sig));
      let m = autoMap(first.rows, header, kind);
      if (mem !== null) {
        for (const f of FIELDS[kind]) if (f.id in mem) m = setColumn(m, f.id, mem[f.id] ?? null);
      }
      setRemembered(mem !== null);
      setLoaded({ name: file.name, wb, sheet: 0, header });
      setMap(m);
      setCheck(null);
      setReports([]);
      setPartyReports([]);
      setProgress(null);
      store(RECENT(slug, kind), { name: file.name, rows: Math.max(0, first.rows.length - header - 1), cols: (first.rows[header] ?? []).length });
      feedback.ok();
      setStep(3);
    } catch (e) {
      feedback.error();
      setError(t(`fileError.${e instanceof SheetError ? e.code : "UNREADABLE"}`));
    } finally {
      setBusy(false);
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  }

  function remember(): void {
    if (map === null || loaded === null) return;
    store(MEM(slug, kind, headerSignature(head)), map.col);
  }

  async function runCheck(): Promise<void> {
    if (map === null || loaded === null) return;
    setBusy(true);
    setError(null);
    if (kind === "cari") {
      // T-428: cari kartlar kayıt olarak gider; kontrol = sunucuda yazmadan deneme (dryRun), aynı kurallar.
      const records = buildRecords(rows, loaded.header, map, kind) as unknown as PartyRec[];
      const res: PartyReport["rows"][number][] = [];
      for (let i = 0; i < records.length; i += PARTY_CHUNK) {
        const r = await importPartiesAction({ slug, dryRun: true, rows: records.slice(i, i + PARTY_CHUNK) });
        if (!r.ok) {
          setBusy(false);
          feedback.error();
          setError(t("serverError", { code: r.error.code }));
          return;
        }
        res.push(...r.data.rows);
      }
      const invalid = res.filter((x) => x.status === "INVALID");
      const bad = new Set(invalid.map((x) => x.row));
      const valid = records.filter((x) => !bad.has(x.row));
      const blocked = valid.length === 0 || (invalid.length > 0 && !skip);
      setCheck({
        preview: null,
        records: valid,
        text: "",
        rowMap: [],
        nNew: res.filter((x) => x.status === "CREATED").length,
        nUpd: res.filter((x) => x.status === "UPDATED").length,
        bad: [
          ...invalid.map((x) => ({ row: x.row, code: `P:${x.issue ?? "UNKNOWN"}`, params: {} })),
          ...res.filter((x) => x.warning !== undefined && x.status !== "INVALID").map((x) => ({ row: x.row, code: `W:${x.warning ?? ""}`, params: {} })),
        ].sort((a, b) => a.row - b.row).slice(0, 20),
        badRows: invalid.length,
        blocked,
      });
      setBusy(false);
      (!blocked ? feedback.ok : feedback.error)();
      setStep(4);
      return;
    }
    const first = buildCsv(rows, loaded.header, map, kind);
    const r = await previewImportAction({ slug, text: first.text });
    if (!r.ok) {
      setBusy(false);
      feedback.error();
      setError(t("serverError", { code: r.error.code }));
      return;
    }
    const p = r.data;
    const issues = p.issues.map((i) => ({ row: i.row <= 1 ? 0 : (first.rowMap[i.row] ?? i.row), code: i.code, params: { ...(i.params ?? {}) } as Record<string, string | number> }));
    const headerLevel = p.issues.some((i) => i.row <= 1);
    const badFileRows = new Set(issues.filter((i) => i.row > 0).map((i) => i.row));
    let final: { text: string; rowMap: readonly number[]; preview: ImportPreview } = { text: first.text, rowMap: first.rowMap, preview: p };
    // Sorunluları atla: sorunlu dosya satırları çıkarılıp temiz dosya yeniden önizlenir (sunucu yine her şeyi doğrular).
    if (!headerLevel && p.issueTotal > 0 && p.issueTotal === p.issues.length && skip) {
      const second = buildCsv(rows, loaded.header, map, kind, badFileRows);
      const r2 = await previewImportAction({ slug, text: second.text });
      if (r2.ok) final = { text: second.text, rowMap: second.rowMap, preview: r2.data };
    }
    const fp = final.preview;
    const clean = fp.issueTotal === 0;
    const nNew = !clean ? 0 : "products" in fp && fp.products !== undefined ? fp.products.create : (fp.summary?.stockLines ?? 0);
    const nUpd = !clean ? 0 : "products" in fp && fp.products !== undefined ? fp.products.existing : 0;
    setCheck({ preview: fp, text: final.text, rowMap: final.rowMap, nNew, nUpd, bad: issues.slice(0, 20), badRows: headerLevel ? 0 : p.summary?.errorRows ?? badFileRows.size, blocked: !clean });
    setBusy(false);
    (clean ? feedback.ok : feedback.error)();
    setStep(4);
  }

  async function runApply(): Promise<void> {
    if (check === null || check.blocked) return;
    setBusy(true);
    setError(null);
    if (check.records !== undefined) {
      const acc: PartyReport[] = [];
      const total = check.records.length;
      setProgress({ done: 0, total });
      for (let i = 0; i < total; i += PARTY_CHUNK) {
        const r = await importPartiesAction({ slug, dryRun: false, rows: check.records.slice(i, i + PARTY_CHUNK) });
        if (!r.ok) {
          setError(t("serverError", { code: r.error.code }));
          break;
        }
        acc.push(r.data);
        setPartyReports([...acc]);
        setProgress({ done: Math.min(total, i + PARTY_CHUNK), total });
      }
      remember();
      setBusy(false);
      feedback.ok();
      setStep(5);
      return;
    }
    if (check.preview === null) return;
    const preview = check.preview;
    const acc: ChunkReport[] = [];
    const total = preview.rowCount;
    setProgress({ done: 0, total });
    for (let c = 0; c < preview.chunkCount; c++) {
      const r = await applyImportChunkAction({ slug, text: check.text, chunk: c, digest: preview.digest });
      if (!r.ok) {
        setError(t("serverError", { code: r.error.code }));
        break;
      }
      acc.push(r.data);
      setReports([...acc]);
      setProgress({ done: Math.min(total, (c + 1) * chunkSize), total });
      if (!r.data.complete) break;
    }
    remember();
    setBusy(false);
    feedback.ok();
    setStep(5);
  }

  // ---- görünüm değerleri (kaynak renderVals) ----
  const STEPS = [t("steps.1"), t("steps.2"), t("steps.3"), t("steps.4"), t("steps.5")];
  const title = step === 1 ? t("title") : `${kindTitle} · ${t("title")}`;
  const stepLine = t("stepLine", { n: Math.min(step, 4), name: buyukHarf(STEPS[step - 1] ?? "", locale) });
  const colSample = (i: number): string => (loaded === null ? "" : samples(rows, loaded.header, i).join(" · "));
  const colName = (i: number): string => `${colLetter(i)} · ${buyukHarf(head[i] ?? "", locale)}`;
  const fieldOf = (i: number) => fields.find((f) => map?.col[f.id] === i);
  const missIds = map === null ? [] : fields.filter((f) => f.required && (map.col[f.id] ?? null) === null).map((f) => f.id);
  const wait = map === null ? [] : waiting(map, kind);
  const rowState = (id: string, req: boolean): "auto" | "user" | "sug" | "miss" | "skip" => {
    const c = map?.col[id] ?? null;
    const s = map?.state[id];
    return c !== null ? (s === "sug" ? "sug" : s === "user" ? "user" : "auto") : req ? "miss" : "skip";
  };
  const IC = { auto: AICON.check, user: AICON.check, sug: AICON.qmark, miss: AICON.plus, skip: AICON.skip } as const;
  const nAuto = fields.filter((f) => ["auto", "user"].includes(rowState(f.id, f.required))).length;
  const nSug = fields.filter((f) => rowState(f.id, f.required) === "sug").length;
  const unusedCols = head.map((h, i) => ({ h, i })).filter((x) => x.h !== "" && fieldOf(x.i) === undefined).map((x) => `${colLetter(x.i)} · ${x.h}`);
  const shown = fields.filter((f) => f.required || (map?.col[f.id] ?? null) !== null).slice(0, 5);

  const dirty = step === 3 || step === 4;
  const partyRows = partyReports.flatMap((r) => r.rows);
  const applied: readonly { readonly row: number; readonly code: string; readonly status: string; readonly reason?: string }[] =
    kind === "cari" ? partyRows.map((r) => ({ row: r.row, code: r.issue ?? "", status: r.status === "INVALID" ? "FAILED" : r.status })) : reports.flatMap((r) => r.rows);
  const count = (...s: string[]): number => applied.filter((r) => s.includes(r.status)).length;
  const added = count("CREATED", "APPLIED");
  const updated = count("UPDATED");
  const same = count("UNCHANGED", "REPLAYED");
  const failedRows = applied.filter((r) => r.status === "FAILED");
  const failed = failedRows.length;
  const expected = check === null ? 0 : check.records !== undefined ? check.records.length : (check.preview?.rowCount ?? 0);
  const notTried = check === null ? 0 : count("NOT_ATTEMPTED") + Math.max(0, expected - applied.length);
  const partial = step === 5 && (failed > 0 || notTried > 0 || error !== null);

  let main: (() => void) | null = null;
  let mainLabel = "";
  let mainIcon: string = AICON.check;
  let mainCls = "dk big scan";
  if (step === 2) {
    mainLabel = t("main.pick");
    mainIcon = AICON.upload;
    main = () => fileRef.current?.click();
  }
  if (step === 3) {
    if (wait.length > 0) {
      mainLabel = t("main.wait", { n: wait.length });
      mainCls = "dk big scan wait";
      mainIcon = AICON.qmark;
      main = () => {
        feedback.error();
        setPick(wait[0] ?? null);
      };
    } else {
      mainLabel = busy ? t("main.checking") : t("main.check");
      main = () => void runCheck();
    }
  }
  if (step === 4) {
    mainIcon = AICON.down;
    if (check !== null && !check.blocked) {
      mainLabel = busy ? t("main.applying", { done: progress?.done ?? 0, total: progress?.total ?? 0 }) : t("main.apply", { n: fmt(expected) });
      main = () => void runApply();
    } else {
      mainLabel = t("main.fix");
      mainCls = "dk big scan wait";
      mainIcon = AICON.back;
      main = () => setStep(3);
    }
  }
  if (step === 5) {
    mainLabel = t("main.done");
    main = () => {
      setStep(1);
      setLoaded(null);
      setMap(null);
      setCheck(null);
    };
  }
  const goBack = (): void => {
    if (step > 1) setStep(step === 3 ? 2 : step - 1);
  };
  const pickF = pick === null ? null : (fields.find((f) => f.id === pick) ?? null);
  const goList = kind === "stok" ? `${base}/items` : kind === "cari" ? `${base}/parties` : `${base}/stock`;

  return (
    <>
    <div className={`dza${dark ? " dz-dark" : ""}`} data-testid="aktar">
      <div className="wrap">
        <div className="appzone">
          <div className="app">
            <header className="top">
              <span className="brand">
                <span className="alic" style={{ background: dz("2F7D5B"), width: 44, height: 44, borderRadius: 14, flex: "none" }}>
                  <Ico d={[AICON.fileA, AICON.fileB, AICON.fileC]} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{title}</b>
                  <small>{stepLine}</small>
                </span>
              </span>
              <span className="net" style={{ position: "static", flex: "none" }} title={t("online")}>
                <i />
              </span>
            </header>
            <div className="stepbar" aria-hidden="true">
              <span style={{ width: `${step * 20}%` }} />
            </div>

            <main className="inner">
              <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="aktar-file" />
              {error !== null ? (
                <div className="memo" role="alert" data-testid="aktar-error">
                  <span className="mic" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
                    <Ico d={AICON.warn} size={18} />
                  </span>
                  <span>{error}</span>
                </div>
              ) : null}

              {step === 1 ? (
                <>
                  <div className="lead">
                    <b>{t("s1.lead")}</b>
                    <small>{t("s1.hint")}</small>
                  </div>
                  <div className="kinds">
                    {(
                      [
                        ["stok", "2F7D5B", [AICON.boxA, AICON.boxB], true],
                        ["cari", "6C4BD8", [AICON.cariA, AICON.cariB], true],
                        ["acilis", "0E7C7B", [AICON.shelf], true],
                      ] as const
                    ).map(([k, color, icon, on]) => (
                      <button
                        key={k}
                        type="button"
                        className="kind"
                        disabled={!on}
                        aria-disabled={!on}
                        style={on ? undefined : { opacity: 0.55, cursor: "not-allowed" }}
                        data-kind={k}
                        onClick={() => {
                          if (!on) return;
                          feedback.ok();
                          setKind(k as ImportKindKey);
                          setError(null);
                          setStep(2);
                        }}
                      >
                        <span className="kic" style={{ background: dz(color) }}>
                          <Ico d={icon} size={30} />
                        </span>
                        <span className="kt">
                          <b>{t(`kind.${k}.title`)}</b>
                          <small>{on ? t(`kind.${k}.sub`) : t("kind.soon")}</small>
                        </span>
                        <svg className="ico kgo" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                          <path d={AICON.chevron} />
                        </svg>
                      </button>
                    ))}
                  </div>
                  <div className="memo">
                    <span className="mic" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                      <Ico d={AICON.bulb} size={18} />
                    </span>
                    <span>{t("s1.memo")}</span>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="lead">
                    <b>{t("s2.lead", { kind: kindTitle })}</b>
                    <small>{t("s2.hint", { n: fmt(maxRows) })}</small>
                  </div>
                  <button
                    type="button"
                    className="drop"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void onFile(e.dataTransfer.files[0]);
                    }}
                    disabled={busy}
                    data-testid="aktar-drop"
                  >
                    <span className="dic">
                      <Ico d={[AICON.upA, AICON.upB]} size={40} />
                    </span>
                    <b>{busy ? t("s2.reading") : t("s2.pick")}</b>
                    <small>{t("s2.drag")}</small>
                    <span className="exts">
                      <em>XLSX</em>
                      <em>CSV</em>
                    </span>
                  </button>
                  {recent !== null ? (
                    <>
                      <div className="shd">
                        <b>{t("s2.recent")}</b>
                        <span>{t("s2.recentHint")}</span>
                      </div>
                      <button type="button" className="recent" onClick={() => fileRef.current?.click()}>
                        <span className="kic" style={{ background: dz("E3F1E9"), color: dz("17583C"), width: 44, height: 44, borderRadius: 14 }}>
                          <Ico d={[AICON.fileA, AICON.fileB]} size={22} />
                        </span>
                        <span className="kt">
                          <b>{recent.name}</b>
                          <small>{t("s2.recentMeta", { rows: fmt(recent.rows), cols: recent.cols })}</small>
                        </span>
                        <span className="okpill">
                          <Ico d={AICON.check} size={14} />
                          {t("s2.noAsk")}
                        </span>
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}

              {step === 3 && loaded !== null && map !== null ? (
                <>
                  <div className="fhead">
                    <span className="kic" style={{ background: dz("E3F1E9"), color: dz("17583C"), width: 42, height: 42, borderRadius: 13 }}>
                      <Ico d={[AICON.fileA, AICON.fileB]} size={20} />
                    </span>
                    <span className="kt" style={{ flex: 1, minWidth: 0 }}>
                      <b>{loaded.name}</b>
                      <small>
                        {t("s3.meta", { sheet: sheet?.name ?? "", rows: fmt(dataRows), cols: head.length, header: loaded.header + 1 })}
                        {remembered ? ` · ${t("s3.remembered")}` : ""}
                      </small>
                    </span>
                    {loaded.wb.sheets.length > 1 ? (
                      <select
                        aria-label={t("s3.sheet")}
                        value={loaded.sheet}
                        onChange={(e) => {
                          const i = Number(e.target.value);
                          const sh = loaded.wb.sheets[i];
                          if (sh === undefined) return;
                          const h = detectHeader(sh.rows, kind);
                          setLoaded({ ...loaded, sheet: i, header: h });
                          setMap(autoMap(sh.rows, h, kind));
                        }}
                        style={{ minHeight: 44 }}
                      >
                        {loaded.wb.sheets.map((s, i) => (
                          <option key={s.name + String(i)} value={i}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  <div className="sums">
                    <span className="sm ok">
                      <b>{nAuto}</b>
                      {t("s3.found")}
                    </span>
                    <span className={`sm sug${nSug > 0 ? "" : " zero"}`}>
                      <b>{nSug}</b>
                      {t("s3.sure")}
                    </span>
                    <span className={`sm ${missIds.length > 0 ? "miss" : "zero"}`}>
                      <b>{missIds.length}</b>
                      {t("s3.need")}
                    </span>
                  </div>
                  <div className="mapgrid">
                    <div className="maps" role="list" aria-label={t("s3.mapAria")}>
                      {fields.map((f, i) => {
                        const st = rowState(f.id, f.required);
                        const c = map.col[f.id] ?? null;
                        const label = t(`field.${kind}.${f.id}`);
                        const colTxt = c !== null ? colName(c) : f.required ? t("s3.choose") : t("s3.notInFile");
                        const smp = c !== null ? colSample(c) || "—" : f.required ? t("s3.required") : t("s3.optional");
                        return (
                          <div key={f.id} className={`mrow ${st}`} role="listitem" style={{ animationDelay: `${i * 30}ms` }} data-field={f.id} data-state={st}>
                            <button type="button" className="mrow-hit" aria-label={`${label}: ${colTxt}`} onClick={() => setPick(f.id)}>
                              <span className="mst">
                                <Ico d={IC[st]} size={18} />
                              </span>
                              <span className="mfl">
                                <b>
                                  {label}
                                  <em>{f.required ? "*" : ""}</em>
                                </b>
                                <small>{smp}</small>
                              </span>
                              <span className="mcol">{colTxt}</span>
                            </button>
                            {st === "sug" ? (
                              <button
                                type="button"
                                className="mok"
                                aria-label={t("s3.yes")}
                                onClick={() => {
                                  feedback.ok();
                                  setMap({ col: map.col, state: { ...map.state, [f.id]: "user" } });
                                }}
                              >
                                <Ico d={AICON.check} size={20} />
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                      <p className="unused">{unusedCols.length > 0 ? t("s3.unused", { cols: unusedCols.join(", ") }) : t("s3.allUsed")}</p>
                    </div>
                    <div className="pv">
                      <div className="shd" style={{ margin: "0 2px 8px" }}>
                        <b>{t("s3.preview")}</b>
                        <span>{t("s3.previewHint")}</span>
                      </div>
                      <div className="pvt">
                        <div className="pvr pvh">
                          {shown.map((f) => (
                            <span key={f.id} className={(map.col[f.id] ?? null) !== null ? "" : "need"}>
                              {buyukHarf(t(`field.${kind}.${f.id}`), locale)}
                            </span>
                          ))}
                        </div>
                        {[0, 1, 2, 3].map((r) => (
                          <div className="pvr" key={r}>
                            {shown.map((f) => {
                              const c = map.col[f.id] ?? null;
                              const v = c === null ? "" : (rows[loaded.header + 1 + r]?.[c] ?? "");
                              return (
                                <span key={f.id} className={c === null ? "need" : v === "" ? "empty" : ""}>
                                  {v === "" ? (c === null ? "?" : "—") : v}
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {step === 4 && check !== null ? (
                <>
                  <div className="lead">
                    <b>{check.blocked ? t("s4.blocked", { bad: check.badRows }) : t("s4.ready", { n: fmt(expected), bad: check.badRows })}</b>
                    <small>{t("s4.hint")}</small>
                  </div>
                  <div className="chk3">
                    <div className="ck">
                      <span className="kic" style={{ background: dz("2F7D5B") }}>
                        <Ico d={AICON.plus} size={22} />
                      </span>
                      <b data-testid="aktar-new">{fmt(check.nNew)}</b>
                      <small>{t("s4.new")}</small>
                    </div>
                    <div className="ck">
                      <span className="kic" style={{ background: dz("2F5DA8") }}>
                        <Ico d={AICON.update} size={22} />
                      </span>
                      <b>{fmt(check.nUpd)}</b>
                      <small>{t("s4.upd")}</small>
                    </div>
                    <div className="ck bad">
                      <span className="kic">
                        <Ico d={AICON.warn} size={22} />
                      </span>
                      <b data-testid="aktar-bad">{check.badRows}</b>
                      <small>{t("s4.bad")}</small>
                    </div>
                  </div>
                  <div className="probs">
                    {check.bad.map((p, i) => (
                      <div className="pr" key={`${p.row}-${p.code}-${String(i)}`}>
                        <span className="prn">{p.row > 0 ? t("s4.row", { n: p.row }) : t("s4.file")}</span>
                        <span className="kt" style={{ minWidth: 0 }}>
                          <b>{p.code.startsWith("P:") ? t(`partyIssue.${p.code.slice(2)}`) : p.code.startsWith("W:") ? t(`partyWarning.${p.code.slice(2)}`) : ti(`issue.${p.code}.reason`, p.params)}</b>
                          <small>{p.code.startsWith("P:") ? t("partyIssueFix") : p.code.startsWith("W:") ? t("partyWarningFix") : ti(`issue.${p.code}.fix`, p.params)}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="opts">
                    <button
                      type="button"
                      className={`opt${skip ? " on" : ""}`}
                      aria-pressed={skip}
                      onClick={() => {
                        feedback.ok();
                        setSkip(!skip);
                        setCheck(null);
                        setStep(3);
                        flash(t("s4.recheck"));
                      }}
                    >
                      <span className="tg">
                        <i />
                      </span>
                      <span>{t("s4.skip")}</span>
                    </button>
                  </div>
                </>
              ) : null}

              {step === 5 ? (
                <div className="done" data-testid="aktar-done" data-partial={partial ? "true" : "false"}>
                  <span className="dring" style={partial ? { background: dz("E56A00") } : undefined}>
                    <Ico d={partial ? AICON.warn : AICON.check} size={56} />
                  </span>
                  <b>{partial ? t("s5.partial", { n: fmt(added + updated) }) : t(`kind.${kind}.done`, { n: fmt(added + updated) })}</b>
                  <small data-testid="aktar-counts">{t("s5.sub", { added: fmt(added), updated: fmt(updated), same: fmt(same), failed: fmt(failed), notTried: fmt(notTried), skipped: fmt(check?.badRows ?? 0) })}</small>
                  {failedRows.length > 0 ? (
                    <div className="probs" data-testid="aktar-failed">
                      {failedRows.slice(0, 20).map((r) => (
                        <div className="pr" key={`${r.row}-${r.code}`}>
                          <span className="prn">{t("s4.row", { n: check?.rowMap[r.row] ?? r.row })}</span>
                          <span className="kt" style={{ minWidth: 0 }}>
                            <b>{kind === "cari" && r.code !== "" ? t(`partyIssue.${r.code}`) : r.code}</b>
                            <small>{r.reason !== undefined ? ti(`result.reason.${r.reason}`) : t("s5.failedRow")}</small>
                          </span>
                        </div>
                      ))}
                      {failedRows.length > 20 ? <p className="unused">{t("s5.more", { n: failedRows.length - 20 })}</p> : null}
                    </div>
                  ) : null}
                  {partial ? (
                    <button type="button" className="btn y" style={{ minHeight: 52, padding: "0 22px" }} onClick={() => setStep(2)} data-testid="aktar-retry">
                      {t("s5.retry")}
                    </button>
                  ) : (
                    <div className="memo" style={{ maxWidth: 520 }}>
                      <span className="mic" style={{ background: dz("E3F1E9"), color: dz("17583C") }}>
                        <Ico d={AICON.saved} size={18} />
                      </span>
                      <span>{t("s5.memo")}</span>
                    </div>
                  )}
                  <a className="btn n" href={goList} style={{ minHeight: 52, padding: "0 22px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                    {t(`kind.${kind}.goList`)}
                  </a>
                </div>
              ) : null}
            </main>


            {pickF !== null && map !== null && loaded !== null ? (
              <div className="scrim" onClick={() => setPick(null)}>
                <section ref={pickRef} className="sheet" role="dialog" aria-label={t("pick.aria")} onClick={(e) => e.stopPropagation()}>
                  <div className="sh">
                    <span>
                      <b>
                        {t(`field.${kind}.${pickF.id}`)}
                        {pickF.required ? " *" : ""}
                      </b>
                      <small>{t("pick.hint")}</small>
                    </span>
                    <button type="button" className="x" aria-label={t("pick.close")} onClick={() => setPick(null)}>
                      <Ico d={AICON.close} size={18} />
                    </button>
                  </div>
                  <div className="cols">
                    {head.map((h, i) => {
                      const owner = fieldOf(i);
                      const cur = map.col[pickF.id] === i;
                      return (
                        <button
                          key={String(i)}
                          type="button"
                          className={`colb${cur ? " cur" : owner !== undefined ? " taken" : ""}`}
                          data-col={colLetter(i)}
                          onClick={() => {
                            feedback.ok();
                            setMap(setColumn(map, pickF.id, i));
                            setPick(null);
                          }}
                        >
                          <span className="cl">{colLetter(i)}</span>
                          <span className="kt" style={{ minWidth: 0 }}>
                            <b>{h === "" ? t("pick.noHeader") : h}</b>
                            <small>{colSample(i) || t("pick.empty")}</small>
                          </span>
                          <span className="cu">{cur ? t("pick.current") : owner !== undefined ? `→ ${buyukHarf(t(`field.${kind}.${owner.id}`), locale)}` : ""}</span>
                        </button>
                      );
                    })}
                    {!pickF.required ? (
                      <button
                        type="button"
                        className="colb none"
                        onClick={() => {
                          setMap(setColumn(map, pickF.id, null));
                          setPick(null);
                        }}
                      >
                        <span className="cl">—</span>
                        <span className="kt">
                          <b>{t("pick.leaveEmpty")}</b>
                          <small>{t("pick.notInFile")}</small>
                        </span>
                        <span className="cu" />
                      </button>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}

            {cf ? (
              <>
                <div className="cfback" onClick={() => setCf(false)} />
                <div ref={cfRef} className="cfbox" role="alertdialog" aria-label={t("cf.title")}>
                  <span className="cfic">
                    <Ico d={AICON.warn} size={26} />
                  </span>
                  <b>{t("cf.title")}</b>
                  <p>{t("cf.text")}</p>
                  <a href={base} className="cfb save" onClick={remember}>
                    <Ico d={AICON.check} size={20} />
                    {t("cf.save")}
                  </a>
                  <a href={base} className="cfb leave">
                    <Ico d={AICON.signOut} size={20} />
                    {t("cf.leave")}
                  </a>
                  <button type="button" className="cfb stay" onClick={() => setCf(false)}>
                    {t("cf.stay")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    {/* T-958: ortak alt cam çubuk (Kabuk.dc.html): Geri · Ana ekran · ekranın ana işlemi · Modüller · Etkin. */}
    <KabukBar
      dark={dark}
      back={step === 1 ? { href: base, aria: t("backHome"), testId: "aktar-back" } : { onClick: goBack, aria: t("back"), testId: "aktar-back" }}
      homeNav={main !== null && dirty ? { onClick: () => setCf(true), aria: t("home"), testId: "aktar-home" } : { href: base, aria: t("home"), testId: "aktar-home" }}
      main={main === null ? null : { label: mainLabel, d: mainIcon, onClick: main, disabled: busy && step !== 2, testId: "aktar-main", wait: mainCls.includes(" wait") }}
    />
    </>
  );
}
