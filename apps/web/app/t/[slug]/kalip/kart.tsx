"use client";
// T-1049 (STANDART.md §3, kaynak `docs/design/source/StandartUrunKarti.dc.html`): KAYIT KARTI kalıbı — tek büyük panel; üst şerit
// (tür renginde tonlu zemin: görsel kutusu, ad + etiketler, sayı kutuları, hızlı işlemler), alt çizgili renkli simgeli sekmeler, sekme
// gövdesi. Ürün kartı ilk kullanıcı; cari, depo, raf yeri ve belge kartları aynı parçalarla yazılır. Görünüm `design/standart.css`
// (`.stk*`). Renkler ton adıyla (`StTon` → `--color-st-k-*` belirteci); satır içi onaltılık renk yok.
import Link from "next/link";
import { useLocale } from "next-intl";
import { buyukHarf } from "@wms/ui";
import type { ReactNode } from "react";
import { Ico } from "./ekran.tsx";

/** Kaynak renkleri (tuvaldeki ton adları); CSS `.stt-<ton>` sınıfı `--k` değişkenini verir. */
export type StTon = "mavi" | "stok" | "yesil" | "ok" | "amber" | "lacivert" | "mor" | "camgobegi" | "gri" | "kahve" | "turuncu" | "kirmizi";

const ton = (t: StTon): string => `stt-${t}`;

export interface KalipEtiket {
  readonly metin: string;
  /** Renkli etiket (ör. durum); yoksa gri. */
  readonly ton?: "ok" | "kirmizi" | "amber";
  readonly mono?: boolean;
  readonly testId?: string;
  /** Kaydın canlı durumu (ör. belge Taslak → Onaylı): ekran okuyucuya değişince bildirilir (`role="status"`). */
  readonly durum?: boolean;
}

export interface KalipSayiKutusu {
  readonly key: string;
  readonly etiket: string;
  readonly deger: string;
  readonly d: string;
  readonly ton: StTon;
  readonly testId?: string;
}

export interface KalipKartIslem {
  readonly key: string;
  readonly etiket: string;
  readonly d: string;
  readonly ton: StTon;
  /** Bağlantı (`href`) ya da aynı ekranda işlem (`onClick`; ör. raf yeri oluşturucu). */
  readonly href?: string;
  readonly onClick?: () => void;
  readonly testId?: string;
}

/** Kaynak üst şerit. `ad` sayfanın birinci düzey başlığıdır (üst çubukta ekran adı yazar). */
export function KalipKartSerit({
  etiket,
  ad,
  d,
  tur,
  etiketler,
  kutular,
  islemler,
  islemEtiket,
  children,
}: {
  etiket: string;
  ad: string;
  d: string;
  tur: StTon;
  etiketler: readonly KalipEtiket[];
  kutular: readonly KalipSayiKutusu[];
  islemler: readonly KalipKartIslem[];
  islemEtiket: string;
  children?: ReactNode;
}) {
  return (
    <section className={`stkserit ${ton(tur)}`} aria-label={etiket}>
      <span className="stkgorsel" aria-hidden="true">
        <Ico d={d} size={40} />
      </span>
      <span className="stkad">
        <b role="heading" aria-level={1}>
          {ad}
        </b>
        <span className="stketk">
          {etiketler.map((e) => (
            <span key={e.metin} className={`stktag${e.mono === true ? " mono" : ""}${e.ton === undefined ? "" : ` ${e.ton}`}`} data-testid={e.testId} role={e.durum === true ? "status" : undefined}>
              {e.metin}
            </span>
          ))}
        </span>
        {children}
      </span>
      {kutular.length === 0 ? null : (
        <span className="stkkutular">
          {kutular.map((k) => (
            <span key={k.key} className={`stkkutu ${ton(k.ton)}`} data-testid={k.testId}>
              <small>
                <Ico d={k.d} size={15} />
                {k.etiket}
              </small>
              <b>{k.deger}</b>
            </span>
          ))}
        </span>
      )}
      {islemler.length === 0 ? null : (
        <span className="stkislem" role="group" aria-label={islemEtiket}>
          {islemler.map((i) =>
            i.href === undefined ? (
              <button key={i.key} type="button" onClick={i.onClick} className={`stkqb ${ton(i.ton)}`} data-testid={i.testId}>
                <Ico d={i.d} size={20} />
                {i.etiket}
              </button>
            ) : (
              <Link key={i.key} href={i.href} prefetch={false} className={`stkqb ${ton(i.ton)}`} data-testid={i.testId}>
                <Ico d={i.d} size={20} />
                {i.etiket}
              </Link>
            ),
          )}
        </span>
      )}
    </section>
  );
}

export interface KalipKartSekmesi {
  readonly id: string;
  readonly etiket: string;
  readonly d: string;
  readonly ton: StTon;
}

