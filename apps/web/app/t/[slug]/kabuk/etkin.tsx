"use client";
// T-1002 (B-62): Etkin sesli komut — Kabuk.dc.html BİREBİR: basılı tutunca hafif büyüyen düğme (`.dk-etkin.live`), buzlu dinleme perdesi
// (`.veil` + `.vorb` nabız halkaları + `.wave` + `.said`), uzun dinleme (`.timer` + `.stop`), "Anladım" kartı (`.card` `.ch` `.quote`
// `.pchips .pc` `.acts .btn.go/.fix` `.say`), okuma sonucu (`.card .res .rr .open`) ve başarı/hata nabzı (`.fb.good/.bad` + ses).
// Akış: bas-konuş (≥0,3 sn basılı) ya da iki kez dokun (uzun dinleme; sessizlikte ya da "Bitti" ile biter) → 16 kHz WAV → sunucu eylemi
// (`etkinAnlaAction`: kimlik, üyelik, hız sınırı, iç ses servisi, niyet, kiracı verisiyle eşleştirme) → yanıt:
//   - yazma (stok/iş değiştiren): "Anladım" kartı; Onayla (dokunuş ya da kart açıkken tam "onayla" demek, A-172) MEVCUT eylemi çağırır
//     (startCountAction / createManualStockAction / transferStockAction — yetki, kapsam, kilit I-15 ve idempotency I-06 oradadır).
//   - okuma: sonuç kartı doğrudan; gezinme: ekran doğrudan açılır.
// Bilinçli farklar (DESIGN-PARITY T-1002): canlı yazı konuşma bitince gelir (akışlı tanıma yok); sesli yanıt (TTS) ikinci adımda — şimdilik
// ortak ses (tamam/hata) + görsel nabız. Belirsiz eşleşmede aday satırları kartın içinde `.rr` + "Seç" ile.
import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { feedback, kayitBaslat, sayi, type Kayit } from "@wms/ui";
import { completePlan, decide, type Draft, type PickOption, type Plan, type ReadRow, type Slot, type VoiceAnswer, type WriteOp } from "@wms/shared/voice";
import { dz } from "../../../design/kabuk-tokens.ts";
import { KICON } from "../../../design/kabuk-icons.ts";
import { etkinAnlaAction } from "../etkin/actions.ts";
import { startCountAction } from "../counts/actions.ts";
import { createManualStockAction, transferStockAction } from "../stock/documents/actions.ts";
import { useModalFocus } from "../kalip/odak.ts";

type WriteAnswer = Extract<VoiceAnswer, { type: "write" }>;
type ReadAnswer = Extract<VoiceAnswer, { type: "read" }>;
type Picks = WriteAnswer["picks"];

type St =
  | { readonly s: "idle" }
  | { readonly s: "listen" | "long"; readonly at: number }
  | { readonly s: "think" }
  | { readonly s: "write"; readonly text: string; readonly op: WriteOp; readonly draft: Draft; readonly picks: Picks; readonly fallback: string; readonly key: string; readonly busy: boolean }
  | { readonly s: "read"; readonly text: string; readonly a: ReadAnswer }
  | { readonly s: "fb"; readonly ok: boolean; readonly title: string };

export interface EtkinModule {
  readonly id: string;
  readonly name: string;
  readonly href: string | null;
}

// Kaynak (Kabuk.dc.html `parsed` / `tasks`): işlem, miktar, ürün, yer ikonları ve renkleri.
const D = {
  op: "M12 3v12M7 10l5 5 5-5M4 19h16",
  qty: KICON.mKoli,
  item: KICON.mQr,
  loc: KICON.mDepo,
  task: KICON.mTopla,
  trans: KICON.mTrans,
  count: KICON.mSayim,
  person: "M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5",
  ok: "m5 12 5 5 9-10",
  bad: "M6 6l12 12M18 6 6 18",
  mic: KICON.mSes,
  fix: "M4 20h4L19 9l-4-4L4 16z",
} as const;
const OP_COLOR: Record<WriteOp, string> = { stockIn: "2F7D5B", stockOut: "C62828", transfer: "6C4BD8", count: "2F5DA8" };
const OP_D: Record<WriteOp, string> = { stockIn: D.op, stockOut: "M12 21V9M7 14l5-5 5 5M4 5h16", transfer: D.trans, count: D.count };

