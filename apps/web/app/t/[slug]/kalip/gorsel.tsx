"use client";
// T-1145 (STANDART §3 üst şerit görseli + §6 büyük görünüm; kaynak `StandartUrunKarti.dc.html` şerit görseli ve "Görsel ekle",
// `StandartGorselBuyuk.dc.html` büyük görünüm): ORTAK kayıt görseli kalıbı. Ürün kartı ilk kullanıcı; cari / depo kartları aynı parçayı alır.
// - Şerit: kapak görseli (yoksa tür simgesi), birden çok görselde oklar + "1 / 3"; dokununca büyük görünüm. Altında "Görsel ekle";
//   dokunmatik cihazda ayrıca "Fotoğraf çek" (`<input capture>`, arka kamera).
// - Büyük görünüm: ortak buzlu perde (`KalipPerdeKatman`) + cam pencere (Esc / perde kapatır, odak içeride, kapanınca açana döner); oklar,
//   ok tuşları ve kaydırma ile geçiş; küçük resimler; Ekle · Kapak yap · Değiştir · Sil + "Kaydedildi".
// - Yetkisiz kullanıcıda işlemler gizlenmez, kilitli düğme (`KalipKilitliDugme`) + neden. Silme onay sormaz: ekran "Geri al" balonu verir
//   (ALTIN-KURAL 10). Ses / balon ekranın işlem sonucundan (`feedback`); burada yalnız küçük işlemler (sessiz).
// - Büyük dosya tarayıcıda küçültülür (en çok 2048 px JPEG; iPhone HEIC de böylece JPEG olur); asıl denetim ve yeniden kodlama sunucuda.
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { feedback } from "@wms/ui";
import { SICON } from "../../../design/standart-icons.ts";
import { Ico } from "./ico.tsx";
import { KalipKilitliDugme } from "./kilitli.tsx";
import { useModalFocus } from "./odak.ts";
import { KalipPerdeKatman } from "./perde.tsx";

export interface KalipGorsel {
  readonly id: string;
  /** Tam görsel adresi (kiracı yetkili uç). */
  readonly src: string;
  /** Küçük resim (`data:` adresi). */
  readonly thumb: string;
  readonly isMain: boolean;
  readonly width: number;
  readonly height: number;
}

export interface KalipGorselYetki {
  /** İşlem yapılabilir (yetkili + kayıt etkin). */
  readonly yazilabilir: boolean;
  /** Yetkisiz: düğmeler kilitli görünür (gizlenmez). */
  readonly kilitli: boolean;
  readonly gerekce: string;
}

export interface KalipGorselIslem {
  /** Dosya ekle; `replaces` verilirse o görselin yerine. Sonuç: başarılı mı. */
  readonly ekle: (file: Blob, replaces?: string) => Promise<boolean>;
  readonly kapak: (id: string) => Promise<boolean>;
  readonly sil: (id: string) => Promise<boolean>;
}

/** Yükleme üst sınırı (sunucuyla aynı: 5 MiB). */
export const GORSEL_YUKLEME_SINIRI = 5 * 1024 * 1024;
const KABUL = "image/jpeg,image/png,image/webp";
const HAZIR = ["image/jpeg", "image/png", "image/webp"];

