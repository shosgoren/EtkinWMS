"use client";
// T-1090: cari kartı — STANDART §3 kayıt kartı kalıbı (ürün / depo / raf yeri kartıyla aynı parçalar). Veri sunucuda okunur (`getParty`);
// telefon ve e-posta tek dokunuşla arar / yazar. Düzenleme mevcut tam ekran formdadır (`/parties?edit=<id>`).
import { useTranslations } from "next-intl";
import { LICON } from "../../../../design/kalip-icons.ts";
import { SICON } from "../../../../design/standart-icons.ts";
import { KalipEkran } from "../../kalip/ekran.tsx";
import { KalipBilgiIzgara, KalipKartSerit, KalipKayitKart, type KalipBilgi, type KalipEtiket, type StTon } from "../../kalip/kart.tsx";
import type { PartyView } from "../parties-view.tsx";

const KIND_VIS: Readonly<Record<PartyView["kind"], { d: string; ton: StTon }>> = {
  CUSTOMER: { d: LICON.people, ton: "yesil" },
  SUPPLIER: { d: LICON.koli, ton: "mor" },
  BOTH: { d: LICON.transfer, ton: "camgobegi" },
};

/** Güvenlik incelemesi MINOR-1: kayıtlı e-postadaki `?`, `&`, `#` gibi karakterler `mailto:` adresine ek başlık (bcc, body) taşımasın. */
function mailtoHref(email: string): string {
  const at = email.lastIndexOf("@");
  return at <= 0 ? `mailto:${encodeURIComponent(email)}` : `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
}

export function PartyCard({ slug, dark, canEdit, party }: { slug: string; dark: boolean; canEdit: boolean; party: PartyView }) {
  const t = useTranslations("parties");
  const tk = useTranslations("parties.kart");
  const list = `/t/${encodeURIComponent(slug)}/parties`;
  const editHref = `${list}?edit=${encodeURIComponent(party.id)}`;
  const vis = KIND_VIS[party.kind];
  const etiketler: KalipEtiket[] = [
    { metin: party.code, mono: true, testId: "kalip-code" },
    party.archived ? { metin: t(`kind.${party.kind}`) } : { metin: t(`kind.${party.kind}`), ton: "ok" },
    ...(party.archived ? [{ metin: t("archived"), ton: "kirmizi" as const }] : []),
  ];
  const linkStil = { color: "inherit", textDecoration: "underline", overflowWrap: "anywhere", display: "inline-flex", alignItems: "center", minHeight: 44 } as const;
  const bilgiler: KalipBilgi[] = [
    { key: "kind", etiket: t("f.kind"), deger: t(`kind.${party.kind}`), d: vis.d, ton: vis.ton },
    // T-1117 (`0064_party_details`): kısa ad, ilçe ve varsayılan teslimat.
    ...(party.shortName === null ? [] : [{ key: "shortName", etiket: t("f.shortName"), deger: party.shortName, d: SICON.ad, ton: "gri" as const }]),
    ...(party.taxNo === null ? [] : [{ key: "taxNo", etiket: t("f.taxNo"), deger: <span className="mono">{party.taxNo}</span>, d: SICON.bilgi, ton: "lacivert" as const }]),
    ...(party.taxOffice === null ? [] : [{ key: "taxOffice", etiket: t("f.taxOffice"), deger: party.taxOffice, d: SICON.bilgi, ton: "lacivert" as const }]),
    ...(party.phone === null
      ? []
      : [{ key: "phone", etiket: t("f.phone"), deger: <a href={`tel:${party.phone.replace(/[^\d+]/g, "")}`} style={linkStil} aria-label={tk("call", { name: party.name })}>{party.phone}</a>, d: LICON.support, ton: "yesil" as const }]),
    ...(party.email === null
      ? []
      : [{ key: "email", etiket: t("f.email"), deger: <a href={mailtoHref(party.email)} style={linkStil} aria-label={tk("mail", { name: party.name })}>{party.email}</a>, d: LICON.globe, ton: "mavi" as const }]),
    ...(party.city === null ? [] : [{ key: "city", etiket: t("f.city"), deger: party.city, d: LICON.depo, ton: "camgobegi" as const }]),
    ...(party.district === null ? [] : [{ key: "district", etiket: t("f.district"), deger: party.district, d: LICON.depo, ton: "camgobegi" as const }]),
    ...(party.address === null ? [] : [{ key: "address", etiket: t("f.address"), deger: party.address, d: LICON.depo, ton: "gri" as const }]),
    { key: "deliveryMode", etiket: t("f.deliveryMode"), deger: t(`delivery.${party.deliveryMode}`), d: SICON.kamyon, ton: "turuncu" as const },
  ];
  return (
    <KalipEkran
      kind="detay"
      dark={dark}
      title={tk("title")}
      icon={{ d: vis.d, color: "6C4BD8" }}
      heading={false}
      testId="party-detail"
      bar={{
        back: { href: list, aria: tk("back") },
        main: { label: tk("edit"), aria: tk("editAria", { name: party.name }), d: LICON.pencil, href: editHref, disabled: !canEdit, disabledReason: t("readOnlySub"), testId: "party-edit" },
      }}
    >
      <KalipKayitKart
        testId="party-kart"
        serit={<KalipKartSerit etiket={tk("hero")} ad={party.name} d={vis.d} tur={party.archived ? "gri" : vis.ton} etiketler={etiketler} kutular={[]} islemler={[]} islemEtiket={tk("quick")} />}
        ana={<KalipBilgiIzgara baslik={tk("info")} bilgiler={bilgiler} kilitD={SICON.kilit} />}
      />
    </KalipEkran>
  );
}
