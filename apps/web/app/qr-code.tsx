"use client";
// QR kodu (T-912): `otpauth://` adresi gibi kısa metinler için istemcide SVG üretir (ağ isteği yok, sır sunucuya gitmez).
// Kütüphane yalnızca bu bileşende kullanılır; üretim başarısızsa alan boş kalır (elle anahtar yolu zaten ekrandadır).
// Renkler kütüphanenin varsayılanıdır (siyah/beyaz; tarayıcı uygulamaları için en güvenlisi) ve SVG'nin içindedir; tema belirteci değildir.
import { useEffect, useState } from "react";
import { toString as qrToString } from "qrcode";

export function QrCode({ value, label, size = 208 }: { value: string; label: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    qrToString(value, { type: "svg", errorCorrectionLevel: "M", margin: 1 })
      .then((s) => {
        if (live) setSvg(s);
      })
      .catch(() => {
        if (live) setSvg(null);
      });
    return () => {
      live = false;
    };
  }, [value]);
  if (svg === null) return null;
  return (
    <div
      role="img"
      aria-label={label}
      data-testid="qr-code"
      style={{ width: size, height: size }}
      className="shrink-0 overflow-hidden rounded-card border-2 border-border p-1 [&>svg]:h-full [&>svg]:w-full"
      // Kütüphanenin ürettiği SVG yalnızca <path>/<rect> içerir; metin kullanıcıdan değil sunucunun verdiği otpauth adresinden gelir.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
