"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.auth` kabuğu + `v.pick` (BİRDEN ÇOK ÜYELİK · Çalışma alanı seçin) BİREBİR. Sınıf adları, öğe sırası,
// ikon yolu ve metinler kaynaktan; CSS `app/design/giris.css`. Satır seçimi alanı açar (bağlantı); "SON" çipi ve seçili çerçeve sunucudaki
// son kullanılan alandır (T-999, 0048). Kabuk saha girişiyle ortaktır (`field/flow.tsx` `Shell`).
import { useLocale, useTranslations } from "next-intl";
import { buyukHarf } from "@wms/ui";
import { DzRoot } from "../design/dz-root.tsx";
import { C, dz } from "../design/giris-tokens.ts";
import { Ico, Shell } from "../field/flow.tsx";

export interface PickRow {
  readonly slug: string;
  readonly name: string;
  readonly roles: string;
  readonly last: boolean;
}

const TONE: readonly (readonly [string, string])[] = [
  ["FFE7A8", "4A3500"],
  ["CFE8DA", "0F3D27"],
  ["DCE4F8", "1C2E5C"],
  ["F6D9C9", "5C2410"],
];
const CHEVRON = "M9 6l6 6-6 6";

/** Kaynaktaki `ini`: kelimelerin baş harfleri (harf/rakam olmayan karakterler atlanır), en çok iki, büyük harf. */
export function initials(name: string, locale: string): string {
  return buyukHarf(
    name
      .split(" ")
      .map((x) => Array.from(x).find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? "")
      .join("")
      .slice(0, 2),
    locale,
  );
}

export function WorkspacePicker({ dark, host, rows }: { dark: boolean; host: string; rows: readonly PickRow[] }) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="workspaces">
      <Picker host={host} rows={rows} />
    </DzRoot>
  );
}

function Picker({ host, rows }: { host: string; rows: readonly PickRow[] }) {
  const t = useTranslations("workspaces");
  const locale = useLocale(); // T-1001 (ALTIN-KURAL 16): kullanıcının dili
  return (
    <Shell fact={false}>
      <span className="kick">{t("kick")}</span>
      <h1 className="lh">{t("heading")}</h1>
      <div className="rows">
        {rows.map((w, i) => {
          const tone = TONE[i % TONE.length] ?? ["FFE7A8", "4A3500"];
          return (
            <a
              key={w.slug}
              href={`/t/${encodeURIComponent(w.slug)}`}
              className={w.last ? "row sel" : "row"}
              style={{ background: C.surface, color: "inherit", textDecoration: "none" }}
              aria-current={w.last ? "true" : undefined}
            >
              <span className="av" style={{ background: dz(tone[0]), color: dz(tone[1]) }}>
                {initials(w.name, locale)}
              </span>
              <span className="rt">
                <b>{w.name}</b>
                <span>{`${host}/${w.slug} · ${buyukHarf(w.roles, locale)}`}</span>
              </span>
              {w.last ? (
                <span className="chip" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                  {t("last")}
                </span>
              ) : null}
              <Ico d={CHEVRON} size={26} sw={3} />
            </a>
          );
        })}
      </div>
      <p className="ls" style={{ margin: 0 }}>
        {t("note")}
      </p>
    </Shell>
  );
}
