import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { THEME_COOKIE } from "../design/theme.ts";
import { GICON, GirisBaglanti, GirisBant, GirisBaslik, GirisKabuk } from "../giris-ui.tsx";

// Kısa, statik yardım sayfası (T-122 Supervisor eki): üst bardaki "Yardım çağır" bağlantısının hedefi. Sahte işlev yok
// (sohbet/telefon/form yok); yalnızca takılınca ne yapılacağı. Oturum gerekmez.
// T-974 (B-63 grup B): Giris.dc.html `v.auth` kabuğu; her madde ikonlu `.ban` (giriş = kilit, erişim = kullanıcı, kod = e-posta / yöneticine ilet).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("help");
  return { title: t("title") };
}

const ITEMS = [
  ["sign", GICON.lock],
  ["access", GICON.user],
  ["support", GICON.mail],
] as const;

export default async function HelpPage() {
  const t = await getTranslations("help");
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <GirisKabuk dark={dark} testId="help">
      <GirisBaslik title={t("title")} sub={t("intro")} />
      <ul style={{ display: "flex", flexDirection: "column", gap: "10px", margin: 0, padding: 0, listStyle: "none" }}>
        {ITEMS.map(([k, d]) => (
          <li key={k}>
            <GirisBant kind="info" d={d}>
              {t(`items.${k}`)}
            </GirisBant>
          </li>
        ))}
      </ul>
      <GirisBaglanti href="/">{t("back")}</GirisBaglanti>
    </GirisKabuk>
  );
}
