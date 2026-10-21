"use client";
// T-981b: Ayarlar › Bağlantılar — form kalıbı (KalipForm.dc.html sınıfları; tuvalde kaynağı yok, DESIGN-PARITY T-981b). Sekme şeridi
// (Genel · Bağlantılar), 1 · Alan ve 2 · İşlem büyük ikonlu seçim kutuları, boş şablon indirme, Entegrasyonlar (Paraşüt, Logo: YAKINDA
// yer tutucusu — bağlantı, form ya da sahte durum yok; ileride `integrations` ekranına bağlanır). Ana işlem alt cam çubukta: seçime göre
// AKTAR'A GEÇ / GÜNCELLE / İNDİR (seçim tamamlanmadan pasif). İçeri al ve Güncelle mevcut Aktar akışını açar (`/import?tur=&kip=`),
// Dışarı aktar ortak `excelIndir` ile .xlsx indirir. Her dokunuşta ses; sonuç balonu renk + ses.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LICON } from "../../../../design/kalip-icons.ts";
import { KalipBaslik, KalipEkran, tone, useKalipToast } from "../../kalip/ekran.tsx";
import { excelHata, excelIndir } from "../../kalip/excel.tsx";
import { KalipGrup, KalipIzgara, KalipKilit, KalipSabit } from "../../kalip/form.tsx";
import { KalipSecimKutulari, KalipSekme } from "../../kalip/secim.tsx";

type Alan = "items" | "parties" | "warehouses" | "locations" | "stock";
type Islem = "import" | "update" | "export";

const AKTAR: Readonly<Record<Alan, string>> = { items: "urun", parties: "cari", warehouses: "depo", locations: "raf", stock: "acilis" };
const ALAN: Readonly<Record<Alan, { readonly d: string; readonly color: string }>> = {
  items: { d: LICON.box, color: "2F5DA8" },
  parties: { d: LICON.people, color: "6C4BD8" },
  warehouses: { d: LICON.depo, color: "30475A" },
  locations: { d: LICON.raf, color: "0E7C7B" },
  stock: { d: LICON.koli, color: "9A5B2E" },
};
const ISLEM: Readonly<Record<Islem, { readonly d: string; readonly color: string }>> = {
  import: { d: LICON.moveIn, color: "2F7D5B" },
  update: { d: LICON.transfer, color: "2F5DA8" },
  export: { d: LICON.moveOut, color: "0E7C7B" },
};

