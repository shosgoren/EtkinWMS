// T-1107 (27 Ekim genel kontrol): birleştirme çakışması çözülürken düşen tek bir "}" (T-1103) bütün web derlemesini kırdı ve ancak CI
// derleme işinde görüldü. Tasarım CSS'lerinde süslü parantez dengesi, kapanmamış yorum/dize ve unutulmuş çakışma işareti burada, birim
// testinde yakalanır (yeni bağımlılık yok; yorum ve dize içindeki parantezler sayılmaz).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dosyalar = [
  ...readdirSync(here)
    .filter((f) => f.endsWith(".css"))
    .map((f) => join(here, f)),
  join(here, "..", "globals.css"),
];

/** İlk sorunu döndürür; sorun yoksa `null`. */
function cssSorunu(css: string): string | null {
  const satir = (i: number): number => css.slice(0, i).split("\n").length;
  const cakisma = /^(<{7}|={7}|>{7})( |$)/m.exec(css);
  if (cakisma) return `çakışma işareti (satır ${satir(cakisma.index)})`;
  const acik: number[] = [];
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const son = css.indexOf("*/", i + 2);
      if (son < 0) return `kapanmamış yorum (satır ${satir(i)})`;
      i = son + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      if (css[j] !== c) return `kapanmamış dize (satır ${satir(i)})`;
      i = j;
    } else if (c === "{") acik.push(i);
    else if (c === "}" && acik.pop() === undefined) return `fazla "}" (satır ${satir(i)})`;
  }
  return acik.length > 0 ? `kapanmamış "{" (satır ${satir(acik[acik.length - 1]!)})` : null;
}

describe("tasarım CSS bütünlüğü", () => {
  it("denetleyici bozuk örnekleri yakalar", () => {
    expect(cssSorunu(".a { color: red; }")).toBeNull();
    expect(cssSorunu('.a::after { content: "}"; } /* { */')).toBeNull();
    expect(cssSorunu(".a { .b { color: red; }")).toMatch(/kapanmamış "\{"/);
    expect(cssSorunu(".a { } }")).toMatch(/fazla/);
    expect(cssSorunu("<<<<<<< HEAD\n.a {}\n=======\n.b {}\n>>>>>>> main\n")).toMatch(/çakışma/);
    expect(cssSorunu(".a {} /* açık")).toMatch(/yorum/);
  });

  it.each(dosyalar.map((f) => [relative(here, f)]))("%s dengeli", (ad) => {
    expect(cssSorunu(readFileSync(join(here, ad), "utf8"))).toBeNull();
  });
});