/** Büyük ya da tarayıcının çözebildiği başka türdeki fotoğrafı (ör. HEIC) en çok 2048 px JPEG'e küçültür; olmazsa dosyanın kendisi. */
export async function gorselHazirla(file: Blob): Promise<Blob> {
  if ((file.size <= 1_500_000 && HAZIR.includes(file.type)) || typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return file;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Yükleme yanıtı (sunucu `addItemImage`). */
export interface GorselYuklemeSonucu {
  readonly imageId: string;
  readonly replacedId: string | null;
  readonly isMain: boolean;
  readonly changed: boolean;
}

/** Görsel baytlarını kiracı uç noktasına gönderir (aynı köken; çerezle oturum). Hata gövdesi sunucunun güvenli hata nesnesidir. */
export async function gorselGonder(url: string, blob: Blob): Promise<{ readonly ok: true; readonly data: GorselYuklemeSonucu } | { readonly ok: false; readonly error: { code: string; detail?: string; requestId?: string } }> {
  try {
    const res = await fetch(url, { method: "POST", body: blob, headers: { "content-type": blob.type === "" ? "application/octet-stream" : blob.type }, credentials: "same-origin" });
    const body = (await res.json().catch(() => null)) as { error?: { code?: unknown; detail?: unknown; requestId?: unknown } } | GorselYuklemeSonucu | null;
    if (!res.ok || body === null || "error" in body) {
      const e = body !== null && "error" in body ? body.error : undefined;
      return {
        ok: false,
        error: {
          code: typeof e?.code === "string" ? e.code : "INTERNAL",
          ...(typeof e?.detail === "string" ? { detail: e.detail } : {}),
          ...(typeof e?.requestId === "string" ? { requestId: e.requestId } : {}),
        },
      };
    }
    return { ok: true, data: body as GorselYuklemeSonucu };
  } catch {
    return { ok: false, error: { code: "INTERNAL" } };
  }
}

function useDokunmatik(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(pointer: coarse)");
    setV(mq.matches);
    const on = (): void => setV(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return v;
}

/** Ekle düğmeleri: "Görsel ekle" (dosya) + dokunmatikte "Fotoğraf çek" (kamera). `replaces` doluysa seçilen dosya o görselin yerine geçer. */
function EkleDugmeleri({ yetki, busy, onFile, sinirda, kucuk, testId }: { yetki: KalipGorselYetki; busy: boolean; onFile: (f: File) => void; sinirda: boolean; kucuk: boolean; testId: string }) {
  const t = useTranslations("kalip.gorsel");
  const dosya = useRef<HTMLInputElement>(null);
  const kamera = useRef<HTMLInputElement>(null);
  const dokunmatik = useDokunmatik();
  const sec = (el: HTMLInputElement | null): void => {
    if (busy) return;
    if (sinirda) {
      feedback.warn(t("limit"));
      return;
    }
    feedback.minor();
    el?.click();
  };
  const al = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f !== undefined) onFile(f);
  };
  return (
    <>
      <input ref={dosya} type="file" accept={KABUL} hidden onChange={al} data-testid={`${testId}-dosya`} />
      <input ref={kamera} type="file" accept="image/*" capture="environment" hidden onChange={al} data-testid={`${testId}-kamera`} />
      <KalipKilitliDugme kilitli={yetki.kilitli} gerekce={yetki.gerekce} className={kucuk ? "stkgekle kucuk" : "stkgekle"} aria-busy={busy || undefined} onClick={() => sec(dosya.current)} data-testid={`${testId}-ekle`}>
        <Ico d={kucuk ? SICON.gArti : SICON.gorselEkle} size={kucuk ? 20 : 16} />
        {kucuk ? t("addShort") : t("add")}
      </KalipKilitliDugme>
      {dokunmatik ? (
        <KalipKilitliDugme kilitli={yetki.kilitli} gerekce={yetki.gerekce} className={kucuk ? "stkgekle kucuk" : "stkgekle"} aria-busy={busy || undefined} onClick={() => sec(kamera.current)} data-testid={`${testId}-foto`}>
          <Ico d={SICON.gorselEkle} size={kucuk ? 20 : 16} />
          {t("photo")}
        </KalipKilitliDugme>
      ) : null}
    </>
  );
}

export interface KalipKartGorselProps {
  readonly ad: string;
  readonly kod: string;
  /** Görsel yokken şeritte görünen tür simgesi. */
  readonly d: string;
  readonly gorseller: readonly KalipGorsel[];
  readonly yetki: KalipGorselYetki;
  readonly islem: KalipGorselIslem;
  /** Büyük görünümün teması (portal kök kabın dışına çizilir). */
  readonly dark: boolean;
  /** Ürün başına görsel sınırı. */
  readonly sinir: number;
}

/** Üst şerit görsel kutusu + "Görsel ekle" + büyük görünüm (pencere). */
export function KalipKartGorsel({ ad, kod, d, gorseller, yetki, islem, dark, sinir }: KalipKartGorselProps) {
  const t = useTranslations("kalip.gorsel");
  const [sira, setSira] = useState(0);
  const [acik, setAcik] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kaydedildi, setKaydedildi] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const n = gorseller.length;
  const i = n === 0 ? 0 : Math.min(sira, n - 1);
  const cur = gorseller[i];
  const git = (yon: -1 | 1): void => {
    if (n < 2) return;
    feedback.minor();
    setSira((x) => (Math.min(x, n - 1) + yon + n) % n);
  };
  const yap = async (f: () => Promise<boolean>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setKaydedildi(false);
    const ok = await f();
    setBusy(false);
    setKaydedildi(ok);
  };
  const dosyaGeldi = (file: File, replaces: string | null): void => {
    if (file.size > GORSEL_YUKLEME_SINIRI * 4) {
      feedback.error(t("tooBig"));
      return;
    }
    void yap(async () => {
      const blob = await gorselHazirla(file);
      if (blob.size > GORSEL_YUKLEME_SINIRI) {
        feedback.error(t("tooBig"));
        return false;
      }
      const ok = await islem.ekle(blob, replaces ?? undefined);
      if (ok && replaces === null) setSira(n);
      return ok;
    });
  };
  const islemVar = yetki.yazilabilir || yetki.kilitli;
  const kutu: ReactNode =
    cur === undefined ? (
      <span className="stkgorsel" aria-hidden="true" data-testid="kart-gorsel-bos">
        <Ico d={d} size={40} />
      </span>
    ) : (
      <span className="stkgkap">
        <button
          type="button"
          className="stkgorsel stkgimg"
          aria-label={t("open", { n })}
          onClick={() => {
            feedback.minor();
            setAcik(true);
          }}
          data-testid="kart-gorsel"
        >
          {/* Kiracı yetkili uç: görsel iyileştirici kullanılmaz (kimlik doğrulamalı, önbellek özel). */}
          <Image src={cur.src} alt={t("alt", { name: ad, i: i + 1 })} width={cur.width} height={cur.height} unoptimized />
          {n > 1 ? <span className="stkgsay mono">{t("count", { i: i + 1, n })}</span> : null}
        </button>
        {n > 1 ? (
          <>
            <button type="button" className="stkgok sol" aria-label={t("prev")} onClick={() => git(-1)}>
              <span>
                <Ico d={SICON.gOnceki} size={14} />
              </span>
            </button>
            <button type="button" className="stkgok sag" aria-label={t("next")} onClick={() => git(1)}>
              <span>
                <Ico d={SICON.chevRight} size={14} />
              </span>
            </button>
          </>
        ) : null}
      </span>
    );
  return (
    <span className="stkgsut">
      {kutu}
      {islemVar ? <EkleDugmeleri yetki={yetki} busy={busy} onFile={(f) => dosyaGeldi(f, null)} sinirda={n >= sinir} kucuk={false} testId="kart-gorsel" /> : null}
      {acik && mounted && cur !== undefined
        ? createPortal(
            <GorselBuyuk
              dark={dark}
              ad={ad}
              kod={kod}
              gorseller={gorseller}
              i={i}
              git={git}
              sec={(x) => {
                feedback.minor();
                setSira(x);
              }}
              onClose={() => setAcik(false)}
              yetki={yetki}
              islemVar={islemVar}
              busy={busy}
              kaydedildi={kaydedildi}
              sinirda={n >= sinir}
              onFile={(f) => dosyaGeldi(f, null)}
              onDegistirFile={(f) => dosyaGeldi(f, cur.id)}
              onKapak={() => void yap(() => islem.kapak(cur.id))}
              onSil={() =>
                void yap(async () => {
                  const ok = await islem.sil(cur.id);
                  if (ok && n === 1) setAcik(false);
                  return ok;
                })
              }
            />,
            document.body,
          )
        : null}
    </span>
  );
}