/** Kaynak `.ut` alt çizgili sekmeler; seçim aynı sayfada adres (`?sekme=`) değişimidir. */
export function KalipKartSekmeler({ etiket, sekmeler, secili, href }: { etiket: string; sekmeler: readonly KalipKartSekmesi[]; secili: string; href: (id: string) => string }) {
  return (
    <nav className="stksekme" aria-label={etiket}>
      {sekmeler.map((s) => (
        <Link key={s.id} href={href(s.id)} replace scroll={false} prefetch={false} className={s.id === secili ? "on" : undefined} aria-current={s.id === secili ? "page" : undefined} data-testid={`kart-sekme-${s.id}`}>
          <span className={ton(s.ton)}>
            <Ico d={s.d} size={16} />
          </span>
          {s.etiket}
        </Link>
      ))}
    </nav>
  );
}

/** Kayıt kartı paneli: şerit + sekmeler + gövde (`ana` sol 2/3, `yan` sağ 1/3; telefonda alt alta). */
export function KalipKayitKart({ serit, sekmeler = null, ana, yan, testId }: { serit: ReactNode; sekmeler?: ReactNode; ana: ReactNode; yan?: ReactNode; testId?: string }) {
  return (
    <section className="stkart" data-testid={testId}>
      {serit}
      {sekmeler}
      <div className={`stkgovde${yan === undefined ? " tek" : ""}`}>
        <div className="stkana">{ana}</div>
        {yan === undefined ? null : <aside className="stkyan">{yan}</aside>}
      </div>
    </section>
  );
}

export interface KalipBilgi {
  readonly key: string;
  readonly etiket: string;
  readonly deger: ReactNode;
  readonly d: string;
  readonly ton: StTon;
  /** Değiştirilemeyen alan (dış sistem / kullanımda): kilit simgesi + neden (ekran okuyucu ve üstüne gelince). */
  readonly kilit?: string;
  /** Kutucuk içi işlem (ör. kodu değiştir). */
  readonly islem?: ReactNode;
}

/** Kaynak `.dl` simgeli bilgi kutucukları (masaüstü 3 sütun). */
export function KalipBilgiIzgara({ baslik, bilgiler, kilitD }: { baslik: string; bilgiler: readonly KalipBilgi[]; kilitD: string }) {
  return (
    <>
      <b className="stkbas">{baslik}</b>
      <div className="stkdl">
        {bilgiler.map((b) => (
          <span key={b.key} data-testid={`kart-bilgi-${b.key}`}>
            <small>
              <i className={ton(b.ton)} aria-hidden="true">
                <Ico d={b.d} size={13} />
              </i>
              {b.etiket}
            </small>
            <b>
              <span>{b.deger}</span>
              {b.kilit === undefined ? null : (
                <span className="stkkilit" title={b.kilit}>
                  <Ico d={kilitD} size={15} />
                  <span className="sr">{b.kilit}</span>
                </span>
              )}
              {b.islem}
            </b>
          </span>
        ))}
      </div>
    </>
  );
}

export interface KalipHareket {
  readonly key: string;
  readonly baslik: string;
  readonly no: string | null;
  readonly meta: string;
  readonly miktar: string;
  /** Miktar hapı: giriş yeşil, çıkış kırmızı, yer değişimi mor. */
  readonly yon: "giris" | "cikis" | "yer";
  readonly d: string;
  readonly ton: StTon;
  readonly kisi: string | null;
  readonly href: string;
  readonly aria: string;
}

/** Kaynak sağ sütun "Son hareketler" zaman çizgisi: her satır o işlemi açar. */
export function KalipSonHareketler({ baslik, tumu, bos, hareketler, kisiEtiket }: { baslik: string; tumu: { readonly href: string; readonly etiket: string }; bos: string; hareketler: readonly KalipHareket[]; kisiEtiket: string }) {
  const locale = useLocale();
  return (
    <>
      <div className="stkyanbas">
        <b className="stkbas">{baslik}</b>
        <Link href={tumu.href} prefetch={false}>
          {tumu.etiket}
        </Link>
      </div>
      {hareketler.length === 0 ? (
        <small className="stkbos">{bos}</small>
      ) : (
        <ol className="stkzaman">
          {hareketler.map((h) => (
            <li key={h.key} data-testid="kalip-event">
              <Link href={h.href} prefetch={false} aria-label={h.aria}>
                <span className={`stkev ${ton(h.ton)}`}>
                  <Ico d={h.d} size={18} />
                </span>
                <span className="stkevx">
                  <b>{h.baslik}</b>
                  <small>
                    {h.no === null ? null : <span className="mono">{h.no}</span>}
                    {h.no === null || h.meta === "" ? null : " · "}
                    {h.meta}
                  </small>
                </span>
                <span className={`stkq ${h.yon}`}>{h.miktar}</span>
                {h.kisi === null ? null : (
                  <span className="stkkisi" title={kisiEtiket}>
                    {buyukHarf(h.kisi.slice(0, 1), locale)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
