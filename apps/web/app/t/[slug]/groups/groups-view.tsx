"use client";
// T-421 (I-18): Gruplar.dc.html "Yetki grupları" BİREBİR — 1 Gruplar → 2 Ad + ekranlar / yetkiler → 3 Kişiler → 4 Bitti.
// Sınıf adları, öğe sırası, ikon yolları kaynaktan; CSS `design/gruplar.css` (üretilmiş), uyarlama `design/gruplar-frame.css`.
// Model (güvenlik): "HAZIR" gruplar rollerin kendisidir (salt okunur; rol Ekip ekranında değişir). Özel grup role EK yetki ve ekran verir;
// yazma yalnız hesap sahibine açıktır (domain denetler; `canEdit` yalnız gösterim). Ekip yönetimi grupla verilmez (kart kilitli).
// Bilinçli farklar (DESIGN-PARITY): Etkin (sesle) T-424; özel grup için "Arşivle" düğmesi (kaynakta yok; grup silinmez); kişi aramasında yazı kutusu.
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useModalFocus } from "../kalip/odak.ts";
import { dz } from "../../../design/gruplar-tokens.ts";
import { RICON } from "../../../design/gruplar-icons.ts";
import { archiveGroupAction, saveGroupAction, setMemberGroupAction } from "./actions.ts";
import { KabukBar } from "../kabuk/kabuk-bar.tsx";
import { buyukHarf, feedback, kucukHarf } from "@wms/ui";
import { kilitliDokunus } from "../kalip/kilitli.tsx";

type Overview = {
  readonly groups: readonly { id: string; name: string; color: string; screens: readonly string[]; grants: readonly string[]; archived: boolean; version: number; memberCount: number }[];
  readonly members: readonly { membershipId: string; name: string; isOwner: boolean; isField: boolean; roles: readonly string[]; groupId: string | null }[];
  readonly canEdit: boolean;
};

export interface GroupsViewProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly data: Overview;
}

// Kaynaktaki listeler (SCREENS, POWERS, COLORS) — sıra ve renkler aynen.
const SCREENS = [
  ["receive", "2F7D5B", RICON.receive],
  ["pick", "0E7C7B", RICON.pick],
  ["transfer", "6C4BD8", RICON.transfer],
  ["prod", "B5552B", RICON.prod],
  ["count", "2F5DA8", RICON.count],
  ["labels", "172E42", RICON.labels],
  ["reports", "E56A00", RICON.reports],
  ["problem", "C62828", RICON.warn],
] as const;
/** Yetki kartı → domain yetkileri. `team` (ekip yönetimi) ve `settings` (ayarlar) grupla verilmez: kartlar kilitli (yalnız Yönetici rolü). */
const LOCKED: readonly string[] = ["team", "settings"];
const POWERS = [
  ["scan", "2F7D5B", RICON.scan, ["stock.post"]],
  ["create", "0E7C7B", RICON.plus, ["document.create"]],
  ["approve", "6C4BD8", RICON.approve, ["document.approve", "count_diff.approve"]],
  ["reverse", "B5552B", RICON.reverse, ["reversal.create"]],
  ["team", "2F5DA8", RICON.team, []],
  ["import", "2F7D5B", RICON.import, ["data.import"]],
  ["settings", "172E42", RICON.settings, []],
] as const;
/** Renk anahtarları `#` olmadan (belirteç: `dz()`); sunucuya `#` önekiyle gider (0051 CHECK). */
const COLORS = ["2F7D5B", "0E7C7B", "2F5DA8", "6C4BD8", "B5552B"] as const;
const withHash = (c: string): string => `#${c}`;

/** Hazır gruplar = roller (ADR-016 §4 / A-45). Ekran ve yetki kartları rol izinlerinden; değiştirilemez. */
const TEMPLATES = [
  ["TENANT_ADMIN", "172E42", SCREENS.map((s) => s[0]), ["scan", "create", "approve", "reverse", "team", "import", "settings"]],
  ["WAREHOUSE_MANAGER", "0E7C7B", SCREENS.map((s) => s[0]), ["scan", "create", "approve", "reverse"]],
  ["PICKER", "2F7D5B", ["receive", "pick", "transfer", "problem"], ["scan"]],
  ["COUNTER", "2F5DA8", ["count", "problem"], ["create"]],
  ["READ_ONLY", "6A7F91", ["reports"], []],
] as const;

