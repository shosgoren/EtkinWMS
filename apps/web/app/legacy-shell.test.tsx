import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { LegacyShell } from "./legacy-shell.tsx";

function render(contentClass: string) {
  return renderToStaticMarkup(<>
    <LegacyShell><header className="app-header">Eski kabuk</header></LegacyShell>
    <main className={contentClass}>Sayfa içeriği</main>
  </>);
}

beforeEach(() => { route.pathname = "/"; });

describe("eski kabuğun yol bazlı ilk render sınırı", () => {
  it.each(["/t", "/t/", "/t/demo", "/t/demo/items", "/t/demo/olmayan-ekran"])("%s yolunda tasarım sınıfından bağımsız olarak eski kabuk oluşturmaz", (pathname) => {
    route.pathname = pathname;
    for (const content of ["kalip", "dzp", "kisk", "khe"]) {
      const html = render(content);
      expect(html).not.toContain("app-header");
      expect(html).toContain(`<main class="${content}">Sayfa içeriği</main>`);
    }
  });

  it.each(["/", "/login", "/field", "/help", "/workspaces", "/team", "/tarih"])("%s yolundaki mevcut başlığı korur", (pathname) => {
    route.pathname = pathname;
    const html = render("diger");
    expect(html).toContain('class="app-header"');
    expect(html).toContain("Sayfa içeriği");
  });
});
