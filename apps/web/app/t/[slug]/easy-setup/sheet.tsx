"use client";
// Form penceresi (T-250; T-974 B-63 grup B: kalıp penceresi). Görünüm ve davranış `kalip/pencere.tsx` KalipPencere'dedir: telefonda alt cam
// sayfa, masaüstünde ortada aynı kutu; başlık sabit, gövde kendi içinde kayar, düğme satırı altta. Yerel `<dialog>` modal olduğundan odak
// tuzağı ve Escape tarayıcıdadır. Sözleşme (open/title/titleId/onClose/onSubmit/footer) değişmedi.
import type { FormEvent, ReactNode } from "react";
import { KalipPencere } from "../kalip/pencere.tsx";

export function Sheet({
  open,
  title,
  titleId,
  onClose,
  onSubmit,
  footer,
  icon,
  busy,
  children,
}: {
  open: boolean;
  title: string;
  titleId: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Eylem çubuğu içeriği (düğmeler; `KalipPencereDugme`). */
  footer: ReactNode;
  /** Başlık ikonu (kalıp ikon yolu + kaynak rengi). */
  icon?: { readonly d: string; readonly color: string };
  /** Sunucu çağrısı sürüyor: Esc ve perde kapatmaz. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <KalipPencere open={open} title={title} titleId={titleId} onClose={onClose} onSubmit={onSubmit} footer={footer} {...(icon === undefined ? {} : { icon })} {...(busy === undefined ? {} : { busy })}>
      {children}
    </KalipPencere>
  );
}

/** Form açıkken arkadaki sayfa içeriğini akıştan çıkarır (sayfa gövdesi kaymasın; yalnız form kendi içinde kayar). */
export function PageBody({ hide, children }: { hide: boolean; children: ReactNode }) {
  return (
    <div data-hide={hide} className="flex min-w-0 flex-col gap-4 data-[hide=true]:hidden">
      {children}
    </div>
  );
}
