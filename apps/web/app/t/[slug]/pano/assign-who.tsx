"use client";
// T-422 (I-18): Pano "Atanmayı bekleyen işler" satırındaki kişi yuvarlakları (kaynak `.act > button.av`): kişiye dokun, iş ona gitsin.
// Atama mevcut sunucu eylemiyle (`assignTaskAction`, `document.approve`; hedef üyenin yetkisi ve depo kapsamı domain'de denetlenir).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/pano-tokens.ts";
import { assignTaskAction } from "../tasks/actions.ts";

export interface AssignCandidate {
  readonly membershipId: string;
  readonly ini: string;
  readonly name: string;
  readonly color: string;
}

export function AssignWho({ slug, taskId, version, who }: { slug: string; taskId: string; version: number; who: readonly AssignCandidate[] }) {
  const t = useTranslations("pano");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (done !== null) return <span className="meta" style={{ fontWeight: 700 }}>{t("assignedTo", { name: done })}</span>;
  return (
    <span className="act" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {failed ? (
        <span role="alert" className="meta" style={{ color: dz("C62828"), fontWeight: 700 }}>
          {t("assignFailed")}
        </span>
      ) : null}
      {who.map((w) => (
        <button
          key={w.membershipId}
          type="button"
          className="av"
          style={{ background: dz(w.color), border: 0, cursor: "pointer", opacity: pending ? 0.5 : 1 }}
          aria-label={t("assignTo", { name: w.name })}
          title={w.name}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setFailed(false);
              const r = await assignTaskAction({ slug, taskId, membershipId: w.membershipId, expectedVersion: version });
              if (!r.ok) {
                setFailed(true);
                return;
              }
              setDone(w.name);
              router.refresh();
            })
          }
        >
          {w.ini}
        </button>
      ))}
    </span>
  );
}
