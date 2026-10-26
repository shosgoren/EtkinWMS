// T-1043 (kullanıcı isteği 26 Ekim): iki adımlı doğrulama kurulumunda bilgisayar ekranındaki QR bu adrese gider; telefon kamerasıyla
// okutulunca iPhone'da App Store'a, Android'de Google Play'e yönlenir. Oturum gerekmez; hedefler sabit tablodan (açık yönlendirme yok).
import { dogrulamaUygulamasiMi, magazaAdresi } from "../../../dogrulama-magaza.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ app: string }> }): Promise<Response> {
  const { app } = await params;
  if (!dogrulamaUygulamasiMi(app)) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: magazaAdresi(app, request.headers.get("user-agent") ?? ""), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
