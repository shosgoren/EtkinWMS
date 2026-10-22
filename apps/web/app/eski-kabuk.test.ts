// T-1012 (kullanıcı bildirimi 22 Ekim: geçişte eski üst çubuk bir an görünüp kayboluyor): eski "Kolay mod · İşlemler/Genel bakış · Yardım"
// çubuğu kök yerleşimde oluşturulmaz; yalnız karşılama sayfası (`/`) çizer. Ekran ekran CSS gizlemesi (`body:has(.x) .app-header`) geri
// gelmez: yükleme/hata/bulunamadı ve istemci içi geçiş bu sınıflara bağlı olmamalı.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP = __dirname;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p, ext);
    return ext.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("eski kök üst çubuğu (T-1012)", () => {
  it("kök yerleşim eski çubuğu ve karşılama başlığını oluşturmaz", () => {
    const src = readFileSync(join(APP, "layout.tsx"), "utf8");
    expect(src).not.toContain("app-header");
    expect(src).not.toContain("WelcomeHeader");
    expect(src).not.toContain("GuideTrigger");
  });

  it("eski çubuğu yalnız karşılama başlığı çizer; onu yalnız karşılama sayfası kullanır", () => {
    const owners = files(APP, /\.tsx$/).filter((f) => readFileSync(f, "utf8").includes('className="app-header')).map((f) => relative(APP, f));
    expect(owners).toEqual(["welcome-header.tsx"]);
    const users = files(APP, /\.tsx$/).filter((f) => /from "\.\/welcome-header\.tsx"/.test(readFileSync(f, "utf8"))).map((f) => relative(APP, f));
    expect(users).toEqual(["page.tsx"]);
  });

  it("çalışma alanı ekranları (yükleme/hata/bulunamadı dahil) eski çubuğa bağlı değildir ve CSS ile gizleme kuralı yoktur", () => {
    for (const f of files(join(APP, "t"), /\.tsx?$/)) expect(readFileSync(f, "utf8"), relative(APP, f)).not.toMatch(/welcome-header|app-header/);
    for (const f of files(APP, /\.css$/)) expect(readFileSync(f, "utf8"), relative(APP, f)).not.toMatch(/:has\([^)]*\)\s*\.app-header/);
  });
});
