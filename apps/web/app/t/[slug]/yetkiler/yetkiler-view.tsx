"use client";
// T-1142 (kullanıcı kararı 31 Ekim: "kullanıcı yetkilendirme bölümü pratik ve akıcı olmalı, tüm yetkiler toggle ile ayarlanmalı"): Yetkiler —
// STANDART §5 AYAR KALIBI (tuvalde ayrı çizim yok; en yakın kalıp Ayarlar › Entegrasyonlar'dan türetildi, DESIGN-PARITY T-1142).
// Üstte ayar sekmeleri (Kullanıcılar ve yetki); solda alt bölüm listesi = her özel yetki grubu + "Kişiler"; sağda yalnız seçili bölüm.
// Grup: arama, hazır şablon (tek dokunuş), bölüm × işlem aç/kapa satırları (bölümün "Hepsini aç/kapat"ı). Her dokunuş ANINDA kaydedilir
// (Kaydet düğmesi yok): sunucu küme işlemi (`changeGroupGrantsAction`, idempotent) → balon + ses; hata olursa satır eski hâline döner.
// Kişi: rol ve grup seçimi, her yetkinin kaynağı (rolünden / grubundan / kapalı), rolden fazlası sarı çizgiyle; "Rol varsayılanına dön" tek
// dokunuş (gruptan çıkarır). Kilitli satır gizlenmez: dokununca gerekçe balonu + hata sesi (yalnız hesap sahibi, herkeste açık, yalnız Yönetici,
// saha hesabı + iki adımlı doğrulama). Katalog sunucudan (domain tek kaynağı); bu dosya `@wms/domain` içe aktarmaz (AC-28).
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { feedback, kucukHarf } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { SICON } from "../../../design/standart-icons.ts";
import { KalipAltBolumler, KalipAnahtarKumesi, KalipAyarKart, KalipAyarSatir, KalipYonSecimi, type KalipAltBolum, type KalipYon } from "../kalip/ayar.tsx";
import { Ico, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAlan, KalipAnahtar } from "../kalip/form.tsx";
import type { StTon } from "../kalip/kart.tsx";
import { KalipKilitliDugme, kilitliDokunus } from "../kalip/kilitli.tsx";
import { KalipBos } from "../kalip/liste.tsx";
import { KalipSecim, KalipSecimKutulari, KalipSekme } from "../kalip/secim.tsx";
import { ayarSekmeleri } from "../settings/sekmeler.ts";
import { changeGroupGrantsAction, setMemberGroupAction } from "../groups/actions.ts";
import { changeRoleAction } from "../members/actions.ts";
import { bolumDurumu, eslesenSablon, sablonFarki, yetkiAra, yetkiKaynagi, type YetkiAnahtar, type YetkiBolum, type YetkiKatalog, type YetkiRol, type YetkiSatir } from "./katalog.ts";

export interface YetkiGrup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly grants: readonly string[];
  readonly version: number;
}
export interface YetkiKisi {
  readonly membershipId: string;
  readonly name: string;
  readonly isOwner: boolean;
  readonly isField: boolean;
  readonly role: string;
  readonly groupId: string | null;
}
export interface YetkilerViewProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly katalog: YetkiKatalog;
  /** Adres `?bolum=`: `grup-<id>` ya da `kisiler`. */
  readonly bolum: string | null;
  readonly kisi: string | null;
  readonly data: { readonly canEdit: boolean; readonly groups: readonly YetkiGrup[]; readonly members: readonly YetkiKisi[] };
}

