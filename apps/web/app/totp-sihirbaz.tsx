"use client";
// T-1034 (kullanıcı kararı 25 Ekim, ALTIN-KURAL "eğitim gerektirmeyen"): iki adımlı doğrulama kurulumu adım adım sihirbaz. Aktivasyonun
// 4. adımı ve `/mfa` aynı bileşeni kullanır. Sıra: (1) uygulamayı kur → (2) hesabı ekle (telefonda tek dokunuş `otpauth://`, bilgisayarda
// QR + üç adım; QR okunmazsa anahtar KOPYALA ile) → (3) 6 haneli kod (altıncı rakamda kendiliğinden doğrular) → (4) yedek kodlar
// (İNDİR / KOPYALA / YAZDIR, "Kaydettim" işaretlenmeden bitmez; işaretlenmeden sayfadan çıkışta ortak çıkış kutusu sorar). Sunucu çağrıları çağıranda (`verify`); bileşen yalnız akışı yürütür.
// Giris.dc.html sınıfları (`.card`, `.fll`, `.ls`, `.hint`, `.inp`, `.addr`, `.kv`, `.chk`, `.ban`, `.act > .big`); yeni CSS yok.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { sesCal } from "@wms/ui";
import { useDz } from "./design/dz-root.tsx";
import { C, dz } from "./design/giris-tokens.ts";
import { GICON } from "./design/giris-icons.ts";
import { Ico } from "./field/flow.tsx";
import { useCikisKorumasi } from "./t/[slug]/kalip/cikis.tsx";
import { QrCode } from "./qr-code.tsx";

type Adim = 1 | 2 | 3 | 4;

/** Resmî mağaza sayfaları (uygulama kimlikleri yayıncının kendi sayfalarından). */
export const MAGAZA = {
  google: {
    ios: "https://apps.apple.com/app/google-authenticator/id388497605",
    android: "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2",
  },
  microsoft: {
    ios: "https://apps.apple.com/app/microsoft-authenticator/id983156458",
    android: "https://play.google.com/store/apps/details?id=com.azure.authenticator",
  },
} as const;

