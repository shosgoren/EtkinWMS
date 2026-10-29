"use client";
// T-1115 (I-18, tuval `StandartAnaEkran.dc.html` "1 · Ana ekran"): "İşler" başlığı + "Düzenle · sürükle bırak" + 4 sütunlu iş kutuları
// (`.job` / `.jic`: renkli ikon kutusu, ad, kısa alt yazı). Kutular sunucuda yetkiyle süzülmüş gelir (`ana-ekran.ts`).
// Düzenle: kutular sürüklenir (fare) ya da her kutudaki öne / sona oklarıyla taşınır (dokunma, klavye); "Bitti" seçimi cihazda saklar
// (kişisel kolaylık; `kabuk/kisayol.tsx` ile aynı desen — depolama yoksa seçim bu oturumda kalır).
// T-1128 (kullanıcı 29 Ekim: "Düzenle kısmında yetkisi olan modülü getiremiyor"): Düzenle'de her kutuda kaldır (✕); sondaki "İş ekle"
// kutusu ortak aramalı seçim sayfasını (`KalipSecimSayfasi`) açar — üyenin açabildiği, ızgarada olmayan bütün işler (tuval kutuları +
// Modüller sayfasındaki modüller; modül kutusu Modüller sayfasının renk, ikon ve adıyla). Denetimler adın altında ayrı satırdadır
// (telefonda ad okunur kalır). Kayıt yoksa tuval varsayılanı; eski kayıt (yalnız sıra) okunur; izni kalmayan kutu sessizce düşer.
import Link from "next/link";
import { useEffect, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { feedback } from "@wms/ui";
import { SICON } from "../../../design/standart-icons.ts";
import { LICON } from "../../../design/kalip-icons.ts";
import { dz as kdz } from "../../../design/kabuk-tokens.ts";
import { KalipSecimSayfasi, type KalipSecimSecenek } from "../kalip/secim.tsx";
import type { KabukModuleId } from "../kabuk/types.ts";
import { cikar, ekle, eklenebilir, kaydir, secimKaydi, secimUygula, tasi, type AnaAday, type AnaIs, type AnaIsKey } from "./ana-sira.ts";

const SIRA_KEY = (slug: string): string => `etkin-ana-isler:${slug}`;

const IKON: Readonly<Record<AnaIsKey, string>> = {
  giris: SICON.indir,
  satis: SICON.kamyon,
  stok: SICON.kutu,
  urun: SICON.kutu,
  cari: SICON.kisiler,
  depo: SICON.raf,
  excel: SICON.belgeOnay,
  kayit: SICON.kalkan,
};

function Ico({ d, size, wide }: { d: string; size: number; wide?: boolean }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} style={wide === true ? { strokeWidth: 3.2 } : undefined} />
    </svg>
  );
}

