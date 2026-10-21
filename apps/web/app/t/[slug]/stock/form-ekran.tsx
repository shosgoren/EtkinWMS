"use client";
// T-972 (B-63 grup 2): yeni belge formlarının (stok girişi/çıkışı/transfer, sevk siparişi, reçete, mal kabul teslimi) FORM kalıbı kabı.
// Alt cam çubuğun ana işlemi ekrandaki formu gönderir (`form.workflow-form` → `requestSubmit`); formun kendi gönder düğmesi ve sunucu
// eylemi değişmez. Geri: bölüm listesi.
// T-990 (B-97, ALTIN-KURAL "Kaydedilmemiş iş uyarısı" + "Form doğrulama"):
//  - Çıkış koruması: formdaki alanların açılış değerleri (görünür alanların anlık görüntüsü) saklanır; `input`/`change` olaylarında güncel
//    değerle karşılaştırılır (`degisti`: yazılıp silinen alan değişiklik sayılmaz). Yarım işte Geri / Ana ekran / bağlantılar yalnız
//    uygulamanın cam kutusunu açar. Durumu React'ta tutulan seçim/satırlar formun `data-dirty="true"` özniteliğiyle bildirilir.
//    Form gönderilince koruma kalkar; kullanıcı yeniden yazarsa yeniden karşılaştırılır.
//  - Ana işlem kapalıysa sessiz kalmaz: hata sesi + neden balonu.
//  - Tarayıcı alan denetimi geçmezse tarayıcının kendi balonu yerine: ilk geçersiz alana kaydırma + odak, hata sesi, balon
//    "N alan eksik: <etiketler>" (etiketler `labels` / `aria-label` / çevreleyen `label`'dan).
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { useCikisKorumasi } from "../kalip/cikis.tsx";
import { degisti } from "../kalip/dogrula.ts";
import { KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { feedback } from "@wms/ui";

const FORM_SEL = ".kalip form.workflow-form";
type Alan = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function formlar(): HTMLFormElement[] {
  return Array.from(document.querySelectorAll<HTMLFormElement>(FORM_SEL));
}

function alanlar(form: HTMLFormElement): Alan[] {
  return Array.from(form.elements).filter(
    (el): el is Alan => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement,
  );
}

/** Kullanıcının değiştirebildiği alanların değerleri (gizli alanlar, düğmeler ve dosyalar karşılaştırmaya girmez). */
function goruntu(form: HTMLFormElement): string[] {
  const out: string[] = [];
  alanlar(form).forEach((el, i) => {
    if (el instanceof HTMLInputElement) {
      if (["hidden", "submit", "button", "reset", "image", "file"].includes(el.type)) return;
      const key = `${el.name || el.id || i}`;
      out.push(el.type === "checkbox" || el.type === "radio" ? `${key}=${el.checked ? el.value : ""}` : `${key}=${el.value}`);
      return;
    }
    if (el instanceof HTMLSelectElement) {
      out.push(`${el.name || el.id || i}=${Array.from(el.selectedOptions, (o) => o.value).join("|")}`);
      return;
    }
    out.push(`${el.name || el.id || i}=${el.value}`);
  });
  return out;
}

/** Alanın kullanıcıya görünen adı: `<label for>` / çevreleyen label / aria-label / placeholder / name. */
function etiket(el: Alan): string {
  const fromLabels = el.labels === null ? "" : Array.from(el.labels, (l) => l.innerText.trim()).find((s) => s !== "") ?? "";
  if (fromLabels !== "") return fromLabels.split("\n")[0]?.trim() ?? fromLabels;
  const aria = el.getAttribute("aria-label")?.trim() ?? "";
  if (aria !== "") return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by !== null) {
    const s = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText.trim() ?? "")
      .filter((x) => x !== "")
      .join(" ");
    if (s !== "") return s;
  }
  const ph = el.getAttribute("placeholder")?.trim() ?? "";
  if (ph !== "") return ph;
  return el.name;
}