/** Bölüm simgesi ve rengi (STANDART §7 tek eşleme: depo bina, raf yeri raf, entegrasyon Paraşüt turuncusu…). */
const BOLUM: Record<YetkiBolum, { readonly d: string; readonly ton: StTon; readonly color: string }> = {
  items: { d: LICON.box, ton: "mavi", color: "2F5DA8" },
  parties: { d: SICON.kisiler, ton: "yesil", color: "2F7D5B" },
  warehouses: { d: SICON.bina, ton: "lacivert", color: "172E42" },
  locations: { d: SICON.raf, ton: "kahve", color: "B85A14" },
  stock: { d: SICON.barkod, ton: "mor", color: "6C4BD8" },
  documents: { d: SICON.belge, ton: "camgobegi", color: "0E7C7B" },
  excel: { d: LICON.excel, ton: "ok", color: "2F7D5B" },
  reports: { d: SICON.grafik, ton: "turuncu", color: "E56A00" },
  settings: { d: LICON.gear, ton: "gri", color: "4E6476" },
  integrations: { d: SICON.baglanti, ton: "parasut", color: "E56A00" },
};
/** Satır simgesi işlem adından (`<bölüm>.<işlem>`). */
const ISLEM: Record<string, string> = {
  create: LICON.plus,
  edit: LICON.pencil,
  archive: SICON.arsiv,
  post: SICON.barkod,
  countApprove: SICON.sayim,
  reverse: SICON.cevrim,
  approve: SICON.belgeOnay,
  import: LICON.excel,
  stock: SICON.grafik,
  audit: SICON.gecmis,
  takeout: SICON.indir,
  manage: LICON.gear,
  users: SICON.kisiler,
};
const SABLON: Record<string, { readonly d: string; readonly ton: StTon }> = {
  warehouseLead: { d: SICON.bina, ton: "lacivert" },
  picker: { d: SICON.barkod, ton: "yesil" },
  counter: { d: SICON.sayim, ton: "mavi" },
  cardKeeper: { d: LICON.box, ton: "mor" },
  readOnly: { d: SICON.grafik, ton: "gri" },
};
const ROL_RENK: Record<YetkiRol, { readonly color: string; readonly d: string }> = {
  TENANT_ADMIN: { color: "172E42", d: LICON.shield },
  WAREHOUSE_MANAGER: { color: "0E7C7B", d: SICON.bina },
  PICKER: { color: "2F7D5B", d: SICON.barkod },
  COUNTER: { color: "2F5DA8", d: SICON.sayim },
  READ_ONLY: { color: "4E6476", d: SICON.grafik },
};
const ROLLER: readonly YetkiRol[] = ["TENANT_ADMIN", "WAREHOUSE_MANAGER", "PICKER", "COUNTER", "READ_ONLY"];
const hexKey = (c: string): string => c.replace("#", "").toUpperCase();
const islemOf = (r: YetkiSatir): string => r.id.slice(r.section.length + 1);

type Sonuc = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string | undefined } };