function GorselBuyuk({
  dark,
  ad,
  kod,
  gorseller,
  i,
  git,
  sec,
  onClose,
  yetki,
  islemVar,
  busy,
  kaydedildi,
  sinirda,
  onFile,
  onKapak,
  onDegistirFile,
  onSil,
}: {
  dark: boolean;
  ad: string;
  kod: string;
  gorseller: readonly KalipGorsel[];
  i: number;
  git: (yon: -1 | 1) => void;
  sec: (i: number) => void;
  onClose: () => void;
  yetki: KalipGorselYetki;
  islemVar: boolean;
  busy: boolean;
  kaydedildi: boolean;
  sinirda: boolean;
  onFile: (f: File) => void;
  onKapak: () => void;
  onDegistirFile: (f: File) => void;
  onSil: () => void;
}) {
  const t = useTranslations("kalip.gorsel");
  const box = useRef<HTMLElement>(null);
  const degistirInput = useRef<HTMLInputElement>(null);
  const dokunus = useRef<number | null>(null);
  useModalFocus(true, box, { onClose, busy });
  const n = gorseller.length;
  const cur = gorseller[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "ArrowLeft") git(-1);
      else if (e.key === "ArrowRight") git(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [git]);
  if (cur === undefined) return null;
  return (
    <div className={dark ? "stkgk dz-dark" : "stkgk"}>
      <KalipPerdeKatman onClose={onClose} label={t("close")} />
      <section ref={box} className="stkgb" role="dialog" aria-modal="true" aria-label={t("title", { name: ad })} tabIndex={-1} data-testid="gorsel-buyuk">
        <div className="stkgbh">
          <span>
            <b className="h">{ad}</b>
            <small className="mono">{t("sub", { code: kod, i: i + 1, n })}</small>
          </span>
          <button type="button" className="stkgbx" aria-label={t("close")} onClick={onClose} data-testid="gorsel-kapat">
            <Ico d={SICON.gKapat} size={26} />
          </button>
        </div>
        <div
          className="stkgbo"
          onTouchStart={(e) => {
            dokunus.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const x0 = dokunus.current;
            const x1 = e.changedTouches[0]?.clientX;
            dokunus.current = null;
            if (x0 === null || x1 === undefined || Math.abs(x1 - x0) < 50) return;
            git(x1 < x0 ? 1 : -1);
          }}
        >
          {n > 1 ? (
            <button type="button" className="stkgba" aria-label={t("prev")} onClick={() => git(-1)}>
              <Ico d={SICON.gOnceki} size={28} />
            </button>
          ) : null}
          <Image src={cur.src} alt={t("alt", { name: ad, i: i + 1 })} width={cur.width} height={cur.height} className="stkgbi" unoptimized data-testid="gorsel-buyuk-img" />
          {n > 1 ? (
            <button type="button" className="stkgba" aria-label={t("next")} onClick={() => git(1)}>
              <Ico d={SICON.chevRight} size={28} />
            </button>
          ) : null}
        </div>
        <div className="stkgbal" role="group" aria-label={t("group")}>
          {gorseller.map((g, k) => (
            <button key={g.id} type="button" className={k === i ? "stkgth on" : "stkgth"} aria-label={k === i ? t("thumbOpen", { i: k + 1 }) : t("thumb", { i: k + 1 })} aria-current={k === i || undefined} onClick={() => sec(k)}>
              <Image src={g.thumb} alt="" width={96} height={72} unoptimized />
              {g.isMain ? (
                <i className="stkgthk" aria-label={t("mainTag")}>
                  <Ico d={SICON.gKapak} size={12} />
                </i>
              ) : null}
            </button>
          ))}
          {islemVar ? (
            <>
              <EkleDugmeleri yetki={yetki} busy={busy} onFile={onFile} sinirda={sinirda} kucuk testId="gorsel-buyuk" />
              <span className="stkgbay" aria-hidden="true" />
              <KalipKilitliDugme
                kilitli={yetki.kilitli}
                gerekce={yetki.gerekce}
                className="stkgbd"
                aria-busy={busy || undefined}
                aria-pressed={cur.isMain}
                onClick={() => {
                  if (busy) return;
                  if (cur.isMain) {
                    feedback.minor();
                    return;
                  }
                  onKapak();
                }}
                data-testid="gorsel-kapak"
              >
                <Ico d={SICON.gKapak} size={18} />
                {cur.isMain ? t("mainTag") : t("main")}
              </KalipKilitliDugme>
              <input
                ref={degistirInput}
                type="file"
                accept={KABUL}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f !== undefined) onDegistirFile(f);
                }}
                data-testid="gorsel-degistir-dosya"
              />
              <KalipKilitliDugme
                kilitli={yetki.kilitli}
                gerekce={yetki.gerekce}
                className="stkgbd"
                aria-busy={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  feedback.minor();
                  degistirInput.current?.click();
                }}
                data-testid="gorsel-degistir"
              >
                <Ico d={SICON.cevrim} size={18} />
                {t("replace")}
              </KalipKilitliDugme>
              <KalipKilitliDugme
                kilitli={yetki.kilitli}
                gerekce={yetki.gerekce}
                className="stkgbd sil"
                aria-busy={busy || undefined}
                onClick={() => {
                  if (busy) return;
                  onSil();
                }}
                data-testid="gorsel-sil"
              >
                <Ico d={SICON.gSil} size={18} />
                {t("remove")}
              </KalipKilitliDugme>
            </>
          ) : null}
          {kaydedildi ? (
            <span role="status" className="stkgbok" data-testid="gorsel-kaydedildi">
              <Ico d={SICON.gTamam} size={16} />
              {t("saved")}
            </span>
          ) : null}
          <span className="stkgbip">{t("hint")}</span>
        </div>
      </section>
    </div>
  );
}

/** Liste "Görsel" sütunu (kaynak `StandartUrunlerListe.dc.html`): kapak küçük resmi + görsel sayısı kadar nokta (ilki koyu); görselsiz
 * satırda aynı hizada "+" kutusu. Salt gösterim (satır bağlantısı kaydı açar). */
export function KalipListeGorsel({ gorsel, etiket }: { gorsel: { readonly thumb: string; readonly count: number } | undefined; etiket: string }) {
  return (
    <span className="ktgor-k" role="img" aria-label={etiket} data-testid={gorsel === undefined ? "liste-gorsel-bos" : "liste-gorsel"}>
      {gorsel === undefined ? (
        <span className="ktgor-b bos">
          <Ico d={SICON.gArti} size={18} />
        </span>
      ) : (
        <span className="ktgor-b">
          <Image src={gorsel.thumb} alt="" width={52} height={40} unoptimized />
        </span>
      )}
      <span className="ktgor-n" aria-hidden="true">
        {gorsel === undefined || gorsel.count < 2 ? null : Array.from({ length: Math.min(gorsel.count, 5) }, (_, k) => <i key={k} className={k === 0 ? "on" : undefined} />)}
      </span>
    </span>
  );
}