function Ico({ d, size }: { d: string; size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
function MicCore() {
  return (
    <svg className="ico" width="30" height="30" viewBox="0 0 24 24">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * Etkin denetleyicisi: düğme işleyicileri ve perde. `enabled=false` ise hiçbir şey çizmez (KabukBar eski "yakında" düğmesini çizer).
 */
export function useEtkin(opts: { readonly enabled: boolean; readonly base: string; readonly slug: string; readonly modules: readonly EtkinModule[] }): {
  readonly live: boolean;
  readonly handlers: Pick<HTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onKeyDown">;
  readonly overlay: ReactNode;
} {
  const t = useTranslations("etkin");
  const locale = useLocale();
  const router = useRouter();
  const [st, setSt] = useState<St>({ s: "idle" });
  const [said, setSaid] = useState("");
  const [tick, setTick] = useState(0);
  const rec = useRef<Kayit | null>(null);
  const startP = useRef<Promise<void> | null>(null);
  const releaseWanted = useRef(false);
  const cancelWanted = useRef(false);
  const tapTimer = useRef<number | undefined>(undefined);
  const downAt = useRef(0);
  const lastTap = useRef(0);
  const card = useRef<Extract<St, { s: "write" }> | null>(null);
  const panel = useRef<HTMLElement>(null);
  const fbTimer = useRef<number | undefined>(undefined);
  const { base, slug, modules } = opts;

  const go = useCallback(
    (href: string) => {
      router.push(`${base}${href}`);
    },
    [base, router],
  );

  const fail = useCallback((title: string) => {
    feedback.error();
    setSt({ s: "fb", ok: false, title });
  }, []);
  const succeed = useCallback((title: string, then?: () => void) => {
    feedback.ok();
    setSt({ s: "fb", ok: true, title });
    window.clearTimeout(fbTimer.current);
    fbTimer.current = window.setTimeout(() => {
      setSt((cur) => (cur.s === "fb" ? { s: "idle" } : cur));
      then?.();
    }, 1400);
  }, []);
  const close = useCallback(() => {
    rec.current?.cancel();
    rec.current = null;
    card.current = null;
    window.clearTimeout(fbTimer.current);
    setSt({ s: "idle" });
  }, []);

  const approve = useCallback(
    async (c: Extract<St, { s: "write" }>) => {
      const { plan } = completePlan(c.op, c.draft);
      if (plan === null || c.busy) {
        feedback.warn();
        return;
      }
      const busyCard = { ...c, busy: true };
      card.current = busyCard;
      setSt(busyCard);
      const res = await run(plan, slug, c.key, t("reason"));
      card.current = null;
      if (!res.ok) {
        const code = res.error.code;
        fail(
          code === "FORBIDDEN"
            ? t("err.forbidden")
            : code === "INSUFFICIENT_STOCK"
              ? t("err.stock")
              : code === "TRACKING_VIOLATION" || code === "VALIDATION_FAILED"
                ? t("err.tracking")
                : code === "RATE_LIMITED"
                  ? t("err.rate")
                  : t("err.generic", { code: res.error.requestId.slice(0, 8) }),
        );
        return;
      }
      const data = res.data as { sessionId?: string | null; missing?: readonly string[]; documentId?: string };
      if (plan.op === "count") {
        if (data.sessionId === null || data.sessionId === undefined) return fail(t("err.missingLoc"));
        const id = data.sessionId;
        return succeed(t("done.count", { code: plan.code }), () => go(`/counts?id=${encodeURIComponent(id)}`));
      }
      if (plan.op === "transfer") return succeed(t("done.transfer"));
      const doc = data.documentId;
      succeed(t(`done.${plan.op}`), doc === undefined ? undefined : () => go(`/stock/documents?id=${encodeURIComponent(doc)}`));
    },
    [fail, go, slug, succeed, t],
  );

  const handle = useCallback(
    (res: Awaited<ReturnType<typeof etkinAnlaAction>>) => {
      if (!res.ok) return fail(res.error.code === "RATE_LIMITED" ? t("err.rate") : t("err.generic", { code: res.error.requestId.slice(0, 8) }));
      const d = res.data;
      if (d.status !== "ok") return fail(t(`err.${d.status}`));
      setSaid(d.text);
      const a = d.answer;
      const pending = card.current;
      if (a.type === "confirm") {
        if (pending === null) return fail(t("err.noCard"));
        void approve(pending);
        return;
      }
      if (a.type === "fix") {
        if (pending !== null) setSt(pending);
        else setSt({ s: "idle" });
        return;
      }
      if (a.type === "write") {
        const c = { s: "write" as const, text: d.text, op: a.op, draft: a.draft, picks: a.picks, fallback: a.fallback, key: newKey(), busy: false };
        card.current = c;
        feedback.minor();
        setSt(c);
        return;
      }
      card.current = null;
      if (a.type === "read") {
        feedback.minor();
        setSt({ s: "read", text: d.text, a });
        return;
      }
      if (a.type === "nav") {
        feedback.info(t("opening"));
        setSt({ s: "idle" });
        go(a.href);
        return;
      }
      if (a.type === "open") {
        const m = decide(
          a.target,
          modules.filter((x) => x.href !== null).map((x) => ({ id: x.id, code: x.id, name: x.name, href: x.href! })),
        );
        if (m.kind === "one") {
          feedback.info(t("opening"));
          setSt({ s: "idle" });
          router.push(m.c.href);
          return;
        }
        return fail(t("err.notFound"));
      }
      fail(t("err.unknown", { text: d.text }));
    },
    [approve, fail, go, modules, router, t],
  );

  const finish = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    if (r === null) return;
    const wav = await r.stop();
    if (wav.seconds < 0.4) {
      const pending = card.current;
      setSt(pending ?? { s: "idle" });
      feedback.info(t("err.tooShort"));
      return;
    }
    setSaid("");
    setSt({ s: "think" });
    let res: Awaited<ReturnType<typeof etkinAnlaAction>>;
    try {
      res = await etkinAnlaAction({ slug, audio: wav.base64 });
    } catch {
      return fail(t("err.unavailable"));
    }
    handle(res);
  }, [fail, handle, slug, t]);

  // Mikrofon açılışı birkaç yüz ms sürebilir: başlatmalar sıraya girer (iki dokunuşta önceki kısa kayıt kapanır, sonra uzun dinleme açılır).
  const begin = useCallback(
    (mode: "listen" | "long") => {
      // Perde hemen açılır (dokunur dokunmaz görsel geri bildirim); mikrofon arkada açılır.
      setSaid("");
      setSt({ s: mode, at: Date.now() });
      const runStart = async (): Promise<void> => {
        if (startP.current !== null) await startP.current.catch(() => undefined);
        if (rec.current !== null) return;
        releaseWanted.current = false;
        try {
          // Mikrofon 6 sn içinde açılmazsa (izin penceresi/aygıt yok) hata balonu; kayıt açılırsa sonradan kapatılır.
          const opening = kayitBaslat({ long: mode === "long", onAuto: () => void finish() });
          const r = await Promise.race([opening, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("mic-timeout")), 6000))]).catch((e: unknown) => {
            void opening.then((late) => late.cancel()).catch(() => undefined);
            throw e;
          });
          if (cancelWanted.current) {
            cancelWanted.current = false;
            r.cancel();
            return;
          }
          rec.current = r;
          setSaid("");
          setSt({ s: mode, at: Date.now() });
          if (mode === "listen" && releaseWanted.current) void finish();
        } catch {
          cancelWanted.current = false;
          fail(t("err.mic"));
        }
      };
      const p = runStart();
      startP.current = p;
      void p.finally(() => {
        if (startP.current === p) startP.current = null;
      });
    },
    [fail, finish, t],
  );

  // Uzun dinleme sayacı (kaynak `.timer` 00:ss).
  useEffect(() => {
    if (st.s !== "long" && st.s !== "listen") return;
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [st.s]);
  useEffect(() => () => {
    rec.current?.cancel();
    window.clearTimeout(fbTimer.current);
    window.clearTimeout(tapTimer.current);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (!opts.enabled || e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* yakalama yok */
    }
    if (st.s === "long") {
      void finish();
      return;
    }
    if (st.s === "think") {
      downAt.current = 0;
      return;
    }
    downAt.current = Date.now();
    begin("listen");
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>): void => {
    if (!opts.enabled || downAt.current === 0) return;
    e.preventDefault();
    const held = Date.now() - downAt.current;
    downAt.current = 0;
    if (held >= 300) {
      if (rec.current === null) releaseWanted.current = true;
      else void finish();
      return;
    }
    // Kısa dokunuş: kısa kayıt atılır (henüz açılıyorsa açılınca kapanır); ikinci dokunuş 450 ms içinde gelirse uzun dinleme, gelmezse
    // "Basılı tut ve konuş" ipucu.
    if (rec.current !== null) {
      rec.current.cancel();
      rec.current = null;
    } else cancelWanted.current = true;
    window.clearTimeout(tapTimer.current);
    setSt(card.current ?? { s: "idle" });
    const now = Date.now();
    if (now - lastTap.current < 450) {
      lastTap.current = 0;
      begin("long");
    } else {
      lastTap.current = now;
      tapTimer.current = window.setTimeout(() => {
        if (lastTap.current === now && rec.current === null) feedback.info(t("err.tooShort"));
      }, 460);
    }
  };
  // T-1103: sistem iptali (iOS kenar hareketi, gelen arama, kaydırma) bırakma DEĞİLDİR: kayıt gönderilmez, çift dokunuş sayılmaz.
  const onPointerCancel = (): void => {
    if (!opts.enabled || downAt.current === 0) return;
    downAt.current = 0;
    if (rec.current !== null) {
      rec.current.cancel();
      rec.current = null;
    } else cancelWanted.current = true;
    releaseWanted.current = false;
    lastTap.current = 0;
    window.clearTimeout(tapTimer.current);
    setSt(card.current ?? { s: "idle" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (!opts.enabled || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    if (st.s === "long" || st.s === "listen") void finish();
    else begin("long");
  };

  const choose = (slot: keyof Picks, o: PickOption): void => {
    if (st.s !== "write") return;
    feedback.minor();
    const d: Draft =
      slot === "item"
        ? { ...st.draft, itemId: o.id, itemLabel: o.label, itemUnitCode: o.unitCode ?? "", itemUnitName: o.unitName ?? "" }
        : slot === "loc"
          ? { ...st.draft, locationId: o.id, locationLabel: o.label, warehouseId: o.warehouseId ?? "", code: o.label }
          : slot === "from"
            ? { ...st.draft, sourceLocationId: o.id, sourceLabel: o.label, sourceWarehouseId: o.warehouseId ?? "" }
            : { ...st.draft, targetLocationId: o.id, targetLabel: o.label, targetWarehouseId: o.warehouseId ?? "" };
    const picks: Picks = { ...st.picks };
    delete (picks as Record<string, unknown>)[slot];
    const next = { ...st, draft: d, picks };
    card.current = next;
    setSt(next);
  };

  const open = st.s === "write" || st.s === "read";
  useModalFocus(open, panel, { onClose: close, busy: st.s === "write" && st.busy, initial: "first" });

  if (!opts.enabled) return { live: false, handlers: {}, overlay: null };
  const live = st.s === "listen" || st.s === "long";
  const sec = live ? Math.min(59, Math.floor((Date.now() - st.at) / 1000)) : 0;
  void tick;
  const clock = `00:${sec < 10 ? "0" : ""}${sec}`;
  const num = (v: string | undefined): string => (v === undefined || v === "" || Number.isNaN(Number(v)) ? (v ?? "") : sayi(Number(v), locale));

  let overlay: ReactNode = null;
  if (live || st.s === "think") {
    overlay = (
      <div className="veil" role="status" aria-live="polite" data-testid="etkin-veil" data-state={st.s}>
        <span className="vorb" aria-hidden="true">
          <span className="vr a" />
          <span className="vr b" />
          <span className="vr c" />
          <span className="vcore">
            <MicCore />
          </span>
        </span>
        <span className="wave" aria-hidden="true">
          {[0, 0.15, 0.3, 0.1, 0.25, 0.05, 0.2].map((dl, i) => (
            <span key={i} style={{ animationDelay: `${dl}s` }} />
          ))}
        </span>
        {st.s === "long" ? (
          <span className="timer">
            <i />
            {t("timer", { clock })}
          </span>
        ) : null}
        <p className="said" style={{ margin: 0 }}>
          “{st.s === "think" ? t("thinking") : said === "" ? t("listening") : said}”<span className="caret" />
        </p>
        {st.s === "listen" ? (
          <>
            <p className="vhint" style={{ margin: 0 }}>
              {t("hint")}
            </p>
            <div className="vchips">
              <span className="vchip" aria-hidden="true">
                <i>
                  <Ico d={D.ok} size={16} />
                </i>
                {t("release")}
              </span>
              <span className="vchip" aria-hidden="true">
                <i>
                  <Ico d={D.mic} size={16} />
                </i>
                {t("example")}
              </span>
            </div>
          </>
        ) : null}
        {st.s === "long" ? (
          <button type="button" className="stop" onClick={() => void finish()} data-testid="etkin-stop">
            <i aria-hidden="true" />
            {t("stop")}
          </button>
        ) : null}
      </div>
    );
  } else if (st.s === "write") {
    const { plan, missing } = completePlan(st.op, st.draft);
    const d = st.draft;
    const chips: { k: string; v: string; d: string; c: string; miss?: boolean }[] = [{ k: t("k.op"), v: t(`op.${st.op}`), d: OP_D[st.op], c: OP_COLOR[st.op] }];
    if (st.op !== "count") chips.push({ k: t("k.qty"), v: d.quantity === undefined ? "?" : `${num(d.quantity)}${d.unit === undefined ? ` ${d.itemUnitCode ?? ""}` : ` ${d.unit}`}`.trim(), d: D.qty, c: "9A5B2E", miss: missing.includes("qty") || missing.includes("unit") });
    if (st.op !== "count") chips.push({ k: t("k.item"), v: d.itemLabel ?? "?", d: D.item, c: "2F5DA8", miss: missing.includes("item") && st.picks.item === undefined });
    if (st.op === "transfer") {
      chips.push({ k: t("k.from"), v: d.sourceLabel ?? "?", d: D.loc, c: "3A6A8C", miss: missing.includes("from") && st.picks.from === undefined });
      chips.push({ k: d.targetLabel === undefined && d.toWarehouseLabel !== undefined ? t("k.wh") : t("k.to"), v: d.targetLabel ?? d.toWarehouseLabel ?? "?", d: D.loc, c: "3A6A8C", miss: missing.includes("to") && st.picks.to === undefined });
    } else chips.push({ k: t("k.loc"), v: d.locationLabel ?? "?", d: D.loc, c: "3A6A8C", miss: missing.includes("loc") && st.picks.loc === undefined });
    const pickSlots = (Object.keys(st.picks) as (keyof Picks)[]).filter((k) => (st.picks[k]?.length ?? 0) > 0);
    const reason =
      missing.includes("unit") && d.itemUnitCode !== undefined
        ? t("unitConflict", { unit: d.itemUnitCode })
        : t("missing", { list: missing.map((m: Slot) => t(`slot.${m}`)).join(", ") });
    overlay = (
      <div className="veil" data-testid="etkin-confirm">
        <section ref={panel} className="card" role="dialog" aria-modal="true" aria-label={t("understood")} tabIndex={-1}>
          <div className="ch">
            <span className="ok">
              <Ico d={D.ok} size={22} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{t("understood")}</b>
              <small>{st.op === "count" ? t("countSub") : t("writeSub")}</small>
            </span>
            <button type="button" className="x" aria-label={t("cancel")} onClick={close} data-testid="etkin-close">
              <Ico d={D.bad} size={20} />
            </button>
          </div>
          <p className="quote">“{st.text}”</p>
          <div className="pchips">
            {chips.map((p) => (
              <span key={p.k} className="pc" data-miss={p.miss === true ? "true" : undefined}>
                <i style={{ background: dz(p.miss === true ? "C62828" : p.c) }}>
                  <Ico d={p.d} size={18} />
                </i>
                <span>
                  <b>{p.v}</b>
                  <small>{p.miss === true ? `${p.k} · ${t("k.missing")}` : p.k}</small>
                </span>
              </span>
            ))}
          </div>
          {pickSlots.map((slot) => (
            <div key={slot} className="res" role="list" aria-label={t("k.pick", { n: st.picks[slot]!.length })} data-testid={`etkin-pick-${slot}`}>
              {st.picks[slot]!.map((o) => (
                <div key={o.id} className="rr" role="listitem">
                  <i style={{ background: dz(slot === "item" ? "2F5DA8" : "3A6A8C") }}>
                    <Ico d={slot === "item" ? D.item : D.loc} size={20} />
                  </i>
                  <span style={{ minWidth: 0 }}>
                    <b>{o.label}</b>
                    <small>{o.sub}</small>
                  </span>
                  <button type="button" className="open" onClick={() => choose(slot, o)}>
                    {t("choose")}
                  </button>
                </div>
              ))}
            </div>
          ))}
          <div className="acts">
            <button
              type="button"
              className="btn go"
              aria-disabled={plan === null || st.busy ? "true" : undefined}
              onClick={() => {
                if (plan === null) {
                  feedback.warn(reason);
                  return;
                }
                void approve(st);
              }}
              data-testid="etkin-approve"
            >
              {st.busy ? <span className="kyuk" aria-hidden="true" /> : <Ico d={D.ok} size={22} />}
              {t("approve")}
            </button>
            {plan === null && pickSlots.length === 0 ? (
              <button type="button" className="btn fix" onClick={() => go(st.fallback)} data-testid="etkin-screen">
                <Ico d={KICON.mFis} size={20} />
                {t("completeOnScreen")}
              </button>
            ) : (
              <button
                type="button"
                className="btn fix"
                onClick={() => {
                  feedback.minor();
                  begin("long");
                }}
                data-testid="etkin-fix"
              >
                <Ico d={D.fix} size={20} />
                {t("fix")}
              </button>
            )}
          </div>
          {plan === null ? <p className="vhint" style={{ margin: 0 }}>{reason}</p> : null}
          <span className="say">
            <i>
              <Ico d={D.mic} size={14} />
            </i>
            {t("sayHint")}
          </span>
        </section>
      </div>
    );
  } else if (st.s === "read") {
    const a = st.a;
    const n = sayi(a.total, locale);
    const title =
      a.icon === "task"
        ? a.title === ""
          ? t("title.myTasks", { n })
          : t("title.tasksOf", { name: a.title, n })
        : a.icon === "loc"
          ? t("title.loc", { code: a.title, n })
          : t("title.item", { name: a.title });
    const color = a.icon === "task" ? "6C4BD8" : a.icon === "loc" ? "3A6A8C" : "2F5DA8";
    const rowView = (r: ReadRow) => {
      if (r.icon === "task") {
        const [kind = "", item = ""] = r.title.split("|");
        const [loc = "", qty = "", status = ""] = r.meta.split("|");
        return {
          title: [t.has(`task.${kind}`) ? t(`task.${kind}`) : kind, item].filter((x) => x !== "").join(" · "),
          meta: [loc, qty === "" ? "" : num(qty), t.has(`status.${status}`) ? t(`status.${status}`) : status].filter((x) => x !== "").join(" · "),
          d: kind === "COUNT" ? D.count : kind === "PICK" ? D.task : D.trans,
          c: kind === "COUNT" ? "2F5DA8" : kind === "PICK" ? "2F7D5B" : "6C4BD8",
        };
      }
      if (r.meta.includes("|")) {
        const [qty = "", unit = "", code = ""] = r.meta.split("|");
        return { title: r.title, meta: `${num(qty)} ${unit} · ${code}`, d: D.item, c: "2F5DA8" };
      }
      return { title: r.title, meta: r.meta, d: r.icon === "loc" ? D.loc : D.person, c: r.icon === "loc" ? "3A6A8C" : "6C4BD8" };
    };
    overlay = (
      <div className="veil" data-testid="etkin-read">
        <section ref={panel} className="card" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
          <div className="ch">
            <span className="ok" style={{ background: dz(color) }}>
              <Ico d={a.icon === "task" ? D.person : a.icon === "loc" ? D.loc : D.item} size={22} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{title}</b>
              <small style={{ color: dz("9FB2C2") }}>{t("readSub")}</small>
            </span>
            <button type="button" className="x" aria-label={t("close")} onClick={close} data-testid="etkin-close">
              <Ico d={D.bad} size={20} />
            </button>
          </div>
          <p className="quote">“{st.text}”</p>
          <div className="res" role="list">
            {a.rows.length === 0 ? (
              <div className="rr" role="listitem">
                <i style={{ background: dz("9FB2C2") }}>
                  <Ico d={D.bad} size={20} />
                </i>
                <span style={{ minWidth: 0 }}>
                  <b>{t(`empty.${a.empty ?? "items"}`)}</b>
                </span>
              </div>
            ) : (
              a.rows.slice(0, 5).map((r, i) => {
                const v = rowView(r);
                return (
                  <div key={`${r.href}-${i}`} className="rr" role="listitem">
                    <i style={{ background: dz(v.c) }}>
                      <Ico d={v.d} size={20} />
                    </i>
                    <span style={{ minWidth: 0 }}>
                      <b>{v.title}</b>
                      <small>{v.meta}</small>
                    </span>
                    <button
                      type="button"
                      className="open"
                      onClick={() => {
                        close();
                        go(r.href);
                      }}
                    >
                      {t("open")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
          {a.total > Math.min(5, a.rows.length) ? (
            <button
              type="button"
              className="vchip"
              onClick={() => {
                close();
                go(a.href);
              }}
            >
              {t("more", { n })}
            </button>
          ) : null}
        </section>
      </div>
    );
  } else if (st.s === "fb") {
    overlay = (
      <div className="veil" role="status" aria-live="assertive" style={{ justifyContent: "center", paddingBottom: 120 }} onClick={close} data-testid="etkin-fb" data-ok={st.ok ? "true" : "false"}>
        <span className={`fb ${st.ok ? "good" : "bad"}`} aria-hidden="true">
          <span className="pl" />
          <span className="pl b" />
          <span className="core">
            <Ico d={st.ok ? D.ok : D.bad} size={40} />
          </span>
        </span>
        <span className="fbt">{st.title}</span>
        <span className="snd">
          <Ico d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" size={16} />
          {st.ok ? t("soundOk") : t("soundErr")}
        </span>
        {!st.ok ? (
          <button
            type="button"
            className="vchip"
            onClick={(e) => {
              e.stopPropagation();
              begin("long");
            }}
            data-testid="etkin-retry"
          >
            <i>
              <Ico d={D.mic} size={16} />
            </i>
            {t("retry")}
          </button>
        ) : null}
      </div>
    );
  }
  return { live, handlers: { onPointerDown, onPointerUp, onPointerCancel, onKeyDown }, overlay };
}

/** Onaylanan plan → MEVCUT sunucu eylemi (idempotency anahtarı kart başına sabit: çift dokunuş tek kayıt). */
async function run(plan: Plan, slug: string, clientKey: string, reason: string) {
  switch (plan.op) {
    case "count":
      return startCountAction({ slug, clientKey, warehouseId: plan.warehouseId, codes: [plan.code], blind: false });
    case "transfer":
      return transferStockAction({ slug, clientKey, sourceLocationId: plan.sourceLocationId, targetLocationId: plan.targetLocationId, itemId: plan.itemId, quantity: plan.quantity, reason });
    case "stockIn":
    case "stockOut":
      return createManualStockAction({
        slug,
        clientKey,
        kind: plan.op === "stockIn" ? "STOCK_IN" : "STOCK_OUT",
        warehouseId: plan.warehouseId,
        itemId: plan.itemId,
        locationId: plan.locationId,
        quantity: plan.quantity,
        reason,
      });
  }
}
