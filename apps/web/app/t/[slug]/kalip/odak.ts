"use client";
// T-436 (ALTIN-KURAL 11): perde / pencere / menü odak davranışı tek kancada. T-980 perdeyi tek bileşende birleştirince bu kanca o
// bileşene bağlanır; o zamana kadar mevcut perde ve pencereler kullanır.
// - Esc kapatır (`busy` iken kapatmaz).
// - Odak perdenin içinde tutulur (Tab / Shift+Tab döner).
// - Açılınca odak perdeye (ya da ilk öğeye) gider; kapanınca AÇAN öğeye döner.
import { useEffect, useRef, type RefObject } from "react";

const ODAKLANIR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalFocusOptions {
  /** Kapatma isteği (Esc). Verilmezse Esc bir şey yapmaz. */
  readonly onClose?: () => void;
  /** Sunucu çağrısı sürüyor: Esc kapatmaz. */
  readonly busy?: boolean;
  /** Açılınca odak: kabın kendisi (varsayılan; telefonda klavye açılmaz) ya da ilk odaklanır öğe. */
  readonly initial?: "container" | "first" | "none";
  /** Odak tuzağı (varsayılan açık; yerel `<dialog>` zaten tutar). */
  readonly trap?: boolean;
}

/** Kap içindeki odaklanabilir öğeler (görünür olanlar). */
export function odaklanirlar(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ODAKLANIR)].filter((e) => e.getClientRects().length > 0 || e === document.activeElement);
}

export function useModalFocus(open: boolean, ref: RefObject<HTMLElement | null>, opts: ModalFocusOptions = {}): void {
  const opener = useRef<HTMLElement | null>(null);
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    opener.current = prev instanceof HTMLElement && prev !== document.body ? prev : null;
    const root = ref.current;
    const initial = o.current.initial ?? "container";
    if (root !== null && initial !== "none" && !root.contains(document.activeElement)) {
      if (initial === "first") (odaklanirlar(root)[0] ?? root).focus();
      else {
        if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
        root.focus();
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      const el = ref.current;
      if (e.key === "Escape") {
        if (o.current.busy === true || o.current.onClose === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        o.current.onClose();
        return;
      }
      if (e.key !== "Tab" || el === null || o.current.trap === false) return;
      const f = odaklanirlar(el);
      if (f.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (a === last || (a !== null && !el.contains(a)))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Kapanınca odak açan öğeye döner (hâlâ sayfadaysa).
      const back = opener.current;
      opener.current = null;
      if (back !== null && back.isConnected) {
        window.setTimeout(() => {
          // Kullanıcı bu arada başka bir öğeye geçtiyse (ör. menüden bağlantı) odağı çalma.
          const a = document.activeElement;
          const bos = a === null || a === document.body || !a.isConnected || (ref.current !== null && ref.current.contains(a));
          if (back.isConnected && bos) back.focus({ preventScroll: true });
        }, 0);
      }
    };
  }, [open, ref]);
}
