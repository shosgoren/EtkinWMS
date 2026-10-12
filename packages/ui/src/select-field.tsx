"use client";
// Seçim alanı (T-912). Gerçek bir `<select>` sarmalanır: formlar, Playwright `selectOption`, ekran okuyucular ve dokunmatik
// cihazların yerel seçici penceresi aynen çalışır. Yalnızca hassas işaretçili (fare) cihazlarda tarayıcının tasarıma
// uymayan yerel açılır listesi yerine aynı görünümde kendi liste kutumuz açılır; seçim yine `<select>` değerine yazılır ve
// `change` olayı tetiklenir (React `onChange` dahil). Klavye kullanımı yerel `<select>` davranışıdır (ok tuşları, harfle arama).
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children"> {
  label: string;
  hint?: ReactNode;
  options: readonly SelectOption[];
  /** `id` verilmezse üretilir; `name` formda gönderilen alan adıdır. */
  id?: string;
}

const FIELD =
  "bg-none min-h-12 w-full min-w-0 appearance-none rounded-card border-2 border-border-strong bg-surface py-2 pl-4 pr-12 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60";

function finePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
}

export function SelectField({ label, hint, options, id: givenId, onChange, disabled, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = `${id}-hint`;
  const listId = `${id}-listbox`;
  const selectRef = useRef<HTMLSelectElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const currentValue = (): string => selectRef.current?.value ?? String(rest.value ?? rest.defaultValue ?? "");

  function commit(value: string) {
    const el = selectRef.current;
    if (el !== null && el.value !== value) {
      el.value = value;
      // React'in kontrollü `onChange` yolunu da çalıştırır (native `change` kabarcıklanır).
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
    el?.focus();
  }

  // Dışarı tıklama / Escape kapatır; liste açılınca seçili satır odakta.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (listRef.current?.contains(t) || selectRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        selectRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    items?.[active]?.focus();
  }, [open, active]);

  function openList() {
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === currentValue()),
    );
    setActive(idx);
    setOpen(true);
  }

  function onListKey(e: React.KeyboardEvent<HTMLUListElement>) {
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    const pos = enabled.indexOf(active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(enabled[Math.min(enabled.length - 1, pos + 1)] ?? active);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(enabled[Math.max(0, pos - 1)] ?? active);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(enabled[0] ?? active);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(enabled[enabled.length - 1] ?? active);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o !== undefined && !o.disabled) commit(o.value);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-base font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <span id={hintId} className="text-sm text-ink-muted">
          {hint}
        </span>
      ) : null}
      <div className="relative min-w-0">
        <select
          {...rest}
          id={id}
          ref={selectRef}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          aria-expanded={open || undefined}
          aria-controls={open ? listId : undefined}
          onChange={onChange}
          onMouseDown={(e) => {
            // Fare: yerel pencere yerine kendi listemiz. Dokunmatik/klavye: tarayıcının kendi seçicisi (en iyi erişilebilirlik).
            if (disabled || !finePointer()) return;
            e.preventDefault();
            if (open) setOpen(false);
            else openList();
          }}
          onKeyDown={(e) => {
            if (disabled || !finePointer()) return;
            if (e.key === "ArrowDown" && e.altKey) {
              e.preventDefault();
              openList();
            }
          }}
          className={FIELD}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-ink-muted" />
        {open ? (
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-labelledby={id}
            tabIndex={-1}
            onKeyDown={onListKey}
            data-testid="select-listbox"
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-card border-2 border-border-strong bg-surface p-1 shadow-card"
          >
            {options.map((o, i) => {
              const selected = o.value === currentValue();
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  tabIndex={i === active ? 0 : -1}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => !o.disabled && commit(o.value)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 text-base text-ink outline-none ${i === active ? "bg-accent-soft" : ""} ${o.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <span className="min-w-0 flex-1 break-words">{o.label}</span>
                  {selected ? <Check aria-hidden="true" className="size-5 shrink-0 text-accent" /> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
