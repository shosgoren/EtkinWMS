"use client";
// T-1026: kaynak Yolculuk.dc.html; ortak, engellemeyen çalışma kartı. Eylem/izin/stok komutu çağırmaz.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { intlDil } from '@wms/ui';
import { JICON } from '../../../design/yolculuk-icons.ts';
import { useKabuk } from '../kabuk/kabuk-bar.tsx';
import { JOURNEY_OPEN_EVENT } from '../yolculuk/steps.ts';
import { GUIDE_INSTRUCTIONS, currentGuide, guideHref, type OpGuide } from './rehber-plan.ts';
import { KalipPerdeKatman } from './perde.tsx';
import { cikisSor } from './cikis.tsx';
import { useModalFocus } from './odak.ts';
import { ADIM_REHBER_EVENT, useAdimRehberleri } from './adim-rehber.tsx';
import { ADIM_KAYNAKLARI } from './adim-rehber-plan.ts';
function RehberIkon({ d }: {
    d: string | readonly string[];
}) { return <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{(typeof d === 'string' ? [d] : d).map(p => <path key={p} d={p}/>)}</svg>; }
export const OP_GUIDE_EVENT = 'etkinwms:operation-guide';
export function KalipRehberKart({ title, text, progress, target, onClose, onPrev, onNext, onSkip, style, head, children, closeTestId = "guide-close" }: {
    title: string;
    text: string;
    progress: string;
    target: string | null;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    onSkip?: () => void;
    style?: CSSProperties;
    /** Başlık satırının altında (ör. kurulum adım şeridi, T-1036). */
    head?: ReactNode;
    children?: ReactNode;
    closeTestId?: string;
}) {
    const t = useTranslations('operationGuide'), locale = useLocale();
    const ref = useRef<HTMLElement>(null);
    const [folded, setFolded] = useState(false);
    const [spot, setSpot] = useState<CSSProperties | null>(null);
    useEffect(() => {
        const measure = (): void => { const e = target === null ? null : [...document.querySelectorAll<HTMLElement>(target)].find(el => el.getBoundingClientRect().width > 0); if (!e) {
            setSpot(null);
            return;
        } const r = e.getBoundingClientRect(); setSpot({ left: r.x, top: r.y, width: r.width, height: r.height }); };
        measure();
        const id = window.setInterval(measure, 400);
        return () => window.clearInterval(id);
    }, [target]);
    useEffect(() => { setFolded(false); }, [progress]);
    useEffect(() => {
        const outside = (e: Event): void => { if (e.type === 'focusin' && (!(e.target instanceof Element) || !e.target.matches('input,textarea,button,[role="combobox"],[role="option"]')))
            return; if (e.target instanceof Node && !ref.current?.contains(e.target))
            setFolded(true); };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', outside, true);
        return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); window.speechSynthesis?.cancel(); };
    }, []);
    useLayoutEffect(() => {
        const key = (e: KeyboardEvent): void => { const modal = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'); if (e.defaultPrevented || modal)
            return; if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
        else if (ref.current?.contains(document.activeElement) && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                onNext();
            }
            else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                onPrev();
            }
        } };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [onClose, onNext, onPrev]);
    function apply(): void {
        setFolded(true);
        const el = target === null ? null : document.querySelector<HTMLElement>(target);
        el?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        const focus = el?.matches('input,button,a,select,textarea') ? el : el?.querySelector<HTMLElement>('input,button,a,textarea');
        focus?.focus({ preventScroll: true });
    }
    function speak(): void { if (!window.speechSynthesis)
        return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(`${title}. ${text}`); u.lang = intlDil(locale); window.speechSynthesis.speak(u); }
    return <>{!folded && spot !== null ? <span className="yhole" style={spot} aria-hidden="true"/> : null}<section ref={ref} className={`ycoach working${folded ? ' folded' : ''}`} style={style ?? { left: 12, bottom: 136 }} role="region" aria-label={t('title')} data-testid="working-guide" data-folded={folded}>
    {folded ? <><button className="ynb" type="button" onClick={() => setFolded(false)} data-testid="guide-expand">{t('resume')} · {progress.match(/\d+\/\d+/)?.[0] ?? progress}</button><button type="button" className="cbtn" onClick={onClose} aria-label={t('close')} data-testid={closeTestId}><RehberIkon d={JICON.close}/></button></> : <>
      <div className="cth"><span className="cstep" aria-live="polite">{progress}</span><button type="button" className="cbtn" onClick={speak} aria-label={t('speak')}><RehberIkon d={[JICON.speak, JICON.speakWave]}/></button><button type="button" className="cbtn" onClick={onClose} aria-label={t('close')} data-testid={closeTestId}><RehberIkon d={JICON.close}/></button></div>{head}
      <b className="ctt">{title}</b><p className="ctx">{text}</p>{children}
      <button type="button" className="ynb yapply" onClick={apply} data-testid="guide-apply">{t('apply')}</button>
      <div className="ynav"><button type="button" className="ynb" onClick={onPrev} aria-label={t('prev')}><RehberIkon d={JICON.back}/></button><button type="button" className="yskip" onClick={onSkip ?? onClose}>{t(onSkip ? 'skipStep' : 'skip')}</button><button type="button" className="ynb go" onClick={onNext} data-testid="guide-next">{t('next')}<RehberIkon d={JICON.next}/></button></div>
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
    {current !== null && instruction != null ? <KalipRehberKart title={t(`names.${current.guide}`)} text={t(`instructions.${instruction.key}`)} progress={t('step', { n: current.step + 1, total: 5 })} target={instruction.target} onClose={() => save({ ...current, closed: true })} onPrev={() => save({ ...current, step: Math.max(0, current.step - 1) })} onNext={() => current.step === 4 ? save({ ...current, closed: true, step: 0 }) : save({ ...current, step: current.step + 1 })}>
      {path !== current.path && !path.includes('/field/') && !path.endsWith('/stock/documents') ? <button type="button" className="yalt" onClick={() => cikisSor(() => router.push(`${current.path}${current.query ? '?' + current.query : ''}`))}>{t('open')}</button> : null}
      <button type="button" className="yalt" onClick={() => save({ ...current, step: 0 })} data-testid="guide-restart">{t('restart')}</button><small>{t('learningOnly')}</small>
    </KalipRehberKart> : null}
  </div>;
}