export function YetkilerView({ slug, dark, katalog, bolum, kisi, data }: YetkilerViewProps) {
  const t = useTranslations("yetkiler");
  const tb = useTranslations("baglantilar");
  const locale = useLocale(); // ALTIN-KURAL 16: kullanıcının dili (arama küçük harfi)
  const router = useRouter();
  const { say, node: toast } = useKalipToast("form");
  const base = `/t/${encodeURIComponent(slug)}`;
  const [groups, setGroups] = useState(data.groups);
  const [members, setMembers] = useState(data.members);
  const [q, setQ] = useState("");
  // ALTIN-KURAL 6: aynı anda tek kayıt (çift dokunuş iki istek göndermez); sürerken düğmeler meşgul.
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => setGroups(data.groups), [data.groups]);
  useEffect(() => setMembers(data.members), [data.members]);

  const secili = bolum === "kisiler" ? "kisiler" : groups.some((g) => `grup-${g.id}` === bolum) ? (bolum as string) : groups[0] !== undefined ? `grup-${groups[0].id}` : "kisiler";
  const grup = secili.startsWith("grup-") ? groups.find((g) => `grup-${g.id}` === secili) : undefined;
  const rowLabel = (r: YetkiSatir): string => t(`rows.${r.section}.${islemOf(r)}`);
  const bolumLabel = (s: YetkiBolum): string => t(`sections.${s}`);
  const rows = useMemo(
    () => yetkiAra(katalog.rows, q, (r) => `${rowLabel(r)} ${bolumLabel(r.section)}`, (s) => kucukHarf(s, locale)),
    [katalog.rows, q, locale],
  );
  const sections = katalog.sections.filter((s) => rows.some((r) => r.section === s));
  const roleLabel = (r: string): string => (t.has(`role.${r}`) ? t(`role.${r}`) : r);
  const hasField = (gid: string): boolean => members.some((m) => m.groupId === gid && m.isField);

  const items: KalipAltBolum[] = [
    ...groups.map((g) => ({
      id: `grup-${g.id}`,
      label: g.name,
      d: LICON.shield,
      ton: "mor" as StTon,
      href: `${base}/yetkiler?bolum=${encodeURIComponent(`grup-${g.id}`)}`,
    })),
    { id: "kisiler", label: t("people"), d: LICON.people, ton: "mavi", href: `${base}/yetkiler?bolum=kisiler` },
  ];

  function errorText(e: { readonly code: string; readonly detail?: string | undefined }): string {
    if (e.detail === "RECENT_AUTH_REQUIRED") return t("err.reauth");
    if (e.detail === "MFA_REQUIRED") return t("err.mfa");
    if (e.code === "FORBIDDEN") return t("err.forbidden");
    if (e.code === "VALIDATION_FAILED") return t("err.archived");
    return t("err.failed", { code: e.code });
  }

  /** Tek kayıt kapısı: kilitliyse gerekçe, meşgulse bekle balonu; yoksa iş çalışır. */
  async function tekKayit(fn: () => Promise<void>): Promise<void> {
    if (!data.canEdit) {
      kilitliDokunus(t("lock.owner"));
      return;
    }
    if (busy.current) {
      feedback.warn(t("lock.busy"));
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      await fn();
    } catch {
      say("err", t("err.failed", { code: "INTERNAL" }));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /** Grubun yetkilerini aç/kapa: iyimser gösterim, sunucu sonucu ya da geri dönüş. */
  function degistir(g: YetkiGrup, add: readonly YetkiAnahtar[], remove: readonly YetkiAnahtar[], basari: string): void {
    void tekKayit(async () => {
      const before = g.grants;
      const tahmin = before.filter((x) => !remove.includes(x as YetkiAnahtar)).concat(add.filter((x) => !before.includes(x)));
      setGroups((list) => list.map((x) => (x.id === g.id ? { ...x, grants: tahmin } : x)));
      const r = (await changeGroupGrantsAction({ slug, id: g.id, add: [...add], remove: [...remove] })) as Sonuc;
      const geri = (): void => setGroups((list) => list.map((x) => (x.id === g.id ? { ...x, grants: before } : x)));
      if (!r.ok) {
        geri();
        say("err", errorText(r.error));
        return;
      }
      const d = r.data as { ok: true; changed: boolean; version: number; grants: readonly string[] } | { ok: false; issue: string };
      if (!d.ok) {
        geri();
        say("warn", t("err.field"));
        return;
      }
      setGroups((list) => list.map((x) => (x.id === g.id ? { ...x, grants: d.grants, version: d.version } : x)));
      say("ok", basari);
    });
  }

  function satirlar(g: YetkiGrup, s: YetkiBolum) {
    const field = hasField(g.id);
    return rows
      .filter((r) => r.section === s)
      .map((r) => {
        const on = r.lock === "everyone" ? true : r.grantable && g.grants.includes(r.permission);
        const mfaKilit = r.mfa && field && !on;
        const locked = !data.canEdit || !r.grantable || mfaKilit;
        const reason = !r.grantable ? t(`lock.${r.lock ?? "admin"}`) : !data.canEdit ? t("lock.owner") : mfaKilit ? t("lock.mfaField") : undefined;
        const name = rowLabel(r);
        return (
          <KalipAnahtar
            key={r.id}
            title={name}
            {...(r.mfa ? { sub: t("mfaNote") } : r.grantable ? {} : { sub: t(`lock.${r.lock ?? "admin"}`) })}
            d={ISLEM[islemOf(r)] ?? LICON.shield}
            color={BOLUM[s].color}
            on={on}
            locked={locked}
            lockedReason={reason}
            aria={`${bolumLabel(s)} · ${name}`}
            onToggle={() => degistir(g, on ? [] : [r.permission], on ? [r.permission] : [], t(on ? "saved.off" : "saved.on", { group: g.name, name }))}
            testId={`yetki-${r.id}`}
          />
        );
      });
  }

  function grupKarti(g: YetkiGrup) {
    const field = hasField(g.id);
    const people = members.filter((m) => m.groupId === g.id).length;
    const on = katalog.rows.filter((r) => r.grantable && g.grants.includes(r.permission)).length;
    const sablon = eslesenSablon(katalog.presets, g.grants);
    const yonler: KalipYon[] = katalog.presets.map((p) => ({ id: p.id, label: t(`preset.${p.id}`), d: SABLON[p.id]?.d ?? LICON.shield, ton: SABLON[p.id]?.ton ?? "gri" }));
    return (
      <KalipAyarKart title={g.name} sub={t("groupSub", { people, on })} d={LICON.shield} ton="mor" testId="yetki-grup">
        <KalipAlan label={t("search")} placeholder={t("searchPh")} type="search" value={q} onChange={(e) => setQ(e.target.value)} ikon={{ d: LICON.search, color: "2F5DA8" }} data-testid="yetki-ara" />
        {q.trim() === "" ? (
          <KalipAyarSatir title={t("presets")} sub={t("presetsSub")} d={LICON.check} ton="mor" testId="yetki-sablon">
            <KalipYonSecimi
              label={t("presets")}
              options={yonler}
              value={sablon ?? ""}
              busy={pending}
              onPick={(id) => {
                const p = katalog.presets.find((x) => x.id === id);
                if (p === undefined) return;
                if (!data.canEdit) {
                  kilitliDokunus(t("lock.owner"));
                  return;
                }
                const hedef = field ? p.grants.filter((x) => !katalog.rows.some((r) => r.permission === x && r.mfa)) : p.grants;
                const { add, remove } = sablonFarki(katalog.rows, g.grants, hedef);
                if (add.length + remove.length === 0) {
                  feedback.warn(field && hedef.length < p.grants.length ? t("lock.mfaField") : t("presetSame"));
                  return;
                }
                degistir(g, add, remove, t("presetDone", { group: g.name, preset: t(`preset.${id}`) }));
              }}
              testId="yetki-sablonlar"
            />
          </KalipAyarSatir>
        ) : null}
        {sections.length === 0 ? <KalipBos title={t("noMatch")} action={{ label: t("clear"), kind: "clear", onClick: () => setQ("") }} testId="yetki-bos" /> : null}
        {sections.map((s) => {
          const durum = bolumDurumu(rows, s, g.grants);
          const acilabilir = field ? durum.keys.filter((k) => !katalog.rows.some((r) => r.permission === k && r.mfa)) : durum.keys;
          const hepsi = durum.keys.length > 0 && durum.on === durum.keys.length;
          const kilitli = !data.canEdit || (!hepsi && acilabilir.every((k) => g.grants.includes(k)));
          return (
            <KalipAnahtarKumesi
              key={s}
              title={bolumLabel(s)}
              sub={durum.keys.length === 0 ? t("sectionFixed") : t("sectionSub", { on: durum.on, n: durum.keys.length })}
              d={BOLUM[s].d}
              ton={BOLUM[s].ton}
              allOn={hepsi}
              {...(durum.keys.length === 0 ? {} : { allLabel: hepsi ? t("allOff") : t("allOn"), allIcon: hepsi ? LICON.close : LICON.check })}
              {...(durum.keys.length === 0
                ? {}
                : {
                    onAll: () =>
                      hepsi
                        ? degistir(g, [], durum.keys, t("saved.allOff", { group: g.name, section: bolumLabel(s) }))
                        : degistir(g, acilabilir.filter((k) => !g.grants.includes(k)), [], t("saved.allOn", { group: g.name, section: bolumLabel(s) })),
                  })}
              allLocked={kilitli}
              allLockedReason={!data.canEdit ? t("lock.owner") : t("lock.mfaField")}
              testId={`yetki-bolum-${s}`}
            >
              {satirlar(g, s)}
            </KalipAnahtarKumesi>
          );
        })}
      </KalipAyarKart>
    );
  }

  // ---- Kişi görünümü -------------------------------------------------------------------------------------------------------------
  const kisiler = members;
  const kisiSecili = kisiler.find((m) => m.membershipId === kisi) ?? kisiler.find((m) => !m.isOwner) ?? kisiler[0];
  const grupOf = (m: YetkiKisi): YetkiGrup | undefined => (m.groupId === null ? undefined : groups.find((g) => g.id === m.groupId));

  function kisiKarti(m: YetkiKisi) {
    const g = grupOf(m);
    const grants = g?.grants ?? [];
    const fark = katalog.rows.filter((r) => yetkiKaynagi(katalog, m.role, grants, r.permission) === "group").length;
    const kilitSebep = !data.canEdit ? t("lock.owner") : m.isOwner ? t("person.ownerRole") : undefined;
    const rolItems = ROLLER.map((r) => ({
      id: r,
      label: roleLabel(r),
      d: ROL_RENK[r].d,
      color: ROL_RENK[r].color,
      locked: kilitSebep !== undefined || (m.isField && r !== "PICKER" && r !== "COUNTER"),
    }));
    const grupSecenek = [
      { id: "", label: t("person.noGroup"), d: LICON.people, color: "4E6476" },
      ...groups.map((x) => ({ id: x.id, label: x.name, d: LICON.shield, color: hexKey(x.color), ...(m.isField && x.grants.some((k) => katalog.rows.some((r) => r.permission === k && r.mfa)) ? { sub: t("person.fieldGroup") } : {}) })),
    ];
    return (
      <KalipAyarKart
        title={m.name}
        sub={t("person.summary", { role: roleLabel(m.role), group: m.isOwner ? t("person.owner") : (g?.name ?? t("person.noGroup")) })}
        d={LICON.people}
        ton="mavi"
        testId="yetki-kisi"
        actions={
          <KalipKilitliDugme
            className="kdug ikincil"
            kilitli={kilitSebep !== undefined || m.groupId === null}
            gerekce={kilitSebep ?? t("person.resetSame")}
            onClick={() =>
              void tekKayit(async () => {
                const r = (await setMemberGroupAction({ slug, memberId: m.membershipId, groupId: null })) as Sonuc;
                if (!r.ok) {
                  say("err", errorText(r.error));
                  return;
                }
                setMembers((list) => list.map((x) => (x.membershipId === m.membershipId ? { ...x, groupId: null } : x)));
                say("ok", t("person.resetDone", { name: m.name }));
              })
            }
            data-testid="yetki-kisi-sifirla"
          >
            <Ico d={SICON.cevrim} size={18} />
            <span>{t("person.reset")}</span>
          </KalipKilitliDugme>
        }
      >
        <KalipSecim
          label={t("person.pick")}
          hint={t("person.pickHint")}
          value={m.membershipId}
          options={kisiler.map((x) => ({
            id: x.membershipId,
            label: x.name,
            sub: x.isOwner ? t("person.owner") : `${roleLabel(x.role)} · ${grupOf(x)?.name ?? t("person.noGroup")}${x.isField ? ` · ${t("person.field")}` : ""}`,
            d: LICON.people,
            color: "2F5DA8",
          }))}
          onPick={(id) => {
            feedback.minor();
            router.replace(`${base}/yetkiler?bolum=kisiler&kisi=${encodeURIComponent(id)}`, { scroll: false });
          }}
          color="2F5DA8"
          list
          testId="yetki-kisi-sec"
        />
        <KalipSecimKutulari
          label={t("person.role")}
          items={rolItems}
          value={m.role}
          onLocked={() => kilitliDokunus(kilitSebep ?? t("person.fieldRole"))}
          onPick={(id) => {
            if (id === m.role) return;
            void tekKayit(async () => {
              const r = (await changeRoleAction({ slug, memberId: m.membershipId, roleKey: id })) as Sonuc;
              if (!r.ok) {
                say("err", errorText(r.error));
                return;
              }
              setMembers((list) => list.map((x) => (x.membershipId === m.membershipId ? { ...x, role: id } : x)));
              say("ok", t("person.roleDone", { name: m.name, role: roleLabel(id) }));
            });
          }}
          testId="yetki-kisi-rol"
        />
        <KalipSecim
          label={t("person.group")}
          value={m.groupId ?? ""}
          options={grupSecenek}
          onPick={(id) => {
            if (kilitSebep !== undefined) {
              kilitliDokunus(kilitSebep);
              return;
            }
            const groupId = id === "" ? null : id;
            if (groupId === m.groupId) return;
            void tekKayit(async () => {
              const r = (await setMemberGroupAction({ slug, memberId: m.membershipId, groupId })) as Sonuc;
              if (!r.ok) {
                say("err", errorText(r.error));
                return;
              }
              const d = r.data as { ok: boolean; issue?: string };
              if (!d.ok) {
                say("warn", d.issue === "FIELD_MEMBER_MFA" ? t("person.fieldGroup") : d.issue === "GROUP_ARCHIVED" ? t("person.archivedGroup") : t("person.ownerRole"));
                return;
              }
              setMembers((list) => list.map((x) => (x.membershipId === m.membershipId ? { ...x, groupId } : x)));
              say("ok", t("person.groupDone", { name: m.name, group: groupId === null ? t("person.noGroup") : (groups.find((x) => x.id === groupId)?.name ?? "") }));
            });
          }}
          color="6C4BD8"
          testId="yetki-kisi-grup"
        />
        <KalipAlan label={t("search")} placeholder={t("searchPh")} type="search" value={q} onChange={(e) => setQ(e.target.value)} ikon={{ d: LICON.search, color: "2F5DA8" }} data-testid="yetki-ara" />
        <p className="stay-n stt-mavi" aria-live="polite" data-testid="yetki-kisi-fark">
          <Ico d={fark > 0 ? LICON.warn : LICON.check} size={16} />
          <span>{m.isOwner ? t("person.ownerRole") : fark > 0 ? t("person.diff", { n: fark }) : t("person.sameAsRole")}</span>
        </p>
        {sections.length === 0 ? <KalipBos title={t("noMatch")} action={{ label: t("clear"), kind: "clear", onClick: () => setQ("") }} testId="yetki-bos" /> : null}
        {sections.map((s) => {
          const list = rows.filter((r) => r.section === s);
          const acik = list.filter((r) => (m.isOwner ? true : yetkiKaynagi(katalog, m.role, grants, r.permission) !== null)).length;
          return (
            <KalipAnahtarKumesi key={s} title={bolumLabel(s)} sub={t("sectionSub", { on: acik, n: list.length })} d={BOLUM[s].d} ton={BOLUM[s].ton} testId={`yetki-kisi-bolum-${s}`}>
              {list.map((r) => {
                const src = m.isOwner ? "role" : yetkiKaynagi(katalog, m.role, grants, r.permission);
                const name = rowLabel(r);
                const sub = src === "role" ? t("person.fromRole") : src === "group" ? t("person.fromGroup", { group: g?.name ?? "" }) : t("person.off");
                return (
                  <KalipAnahtar
                    key={r.id}
                    title={name}
                    sub={sub}
                    d={ISLEM[islemOf(r)] ?? LICON.shield}
                    color={BOLUM[s].color}
                    on={src !== null}
                    changed={src === "group"}
                    locked
                    lockedReason={src === "role" ? t("person.lockRole") : src === "group" ? t("person.lockGroup", { group: g?.name ?? "" }) : r.grantable ? t("person.lockOff") : t(`lock.${r.lock ?? "admin"}`)}
                    aria={`${bolumLabel(s)} · ${name}: ${sub}`}
                    onToggle={() => undefined}
                    testId={`yetki-kisi-${r.id}`}
                  />
                );
              })}
            </KalipAnahtarKumesi>
          );
        })}
      </KalipAyarKart>
    );
  }

  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={t("title")}
      icon={{ d: LICON.shield, color: "6C4BD8" }}
      testId="yetkiler"
      bar={{
        back: { href: `${base}/settings?sekme=kullanici`, testId: "kabuk-back" },
        main: {
          label: t("main"),
          aria: t("mainAria"),
          d: LICON.plus,
          href: `${base}/groups?new=1`,
          locked: !data.canEdit,
          disabledReason: t("lock.owner"),
          testId: "yetkiler-main",
        },
      }}
      overlays={toast}
    >
      <KalipSekme label={tb("tabs")} color="0E7C7B" current="kullanici" items={ayarSekmeleri(base, tb)} />
      <KalipAltBolumler label={t("bolumLabel")} items={items} current={secili} testId="yetki-bolumler">
        {grup !== undefined ? (
          grupKarti(grup)
        ) : kisiSecili === undefined ? (
          <KalipBos title={t("person.none")} testId="yetki-kisi-yok" />
        ) : (
          kisiKarti(kisiSecili)
        )}
        {groups.length === 0 ? (
          <KalipBos title={t("empty.title")} hint={t("empty.hint")} action={{ label: t("empty.action"), kind: "add", href: `${base}/groups?new=1` }} testId="yetki-grup-yok" iconD={LICON.shield} />
        ) : null}
      </KalipAltBolumler>
    </KalipEkran>
  );
}
