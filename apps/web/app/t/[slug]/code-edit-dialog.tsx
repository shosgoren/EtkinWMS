"use client";
// Kodu değiştir penceresi (T-257): ürün, depo ve lokasyon ekranlarının ortak parçası. Kod normalleştirmesi, benzersizlik ve yetki
// SUNUCUDADIR (T-251 domain komutları); burada yeniden yazılmaz. İstemci yalnızca boş/aynı değeri göndermez (kısa yol, kural değil).
// Tek ekran (T-250 deseni): başlık sabit, eylem çubuğu altta sabit; eski → yeni önizlemesi ve "geçmiş hareketler etkilenmez" açıklaması
// her zaman görünür. Onay ek bir soru değildir (N-03): değişiklik geri alınabilir, bu yüzden sonuç bildiriminde "Geri al" düğmesi vardır.
// Sunucu hatası pencerede kalır, yazılan değer korunur (çağıranın `renderError` bileşeni neden + sonraki eylemi gösterir).
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Banner, Button } from "@wms/ui";
import { LICON } from "../../design/kalip-icons.ts";
import { Sheet } from "./easy-setup/sheet.tsx";
import { KalipPencereAlan, KalipPencereDugme, KalipPencereMetin } from "./kalip/pencere.tsx";

/** Sunucu eylem hatası (`ActionResult.error`): yalnızca kod + ayrıntı + istek kimliği. */
export interface CodeEditError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

export type CodeEditResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly error: CodeEditError };

export function CodeEditDialog({
  open,
  subject,
  current,
  titleId,
  onClose,
  onDone,
  submit,
  renderError,
}: {
  open: boolean;
  /** Kartın adı (başlıkta gösterilir). */
  subject: string;
  /** Şimdiki kod (sunucunun döndürdüğü hâliyle). */
  current: string;
  titleId: string;
  onClose: () => void;
  onDone: (result: { readonly from: string; readonly to: string; readonly changed: boolean }) => void;
  submit: (code: string) => Promise<CodeEditResult>;
  renderError: (error: CodeEditError) => ReactNode;
}) {
  const t = useTranslations("codeEdit");
  const [code, setCode] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CodeEditError | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(current);
    setError(null);
    setBusy(false);
    // Her açılışta şimdiki kodla başlar; açıkken `current` değişse de yazılan korunur.
  }, [open]);

  const next = code.trim();
  const unchanged = next === "" || next === current;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unchanged || busy) return;
    setBusy(true);
    setError(null);
    const res = await submit(next);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone({ from: current, to: next, changed: res.changed });
  }

  return (
    <Sheet
      open={open}
      title={t("title")}
      titleId={titleId}
      icon={{ d: LICON.pencil, color: "2F5DA8" }}
      busy={busy}
      onClose={onClose}
      onSubmit={(e) => void onSubmit(e)}
      footer={
        <>
          <KalipPencereDugme kind="cancel" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </KalipPencereDugme>
          <KalipPencereDugme type="submit" loading={busy} disabled={unchanged}>
            {t("submit")}
          </KalipPencereDugme>
        </>
      }
    >
      <KalipPencereMetin strong>{subject}</KalipPencereMetin>
      <KalipPencereMetin>{t("current", { code: current })}</KalipPencereMetin>
      <KalipPencereAlan
        label={t("newCode")}
        hint={t("newCodeHint")}
        name="newCode"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        required
        maxLength={512}
      />
      <KalipPencereMetin mono live testId="code-edit-preview">
        {unchanged ? t("previewSame") : t("preview", { from: current, to: next })}
      </KalipPencereMetin>
      <KalipPencereMetin>{t("history")}</KalipPencereMetin>
      {error ? renderError(error) : null}
    </Sheet>
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
