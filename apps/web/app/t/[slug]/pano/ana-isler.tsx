"use client";
// T-1115 (I-18, tuval `StandartAnaEkran.dc.html` "1 · Ana ekran"): "İşler" başlığı + "Düzenle · sürükle bırak" + 4 sütunlu iş kutuları
// (`.job` / `.jic`: renkli ikon kutusu, ad, kısa alt yazı). Kutular sunucuda yetkiyle süzülmüş gelir (`ana-ekran.ts`); burada yalnız sıra.
// Düzenle: kutular sürüklenir (fare) ya da her kutudaki öne / sona oklarıyla taşınır (dokunma, klavye); "Bitti" sırayı cihazda saklar
// (kişisel kolaylık; `kabuk/kisayol.tsx` ile aynı desen — depolama yoksa sıra bu oturumda kalır).
import Link from "next/link";
import { useEffect, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { feedback } from "@wms/ui";
import { SICON } from "../../../design/standart-icons.ts";
import { kaydir, siraUygula, tasi, type AnaIs, type AnaIsKey } from "./ana-sira.ts";

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

export function AnaIsler({ slug, items }: { slug: string; items: readonly AnaIs[] }) {
  const t = useTranslations("pano.ana");
  const keys = items.map((x) => x.key);
  const [order, setOrder] = useState<readonly string[]>(keys);
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const sig = keys.join(",");

  useEffect(() => {
    const visible = sig === "" ? [] : sig.split(",");
    try {
      const raw = window.localStorage.getItem(SIRA_KEY(slug));
      setOrder(siraUygula(visible, raw === null ? null : (JSON.parse(raw) as unknown)));
    } catch {
      /* tarayıcı depolaması yoksa tuval sırası */
      setOrder(visible);
    }
  }, [slug, sig]);

  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setEdit(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);

  if (items.length === 0) return null;

  const bitir = (): void => {
    try {
      window.localStorage.setItem(SIRA_KEY(slug), JSON.stringify(order));
    } catch {
      /* hatırlanamaz; sıra bu oturumda kalır */
    }
    feedback.minor();
    setEdit(false);
  };
  const shown = order.map((k) => items.find((x) => x.key === k)).filter((x) => x !== undefined);
  const onDrop = (e: DragEvent<HTMLElement>, to: number): void => {
    e.preventDefault();
    if (drag !== null) setOrder((o) => tasi(o, drag, to));
    setDrag(null);
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
          const body = (
            <>
              <span className="jic">
                <Ico d={IKON[x.key]} size={26} />
              </span>
              <span className="jt">
                <b>{t(`is.${x.key}.ad`)}</b>
                <small>{t(`is.${x.key}.alt`)}</small>
              </span>
            </>
          );
          if (!edit) {
            return (
              <Link key={x.key} href={x.href} className={`job sta-${x.key}`} data-is={x.key}>
                {body}
              </Link>
            );
          }
          const ad = t(`is.${x.key}.ad`);
          return (
            <div
              key={x.key}
              className={`job sta-${x.key}${drag === x.key ? " tut" : ""}`}
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
                <button type="button" aria-label={t("one", { ad })} disabled={i === 0} onClick={() => setOrder((o) => kaydir(o, x.key, -1))}>
                  <Ico d={SICON.al} size={18} />
                </button>
                <button type="button" aria-label={t("sona", { ad })} disabled={i === shown.length - 1} onClick={() => setOrder((o) => kaydir(o, x.key, 1))}>
                  <Ico d={SICON.gonder} size={18} />
                </button>
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}