export function BaglantilarView({ slug, dark, canData, canMaster }: { slug: string; dark: boolean; canData: boolean; canMaster: boolean }) {
  const t = useTranslations("baglantilar");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const [alan, setAlan] = useState<Alan | null>(null);
  const [islem, setIslem] = useState<Islem | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, node: toast } = useKalipToast("form");

  // Depo / raf İÇE aktarma Yönetici işidir (settings.manage); dışarı aktarma aktarım yetkisiyle açık. Açılış stoku güncellenemez (I-04).
  const importLocked = (a: Alan | null): boolean => !canData || ((a === "warehouses" || a === "locations") && !canMaster);
  const islemLocked = (i: Islem, a: Alan | null): boolean => !canData || (i !== "export" && importLocked(a)) || (i === "update" && a === "stock");
  const lockReason = (i: Islem): string => (!canData ? t("lockData") : i === "update" && alan === "stock" ? t("lockStock") : t("lockMaster"));

  const download = async (href: string, template: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const r = await excelIndir(href);
    setBusy(false);
    if (!r.ok) {
      tone("err");
      say("err", t(`err.${excelHata(r.code)}`));
      return;
    }
    tone("ok");
    if (template) say("ok", t("templateDone"));
    else if (r.truncated === true) say("warn", t("doneTruncated", { n: (r.rows ?? 0).toLocaleString("tr-TR") }));
    else if (r.personalOmitted === true) say("info", t("donePersonal", { n: (r.rows ?? 0).toLocaleString("tr-TR") }));
    else say("ok", t("done", { n: (r.rows ?? 0).toLocaleString("tr-TR") }));
  };

  const ready = alan !== null && islem !== null && !islemLocked(islem, alan);
  const run = (): void => {
    // Ana düğme sessiz kalmaz: seçim eksik ya da kilitliyse hata sesi + ne yapılacağını söyleyen balon.
    if (alan === null || islem === null) {
      tone("err");
      say("warn", alan === null ? t("pickArea") : t("pickOp"));
      return;
    }
    if (islemLocked(islem, alan)) {
      tone("err");
      say("warn", lockReason(islem));
      return;
    }
    tone("tap");
    if (islem === "export") {
      void download(`/api/t/${encodeURIComponent(slug)}/export/${alan}`, false);
      return;
    }
    router.push(`${base}/import?tur=${AKTAR[alan]}${islem === "update" ? "&kip=guncelle" : ""}`);
  };
  const mainLabel = islem === "export" ? (busy ? t("main.exporting") : t("main.export")) : islem === "update" ? t("main.update") : t("main.import");

  const alanlar = (["items", "parties", "warehouses", "locations", "stock"] as const).map((a) => ({ id: a, label: t(`alan.${a}`), sub: t(`alanSub.${a}`), d: ALAN[a].d, color: ALAN[a].color }));
  const islemler = (["import", "update", "export"] as const).map((i) => ({ id: i, label: t(`islem.${i}`), sub: t(`islemSub.${i}`), d: ISLEM[i].d, color: ISLEM[i].color, locked: islemLocked(i, alan) }));

  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={t("title")}
      icon={{ d: LICON.excel, color: "2F7D5B" }}
      testId="baglantilar"
      bar={{
        back: { href: `${base}/settings`, aria: t("back"), testId: "kabuk-back" },
        main: { label: mainLabel, aria: ready ? t("mainAria", { alan: t(`alan.${alan ?? "items"}`), islem: t(`islem.${islem ?? "import"}`) }) : t("pickFirst"), d: islem === "export" ? LICON.moveOut : LICON.check, disabled: busy, wait: !ready, onClick: run, testId: "baglantilar-main" },
      }}
      overlays={toast}
    >
      <KalipSekme
        label={t("tabs")}
        color="0E7C7B"
        current="baglantilar"
        items={[
          { id: "genel", label: t("tabGeneral"), d: LICON.gear, href: `${base}/settings` },
          { id: "baglantilar", label: t("tabLinks"), d: LICON.excel, href: `${base}/settings/baglantilar` },
        ]}
      />
      {canData ? null : <KalipKilit title={t("lockTitle")} sub={t("lockSub")} />}
      <KalipBaslik title={t("head")} hint={t("headHint")} />
      <KalipIzgara
        left={
          <KalipGrup title={t("step1")} sub={t("step1Sub")} d={LICON.grid} color="2F5DA8" testId="baglantilar-alan">
            <KalipSecimKutulari
              label={t("step1")}
              items={alanlar}
              value={alan}
              onPick={(id) => {
                const a = id as Alan;
                setAlan(a);
                if (islem !== null && islemLocked(islem, a)) setIslem(null);
              }}
            />
          </KalipGrup>
        }
        right={
          <>
            <KalipGrup title={t("step2")} sub={t("step2Sub")} d={LICON.excel} color="2F7D5B" testId="baglantilar-islem">
              <KalipSecimKutulari
                label={t("step2")}
                items={islemler}
                value={islem}
                onPick={(id) => setIslem(id as Islem)}
                onLocked={(id) => say("warn", lockReason(id as Islem))}
              />
              <small className="sxn">{alan === null ? t("pickArea") : islem === null ? t("pickOp") : t(`hint.${islem}`)}</small>
            </KalipGrup>
            <KalipGrup title={t("template")} sub={t("templateSub")} d={LICON.clip} color="B07D0B" testId="baglantilar-sablon">
              <button
                type="button"
                className="btn n"
                disabled={busy}
                aria-disabled={alan === null || !canData || undefined}
                onClick={() => {
                  if (alan === null || !canData) {
                    tone("err");
                    say("warn", alan === null ? t("pickArea") : t("lockData"));
                    return;
                  }
                  tone("tap");
                  void download(`/api/t/${encodeURIComponent(slug)}/export/${alan}?template=1`, true);
                }}
                data-testid="baglantilar-template"
              >
                {alan === null ? t("templatePick") : t("templateBtn", { alan: t(`alan.${alan}`) })}
              </button>
            </KalipGrup>
          </>
        }
      />
      <KalipBaslik title={t("integrations")} hint={t("integrationsHint")} />
      <KalipGrup title={t("integrations")} sub={t("integrationsSub")} d={LICON.transfer} color="6C4BD8" testId="baglantilar-entegrasyon">
        {/* Yer tutucu: gerçek bağlantı ayrı iş (Paraşüt, Logo). Dokunulmaz satır + YAKINDA hapı; ileride `integrations` ekranına bağlantı olur. */}
        <KalipSabit title={t("parasut")} d={LICON.workspace} color="0F6E8C" pill={{ label: t("soon"), ok: false }} aria={t("soonAria", { name: t("parasut") })} testId="entegrasyon-parasut" />
        <KalipSabit title={t("logo")} d={LICON.workspace} color="E56A00" pill={{ label: t("soon"), ok: false }} aria={t("soonAria", { name: t("logo") })} testId="entegrasyon-logo" />
      </KalipGrup>
    </KalipEkran>
  );
}