export function FormEkran({ kind = "form", heading, dark, title, icon, back, mainLabel, mainAria, children, testId }: { kind?: "form" | "detay"; heading?: boolean; dark: boolean; title: string; icon: { readonly d: string; readonly color: string }; back: string; mainLabel: string; mainAria: string; children: ReactNode; testId?: string }) {
  const t = useTranslations("kalip");
  const { say, node: toast } = useKalipToast("form");
  const [dirty, setDirty] = useState(false);
  // Form başına açılış görüntüsü (adım değişip yeni form gelirse ilk dokunuşta alınır: odak/basma her zaman yazmadan önce gelir).
  const ilk = useRef(new WeakMap<HTMLFormElement, string[]>());
  const sayRef = useRef(say);
  sayRef.current = say;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const base = ilk.current;
    for (const f of formlar()) base.set(f, goruntu(f));
    const yakala = (e: Event): void => {
      const f = e.target instanceof Element ? e.target.closest<HTMLFormElement>(FORM_SEL) : null;
      if (f !== null && !base.has(f)) base.set(f, goruntu(f));
    };
    // Durumu React'ta tutulan seçimler/satırlar (KalipSecim, eklenen satırlar) alan olayı üretmez: form `data-dirty="true"` ile bildirir.
    const hesapla = (): void => {
      setDirty(formlar().some((x) => x.dataset.dirty === "true" || degisti(goruntu(x), base.get(x) ?? goruntu(x))));
    };
    const olc = (e: Event): void => {
      const f = e.target instanceof Element ? e.target.closest<HTMLFormElement>(FORM_SEL) : null;
      // React denetimli alan değeri düzeltebilir (ör. yalnız rakam): karşılaştırma bir kare sonra, güncel DOM değeriyle.
      if (f !== null) window.requestAnimationFrame(hesapla);
    };
    const gozcu = new MutationObserver(hesapla);
    gozcu.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-dirty"] });
    const onSubmit = (e: Event): void => {
      if (!(e.target instanceof HTMLFormElement) || !e.target.matches(FORM_SEL)) return;
      // Doğrulamayı geçip gönderilen form: koruma kalkar (sunucu sonucu formun kendi alanında görünür).
      setDirty(false);
    };
    // Tarayıcı alan denetimi: kendi balonu yerine tek ortak geri bildirim (ilk geçersiz alana odak, ses, "N alan eksik: …").
    let bekleyen: Alan[] = [];
    let raf = 0;
    const onInvalid = (e: Event): void => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
      if (el.form === null || !el.form.matches(FORM_SEL)) return;
      e.preventDefault();
      bekleyen.push(el);
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const list = bekleyen;
        bekleyen = [];
        bildir(list);
      });
    };
    const bildir = (list: Alan[]): void => {
      if (list.length === 0) return;
      const tr = tRef.current;
      const eksik = list.filter((x) => x.validity.valueMissing);
      const hatali = list.filter((x) => !x.validity.valueMissing);
      const ad = (xs: Alan[]): string => [...new Set(xs.map(etiket))].join(", ");
      const parts: string[] = [];
      if (eksik.length > 0) parts.push(tr("vMissing", { n: eksik.length, list: ad(eksik) }));
      if (hatali.length > 0) parts.push(tr("vInvalid", { n: hatali.length, list: ad(hatali) }));
      feedback.error();
      sayRef.current("err", parts.join(" · "));
      const first = list[0];
      if (first === undefined) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      first.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      first.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", yakala, true);
    document.addEventListener("pointerdown", yakala, true);
    document.addEventListener("input", olc, true);
    document.addEventListener("change", olc, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("invalid", onInvalid, true);
    return () => {
      gozcu.disconnect();
      window.cancelAnimationFrame(raf);
      document.removeEventListener("focusin", yakala, true);
      document.removeEventListener("pointerdown", yakala, true);
      document.removeEventListener("input", olc, true);
      document.removeEventListener("change", olc, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("invalid", onInvalid, true);
    };
  }, []);

  const korunan = useCikisKorumasi(dirty, { dark });

  return (
    <KalipEkran
      kind={kind}
      {...(heading === undefined ? {} : { heading })}
      dark={dark}
      title={title}
      icon={icon}
      testId={testId ?? "kalip-form"}
      bar={{
        // Bağlantı kalır (href); KabukBar bağlantısı istemci içi geçiştir ve yarım işte `cikisSor` ile ortak cam kutuya sorar.
        back: { href: back, aria: t("back") },
        main: {
          label: mainLabel,
          aria: mainAria,
          d: LICON.check,
          testId: "kalip-form-save",
          onClick: () => {
            const form = document.querySelector<HTMLFormElement>(FORM_SEL);
            const primary = form?.querySelector<HTMLButtonElement>(".workflow-primary") ?? form?.querySelector<HTMLButtonElement>('button[type="submit"]');
            if (form === null || form === undefined) {
              say("err", t("mainOff"));
              return;
            }
            // Alan denetimi geçmezse `invalid` olayları ortak geri bildirimi verir (checkValidity tarayıcı balonu açmaz).
            if (!form.checkValidity()) return;
            if (primary?.disabled === true) {
              say("err", t("formFirst"));
              primary.scrollIntoView({ block: "center" });
              return;
            }
            feedback.minor();
            form.requestSubmit(primary ?? undefined);
          },
        },
      }}
      overlays={
        <>
          {toast}
          {korunan.kutu}
        </>
      }
    >
      {children}
    </KalipEkran>
  );
}
