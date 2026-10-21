"use client";
// Tenant alanı hata sınırı (T-119 MINOR-1; T-979 giriş tasarım dilinde, `giris-ui.tsx`). Sunucu bileşeni hataları istemciye yalnızca genel
// mesaj + `digest` olarak gelir (üretimde ham mesaj/yığın maskelenir); hata KODU buraya taşınmaz. Askıda/kapanan tenant `layout.tsx`'te
// kodla yakalanıp durum olarak gösterilir; burası beklenmeyen hatalar içindir: ham mesaj/yığın gösterilmez, yalnızca genel neden + sonraki
// eylem ve (varsa) destek kodu. Tema çerezi istemcide okunur (hata sınırı sunucu verisi almaz).
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GirisBant, GirisBaslik, GirisEylem, GirisKabuk } from "../../giris-ui.tsx";
import { THEME_COOKIE } from "../../design/theme.ts";

export default function TenantError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("members.errors");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.cookie.split("; ").includes(`${THEME_COOKIE}=koyu`));
  }, []);
  return (
    <GirisKabuk dark={dark} testId="tenant-error">
      <GirisBaslik title={t("boundaryTitle")} />
      <GirisBant kind="err">
        {t("internal")} {t("internalAction")}
        {error.digest ? <small style={{ display: "block", wordBreak: "break-all" }}>{t("supportCode", { code: error.digest })}</small> : null}
      </GirisBant>
      <GirisEylem type="button" label={t("retry")} onClick={() => retry()} />
    </GirisKabuk>
  );
}
