"use client";
// T-1116 (STANDART §3 "Stok ve yer", kaynak `docs/design/source/StandartUrunKartiStok.dc.html`): KATLANIR PIVOT kalıbı — üstte
// "Grupla:" seviye çipleri + Hepsini aç / Hepsini kapat, ortada kendi içinde kayan tablo (sütun başlığı sabit; ad · SKT · durum ·
// miktar), altta sabit toplam şeridi. Her seviye satırı simgeli (tür → renk), çocuğu olan satır dokununca açılır/kapanır
// (`aria-expanded`). Gruplama saf yardımcıdadır (`pivot.ts`); ekran yalnız girdileri, tür simgelerini ve metinleri verir. Görünüm
// `design/standart.css` (`.stpv*`). Ürün kartı ilk kullanıcı; depo / raf yeri kartları aynı parçayla yazılır.
// Bilinçli fark (rapor): tuvaldeki sürükleyerek sıra değiştirme, "+ Seri" ve "Tam ekran" bu işte yok; seviye çipleri sabit sırayı gösterir.
import { useState } from "react";
import type { CSSProperties } from "react";
import { feedback } from "@wms/ui";
import { SICON } from "../../../design/standart-icons.ts";
import { Ico } from "./ekran.tsx";
import type { StTon } from "./kart.tsx";
import { acilabilirler, altSayilari, gorunurSatirlar, type PivotDugum } from "./pivot.ts";

export interface KalipPivotTur {
  readonly d: string;
  readonly ton: StTon;
}

export interface KalipPivotDurum {
  readonly metin: string;
  readonly ton: "ok" | "amber" | "kirmizi";
}

export interface KalipPivotProps {
  readonly etiket: string;
  /** İlk sütun başlığı (ör. "Depo › Raf yeri › Lot › Paket"). */
  readonly baslik: string;
  readonly sutunlar: { readonly skt: string; readonly durum: string; readonly miktar: string };
  readonly kokler: readonly PivotDugum[];
  readonly turler: Readonly<Record<string, KalipPivotTur>>;
  /** Satır altı küçük yazı (ör. "4 raf yeri · 2 lot"); `alt` = düğümün altındaki tür başına sayı. */
  readonly meta: (d: PivotDugum, alt: ReadonlyMap<string, number>) => string | null;
  readonly durum: (kod: string) => KalipPivotDurum;
  /** Yaprakta ayrılmış miktar hapı metni (ayrılmış 0 ise çizilmez). */
  readonly ayrilmis: (miktar: string) => string;
  readonly miktar: (q: string) => string;
  readonly skt: (gun: string) => string;
  readonly grupla: { readonly etiket: string; readonly seviyeler: readonly { readonly tur: string; readonly etiket: string }[] };
  readonly ac: string;
  readonly kapat: string;
  readonly toplam: { readonly etiket: string; readonly ozet: string; readonly miktar: string };
  readonly testId?: string;
}

const sifirMi = (v: string): boolean => /^-?0*(\.0*)?$/.test(v.trim());

