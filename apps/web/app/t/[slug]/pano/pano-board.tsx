// T-422 (I-18): hesap sahibi ve depo yöneticisi ana ekranı. Kabuk Pano.dc.html (`PanoShell`).
// T-1115 (kullanıcı 28 Ekim: onaylı tuval ekranları canlıda olmalı; STANDART §8 adım 3): içerik onaylı tuvale `StandartAnaEkran.dc.html`
// ("1 · Ana ekran") geçti — "Bekleyen işler" üç kutusu (`getBoard` sayıları: bekleyen sipariş, onay bekleyen sayım, kritik stok; uydurma
// yok, G-07) ve "İşler" kutuları (Modüller sayfasının yetki süzgeci; yetkisiz kutu gizli; "Düzenle" ile cihazda sıralanır). Tuvalin
// çizmediği eski Pano bölümleri (raporlar, dikkat isteyenler, satın alma, bekleyen siparişler, devir hızı, planla / ekip şu an, bugün
// depoda, iş halkası, bildirim zili) kalktı; ayrıntıları hedef ekranlardadır (Stok, Sevkiyat, Sayım, Görevler). Selam h1'i ve kurulum
// yolculuğu simgesi (T-1006 / T-1100) kalır.
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { buyukHarf } from "@wms/ui";
import type { Board } from "@wms/domain/operations";
import { PICON } from "../../../design/pano-icons.ts";
import { SICON } from "../../../design/standart-icons.ts";
import { appVersionOf } from "./app-version.ts";
import { PanoShell, type PanoLink } from "./pano-shell.tsx";
import { YolculukKart } from "../yolculuk/yolculuk.tsx";
import type { JourneyData } from "../yolculuk/steps.ts";
import type { KabukMember } from "../kabuk/modules.ts";
import { anaIsAdaylari, anaIsler, bekleyenler, type BekleyenKey } from "./ana-ekran.ts";
import { AnaIsler } from "./ana-isler.tsx";

export type BoardRole = "owner" | "manager";

export interface PanoBoardProps {
  readonly slug: string;
  readonly role: BoardRole;
  readonly board: Board | null;
  readonly userName: string;
  readonly tenantName: string;
  readonly dark: boolean;
  /** Sayım onayı (`document.approve`): sayım kutusu sayım oturumlarını açar. */
  readonly canApprove: boolean;
  readonly canReport: boolean;
  readonly usersManage: boolean;
  readonly settingsManage: boolean;
  /** Modüller sayfasıyla aynı üyelik bilgisi (rol, özel grup yetkileri, görünür ekranlar): İşler kutuları bununla süzülür. */
  readonly member: KabukMember;
  /** T-1006: ilk kurulum yolculuğu (okunamadıysa `null`: kart yok). */
  readonly journey?: JourneyData | null;
}

const BEK_IKON: Readonly<Record<BekleyenKey, string>> = { orders: SICON.kamyon, count: SICON.sayim, critical: SICON.uyari };

export async function PanoBoard(p: PanoBoardProps) {
  const t = await getTranslations("pano");
  const ta = await getTranslations("pano.ana");
  const tg = await getTranslations("home.gv");
  const th = await getTranslations("home");
  const locale = await getLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const base = `/t/${encodeURIComponent(p.slug)}`;
  const b = p.board;
  const firstName = p.userName.trim().split(/\s+/)[0] ?? p.userName;
  // T-1050 (STANDART §1, tuval "Merhaba Evren"): her ana ekranda aynı selam (kokpit ile aynı).
  const greet = th("hello", { name: firstName });
  const owner = p.role === "owner";
  const roleTitle = owner ? t("ownerTitle") : t("managerTitle");
  const where = buyukHarf(b?.warehouseName ?? tg("allWarehouses"), locale);
  const brandSub = `${buyukHarf(p.tenantName, locale)} · ${buyukHarf(roleTitle, locale)}`;
  const ini = buyukHarf(firstName.trim()[0] ?? "?", locale);

  const teamLinks: PanoLink[] = [
    { k: "users", label: t("m.users"), color: "6C4BD8", d: PICON.team, href: p.usersManage ? `${base}/team` : `${base}/members` },
    ...(p.usersManage ? [{ k: "pending", label: t("m.pending"), color: "E56A00", d: PICON.clock, href: `${base}/members/devices` }] : []),
    ...(p.usersManage ? [{ k: "join", label: t("m.join"), color: "2F7D5B", d: PICON.plus, href: `${base}/members/join` }] : []),
    ...(p.usersManage ? [{ k: "groups", label: t("m.groups"), color: "0E7C7B", d: PICON.shieldCheck, href: `${base}/groups` }] : []),
  ];
  const isler = anaIsler(base, p.member);
  // T-1128: Düzenle'de eklenebilir bütün işler (aynı yetki süzgeci; yalnız görünürlük).
  const adaylar = anaIsAdaylari(base, p.member);
  const bek = b === null ? null : bekleyenler(base, b, p.canApprove);

  return (
    <PanoShell
      slug={p.slug}
      dark={p.dark}
      brandSub={brandSub}
      greet={greet}
      team
      me={{ ini, name: p.userName, group: buyukHarf(roleTitle, locale) + (owner ? "" : ` · ${where}`), color: owner ? "172E42" : "0E7C7B" }}
      teamLinks={teamLinks}
      settingsHref={p.settingsManage ? `${base}/settings` : undefined}
      scanHref={`${base}/field`}
      canReport={p.canReport}
      appVersion={appVersionOf()}
    >
      <div className="hello">
        <div className="hl">
          <div style={{ minWidth: 0 }}>
            <h1>{greet}</h1>
          </div>
        </div>
        {/* T-1100: rehber girişi yalnız simge, "Merhaba" satırının sağında; kurulum bitince görünmez. */}
        {p.journey != null && !p.journey.dismissed ? <YolculukKart data={p.journey} dark={p.dark} ikon /> : null}
      </div>

      <div className="stana">
        {/* Bekleyen işler: veri okunamadıysa kutular sayı uydurmadan "veri okunamadı" der (dokunulmaz). */}
        <section className="stana-bek" aria-label={ta("bekleyen")} data-testid="pano-reports">
          {bek === null ? (
            <p className="stbk bos" role="status">{tg("noData")}</p>
          ) : (
            bek.map((x) => (
              <Link key={x.key} href={x.href} className={`stbk stb-${x.key}${x.n > 0 ? " var" : ""}`} data-report={x.key} aria-label={ta(`b.${x.key}.aria`, { n: x.n })}>
                <span className="bki">
                  <svg className="ico" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
                    <path d={BEK_IKON[x.key]} />
                  </svg>
                </span>
                <span className="bkt">
                  <b>{ta(`b.${x.key}.ad`)}</b>
                  <small>{x.key === "orders" && x.n > 0 ? ta("b.orders.eski", { d: x.days }) : ta(`b.${x.key}.alt`)}</small>
                </span>
                <b className="h bkn">{x.n}</b>
              </Link>
            ))
          )}
        </section>
        <AnaIsler slug={p.slug} items={isler} adaylar={adaylar} kaynak={p.journey?.cardSource ?? null} />
      </div>
    </PanoShell>
  );
}