export function AnaIsler({ slug, items, adaylar }: { slug: string; items: readonly AnaIs[]; adaylar: readonly AnaAday[] }) {
  const t = useTranslations("pano.ana");
  const tk = useTranslations("kabuk");
  const keys = items.map((x) => x.key);
  const izinli = adaylar.map((x) => x.key);
  const [order, setOrder] = useState<readonly string[]>(keys);
  const [edit, setEdit] = useState(false);
  const [pick, setPick] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const sig = `${keys.join(",")}|${izinli.join(",")}`;

  useEffect(() => {
    const [v, a] = sig.split("|");
    const varsayilan = v === undefined || v === "" ? [] : v.split(",");
    const izin = a === undefined || a === "" ? [] : a.split(",");
    try {
      const raw = window.localStorage.getItem(SIRA_KEY(slug));
      setOrder(secimUygula(varsayilan, izin, raw === null ? null : (JSON.parse(raw) as unknown)));
    } catch {
      /* tarayıcı depolaması yoksa tuval varsayılanı */
      setOrder(varsayilan);
    }
  }, [slug, sig]);

  useEffect(() => {
    // Seçim sayfası açıkken Esc yalnız sayfayı kapatır (ortak odak düzeni); Düzenle kipi sürer.
    if (!edit || pick) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setEdit(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit, pick]);

  if (adaylar.length === 0) return null;

  const bul = (k: string): AnaAday | undefined => adaylar.find((x) => x.key === k);
  const ad = (x: AnaAday): string => (x.mod === undefined ? t(`is.${x.key as AnaIsKey}.ad`) : tk(`mod.${x.key as KabukModuleId}.name`));
  const alt = (x: AnaAday): string => (x.mod === undefined ? t(`is.${x.key as AnaIsKey}.alt`) : tk(`mod.${x.key as KabukModuleId}.sub`));
  const ikon = (x: AnaAday): string => x.mod?.d ?? IKON[x.key as AnaIsKey];

  const bitir = (): void => {
    try {
      window.localStorage.setItem(SIRA_KEY(slug), JSON.stringify(secimKaydi(order)));
    } catch {
      /* hatırlanamaz; seçim bu oturumda kalır */
    }
    feedback.ok();
    setEdit(false);
  };
  const shown = order.map(bul).filter((x) => x !== undefined);
  const kalan = eklenebilir(izinli, order)
    .map(bul)
    .filter((x) => x !== undefined);
  const secenekler: KalipSecimSecenek[] = kalan.map((x) => ({
    id: x.key,
    label: ad(x),
    sub: alt(x),
    d: ikon(x),
    // Modül rengi kabuk belirteci (`.dzk` kapsamında tanımlı); tuval kutusu kendi `sta-*` rengiyle.
    ikonKutu: x.mod === undefined ? { sinif: `stak sta-${x.key}` } : { sinif: "dzk", arka: kdz(x.mod.color) },
  }));
  const onDrop = (e: DragEvent<HTMLElement>, to: number): void => {
    e.preventDefault();
    if (drag !== null) setOrder((o) => tasi(o, drag, to));
    setDrag(null);
  };
  const ekleAc = (): void => {
    feedback.minor();
    setEdit(true);
    setPick(true);
  };

  return (
    <>
      <div className="stana-hd">
        <b className="h" id="ana-isler-t">{t("isler")}</b>
        {edit ? (
          <button type="button" className="stana-duz on" onClick={bitir} aria-pressed="true" data-testid="ana-duzenle">
            <Ico d={SICON.onay} size={18} />
            {t("bitti")}
          </button>
        ) : (
          <button
            type="button"
            className="stana-duz"
            onClick={() => {
              feedback.minor();
              setEdit(true);
            }}
            aria-pressed="false"
            data-testid="ana-duzenle"
          >
            <Ico d={SICON.tutamac} size={18} wide />
            {t("duzenle")}
          </button>
        )}
      </div>
      <section className={`stana-is${edit ? " duz" : ""}`} aria-labelledby="ana-isler-t" data-testid="ana-isler">
        {shown.map((x, i) => {
          const adi = ad(x);
          const body = (
            <>
              {x.mod === undefined ? (
                <span className="jic">
                  <Ico d={ikon(x)} size={26} />
                </span>
              ) : (
                // Modül rengi kabuk belirteci (`--color-dz-x-*` yalnız `.dzk` kapsamında tanımlı; kisayol.tsx ile aynı).
                <span className="jic dzk" style={{ background: kdz(x.mod.color) }}>
                  <Ico d={x.mod.d} size={26} />
                </span>
              )}
              <span className="jt">
                <b>{adi}</b>
                <small>{alt(x)}</small>
              </span>
            </>
          );
          const cls = `job${x.mod === undefined ? ` sta-${x.key}` : ""}`;
          if (!edit) {
            return (
              <Link key={x.key} href={x.href} className={cls} data-is={x.key}>
                {body}
              </Link>
            );
          }
          return (
            <div
              key={x.key}
              className={`${cls}${drag === x.key ? " tut" : ""}`}
              data-is={x.key}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDrag(x.key);
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, i)}
            >
              {body}
              <span className="jok">
                <button
                  type="button"
                  className="jx"
                  aria-label={t("cikar", { ad: adi })}
                  onClick={() => {
                    feedback.minor();
                    setOrder((o) => cikar(o, x.key));
                  }}
                  data-testid="ana-cikar"
                >
                  <Ico d={LICON.close} size={18} />
                </button>
                <button type="button" aria-label={t("one", { ad: adi })} disabled={i === 0} onClick={() => setOrder((o) => kaydir(o, x.key, -1))}>
                  <Ico d={SICON.al} size={18} />
                </button>
                <button type="button" aria-label={t("sona", { ad: adi })} disabled={i === shown.length - 1} onClick={() => setOrder((o) => kaydir(o, x.key, 1))}>
                  <Ico d={SICON.gonder} size={18} />
                </button>
              </span>
            </div>
          );
        })}
        {/* "İş ekle": Düzenle'de ızgarada olmayan izinli iş varsa; ızgara boşsa (hepsi çıkarıldı) Düzenle dışında da — boş durumun sıradaki adımı. */}
        {kalan.length > 0 && (edit || shown.length === 0) ? (
          <button type="button" className="job jek" onClick={ekleAc} data-testid="ana-ekle">
            <span className="jic">
              <Ico d={LICON.plus} size={26} />
            </span>
            <span className="jt">
              <b>{t("ekle")}</b>
              <small>{t("ekleAlt", { n: kalan.length })}</small>
            </span>
          </button>
        ) : null}
      </section>
      <KalipSecimSayfasi
        open={pick}
        title={t("ekle")}
        options={secenekler}
        value=""
        onPick={(id) => setOrder((o) => ekle(o, id))}
        onClose={() => setPick(false)}
        icon={{ d: LICON.plus, color: "2F5DA8" }}
        scan={false}
        testId="ana-ekle-secim"
      />
    </>
  );
}
