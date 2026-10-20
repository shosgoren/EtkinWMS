"use client";
// Toplu yayın (21 Ekim, T-967 × T-968): kalıp üst çubuğunun sağ üst `.tph` yuvasının VARSAYILANI — kaynak KalipListe/Form/Detay
// `.helpb` (Sorun bildir, sarı üçgen) + `.helpb.sup` (Destek, kulaklık) düğmeleri; tuvaldeki `.ph` yer tutucu çizgisi asıl düğmede yok.
// Davranış Pano üst çubuğuyla aynı (T-967): Sorun bildir → mevcut Sorun penceresi (ProblemSheet, yöneticiye; yalnız bildirme yetkisi
// olana), Destek → Destek penceresi ya da talep varsa Taleplerim (Etkin ekibine); talepler açılışta değil Destek'e dokununca yüklenir (her ekran açılışında sunucu eylemi = işlem hız sınırı bütçesi).
// İkon yolları kaynaktan (LICON.warn / LICON.support), pencereler T-967 support-layer bileşenleri; kalıp kabının (`.dzl/.dzf/.dzd`)
// `.app`/`.top` kuralları pencerelere sızmasın diye pencereler `body`ye taşınır (portal).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LICON } from "../../../design/kalip-icons.ts";
import { ProblemSheet } from "../problem-sheet.tsx";
import { SupportList, SupportSheet, useSupport } from "../pano/support-layer.tsx";
import { Ico, tone } from "./ekran.tsx";

export function KalipDestek({ slug, dark, canReport }: { slug: string; dark: boolean; canReport: boolean }) {
  const td = useTranslations("destek");
  const support = useSupport(slug, false);
  const [problem, setProblem] = useState(false);
  const [help, setHelp] = useState<"form" | "list" | null>(null);
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  const hasTickets = (support.tickets?.length ?? 0) > 0;
  const closeHelp = useCallback(() => {
    setHelp(null);
    setSentCode(null);
  }, []);
  const openForm = useCallback(() => {
    tone("tap");
    setSentCode(null);
    setHelp("form");
  }, []);
  return (
    <>
      {canReport ? (
        <button
          type="button"
          className="helpb"
          aria-label={td("issue")}
          title={td("issueTitle")}
          aria-haspopup="dialog"
          aria-expanded={problem}
          onClick={() => {
            tone("tap");
            setHelp(null);
            setProblem(true);
          }}
          data-testid="kalip-problem"
        >
          <Ico d={LICON.warn} size={22} />
        </button>
      ) : null}
      <button
        type="button"
        className="helpb sup"
        aria-label={support.unread > 0 ? td("helpUnread", { n: support.unread }) : td("help")}
        title={td("helpTitle")}
        aria-haspopup="dialog"
        aria-expanded={help !== null}
        onClick={() => {
          tone("tap");
          setProblem(false);
          setSentCode(null);
          // Talepler açılışta yüklenmez (hız sınırı bütçesi); dokununca bir kez yüklenir, talep varsa Taleplerim.
          void support.reload().then((n) => setHelp((n ?? (hasTickets ? 1 : 0)) > 0 ? "list" : "form"));
        }}
        data-testid="kalip-support"
      >
        <Ico d={LICON.support} size={22} />
      </button>
      {host === null ? null : createPortal(<>
      {help === "list" ? (
        <SupportList
          slug={slug}
          dark={dark}
          state={support}
          sentCode={sentCode}
          canReport={canReport}
          team={false}
          onIssue={() => {
            tone("tap");
            closeHelp();
            setProblem(true);
          }}
          onNew={openForm}
          onTeam={closeHelp}
          onClose={closeHelp}
        />
      ) : null}
      {help === "form" ? (
        <SupportSheet
          slug={slug}
          dark={dark}
          appVersion={null}
          onClose={closeHelp}
          onSent={(code) => {
            setSentCode(code);
            setHelp("list");
            void support.reload();
          }}
        />
      ) : null}
      {problem && canReport ? (
        <div className={`dz dzp-pop${dark ? " dz-dark" : ""}`}>
          <ProblemSheet slug={slug} onClose={() => setProblem(false)} />
        </div>
      ) : null}
      </>, host)}
    </>
  );
}
