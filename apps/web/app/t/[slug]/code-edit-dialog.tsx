"use client";
// Kodu değiştir (T-257): ürün, depo ve lokasyon ekranlarının ortak parçası. Kod normalleştirmesi, benzersizlik ve yetki SUNUCUDADIR
// (T-251 domain komutları); burada yeniden yazılmaz. İstemci yalnızca boş/aynı değeri göndermez (kısa yol, kural değil).
// T-990 (B-97): pencere değil TAM EKRAN FORM (`KalipFormEkran`; çağıran ekran adresle açar, ör. `?kod=1` / `?kod=<id>`). Kaydet alt
// çubuğun ana işlemidir ve yalnız yeni kod yazılınca etkindir; eski → yeni önizlemesi ve "geçmiş hareketler etkilenmez" açıklaması
// her zaman görünür. Onay ek bir soru değildir (N-03): değişiklik geri alınabilir, bu yüzden sonuç bildiriminde "Geri al" düğmesi vardır.
// Sunucu reddi (kod zaten var) yeni kod alanının altında; yazılan değer korunur. Yarım işte çıkış ortak cam kutuyu açar.
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Banner, Button } from "@wms/ui";
import { LICON } from "../../design/kalip-icons.ts";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "./kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup } from "./kalip/form.tsx";
import type { AlanKurali } from "./kalip/dogrula.ts";

/** Sunucu eylem hatası (`ActionResult.error`): yalnızca kod + ayrıntı + istek kimliği. */
export interface CodeEditError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

export type CodeEditResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly error: CodeEditError };

/** Alanın altında gösterilecek ret (kod zaten var / belirsiz / geçersiz biçim); diğerleri formun genel nedeni. */
function alanHatasi(e: CodeEditError): boolean {
  return e.code === "VALIDATION_FAILED" && (e.detail === undefined || e.detail === "CODE_TAKEN" || e.detail === "CODE_AMBIGUOUS");
}

/** Tam ekran "Kodu değiştir" formu. */
export function CodeEditForm({
  dark,
  subject,
  current,
  icon = { d: LICON.pencil, color: "2F5DA8" },
  testId = "code-edit-form",
  homeHref,
  onBack,
  onDone,
  submit,
  errorText,
  renderError,
}: {
  dark: boolean;
  /** Kartın adı (başlıkta ve önizlemede). */
  subject: string;
  /** Şimdiki kod (sunucunun döndürdüğü hâliyle). */
  current: string;
  icon?: { readonly d: string; readonly color: string };
  testId?: string;
  homeHref?: string;
  onBack: () => void;
  onDone: (result: { readonly from: string; readonly to: string; readonly changed: boolean }) => void;
  submit: (code: string) => Promise<CodeEditResult>;
  /** Sunucu reddinin tek satırlık nedeni + sonraki eylem ("Bu kod zaten kullanılıyor. Farklı bir kod gir."). */
  errorText: (error: CodeEditError) => string;
  /** Bağlantı gerektiren ret (MFA / yeniden giriş) için ekranın kendi hata bildirimi. */
  renderError?: (error: CodeEditError) => ReactNode;
}) {
  const t = useTranslations("codeEdit");
  const [initial] = useState(() => ({ newCode: current }));
  const [v, setV] = useState(initial);
  const [linkErr, setLinkErr] = useState<CodeEditError | null>(null);
  const done = useRef<{ from: string; to: string; changed: boolean } | null>(null);
  const next = v.newCode.trim();
  const unchanged = next === "" || next === current;
  const rules: AlanKurali[] = [{ name: "newCode", label: t("newCode"), required: true, maxLength: 512 }];

  async function save(): Promise<KaydetSonuc> {
    setLinkErr(null);
    const res = await submit(next);
    if (!res.ok) {
      const text = errorText(res.error);
      if (alanHatasi(res.error)) return { ok: false, alan: { newCode: text } };
      if (res.error.detail === "MFA_REQUIRED" || res.error.detail === "RECENT_AUTH_REQUIRED") setLinkErr(res.error);
      return { ok: false, mesaj: res.error.requestId === undefined ? text : `${text} · ${res.error.requestId}` };
    }
    done.current = { from: current, to: next, changed: res.changed };
    return { ok: true };
  }

  return (
    <KalipFormEkran
      dark={dark}
      title={t("title")}
      icon={icon}
      subtitle={subject}
      testId={testId}
      values={v}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={() => {
        if (done.current !== null) onDone(done.current);
      }}
      onBack={onBack}
      {...(homeHref === undefined ? {} : { homeHref })}
      saveShort={t("saveShort")}
      saveAria={t("submit")}
      leaveText={t("leaveText")}
      leaveSaveLabel={t("leaveSave")}
      preview={<KalipOnizleme name={subject} code={unchanged ? current : next} d={icon.d} color={icon.color} rows={[{ k: t("currentShort"), v: current }]} />}
    >
      <KalipGrup title={subject} d={icon.d} color={icon.color}>
        {/* Telefonda grup alt yazısı (kaynak `.sgh small`) gizli: şimdiki kod her boyutta görünür satırda. */}
        <p className="khint">{t("current", { code: current })}</p>
        <KalipAlan
          label={`${t("newCode")} *`}
          hint={t("newCodeHint")}
          name="newCode"
          value={v.newCode}
          onChange={(e) => setV({ newCode: e.target.value })}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={512}
        />
        <small className="khint" aria-live="polite" data-testid="code-edit-preview">
          <b>{unchanged ? t("previewSame") : t("preview", { from: current, to: next })}</b>
        </small>
        <small className="khint">{t("history")}</small>
        {linkErr !== null && renderError !== undefined ? renderError(linkErr) : null}
      </KalipGrup>
    </KalipFormEkran>
  );
}

/** Başarı bildirimi + "Geri al" (N-03): eski koda dönüş aynı sunucu komutudur; sonucu yine sunucu doğrular. */
export function CodeChangedNotice({
  from,
  to,
  busy,
  onUndo,
}: {
  from: string;
  to: string;
  busy: boolean;
  onUndo: () => void;
}) {
  const t = useTranslations("codeEdit");
  return (
    <Banner kind="info">
      <p className="break-all">{t("done", { from, to })}</p>
      <div className="mt-2">
        <Button variant="secondary" onClick={onUndo} loading={busy}>
          {t("undo", { code: from })}
        </Button>
      </div>
    </Banner>
  );
}
