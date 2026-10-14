// PWA/sekme simgesi (T-286, T-981): kodla üretilen 512×512 PNG; ikili dosya yok.
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
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

export default function Icon(): ImageResponse {
  return brandIcon(512);
}
