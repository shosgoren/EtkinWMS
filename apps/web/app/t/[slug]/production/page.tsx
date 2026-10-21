import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getProductionRecipe, listProductionRecipes } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipDetayIzgara, KalipHero, KalipKartBolum, KalipZaman, type KalipOlay } from "../kalip/detay.tsx";
import { KalipBaslik, KalipEkran } from "../kalip/ekran.tsx";
import { fmtQty } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, KalipKilitliEkran } from "../kalip/liste.tsx";
import { BOLUM_ICON, bolumCipleri, kalipDark } from "../stock/belge-kalip.ts";
import { FormEkran } from "../stock/form-ekran.tsx";
import { NewRecipeForm, ProductionForm } from "./production-form.tsx";

// Üretim ve reçeteler (T-972, B-63 grup 2): reçete listesi (KalipListe), reçete ayrıntısı + üretim kaydı (KalipDetay; ana işlem formu
// gönderir), yeni reçete (KalipForm). Veri, yetki ve eylemler değişmedi (tüketim + üretim tek işlemde, sunucuda; I-15 kilitleri eylemde).
export const dynamic = "force-dynamic";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProductionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params,
    sp = await searchParams,
    t = await getTranslations("production"),
    so = await getTranslations("stockOverview"),
    tk = await getTranslations("kural"),
    locale = await getLocale(),
    home = `/t/${encodeURIComponent(slug)}`,
    path = `${home}/production`;
  const id = first(sp.id),
    q = first(sp.q) ?? "",
    after = first(sp.after);
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (!principal) redirect(`/login?next=${encodeURIComponent(path)}`);
  const dark = await kalipDark();
  let data: Awaited<ReturnType<typeof listProductionRecipes>>, recipe: Awaited<ReturnType<typeof getProductionRecipe>> | null;
  try {
    const context = { db: getAppDb(), principal, tenantSlug: slug };
    data = await listProductionRecipes(context, { q, withTotal: !id && first(sp.new) !== "1", ...(after ? { after } : {}) });
    recipe = id ? await getProductionRecipe(context, id) : null;
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
      if (e.code === "FORBIDDEN")
        return (
          <main className="flex w-full min-w-0 flex-col">
            <KalipKilitliEkran title={t("title")} icon={BOLUM_ICON.production} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={home} />
          </main>
        );
    }
    throw e;
  }
  const fq = (v: string) => fmtQty(v, locale);

  if (recipe) {
    const materials: KalipOlay[] = recipe.lines.map((line) => ({
      key: String(line.lineNo),
      title: line.itemName,
      meta: line.itemCode,
      q: `−${fq(line.quantity)} ${line.unitCode}`,
      d: LICON.box,
      color: "0E7C7B",
      qColor: "C62828",
    }));
    const hero = (
      <KalipHero
        label={t("k.hero")}
        name={`${recipe.code} / ${recipe.version} — ${recipe.name}`}
        code={recipe.outputCode}
        tags={[recipe.outputName]}
        d={BOLUM_ICON.production.d}
        color={BOLUM_ICON.production.color}
        total={{ value: fq(recipe.outputQuantity), sub: recipe.unitCode, crit: false }}
        testId="recipe-hero"
      />
    );
    const body = (
      <KalipDetayIzgara
        left={
          <>
            {hero}
            <KalipKartBolum title={t("material")} sub={t("k.materialsSub", { qty: fq(recipe.outputQuantity), unit: recipe.unitCode, name: recipe.outputName })} d={LICON.box} color="0E7C7B" testId="recipe-materials">
              <KalipZaman items={materials} />
            </KalipKartBolum>
          </>
        }
        right={
          <KalipKartBolum title={t("k.produce")} sub={t("k.produceSub")} d={LICON.uret} color="30475A" testId="recipe-produce">
            {data.canPost ? <ProductionForm slug={slug} recipe={recipe} /> : <small className="mono" data-testid="recipe-locked">{t("locked")}</small>}
          </KalipKartBolum>
        }
      />
    );
    return (
      <main className="flex w-full min-w-0 flex-col">
        {data.canPost ? (
          <FormEkran kind="detay" heading={false} dark={dark} title={t("title")} icon={BOLUM_ICON.production} back={path} mainLabel={t("k.produceShort")} mainAria={t("k.produce")} testId="recipe-detail">
            {body}
          </FormEkran>
        ) : (
          <KalipEkran kind="detay" dark={dark} title={t("title")} icon={BOLUM_ICON.production} heading={false} testId="recipe-detail" bar={{ back: { href: path }, main: { label: t("k.produceShort"), aria: t("k.produce"), d: LICON.uret, disabled: true } }}>
            {body}
          </KalipEkran>
        )}
      </main>
    );
  }

  if (first(sp.new) === "1") {
    if (!data.canCreate)
      return (
        <main className="flex w-full min-w-0 flex-col">
          <KalipKilitliEkran title={t("new")} icon={BOLUM_ICON.production} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={path} />
        </main>
      );
    return (
      <main className="flex w-full min-w-0 flex-col">
        <FormEkran dark={dark} title={t("new")} icon={BOLUM_ICON.production} back={path} mainLabel={t("k.saveShort")} mainAria={t("k.saveAria")} testId="recipe-new">
          <NewRecipeForm slug={slug} />
        </FormEkran>
      </main>
    );
  }

  const chips = bolumCipleri(home, "production", { stock: so("k.chipStock"), documents: so("k.chipDocs"), shipping: so("k.chipShipping"), production: so("k.chipProduction") });
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={BOLUM_ICON.production}
        testId="production"
        bar={{ back: { href: home }, main: { label: t("k.newShort"), aria: t("new"), d: LICON.plus, href: `${path}?new=1`, disabled: !data.canCreate, testId: "production-new" } }}
      >
        <KalipAra label={t("search")} placeholder={t("search")} action={path} defaultValue={q} />
        <KalipCipler label={so("k.chips")} chips={chips} />
        {data.items.length === 0 ? (
          <KalipBos
            title={q !== "" ? tk("notFoundSearch") : t("empty")}
            hint={data.canCreate ? t("k.emptyHint") : t("k.lockedHint")}
            action={q !== "" ? { label: so("reset"), href: path, kind: "clear" } : data.canCreate ? { label: t("k.firstRecipe"), href: `${path}?new=1`, kind: "add" } : { label: tk("home"), href: home, kind: "go" }}
            iconD={BOLUM_ICON.production.d}
          />
        ) : (
          <>
            <KalipBaslik title={data.total !== undefined ? t("k.count", { n: data.total }) : data.next === null && after === undefined ? t("k.count", { n: data.items.length }) : t("k.countMore", { n: data.items.length })} hint={t("k.hint")} />
            <KalipKartListe label={t("title")}>
              {data.items.map((row, i) => (
                <KalipKart
                  key={row.id}
                  index={i}
                  name={row.name}
                  code={`${row.code} / ${row.version}`}
                  meta={row.outputName}
                  d={BOLUM_ICON.production.d}
                  color={BOLUM_ICON.production.color}
                  badge={{ value: fq(row.outputQuantity), sub: row.unitCode }}
                  href={`${path}?id=${row.id}`}
                  aria={t("k.cardAria", { code: row.code, version: row.version, name: row.name, output: row.outputName, qty: fq(row.outputQuantity), unit: row.unitCode })}
                  testId="recipe-card"
                />
              ))}
            </KalipKartListe>
          </>
        )}
        {data.next ? (
          <KalipDaha href={`${path}?${new URLSearchParams({ q, after: data.next })}`} iconD={LICON.plus}>
            {t("next")}
          </KalipDaha>
        ) : null}
      </KalipEkran>
    </main>
  );
}
