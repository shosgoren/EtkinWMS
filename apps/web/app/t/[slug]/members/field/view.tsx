"use client";
// Saha personeli ekle (T-997; T-971 FORM kalıbı, KalipForm.dc.html): solda ikonlu gruplar — kişi (ad soyad, kullanıcı adı `.fld`), görev
// (`.gpick`: Toplayıcı / Sayımcı), depo (`.gpick`: "Tüm depolar" + depolar; A-77: kapsam satırı yok = tüm depolar) — sağda etkinleştirme
// kartı (kod, QR, adres satırı, YAZDIR + "Kod yalnız bu ekranda görünür" notu; kod yokken "Personel nasıl girer?") ve saha personeli
// listesi (satırda YENİ KOD). Ana işlem ortak alt çubukta PERSONELİ EKLE. Güvenlik: kod yalnız bu yanıtta ve bu bileşenin belleğinde
// (kaydedilmez, e-postayla gitmez); QR yalnız saha giriş adresini taşır (kod URL'ye girmez); depo önceden seçili gelmez ve seçilmeden
// gönderilemez (T-413 m2). Bilinçli fark (T-971): ekran içi tema düğmesi yok (tema Hesap menüsünde).
import { useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LICON } from "../../../../design/kalip-icons.ts";
import { Ico, KalipEkran, useKalipToast } from "../../kalip/ekran.tsx";
import { KalipAlan, KalipGrup, KalipIzgara, KalipSecenek } from "../../kalip/form.tsx";
import { kdz } from "../../kalip/tokens.ts";
import { createFieldUserAction, resetFieldCodeAction } from "../actions.ts";
import { Btn, ErrLine, Note, QrCode, type ErrState } from "../parts.tsx";
import { buyukHarf, feedback } from "@wms/ui";

interface Warehouse {
  readonly id: string;
  readonly name: string;
}

export interface StaffRow {
  readonly membershipId: string;
  readonly name: string;
  readonly username: string;
  readonly role: string;
  readonly active: boolean;
  readonly locked: boolean;
}

interface Issued {
  readonly username: string;
  readonly code: string;
}

const c = (hex: string): string => kdz("dzf", hex);
/** "Tüm depolar" seçeneğinin kimliği (gönderimde `null`). */
const ALL = "__all";
const HINT: CSSProperties = { margin: "0 4px", fontSize: 12.5, opacity: 0.75 };

