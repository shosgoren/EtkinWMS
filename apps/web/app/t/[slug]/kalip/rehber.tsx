"use client";
// T-1026: kaynak Yolculuk.dc.html; ortak, engellemeyen çalışma kartı. Eylem/izin/stok komutu çağırmaz.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { feedback } from '@wms/ui';
import { JICON } from '../../../design/yolculuk-icons.ts';
import { useKabuk } from '../kabuk/kabuk-bar.tsx';
import { JOURNEY_OPEN_EVENT } from '../yolculuk/steps.ts';
import { GUIDE_INSTRUCTIONS, currentGuide, guideHref, type OpGuide } from './rehber-plan.ts';
import { KalipPerdeKatman, hedefKutusu, type PerdeDelik } from './perde.tsx';
import { cikisSor } from './cikis.tsx';
import { useModalFocus } from './odak.ts';
import { sesiDurdur, useSesliOku } from './sesli-oku.ts';
import { ADIM_REHBER_EVENT, useAdimRehberleri } from './adim-rehber.tsx';
import { ADIM_KAYNAKLARI } from './adim-rehber-plan.ts';
function RehberIkon({ d }: {
    d: string | readonly string[];
}) { return <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{(typeof d === 'string' ? [d] : d).map(p => <path key={p} d={p}/>)}</svg>; }
export const OP_GUIDE_EVENT = 'etkinwms:operation-guide';
/**
 * T-1105 (kullanıcı 27 Ekim: "yazı ve tarif değil, işi yaptırsın"): işlem rehberi kartı T-1095/T-1100 odaklı rehberle aynı — ortak buzlu
 * perde yapılacak yerin çevresini delik bırakıp bütün ekranı örter, kart tek satır (adım · sesli · kapat); "Uygula" ve "Şimdilik kapat"
 * yok. Kullanıcı delikteki gerçek işi yapınca (hedefe dokunup ekran bir sonraki adımın hedefine geçince ya da hedef kaybolunca) adım
 * kendiliğinden ilerler; algılanamayan adımlar için küçük geri / ileri ok düğmeleri kalır. Perdeye dokunmak serbest bırakır (yüzen
 * "Rehbere devam"). Eylem/izin/stok komutu çağırmaz.
 */