/** `otpauth://totp/...?secret=` adresindeki anahtar, dörtlü gruplar hâlinde (okunur; kopyalamada boşluksuz gider). */
export function totpAnahtari(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** Telefon mu: dokunmatik birincil işaretçi + mobil işletim sistemi (tabletler dahil). */
export function telefonMu(ua: string, coarse: boolean): boolean {
  return coarse && /Android|iPhone|iPad|iPod/i.test(ua);
}

/** Yalnız rakam, en çok 6 hane (yapıştırılan "123 456" da çalışır). */
export function kodTemizle(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** İndirilen / yazdırılan yedek kod metni. */
export function yedekMetni(baslik: string, kodlar: readonly string[]): string {
  return [baslik, "", ...kodlar.map((k, i) => `${String(i + 1).padStart(2, "0")}  ${k}`), ""].join("\n");
}

function Dugme({ children, onClick, href, ghost = false, disabled = false, testId }: { children: ReactNode; onClick?: () => void; href?: string; ghost?: boolean; disabled?: boolean; testId?: string }) {
  const style = ghost ? { background: C.chip, color: C.fg } : { background: dz("172E42"), color: dz("FFFFFF") };
  if (href !== undefined) {
    return (
      <a className={ghost ? "big ghost" : "big"} href={href} style={{ ...style, textDecoration: "none" }} data-testid={testId}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={ghost ? "big ghost" : "big"} style={style} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

function KucukDugme({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg, minHeight: "48px", fontSize: "15px", flex: "1 1 0" }} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

export function TotpSihirbaz({ totpURI, backupCodes, verify, onDone }: { totpURI: string; backupCodes: readonly string[]; verify: (code: string) => Promise<true | string | false>; onDone: () => void }) {
  const t = useTranslations("totp");
  const { dark } = useDz();
  const [adim, setAdim] = useState<Adim>(1);
  const [telefon, setTelefon] = useState(false);
  const [qrGoster, setQrGoster] = useState(false);
  const [anahtarGoster, setAnahtarGoster] = useState(false);
  const [kopyalandi, setKopyalandi] = useState<string | null>(null);
  const [kod, setKod] = useState("");
  const [busy, setBusy] = useState(false);
  const [hata, setHata] = useState(false);
  const [hataMetni, setHataMetni] = useState<string | null>(null);
  const [kaydetti, setKaydetti] = useState(false);
  const [kaydetUyari, setKaydetUyari] = useState(false);
  // Doğrulama sunucuda bitti: yedek kodlar yalnız bu ekranda görünür; kaydedilmeden çıkılırsa bir daha gösterilmez.
  const cikis = useCikisKorumasi(adim === 4 && !kaydetti, { title: t("leaveH"), text: t("leaveS"), dark });
  const kodRef = useRef<HTMLInputElement>(null);
  const anahtar = totpAnahtari(totpURI);

  useEffect(() => {
    setTelefon(telefonMu(navigator.userAgent, window.matchMedia("(pointer: coarse)").matches));
  }, []);
  // Kod adımına gelince ve yanlış koddan sonra alan yeniden açılınca (doğrulama sürerken `disabled`; odak ancak açıldıktan sonra verilebilir).
  useEffect(() => {
    if (adim === 3 && !busy) kodRef.current?.focus();
  }, [adim, busy]);

  async function kopyala(metin: string, ne: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(metin);
      setKopyalandi(ne);
      sesCal("tamam");
      setTimeout(() => setKopyalandi((v) => (v === ne ? null : v)), 2000);
    } catch {
      sesCal("hata");
    }
  }

  async function dogrula(deger: string): Promise<void> {
    if (deger.length !== 6 || busy) return;
    setBusy(true);
    setHata(false);
    const ok = await verify(deger);
    setBusy(false);
    if (ok === true) {
      sesCal("tamam");
      setAdim(4);
      return;
    }
    sesCal("hata");
    setHata(true);
    setHataMetni(typeof ok === "string" ? ok : null);
    setKod("");
  }

  function indir(): void {
    const blob = new Blob([yedekMetni(t("fileHead"), backupCodes)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = t("fileName");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sesCal("tamam");
  }

  function yazdir(): void {
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (doc === null || win === null) {
      frame.remove();
      return;
    }
    const pre = doc.createElement("pre");
    pre.textContent = yedekMetni(t("fileHead"), backupCodes);
    pre.style.font = "16px/1.6 monospace";
    doc.body.appendChild(pre);
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 1000);
  }

  function bitir(): void {
    if (!kaydetti) {
      setKaydetUyari(true);
      sesCal("uyari");
      return;
    }
    onDone();
  }

  const adimCubugu = (
    <>
      <span className="kick">{t("kick", { n: adim })}</span>
      <div className="steps" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} style={{ background: i <= adim ? (dark ? dz("F4C542") : dz("172E42")) : C.track }} />
        ))}
      </div>
    </>
  );

  if (adim === 1) {
    return (
      <div data-testid="totp-adim-1" style={{ display: "contents" }}>
        {adimCubugu}
        <h1 className="lh">{t("appH")}</h1>
        <p className="ls">{t("appS")}</p>
        <div className="card" style={{ background: C.surface }}>
          {(["google", "microsoft"] as const).map((app) => (
            <div key={app} style={{ display: "grid", gap: "8px" }}>
              <span className="fll">{app === "google" ? t("appGoogle") : t("appMicrosoft")}</span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <a className="big ghost" href={MAGAZA[app].ios} target="_blank" rel="noopener noreferrer" style={{ background: C.chip, color: C.fg, minHeight: "48px", fontSize: "14px", flex: "1 1 140px", textDecoration: "none" }}>
                  {t("appStore")}
                </a>
                <a className="big ghost" href={MAGAZA[app].android} target="_blank" rel="noopener noreferrer" style={{ background: C.chip, color: C.fg, minHeight: "48px", fontSize: "14px", flex: "1 1 140px", textDecoration: "none" }}>
                  {t("playStore")}
                </a>
              </div>
            </div>
          ))}
          <span className="hint">
            <Ico d={GICON.phone} size={16} />
            {t("appTip")}
          </span>
        </div>
        <div className="act" style={{ background: C.bg }}>
          <Dugme onClick={() => setAdim(2)} testId="totp-app-ok">
            {t("appHave")}
            <Ico d={GICON.next} size={24} sw={3} />
          </Dugme>
        </div>
      </div>
    );
  }

  if (adim === 2) {
    const qrAcik = !telefon || qrGoster;
    return (
      <div data-testid="totp-adim-2" style={{ display: "contents" }}>
        {adimCubugu}
        <h1 className="lh">{t("addH")}</h1>
        <p className="ls">{qrAcik ? t("addDesktopS") : t("addMobileS")}</p>
        <div className="card" style={{ background: C.surface, alignItems: "center", textAlign: "center" }}>
          {qrAcik ? (
            <>
              <QrCode value={totpURI} label={t("qrLabel")} size={176} />
              <ol className="ls" style={{ margin: 0, paddingLeft: "1.2em", textAlign: "left", display: "grid", gap: "4px" }}>
                <li>{t("addStep1")}</li>
                <li>{t("addStep2")}</li>
                <li>{t("addStep3")}</li>
              </ol>
            </>
          ) : (
            <Dugme href={totpURI} testId="totp-ekle">
              <Ico d={GICON.phone} size={22} />
              {t("addMobileBtn")}
            </Dugme>
          )}
          {anahtarGoster ? (
            <div style={{ display: "grid", gap: "8px", width: "100%" }} data-testid="totp-anahtar">
              <span className="fll">{t("keyTitle")}</span>
              <code className="addr" style={{ background: C.chip, maxWidth: "100%", overflowWrap: "anywhere", fontSize: "13px", justifyContent: "center" }}>
                {anahtar.replace(/(.{4})/g, "$1 ").trim()}
              </code>
              <KucukDugme onClick={() => void kopyala(anahtar, "anahtar")} testId="totp-anahtar-kopyala">
                {kopyalandi === "anahtar" ? <Ico d={GICON.check} size={18} sw={3} /> : null}
                {kopyalandi === "anahtar" ? t("copied") : t("copy")}
              </KucukDugme>
              <span className="hint">{t("keyHow")}</span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", width: "100%" }}>
              {telefon && !qrGoster ? <KucukDugme onClick={() => setQrGoster(true)}>{t("addShowQr")}</KucukDugme> : null}
              <KucukDugme onClick={() => setAnahtarGoster(true)} testId="totp-qr-yok">
                {t("addNoQr")}
              </KucukDugme>
            </div>
          )}
        </div>
        <div className="act" style={{ background: C.bg }}>
          <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg, flex: "0 0 auto", minWidth: "64px" }} onClick={() => setAdim(1)} aria-label={t("back")}>
            <Ico d={GICON.back} size={24} sw={3} />
          </button>
          <Dugme onClick={() => setAdim(3)} testId="totp-eklendi">
            {t("addDone")}
            <Ico d={GICON.next} size={24} sw={3} />
          </Dugme>
        </div>
      </div>
    );
  }

  if (adim === 3) {
    return (
      <div data-testid="totp-adim-3" style={{ display: "contents" }}>
        {adimCubugu}
        <h1 className="lh">{t("codeH")}</h1>
        <p className="ls">{t("codeS")}</p>
        <div className="card" style={{ background: C.surface }}>
          <div className={hata ? "inp bad" : "inp"} style={{ background: C.chip, width: "100%" }}>
            <input
              ref={kodRef}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              aria-label={t("codeLabel")}
              aria-invalid={hata || undefined}
              aria-describedby="totp-kod-h"
              value={kod}
              disabled={busy}
              data-testid="totp-kod"
              onChange={(e) => {
                const v = kodTemizle(e.target.value);
                setKod(v);
                if (hata) setHata(false);
                if (v.length === 6) void dogrula(v);
              }}
              style={{ textAlign: "center", fontFamily: "var(--font-plex-mono), monospace", fontSize: "28px", letterSpacing: ".3em" }}
            />
          </div>
          <span id="totp-kod-h" className={hata ? "hint bad" : "hint"} role={hata ? "alert" : undefined}>
            {hata ? <Ico d={GICON.warn} size={16} /> : null}
            {busy ? t("codeChecking") : hata ? (hataMetni ?? t("codeWrong")) : t("codeLabel")}
          </span>
        </div>
        <div className="act" style={{ background: C.bg }}>
          <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg, flex: "0 0 auto", minWidth: "64px" }} onClick={() => setAdim(2)} aria-label={t("back")} disabled={busy}>
            <Ico d={GICON.back} size={24} sw={3} />
          </button>
          <Dugme onClick={() => void dogrula(kod)} disabled={busy || kod.length !== 6} testId="totp-dogrula">
            {t("codeBtn")}
            <Ico d={GICON.next} size={24} sw={3} />
          </Dugme>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="totp-adim-4" style={{ display: "contents" }}>
      {adimCubugu}
      <h1 className="lh">{t("backupH")}</h1>
      <p className="ls">{t("backupS")}</p>
      <div className="card" style={{ background: C.surface }}>
        <dl className="kv" aria-label={t("backupList")} style={{ background: C.chip, margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "12px", userSelect: "all" }} data-testid="totp-yedek">
          {backupCodes.map((k, i) => (
            <div key={k} style={{ display: "flex", gap: "8px" }}>
              <dt>{String(i + 1).padStart(2, "0")}</dt>
              <dd style={{ margin: 0 }}>{k}</dd>
            </div>
          ))}
        </dl>
        <div style={{ display: "flex", gap: "8px" }}>
          <KucukDugme onClick={indir} testId="totp-indir">
            {t("download")}
          </KucukDugme>
          <KucukDugme onClick={() => void kopyala(backupCodes.join("\n"), "yedek")} testId="totp-yedek-kopyala">
            {kopyalandi === "yedek" ? <Ico d={GICON.check} size={18} sw={3} /> : null}
            {kopyalandi === "yedek" ? t("copied") : t("copy")}
          </KucukDugme>
          <KucukDugme onClick={yazdir}>
            {t("print")}
          </KucukDugme>
        </div>
        <button
          type="button"
          role="checkbox"
          className={kaydetti ? "chk on" : "chk"}
          aria-checked={kaydetti}
          onClick={() => {
            setKaydetti((v) => !v);
            setKaydetUyari(false);
          }}
          data-testid="totp-kaydettim"
        >
          <i>
            <Ico d={GICON.check} size={16} sw={3.2} />
          </i>
          {t("saved")}
        </button>
        {kaydetUyari ? (
          <span className="hint bad" role="alert">
            <Ico d={GICON.warn} size={16} />
            {t("savedNeed")}
          </span>
        ) : null}
      </div>
      <div className="act" style={{ background: C.bg }}>
        <Dugme onClick={bitir} testId="totp-bitir">
          {t("finish")}
          <Ico d={GICON.check} size={24} sw={3} />
        </Dugme>
      </div>
      {cikis.kutu}
    </div>
  );
}
