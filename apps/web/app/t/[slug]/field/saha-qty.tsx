"use client";
// T-969: Saha kalıbı (c) "Miktar onayla" BİREBİR — iş kartı (`.job`: ürün kutusu ikonu, ad, kod; okutunca seçildi rozeti `.autosel`),
// büyük sayı (`.qdisp > .qv`, beklenen/kalan satırı), fazlaysa turuncu çerçeve + `.pill.warn`, sayı tuşları (`.kp`, TÜMÜ kısayolu).
// Ana işlem (ONAYLA) ortak alt çubuğun ortasındadır (çağıran verir). Miktar alanı yazılabilir kalır (`inputmode="numeric"`, el terminali
// klavyesi); tuşlar ilk basışta okutulan değeri değiştirir, sonra sona ekler. Sınır ve fazla kabul kuralı sunucu komutundadır; ekran
// yalnız uyarır.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { dz } from "../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../design/saha-icons.ts";
import { Ico, SahaKeypad } from "./saha-shell.tsx";

export interface SahaQtyField {
  readonly label: string;
  readonly value: number;
  readonly onChange: (n: number) => void;
}

export interface SahaQtyProps {
  readonly itemName: string;
  readonly itemSub: string;
  /** Okutulan ürün bu işle eşleşti (kaynak `.autosel`). */
  readonly verified?: string;
  readonly main: SahaQtyField & { readonly unit: string; readonly testId?: string };
  /** İkinci alan (ör. hasarlı adet): açıksa sayı tuşları dokunulan alana yazar. */
  readonly second?: SahaQtyField | null;
  /** Kalan/üst sınır (TÜMÜ ve fazla uyarısı); bilinmiyorsa `null`. */
  readonly max: number | null;
  readonly line: string;
  readonly overText: string;
  readonly compound?: ReactNode;
  /** Sayının yanındaki küçük eylemler (Bir koli daha okut, Hasarlı ekle). */
  readonly side?: ReactNode;
  /** Sayı ile tuşlar arası (ör. kabul rafı seçimi). */
  readonly between?: ReactNode;
  readonly hint?: string;
}

/** Dışarıdan (okutma) gelen değer "taze"dir: ilk tuş onu değiştirir. */
function useFresh(value: number): { fresh: boolean; used: () => void; mark: (n: number) => void } {
  const mine = useRef<number | null>(null);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    if (mine.current !== value) setFresh(true);
  }, [value]);
  return { fresh, used: () => setFresh(false), mark: (n) => (mine.current = n) };
}

export function SahaQty({ itemName, itemSub, verified, main, second, max, line, overText, compound, side, between, hint }: SahaQtyProps) {
  const [target, setTarget] = useState<"main" | "second">("main");
  const active = second !== undefined && second !== null && target === "second" ? second : main;
  const f = useFresh(active.value);
  // İkinci alan açılınca tuşlar ona yazar (yeni açılan alan sorulan alandır).
  const hasSecond = second !== undefined && second !== null;
  useEffect(() => setTarget(hasSecond ? "second" : "main"), [hasSecond]);
  const over = max !== null && main.value > max;
  const field = (fld: SahaQtyField, which: "main" | "second", big: boolean, testId?: string) => (
    <input
      aria-label={fld.label}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      value={String(fld.value)}
      onFocus={() => setTarget(which)}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, "").slice(0, 9);
        const n = d === "" ? 0 : Number(d);
        f.mark(n);
        fld.onChange(n);
      }}
      data-active={target === which ? "true" : "false"}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      style={{ width: `${Math.max(1, String(fld.value).length) + 0.4}ch`, ...(big ? {} : { fontSize: 32 }) }}
    />
  );
  return (
    <>
      <div className="job" data-testid="verify-card">
        <span className="uic" style={{ background: dz("8A5A12") }}>
          <Ico d={SICON.urun} size={22} />
        </span>
        <span style={{ minWidth: 0 }}>
          <b data-testid="verified-item">{itemName}</b>
          <small>{itemSub}</small>
        </span>
        {verified === undefined ? null : (
          <span className="autosel" data-testid="verified-ok">
            {verified}
          </span>
        )}
      </div>
      <div className={`qdisp${over ? " over" : ""}`} aria-live="polite" data-testid="qty-display">
        <span className="qrow">
          <span className="qv">
            {field(main, "main", true, main.testId)}
            <span>{main.unit}</span>
          </span>
          {side === undefined ? null : <span className="qside">{side}</span>}
        </span>
        {second === undefined || second === null ? null : (
          <span className="qv q2">
            <span className="q2l">{second.label}</span>
            {field(second, "second", false)}
          </span>
        )}
        <small>{line}</small>
        {over ? (
          <span className="pill warn" data-testid="qty-over" role="alert">
            <Ico d={SICON.warn} size={14} />
            {overText}
          </span>
        ) : null}
        {compound}
      </div>
      {between}
      {hint === undefined ? null : <div className="qsay">{hint}</div>}
      <SahaKeypad
        value={active.value}
        all={target === "main" ? max : null}
        fresh={f.fresh}
        onUsed={f.used}
        onChange={(n) => {
          f.mark(n);
          active.onChange(n);
        }}
      />
    </>
  );
}