export function KalipRehberKart({ title, text, progress, target, nextTarget = null, onClose, onPrev, onNext, style, head, children, closeTestId = "guide-close" }: {
    title: string;
    text: string;
    progress: string;
    target: string | null;
    /** Sonraki adımın hedefi (kendiliğinden ilerleme için); son adımda `null`. */
    nextTarget?: string | null;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    onSkip?: () => void;
    style?: CSSProperties;
    /** Başlık satırının altında. */
    head?: ReactNode;
    children?: ReactNode;
    closeTestId?: string;
}) {
    const t = useTranslations('operationGuide'), sesliOku = useSesliOku();
    const ref = useRef<HTMLElement>(null);
    const [folded, setFolded] = useState(false);
    const [delik, setDelik] = useState<PerdeDelik | null>(null);
    const dokundu = useRef(false);
    const ilk = useRef<Element | null>(null);
    useEffect(() => { setFolded(false); dokundu.current = false; ilk.current = null; }, [progress]);
    useEffect(() => {
        const gorunur = (sel: string | null): HTMLElement | null => sel === null ? null : [...document.querySelectorAll<HTMLElement>(sel)].find(el => el.getBoundingClientRect().width > 0) ?? null;
        const olc = (): void => {
            const e = gorunur(target);
            if (e !== null && ilk.current === null) ilk.current = e;
            // Kullanıcı hedefteki işi yaptı: sonraki adımın hedefi (başka bir öğe) göründü ya da (son adımda) hedef kayboldu → ilerle.
            if (dokundu.current) {
                const n = gorunur(nextTarget);
                if ((n !== null && n !== ilk.current && (e === null || !n.contains(e))) || (nextTarget === null && e === null)) {
                    dokundu.current = false;
                    feedback.ok();
                    onNext();
                    return;
                }
            }
            if (e === null) { setDelik(o => o === null ? o : null); return; }
            const r = hedefKutusu(e);
            const d = { x: Math.round(r.left - 6), y: Math.round(r.top - 6), w: Math.round(r.width + 12), h: Math.round(r.height + 12) };
            setDelik(o => o !== null && o.x === d.x && o.y === d.y && o.w === d.w && o.h === d.h ? o : d);
        };
        olc();
        const id = window.setInterval(olc, 300);
        // İş yapıldı sayılan olaylar: hedefte bir alan değişti (seçildi/yazılıp bırakıldı), form gönderildi ya da düğme/bağlantıya dokunuldu.
        // Alana yalnız dokunmak ya da harf yazmak ilerletmez.
        const dokun = (ev: Event): void => {
            if (!(ev.target instanceof Element) || target === null || ev.target.closest(target) === null) return;
            if (ev.type === 'click' && ev.target.closest('button, a, [role="option"], [role="button"]') === null) return;
            dokundu.current = true;
        };
        for (const k of ['change', 'submit', 'click'] as const) document.addEventListener(k, dokun, true);
        return () => { window.clearInterval(id); for (const k of ['change', 'submit', 'click'] as const) document.removeEventListener(k, dokun, true); };
    }, [target, nextTarget, onNext]);
    useEffect(() => () => { sesiDurdur(); }, []);
    useLayoutEffect(() => {
        const key = (e: KeyboardEvent): void => { const modal = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'); if (e.defaultPrevented || modal)
            return; if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [onClose]);
    function speak(): void { sesliOku(text); }
    return <>{!folded && delik !== null ? <KalipPerdeKatman onClose={() => { feedback.minor(); setFolded(true); }} label={t('adim.free')} delik={delik}/> : null}<section ref={ref} className={`ycoach working${folded ? ' folded' : ''}`} style={{ ...(style ?? { left: 12, bottom: 136 }), zIndex: 42 }} role="region" aria-label={`${t('title')}: ${title}`} data-testid="working-guide" data-folded={folded}>
    {folded ? <><button className="ynb" type="button" onClick={() => setFolded(false)} data-testid="guide-expand">{t('resume')} · {progress.match(/\d+\/\d+/)?.[0] ?? progress}</button><button type="button" className="cbtn" onClick={onClose} aria-label={t('close')} data-testid={closeTestId}><RehberIkon d={JICON.close}/></button></> : <>
      <div className="cth"><span className="cstep" aria-live="polite">{progress}</span><button type="button" className="cbtn" onClick={speak} aria-label={t('speak')}><RehberIkon d={[JICON.speak, JICON.speakWave]}/></button><button type="button" className="cbtn" onClick={onClose} aria-label={t('close')} data-testid={closeTestId}><RehberIkon d={JICON.close}/></button></div>{head}
      <p className="ctx" data-testid="guide-text">{text}</p>{children}
      <div className="ynav"><button type="button" className="ynb" onClick={onPrev} aria-label={t('prev')}><RehberIkon d={JICON.back}/></button><span/><button type="button" className="ynb" onClick={onNext} aria-label={t('next')} data-testid="guide-next"><RehberIkon d={JICON.next}/></button></div>
    </>}
  </section></>;
}
export function KalipIslemRehberiAc() {
    const t = useTranslations('operationGuide'), ctx = useKabuk(), path = usePathname(), query = useSearchParams();
    const guide = currentGuide(path, query.toString());
    const aktar = useAdimRehberleri();
    // T-1095: aktarma ekranlarında (Bağlantılar, Excel'den aktar, Entegrasyon) "?" adım adım rehber seçimini açar.
    if (guide === null && aktar.length > 0 && /\/(settings\/baglantilar|import|integrations)$/.test(path))
        return <span className="dzj"><button type="button" className="yguide-open" aria-label={t('show')} title={t('show')} data-testid="operation-guide-trigger" onClick={() => window.dispatchEvent(new CustomEvent(OP_GUIDE_EVENT, { detail: 'pick' }))}>?</button></span>;
    if (guide === null || !ctx?.guides?.operations.includes(guide))
        return null;
    return <span className="dzj"><button type="button" className="yguide-open" aria-label={t('show')} title={t('show')} data-testid="operation-guide-trigger" onClick={() => window.dispatchEvent(new CustomEvent(OP_GUIDE_EVENT, { detail: guide }))}>?</button></span>;
}
interface Saved {
    closed?: boolean;
    guide: OpGuide;
    step: number;
    path: string;
    query: string;
}
export function KalipIslemRehberleri({ userId, slug, dark }: {
    userId: string;
    slug: string;
    dark: boolean;
}) {
    const t = useTranslations('operationGuide'), ctx = useKabuk(), path = usePathname(), query = useSearchParams(), router = useRouter();
    const allowed = ctx?.guides?.operations ?? [];
    const aktar = useAdimRehberleri();
    const key = `etkinwms.instructions.v1:${userId}:${slug}`;
    function safeQuery(raw: string): string { const q = new URLSearchParams(raw), out = new URLSearchParams(); for (const k of ['task', 'receipt', 'id']) {
        const v = q.get(k);
        if (v !== null && /^[a-f0-9-]{36}$/i.test(v))
            out.set(k, v);
    } for (const k of ['kind', 'new']) {
        const v = q.get(k);
        if (v !== null && ['COUNT', 'TRANSFER', 'STOCK_OUT'].includes(v))
            out.set(k, v);
    } return out.toString(); }
    const [active, setActive] = useState<Saved | null>(null), [picker, setPicker] = useState(false);
    const pickerRef = useRef<HTMLElement>(null);
    useModalFocus(picker, pickerRef, { onClose: () => setPicker(false), initial: 'container' });
    useEffect(() => { try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const s = JSON.parse(raw) as Saved;
            if (allowed.includes(s.guide) && Number.isInteger(s.step) && s.step >= 0 && s.step < 5 && typeof s.path === 'string' && s.path.startsWith(`${ctx?.base}/`) && typeof s.query === 'string' && currentGuide(s.path, s.query) === s.guide)
                { setActive({ ...s, query: safeQuery(s.query) }); if (!s.closed) ctx?.setGuideOwner?.("operation"); }
        }
    }
    catch { /* bozuk/kapatılmış depolama rehberi engellemez */ } }, [key]); // izin her çizimde ayrıca süzülür
    function save(next: Saved | null): void { setActive(next); if (next !== null && !next.closed) ctx?.setGuideOwner?.("operation"); try {
        if (next === null)
            localStorage.removeItem(key);
        else
            localStorage.setItem(key, JSON.stringify(next));
    }
    catch { /* depolama isteğe bağlı */ } }
    function start(guide: OpGuide): void {
        if (!allowed.includes(guide))
            return;
        const here = currentGuide(path, query.toString()) === guide;
        const run = (): void => {
            setPicker(false);
            save({ guide, step: active?.guide === guide ? active.step : 0, closed: false, path: here ? path : guideHref(ctx?.base ?? '', guide).split('?')[0]!, query: here ? safeQuery(query.toString()) : guideHref('', guide).split('?')[1] ?? '' });
            if (!here)
                router.push(guideHref(ctx?.base ?? '', guide));
        };
        if (here)
            run();
        else
            cikisSor(run);
    }
    useEffect(() => {
        const open = (e: Event): void => {
            if (e instanceof CustomEvent && e.detail === 'list') {
                if (active !== null)
                    save({ ...active, closed: true });
                return;
            }
            if (allowed.length === 0 && aktar.length === 0)
                return;
            e.preventDefault();
            e.stopImmediatePropagation();
            ctx?.setGuideOwner?.('operation');
            window.dispatchEvent(new Event('etkinwms:journey-pause'));
            const g = e instanceof CustomEvent && e.detail === 'pick' ? null : e instanceof CustomEvent && allowed.includes(e.detail as OpGuide) ? e.detail as OpGuide : currentGuide(path, query.toString());
            if (g !== null && allowed.includes(g))
                start(g);
            else
                setPicker(true);
        };
        window.addEventListener(OP_GUIDE_EVENT, open);
        window.addEventListener(JOURNEY_OPEN_EVENT, open, true);
        return () => { window.removeEventListener(OP_GUIDE_EVENT, open); window.removeEventListener(JOURNEY_OPEN_EVENT, open, true); };
    });
    const current = active !== null && !active.closed && allowed.includes(active.guide) ? active : null;
    const instruction = current === null ? null : GUIDE_INSTRUCTIONS[current.guide][current.step];
    return <div className={`dzj${dark ? ' dz-dark' : ''}`}>
    {picker ? <><KalipPerdeKatman onClose={() => setPicker(false)} label={t('close')}/><section className="ysheet" role="dialog" aria-modal="true" aria-label={t('title')} ref={pickerRef} data-testid="guide-picker"><div className="ysh"><b>{t('title')}</b><button type="button" className="ycls" onClick={() => setPicker(false)} aria-label={t('close')}>×</button></div><ol className="ylist">{aktar.map(r => <li className="yst yadim" key={`adim-${r}`} data-testid={`adim-sec-${r}`}><span className="yt"><b>{t(`adim.names.${r}`)}</b></span>{ADIM_KAYNAKLARI.map(k => <button key={k} type="button" className="yact" onClick={() => { setPicker(false); if (active !== null) save({ ...active, closed: true }); window.dispatchEvent(new CustomEvent(ADIM_REHBER_EVENT, { detail: { rehber: r, kaynak: k } })); }} data-testid={`adim-basla-${r}-${k}`}>{t(`adim.kaynak.${k}`)} ›</button>)}</li>)}{allowed.map(g => <li className="yst" key={g}><span className="yt"><b>{t(`names.${g}`)}</b><small>{t('fiveSteps')}</small></span><button type="button" className="yact" onClick={() => start(g)} data-testid={`guide-start-${g}`}>{t('show')} ›</button></li>)}</ol>{ctx?.guides?.setup.length ? <button type="button" className="ygo" onClick={() => { setPicker(false); window.dispatchEvent(new CustomEvent(JOURNEY_OPEN_EVENT, { cancelable: true, detail: 'list' })); }}>{t('setup')}</button> : null}</section></> : null}
    {current !== null && instruction != null ? <KalipRehberKart title={t(`names.${current.guide}`)} text={t(`instructions.${instruction.key}`)} progress={t('step', { n: current.step + 1, total: 5 })} target={instruction.target} nextTarget={GUIDE_INSTRUCTIONS[current.guide][current.step + 1]?.target ?? null} onClose={() => save({ ...current, closed: true })} onPrev={() => save({ ...current, step: Math.max(0, current.step - 1) })} onNext={() => current.step === 4 ? save({ ...current, closed: true, step: 0 }) : save({ ...current, step: current.step + 1 })}>
      {path !== current.path && !path.includes('/field/') && !path.endsWith('/stock/documents') ? <button type="button" className="yalt" onClick={() => cikisSor(() => router.push(`${current.path}${current.query ? '?' + current.query : ''}`))}>{t('open')}</button> : null}
      <button type="button" className="yalt" onClick={() => save({ ...current, step: 0 })} data-testid="guide-restart">{t('restart')}</button>
    </KalipRehberKart> : null}
  </div>;
}
