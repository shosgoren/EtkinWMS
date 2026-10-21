import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { buyukHarf } from "@wms/ui";
import { getAppDb } from "@wms/db";
import { getSupportTicket, isSupportWhatsAppConfigured, listSupportInbox } from "@wms/domain/platform/support";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../design/theme.ts";
import { ticketNo } from "../../support-format.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { panelLabels, panelNav } from "../nav.ts";
import { PanelShell } from "../shell.tsx";
import { supportReplyAction, supportStatusAction } from "./actions.ts";
import { destekMsgs, deviceOf, initials, panelWhen, rowItem } from "./format.ts";
import {
  NotifySettings,
  SupportDetail,
  SupportInbox,
  statusStyle,
  type InboxFilter,
} from "./view.tsx";

// Panel · Destek gelen kutusu ve talep detayı (yonet.etkinyazilim.com/support[?t=<id>]; T-967, B-84). Yalnız platform operatörü
// (domain + 0054 veritabanı işlevi). Talep metni yalnız bu ekrana gelir; depo verisi açılmaz.
export const dynamic = "force-dynamic";

const PATH = "/support";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.destek");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await panelOperatorOrExit(PATH);
  const db = getAppDb();
  const onMissing = (e: unknown): never => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  };
  const query = await searchParams;
  const m = await destekMsgs();
  const locale = await getLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const dark = temaKoyu(await cookies());
  const now = new Date();
  const inbox = await listSupportInbox({ db, principal, status: "ALL" }).catch(onMissing);
  const shell = { dark, nav: await panelNav(principal, undefined, undefined, inbox.openCount), labels: await panelLabels() };

  const picked = first(query.t);
  if (picked !== undefined) {
    const tk = await getSupportTicket({ db, principal, ticketId: picked }).catch((e: unknown) => {
      if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED")) notFound();
      throw e;
    });
    const author = tk.authorName ?? m.noName;
    const st = statusStyle(tk.status);
    const code = tk.context.supportCode;
    const sub = buyukHarf([ticketNo(tk.number), tk.tenantName, ...(code === null ? [] : [`${m.kCode} ${code}`])].join(" · "), locale);
    const firstLine = tk.body.split("\n")[0] ?? "";
    const hist = [
      { t: panelWhen(tk.createdAt, now, m), l: m.hOpened.replace("{name}", () => author) },
      ...tk.messages
        .slice(1)
        .map((x) => ({ t: panelWhen(x.createdAt, now, m), l: (x.authorKind === "OPERATOR" ? m.hOperator : m.hCustomer.replace("{name}", () => author)).replace("{body}", () => x.body) })),
    ];
    return (
      <PanelShell {...shell} current="destek" title={firstLine === "" ? ticketNo(tk.number) : firstLine} sub={sub} backHref={PATH} badge={{ label: m.st[tk.status], bg: st.bg, fg: st.fg }}>
        <SupportDetail
          key={`${tk.id}-${tk.status}-${tk.messageCount}`}
          tk={{
            id: tk.id,
            status: tk.status,
            initials: initials(author, locale),
            author,
            authorSub: panelWhen(tk.createdAt, now, m),
            topic: tk.subjectKind,
            body: tk.body,
            info: [
              { k: m.kRoute, v: tk.context.route ?? "—", mono: true },
              { k: m.kVersion, v: tk.context.appVersion ?? "—", mono: true },
              { k: m.kCode, v: code ?? "—", mono: true },
              { k: m.kDevice, v: deviceOf(tk.context.userAgent, m), mono: false },
              { k: m.kWorkspace, v: `${m.host}/${tk.tenantSlug}`, mono: true },
            ],
            hist,
          }}
          labels={m}
          reply={supportReplyAction}
          status={supportStatusAction}
        />
      </PanelShell>
    );
  }

  const s = first(query.s);
  const filter: InboxFilter = s === "OPEN" || s === "ANSWERED" || s === "CLOSED" ? s : "ALL";
  return (
    <PanelShell {...shell} current="destek" title={m.title} sub={m.sub.replace("{n}", String(inbox.openCount))}>
      <SupportInbox
        key={filter}
        rows={inbox.rows.map((r) => rowItem(r, now, m))}
        filter={filter}
        q={first(query.q) ?? ""}
        labels={m}
        settings={<NotifySettings whatsapp={isSupportWhatsAppConfigured()} labels={m.notify} />}
      />
    </PanelShell>
  );
}