export function FieldStaffView({
  dark,
  slug,
  host,
  tenantName,
  warehouses,
  staff,
}: {
  dark: boolean;
  slug: string;
  host: string;
  tenantName: string;
  warehouses: readonly Warehouse[];
  staff: readonly StaffRow[];
}) {
  const t = useTranslations("fieldStaff");
  const locale = useLocale(); // T-1001 (ALTIN-KURAL 16): kullanıcının dili
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"PICKER" | "COUNTER">("PICKER");
  // T-413 (inceleme m2): depo bilinçli seçilir — `undefined` = seçilmedi (gönderilmez), `null` = tüm depolar.
  const [wh, setWh] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrState>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const { say, node: toast } = useKalipToast("form");
  const returnTo = `/t/${slug}/members/field`;

  function failText(code: string, detail: string | undefined): { text: string; reauth: boolean } {
    if (detail === "RECENT_AUTH_REQUIRED") return { text: t("errReauth"), reauth: true };
    if (detail === "CODE_TAKEN") return { text: t("errTaken"), reauth: false };
    if (detail === "PLAN_LIMIT") return { text: t("errPlan"), reauth: false };
    if (code === "VALIDATION_FAILED") return { text: t("errInvalid"), reauth: false };
    if (code === "FORBIDDEN") return { text: t("errForbidden"), reauth: false };
    return { text: t("errServer"), reauth: false };
  }

  async function newCode(row: StaffRow): Promise<void> {
    setBusy(true);
    setErr(null);
    const res = await resetFieldCodeAction({ slug, memberId: row.membershipId });
    setBusy(false);
    if (res.ok) {
      feedback.ok();
      setIssued({ username: row.username, code: res.data.code });
      router.refresh();
      return;
    }
    feedback.error();
    setErr(failText(res.error.code, res.error.detail));
  }

  async function add(): Promise<void> {
    if (wh === undefined) {
      feedback.error();
      setErr({ text: t("errWarehouse"), reauth: false });
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await createFieldUserAction({ slug, name: name.trim(), username: username.trim(), roleKey: role, warehouseId: wh });
    setBusy(false);
    if (res.ok) {
      // Form değerleri kartla birlikte görünür kalır (kart hangi personele ait, ekranda okunur).
      feedback.ok();
      setIssued({ username: res.data.username, code: res.data.code });
      say("ok", t("cardKick", { username: res.data.username }));
      router.refresh();
      return;
    }
    feedback.error();
    setErr(failText(res.error.code, res.error.detail));
    router.refresh();
  }

  const canAdd = !busy && name.trim().length >= 2 && username.trim().length >= 3;
  const whValue = wh === undefined ? "" : wh === null ? ALL : wh;

  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={t("title")}
      subtitle={t("bandS", { tenant: buyukHarf(tenantName, locale) })}
      icon={{ d: LICON.people, color: "0E7C7B" }}
      testId="field-staff"
      bar={{
        back: { href: `/t/${slug}/members`, aria: t("back") },
        main: {
          label: t("k.addShort"),
          aria: t("add"),
          d: LICON.plus,
          disabled: !canAdd,
          onClick: () => void add(),
          testId: "field-staff-add",
        },
      }}
      overlays={toast}
    >
      <KalipIzgara
        left={
          <>
            <KalipGrup title={t("k.person")} d={LICON.people} color="0E7C7B">
              <KalipAlan label={t("name")} type="text" value={name} maxLength={100} autoComplete="off" onChange={(e) => setName(e.target.value)} />
              <KalipAlan label={t("username")} type="text" autoCapitalize="none" autoComplete="off" spellCheck={false} value={username} maxLength={40} onChange={(e) => setUsername(e.target.value)} />
              <p style={HINT}>{t("usernameHint")}</p>
            </KalipGrup>
            <KalipGrup title={t("role")} d={LICON.moveOut} color="B85A14">
              <KalipSecenek
                label={t("roleLabel")}
                color="B85A14"
                value={role}
                onPick={(id) => setRole(id === "COUNTER" ? "COUNTER" : "PICKER")}
                options={[
                  { id: "PICKER", label: t("rolePicker"), d: LICON.moveOut },
                  { id: "COUNTER", label: t("roleCounter"), d: LICON.clip },
                ]}
              />
            </KalipGrup>
            <KalipGrup title={t("warehouse")} d={LICON.depo} color="30475A">
              <KalipSecenek
                label={t("warehouseLabel")}
                color="30475A"
                value={whValue}
                onPick={(id) => {
                  setWh(id === ALL ? null : id);
                  setErr(null);
                }}
                options={[{ id: ALL, label: t("allWarehouses"), d: LICON.grid }, ...warehouses.map((w) => ({ id: w.id, label: w.name, d: LICON.depo }))]}
              />
            </KalipGrup>
            <ErrLine err={err} returnTo={returnTo} reauthLabel={t("reauthLink")} scope="dzf" />
          </>
        }
        right={
          <>
            {issued !== null ? (
              <KalipGrup title={t("cardKick", { username: issued.username })} d={LICON.key} color="B07D0B" testId="field-staff-card">
                <span
                  className="mono"
                  aria-label={t("codeLabel")}
                  style={{ alignSelf: "center", padding: "8px 0", font: "800 34px/1 var(--font-plex-mono), monospace", letterSpacing: ".18em" }}
                >
                  {issued.code}
                </span>
                <QrCode value={`https://${host}/field`} label={t("qrLabel")} scope="dzf" size={176} />
                <span className="mono" style={{ fontSize: 13, opacity: 0.8, textAlign: "center", overflowWrap: "anywhere" }}>
                  {t("cardLine", { address: `${host}/${slug}` })}
                </span>
                <Btn kind="n" scope="dzf" d={LICON.printer} onClick={() => window.print()}>
                  {t("print")}
                </Btn>
                <Note d={LICON.lock} title={t("onceTitle")} body={t("onceBody")} />
              </KalipGrup>
            ) : (
              <KalipGrup title={t("howTitle")} d={LICON.clock} color="2F5DA8">
                <p style={{ ...HINT, fontSize: 14, opacity: 0.9 }}>{t("howBody")}</p>
              </KalipGrup>
            )}
            <KalipGrup title={t("listTitle")} sub={t("listCount", { n: staff.length })} d={LICON.people} color="172E42">
              {staff.map((p) => {
                const st = p.locked ? t("stLocked") : p.active ? t("stActive") : t("stPending");
                const roleText = p.role === "COUNTER" ? t("roleCounter") : t("rolePicker");
                return (
                  <div key={p.membershipId} className="sr2" style={{ "--c": c(p.locked ? "C62828" : "0E7C7B"), cursor: "default" } as CSSProperties} data-testid="field-staff-row">
                    <span className="ri">
                      <Ico d={p.locked ? LICON.lock : LICON.people} size={20} />
                    </span>
                    <span className="rt">
                      <b>{p.name}</b>
                      <small>{`${p.username} · ${buyukHarf(roleText, locale)}`}</small>
                    </span>
                    <span className={`pill ${p.active && !p.locked ? "ok" : "warn"}`}>{st}</span>
                    <Btn kind="soft" scope="dzf" d={LICON.key} onClick={() => void newCode(p)} aria-label={t("newCodeAria", { name: p.name })} disabled={busy} style={{ minHeight: 44 }}>
                      {t("newCode")}
                    </Btn>
                  </div>
                );
              })}
            </KalipGrup>
          </>
        }
      />
    </KalipEkran>
  );
}
