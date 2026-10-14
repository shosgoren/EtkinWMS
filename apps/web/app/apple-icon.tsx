// iPhone ana ekran simgesi (T-286, T-981): iOS yalnızca PNG alır; 180×180, kodla üretilir (icon.tsx ile aynı çizim; route dosyası başka dışa aktarım taşımaz).
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// T-981: "Rota e" marka işareti (satış sitesiyle aynı); lacivert zemin, beyaz e, sarı nokta. İçerik orta %60'ta (maskable güvenli alan).
function brandIcon(px: number): ImageResponse {
  const e = px * 0.62;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#172e42" }}>
        <svg width={e} height={e} viewBox="16 16 88 88">
          <path d="M32 62H88A28 28 0 1 0 80 82" fill="none" stroke="#ffffff" strokeWidth="13" strokeLinecap="round" />
          <circle cx="80" cy="82" r="12" fill="#f2c53d" stroke="#172e42" strokeWidth="4" />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}

export default function AppleIcon(): ImageResponse {
  return brandIcon(180);
}