export function KalipPivot(p: KalipPivotProps) {
  const [acik, setAcik] = useState<ReadonlySet<string>>(() => new Set(acilabilirler(p.kokler)));
  const satirlar = gorunurSatirlar(p.kokler, acik);
  const degistir = (k: string): void => {
    feedback.minor();
    setAcik((cur) => {
      const n = new Set(cur);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  const hepsi = (ac: boolean): void => {
    feedback.minor();
    setAcik(ac ? new Set(acilabilirler(p.kokler)) : new Set());
  };
  return (
    <div className="stpv" data-testid={p.testId}>
      <div className="stpv-arac">
        <span className="stpv-grup" role="group" aria-label={p.grupla.etiket}>
          <b aria-hidden="true">{p.grupla.etiket}:</b>
          {p.grupla.seviyeler.map((s, i) => (
            <span key={s.tur} className="stpv-cip">
              {i === 0 ? null : <Ico d={SICON.chevRight} size={14} />}
              <span>{s.etiket}</span>
            </span>
          ))}
        </span>
        <span className="stpv-bosluk" />
        <button type="button" className="stpv-dugme" onClick={() => hepsi(true)} data-testid="pivot-ac">
          {p.ac}
        </button>
        <button type="button" className="stpv-dugme" onClick={() => hepsi(false)} data-testid="pivot-kapat">
          {p.kapat}
        </button>
      </div>
      <div className="stpv-tablo">
        <table aria-label={p.etiket}>
          <thead>
            <tr>
              <th scope="col">{p.baslik}</th>
              <th scope="col" className="stpv-genis">{p.sutunlar.skt}</th>
              <th scope="col" className="stpv-genis">{p.sutunlar.durum}</th>
              <th scope="col" className="stpv-sag">{p.sutunlar.miktar}</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((d) => {
              const tur = p.turler[d.tur] ?? { d: SICON.kutu, ton: "gri" as const };
              const meta = p.meta(d, altSayilari(d));
              const cocuklu = d.cocuklar.length > 0;
              const acikMi = acik.has(d.anahtar);
              const durumlar = d.durumlar.map(p.durum);
              const ayr = sifirMi(d.ayrilmis) ? null : p.ayrilmis(d.ayrilmis);
              const ayrYaprak = cocuklu ? null : ayr;
              const ad = (
                <>
                  <span className="stpv-ok" aria-hidden="true">
                    {cocuklu ? <Ico d={acikMi ? SICON.chevOpen : SICON.chevRight} size={16} /> : null}
                  </span>
                  <i className={`stt-${tur.ton}`} aria-hidden="true">
                    <Ico d={tur.d} size={14} />
                  </i>
                  <span className="stpv-ad">
                    <b>{d.etiket}</b>
                    {meta === null ? null : <small>{meta}</small>}
                    {/* Telefonda SKT / Durum sütunları gizlidir: SKT, durum ve ayrılmış hapı satır altına iner (Codex P2). */}
                    {d.skt === null && durumlar.length === 0 && ayrYaprak === null ? null : (
                      <small className="stpv-dar">
                        {d.skt === null ? null : <span>{`${p.sutunlar.skt} ${p.skt(d.skt)}`}</span>}
                        {durumlar.map((x) => (
                          <span key={x.metin} className={`stpv-hap ${x.ton}`}>
                            {x.metin}
                          </span>
                        ))}
                        {ayrYaprak === null ? null : <span className="stpv-hap amber">{ayrYaprak}</span>}
                      </small>
                    )}
                  </span>
                </>
              );
              return (
                <tr key={d.anahtar} className={d.derinlik === 0 ? "kok" : undefined} style={{ "--d": d.derinlik } as CSSProperties} data-testid="pivot-satir" data-tur={d.tur}>
                  <td>
                    {cocuklu ? (
                      <button type="button" className="stpv-satir" aria-expanded={acikMi} onClick={() => degistir(d.anahtar)}>
                        {ad}
                      </button>
                    ) : (
                      <span className="stpv-satir">{ad}</span>
                    )}
                  </td>
                  <td className="stpv-genis">{d.skt === null ? null : `${p.sutunlar.skt} ${p.skt(d.skt)}`}</td>
                  <td className="stpv-genis">
                    {durumlar.map((x) => (
                      <span key={x.metin} className={`stpv-hap ${x.ton}`}>
                        {x.metin}
                      </span>
                    ))}
                    {ayrYaprak === null ? null : <span className="stpv-hap amber">{ayrYaprak}</span>}
                  </td>
                  <td className="stpv-sag">
                    <b className="mono">{p.miktar(d.miktar)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="stpv-toplam" data-testid="pivot-toplam">
        <b>{p.toplam.etiket}</b>
        <span>{p.toplam.ozet}</span>
        <span className="stpv-bosluk" />
        <b className="mono">{p.toplam.miktar}</b>
      </div>
    </div>
  );
}
