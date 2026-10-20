// T-967 (B-84): destek talebine otomatik eklenen uygulama sürümü. Sağlık ucuyla aynı kaynak (`app/api/health/route.ts` versionOf): Fly imaj
// etiketi `FLY_IMAGE_REF` (`…:git-<sha>`) ya da `APP_VERSION`; biçim dışı → null (uydurulmaz). Yalnız sunucuda çağrılır.
export function appVersionOf(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const candidates = [env.APP_VERSION, env.FLY_IMAGE_REF?.split("@")[0]?.split(":").pop()];
  for (const c of candidates) if (c !== undefined && /^git-[0-9a-f]{7,40}$/.test(c)) return c;
  return null;
}