type View = "list" | "edit" | "people" | "done";
interface Draft {
  readonly id: string | null;
  readonly version: number | null;
  readonly template: string | null;
  readonly name: string;
  readonly color: string;
  readonly screens: readonly string[];
  readonly powers: readonly string[];
  readonly picked: readonly string[];
}

function Ico({ d, size, style }: { d: readonly string[] | string; size: number; style?: CSSProperties }) {
  const list = typeof d === "string" ? [d] : d;
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {list.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

const hexKey = (c: string): string => c.replace("#", "").toUpperCase();
const initial = (name: string, locale: string): string => buyukHarf(name.trim()[0] ?? "?", locale);
const powersOf = (grants: readonly string[]): string[] => POWERS.filter(([, , , g]) => g.length > 0 && g.every((x) => grants.includes(x))).map((p) => p[0]);
const grantsOf = (powers: readonly string[]): string[] => POWERS.filter((p) => powers.includes(p[0])).flatMap((p) => [...p[3]]);

export function GroupsView({ slug, dark, data }: GroupsViewProps) {
  const t = useTranslations("gruplar");
  const tr = useTranslations("kural");
  const locale = useLocale(); // T-1001 (ALTIN-KURAL 16): kullanıcının dili
  const base = `/t/${encodeURIComponent(slug)}`;
  const [groups, setGroups] = useState(data.groups);
  const [members, setMembers] = useState(data.members);
  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<"scr" | "pow">("scr");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [cf, setCf] = useState<null | "home" | "back">(null);
  // T-1001 (ALTIN-KURAL 11): Esc kapatır, odak perdede kalır, kapanınca açan düğmeye döner.
  const cfRef = useRef<HTMLDivElement>(null);
  useModalFocus(cf !== null, cfRef, { onClose: () => setCf(null), initial: "first" });
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // T-1001 (ALTIN-KURAL 5, 17): yetkisiz dokunuş — ortak sarı balon + hata sesi.
  const flash = (msg: string): void => kilitliDokunus(msg);

  const active = useMemo(() => groups.filter((g) => !g.archived), [groups]);
  const roleOf = (m: (typeof members)[number]): string => m.roles[0] ?? "READ_ONLY";
  const groupName = (id: string | null): string | null => (id === null ? null : (groups.find((g) => g.id === id)?.name ?? null));
  const nowLabel = (m: (typeof members)[number]): string =>
    m.isOwner ? t("owner") : buyukHarf(groupName(m.groupId) ?? t(`role.${roleOf(m)}`), locale);
  const nowColor = (m: (typeof members)[number]): string => {
    const g = m.groupId === null ? undefined : groups.find((x) => x.id === m.groupId);
    if (g !== undefined) return hexKey(g.color);
    return TEMPLATES.find((x) => x[0] === roleOf(m))?.[1] ?? "6A7F91";
  };

  const tiles = useMemo(() => {
    const tpl = TEMPLATES.map(([role, color, screens]) => {
      const who = members.filter((m) => m.groupId === null && (m.roles as readonly string[]).includes(role));
      return { key: `t:${role}`, template: role as string, id: null as string | null, name: t(`role.${role}`), color: color as string, screens: role === "TENANT_ADMIN" ? t("allScreens") : String(screens.length), who };
    }).filter((x) => x.who.length > 0 || x.template !== "READ_ONLY");
    const custom = active.map((g) => ({
      key: g.id,
      template: null as string | null,
      id: g.id as string | null,
      name: g.name,
      color: hexKey(g.color),
      screens: String(g.screens.length),
      who: members.filter((m) => m.groupId === g.id),
    }));
    return [...tpl, ...custom];
  }, [members, active, t]);

  const dirty = draft !== null && saved !== null && draft.template === null && (view === "edit" || view === "people") && JSON.stringify(draft) !== JSON.stringify(saved);
  const readOnly = draft === null || draft.template !== null || !data.canEdit;

  function open(tile: (typeof tiles)[number]): void {
    feedback.ok();
    setIssue(null);
    let d: Draft;
    if (tile.template !== null) {
      const tpl = TEMPLATES.find((x) => x[0] === tile.template);
      d = { id: null, version: null, template: tile.template, name: tile.name, color: `#${tile.color}`, screens: [...(tpl?.[2] ?? [])], powers: [...(tpl?.[3] ?? [])], picked: tile.who.map((m) => m.membershipId) };
    } else {
      const g = groups.find((x) => x.id === tile.id);
      if (g === undefined) return;
      d = { id: g.id, version: g.version, template: null, name: g.name, color: g.color, screens: [...g.screens], powers: powersOf(g.grants), picked: members.filter((m) => m.groupId === g.id).map((m) => m.membershipId) };
    }
    setDraft(d);
    setSaved(d);
    setTab("scr");
    setView("edit");
  }

  function startNew(): void {
    if (!data.canEdit) {
      flash(t("ownerOnly"));
      return;
    }
    feedback.ok();
    const d: Draft = { id: null, version: null, template: null, name: t("newName"), color: withHash(COLORS[0]), screens: [], powers: [], picked: [] };
    setDraft(d);
    setSaved({ ...d, name: "" });
    setIssue(null);
    setTab("scr");
    setView("edit");
  }

  const upd = (patch: Partial<Draft>): void => setDraft((d) => (d === null ? d : { ...d, ...patch }));
  const toggle = (key: "screens" | "powers" | "picked", id: string): void => {
    if (readOnly || draft === null) return;
    feedback.ok();
    const list = draft[key];
    upd({ [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } as Partial<Draft>);
  };

  function errorText(code: string, detail?: string): string {
    if (detail === "RECENT_AUTH_REQUIRED") return t("err.reauth");
    if (detail === "MFA_REQUIRED") return t("err.mfa");
    if (code === "VERSION_CONFLICT") return t("err.conflict");
    if (code === "FORBIDDEN") return t("ownerOnly");
    return t("err.failed", { code });
  }

  /** Kaydet: grup (ad, renk, ekran, yetki) → kişiler (eklenen: bu grup; çıkarılan: grupsuz). Kısmi sonuçta kalan kişiler bildirilir. */
  async function save(): Promise<boolean> {
    if (draft === null || draft.template !== null || !data.canEdit) return false;
    setBusy(true);
    setIssue(null);
    try {
      const r = await saveGroupAction({
        slug,
        ...(draft.id === null ? {} : { id: draft.id, expectedVersion: draft.version ?? 1 }),
        name: draft.name,
        color: draft.color,
        screens: [...draft.screens],
        grants: grantsOf(draft.powers),
      });
      if (!r.ok) {
        feedback.error();
        setIssue(errorText(r.error.code, r.error.detail));
        return false;
      }
      if (!r.data.ok) {
        feedback.error();
        setIssue(t(`issue.${r.data.issue}`));
        return false;
      }
      const id = r.data.id;
      const before = members.filter((m) => m.groupId === id).map((m) => m.membershipId);
      const add = draft.picked.filter((x) => !before.includes(x));
      const remove = before.filter((x) => !draft.picked.includes(x));
      const skipped: string[] = [];
      const next = new Map(members.map((m) => [m.membershipId, m.groupId] as const));
      for (const [memberId, groupId] of [...add.map((x) => [x, id] as const), ...remove.map((x) => [x, null] as const)]) {
        const m = await setMemberGroupAction({ slug, memberId, groupId });
        if (m.ok && m.data.ok) next.set(memberId, groupId);
        else skipped.push(members.find((x) => x.membershipId === memberId)?.name ?? "?");
      }
      setMembers((list) => list.map((m) => ({ ...m, groupId: next.get(m.membershipId) ?? null })));
      const g = { id, name: draft.name.trim(), color: draft.color, screens: [...draft.screens], grants: grantsOf(draft.powers), archived: false, version: r.data.version, memberCount: 0 };
      setGroups((list) => (list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? g : x)) : [...list, g]));
      const done = { ...draft, id, version: r.data.version, name: g.name, picked: draft.picked.filter((x) => next.get(x) === id) };
      setDraft(done);
      setSaved(done);
      if (skipped.length > 0) setIssue(t("skipped", { names: skipped.join(", ") }));
      feedback.ok();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function archive(): Promise<void> {
    if (draft === null || draft.id === null || draft.version === null || !data.canEdit) return;
    setBusy(true);
    try {
      const r = await archiveGroupAction({ slug, id: draft.id, expectedVersion: draft.version, archived: true });
      if (!r.ok) {
        setIssue(errorText(r.error.code, r.error.detail));
        return;
      }
      const id = draft.id;
      setGroups((list) => list.map((x) => (x.id === id ? { ...x, archived: true } : x)));
      // T-1001 (ALTIN-KURAL 10): arşivleme geri dönüşlüdür — onay yok; birkaç saniye "Geri al" (sunucuda arşivden çıkarır).
      const version = r.data.ok ? r.data.version : draft.version;
      feedback.undo(t("archived", { name: draft.name }), tr("undo"), async () => {
        const u = await archiveGroupAction({ slug, id, expectedVersion: version, archived: false });
        if (u.ok && u.data.ok) {
          const v = u.data.version;
          setGroups((list) => list.map((x) => (x.id === id ? { ...x, archived: false, version: v } : x)));
          feedback.ok(tr("undone"));
        } else feedback.error(tr("undoFailed"));
      });
      setDraft(null);
      setSaved(null);
      setView("list");
    } finally {
      setBusy(false);
    }
  }

  const nScr = draft?.screens.length ?? 0;
  const nPow = draft?.powers.length ?? 0;
  const pickedCount = draft?.picked.length ?? 0;
  const titles: Record<View, [string, string]> = {
    list: [t("title"), t("sub.list")],
    edit: [draft !== null && draft.template !== null ? draft.name : t("editTitle"), draft !== null && draft.template !== null ? t("sub.template") : t("sub.edit")],
    people: [t("peopleTitle"), t("sub.people")],
    done: [t("doneTitle"), t("sub.done")],
  };
  const STEPW: Record<View, number> = { list: 25, edit: 50, people: 75, done: 100 };

  const goList = (): void => {
    setView("list");
    setDraft(null);
    setSaved(null);
    setIssue(null);
  };
  const MAIN: Record<View, [string, string, () => void]> = {
    list: [t("main.new"), RICON.plus, startNew],
    edit: [
      t("main.people"),
      RICON.next,
      () => {
        if (draft !== null && draft.template === null && draft.name.trim() === "") {
          feedback.error();
          setIssue(t("issue.NAME_MISSING"));
          return;
        }
        setIssue(null);
        setView("people");
      },
    ],
    people: readOnly
      ? [t("main.done"), RICON.check, goList]
      : [
          t("main.save", { n: pickedCount }),
          RICON.check,
          () =>
            void save().then((ok) => {
              if (ok) setView("done");
            }),
        ],
    done: [t("main.done"), RICON.check, goList],
  };
  const back = (): void => {
    if (view === "edit") {
      if (dirty) setCf("back");
      else goList();
    } else if (view === "people") setView("edit");
    else if (view === "done") goList();
  };

  const card = (list: typeof SCREENS | typeof POWERS, key: "screens" | "powers") =>
    list.map((item) => {
      const [id, color, d] = item;
      const on = draft?.[key].includes(id) === true;
      const locked = readOnly || (key === "powers" && LOCKED.includes(id));
      return (
        <button
          key={id}
          type="button"
          className={`pm${on ? " on" : ""}`}
          aria-pressed={on}
          aria-disabled={locked}
          data-card={id}
          onClick={() => {
            if (key === "powers" && LOCKED.includes(id) && !readOnly) {
              feedback.error();
              flash(t("teamLocked"));
              return;
            }
            toggle(key, id);
          }}
        >
          <span className="gchk">
            <Ico d={RICON.check} size={14} />
          </span>
          <span className="pic" style={on ? { background: dz(color) } : undefined}>
            <Ico d={d} size={22} />
          </span>
          <b>{t(`${key === "screens" ? "scr" : "pow"}.${id}.name`)}</b>
          <small>{key === "powers" && LOCKED.includes(id) ? t("pow.locked") : t(`${key === "screens" ? "scr" : "pow"}.${id}.hint`)}</small>
        </button>
      );
    });

  const shown = members.filter((m) => q.trim() === "" || kucukHarf(m.name, locale).includes(kucukHarf(q.trim(), locale)));
  const peopleList = readOnly && draft !== null ? shown.filter((m) => draft.picked.includes(m.membershipId)) : shown;
  const [mainLabel, mainIcon, main] = MAIN[view];

  return (
    <>
    <div className={`dzr${dark ? " dz-dark" : ""}`} data-testid="groups">
      <div className="wrap">
        <div className="appzone">
          <div className="app">
            <header className="top">
              <span className="brand">
                <span className="alic" style={{ background: view === "list" || draft === null ? dz("6C4BD8") : dz(hexKey(draft.color)), width: 44, height: 44, borderRadius: 14, flex: "none" }}>
                  <Ico d={[RICON.shieldA, RICON.shieldB]} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{titles[view][0]}</b>
                  <small>{titles[view][1]}</small>
                </span>
              </span>
              <span className="net" style={{ position: "static", flex: "none" }} title={t("online")}>
                <i />
              </span>
            </header>
            <div className="stepbar" aria-hidden="true">
              <span style={{ width: `${STEPW[view]}%` }} />
            </div>

            <main className="inner">
              {issue !== null ? (
                <div className="memo" role="alert" data-testid="groups-issue">
                  <span className="mic" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
                    <Ico d={RICON.warn} size={18} />
                  </span>
                  <span>{issue}</span>
                </div>
              ) : null}

              {view === "list" ? (
                <>
                  <div className="shd">
                    <b>{t("heading")}</b>
                    <span>{t("counts", { people: members.length, groups: tiles.length })}</span>
                  </div>
                  <div className="groups">
                    {tiles.map((g, i) => (
                      <button key={g.key} type="button" className="grp" style={{ animationDelay: `${i * 40}ms` }} onClick={() => open(g)} data-group={g.template ?? g.name}>
                        {g.template !== null ? <span className="tpl">{t("ready")}</span> : null}
                        <span className="gic" style={{ background: dz(g.color) }}>
                          <Ico d={[RICON.shieldA, RICON.shieldB]} size={22} />
                        </span>
                        <b>{g.name}</b>
                        <small>{t("tileMeta", { screens: g.screens, n: g.who.length })}</small>
                        <span className="faces">
                          {g.who.slice(0, 3).map((m) => (
                            <span key={m.membershipId} style={{ background: dz(g.color) }}>
                              {initial(m.name, locale)}
                            </span>
                          ))}
                        </span>
                      </button>
                    ))}
                    <button type="button" className="grp new" onClick={startNew} data-testid="groups-new" aria-disabled={!data.canEdit}>
                      <span className="gic" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                        <Ico d={RICON.plus} size={24} />
                      </span>
                      <b>{t("newTile")}</b>
                      <small>{t("newTileHint")}</small>
                    </button>
                  </div>
                  <div className="memo">
                    <span className="mic" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                      <Ico d={RICON.warn} size={18} />
                    </span>
                    <span>{data.canEdit ? t("memo") : t("memoReadOnly")}</span>
                  </div>
                </>
              ) : null}

              {view === "edit" && draft !== null ? (
                <>
                  <div className="gnm">
                    <span className="gic" style={{ background: dz(hexKey(draft.color)), width: 42, height: 42 }}>
                      <Ico d={RICON.shieldA} size={20} />
                    </span>
                    <input
                      id="gname"
                      aria-label={t("nameAria")}
                      value={draft.name}
                      readOnly={readOnly}
                      maxLength={60}
                      onChange={(e) => upd({ name: e.target.value })}
                      onFocus={(e) => {
                        if (draft.id === null && draft.name === t("newName")) e.currentTarget.select();
                      }}
                      data-testid="groups-name"
                    />
                    {!readOnly ? (
                      <span className="swatches" aria-label={t("colorAria")}>
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`sw${hexKey(draft.color) === c ? " on" : ""}`}
                            style={{ background: dz(c) }}
                            aria-label={t("colorItem", { c: withHash(c) })}
                            onClick={() => upd({ color: withHash(c) })}
                          />
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <div className="seg" role="tablist">
                    <button type="button" className={`sg${tab === "scr" ? " on" : ""}`} role="tab" aria-selected={tab === "scr"} onClick={() => setTab("scr")} data-testid="groups-tab-scr">
                      <b>{nScr}</b> {t("tabScr")}
                    </button>
                    <button type="button" className={`sg${tab === "pow" ? " on" : ""}`} role="tab" aria-selected={tab === "pow"} onClick={() => setTab("pow")} data-testid="groups-tab-pow">
                      <b>{nPow}</b> {t("tabPow")}
                    </button>
                  </div>
                  <div className="perms">{tab === "scr" ? card(SCREENS, "screens") : card(POWERS, "powers")}</div>
                  {draft.template !== null ? (
                    <div className="memo">
                      <span className="mic" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                        <Ico d={RICON.warn} size={18} />
                      </span>
                      <span>{t("templateMemo")}</span>
                    </div>
                  ) : null}
                  {draft.id !== null && data.canEdit ? (
                    <button type="button" className="allb" onClick={() => void archive()} disabled={busy} style={{ alignSelf: "flex-start" }} data-testid="groups-archive">
                      <Ico d={RICON.leave} size={18} />
                      {t("archive")}
                    </button>
                  ) : null}
                </>
              ) : null}

              {view === "people" && draft !== null ? (
                <>
                  <div className="phead">
                    <label className="search">
                      <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d={RICON.searchTail} />
                      </svg>
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
                    </label>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="allb"
                        onClick={() => {
                          feedback.ok();
                          upd({ picked: members.filter((m) => !m.isOwner).map((m) => m.membershipId) });
                        }}
                      >
                        <Ico d={RICON.all} size={18} />
                        {t("all")}
                      </button>
                    ) : null}
                  </div>
                  <div className="people" data-many={peopleList.length > 9}>
                    {peopleList.map((m) => {
                      const on = draft.picked.includes(m.membershipId);
                      const locked = readOnly || m.isOwner;
                      return (
                        <button
                          key={m.membershipId}
                          type="button"
                          className={`ppl${on ? " on" : ""}`}
                          aria-pressed={on}
                          aria-disabled={locked}
                          data-person={m.name}
                          onClick={() => {
                            if (m.isOwner && !readOnly) {
                              feedback.error();
                              flash(t("ownerNoGroup"));
                              return;
                            }
                            toggle("picked", m.membershipId);
                          }}
                        >
                          <span className="av" style={{ background: dz(nowColor(m)) }}>
                            {initial(m.name, locale)}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <b>{m.name}</b>
                            <small>{nowLabel(m)}</small>
                          </span>
                          <span className="gchk">
                            <Ico d={RICON.check} size={14} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {view === "done" && draft !== null ? (
                <div className="done" data-testid="groups-done">
                  <span className="dring">
                    <Ico d={RICON.check} size={56} />
                  </span>
                  <b>{t("doneLine", { name: draft.name })}</b>
                  <small>{t("doneMeta", { n: pickedCount, s: nScr, p: nPow })}</small>
                  <div className="memo" style={{ maxWidth: 520 }}>
                    <span className="mic" style={{ background: dz("E3F1E9"), color: dz("17583C") }}>
                      <Ico d={RICON.sync} size={18} />
                    </span>
                    <span>{t("doneMemo")}</span>
                  </div>
                </div>
              ) : null}
            </main>


            {cf !== null ? (
              <>
                <div className="cfback" onClick={() => setCf(null)} />
                <div ref={cfRef} className="cfbox" role="alertdialog" aria-label={t("cf.title")}>
                  <span className="cfic">
                    <Ico d={RICON.warn} size={26} />
                  </span>
                  <b>{t("cf.title")}</b>
                  <p>{t("cf.text", { name: draft?.name ?? "" })}</p>
                  <button
                    type="button"
                    className="cfb save"
                    disabled={busy}
                    onClick={() =>
                      void save().then((ok) => {
                        setCf(null);
                        if (!ok) return;
                        if (cf === "home") window.location.assign(base);
                        else goList();
                      })
                    }
                  >
                    <Ico d={RICON.check} size={20} />
                    {t("cf.save")}
                  </button>
                  {cf === "home" ? (
                    <a href={base} className="cfb leave">
                      <Ico d={RICON.leave} size={20} />
                      {t("cf.leave")}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="cfb leave"
                      onClick={() => {
                        setCf(null);
                        goList();
                      }}
                    >
                      <Ico d={RICON.leave} size={20} />
                      {t("cf.leave")}
                    </button>
                  )}
                  <button type="button" className="cfb stay" onClick={() => setCf(null)}>
                    {t("cf.stay")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    {/* T-958: ortak alt cam çubuk (Kabuk.dc.html): Geri · Ana ekran · ekranın ana işlemi · Modüller · Etkin. */}
    <KabukBar
      dark={dark}
      back={view === "list" ? { href: `${base}/team`, aria: t("backTeam"), testId: "groups-back" } : { onClick: back, aria: t("back"), testId: "groups-back" }}
      homeNav={dirty ? { onClick: () => setCf("home"), aria: t("home"), testId: "groups-home" } : { href: base, aria: t("home"), testId: "groups-home" }}
      main={{ label: mainLabel, d: mainIcon, onClick: main, disabled: busy || (view === "list" && !data.canEdit), testId: "groups-main" }}
    />
    </>
  );
}
