"use client";
// T-1026: kaynak Yolculuk.dc.html; ortak, engellemeyen çalışma kartı. Eylem/izin/stok komutu çağırmaz.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { feedback } from '@wms/ui';
import { JICON } from '../../../design/yolculuk-icons.ts';
import { LICON } from '../../../design/kalip-icons.ts';
import { ICON as BICON } from '../../../design/bakis-icons.ts';
import { useKabuk } from '../kabuk/kabuk-bar.tsx';
import { JOURNEY_OPEN_EVENT } from '../yolculuk/steps.ts';
import { GUIDE_INSTRUCTIONS, currentGuide, guideAdvance, guideHref, guideScreen, type OpGuide } from './rehber-plan.ts';
import { KalipPerdeKatman } from './perde.tsx';
import { cikisSor } from './cikis.tsx';
import { useModalFocus } from './odak.ts';
import { sesiDurdur, useSesliOku } from './sesli-oku.ts';
import { ADIM_REHBER_EVENT, useAdimRehberleri } from './adim-rehber.tsx';
import { ADIM_KAYNAKLARI, adimPlani } from './adim-rehber-plan.ts';
import { adimaGit, adimKimlik, baslat, bitir, kapat, katla, kimlikCoz, opKimlik, useRehberDurum, yerKaydet } from './rehber-durum.ts';
import { gorunurMu, kartYeri, useRehberHedef, type KartYeri } from './rehber-hedef.ts';
function RehberIkon({ d }: {
    d: string | readonly string[];
}) { return <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{(typeof d === 'string' ? [d] : d).map(p => <path key={p} d={p}/>)}</svg>; }
export { OP_GUIDE_EVENT } from './rehber-plan.ts';
import { OP_GUIDE_EVENT } from './rehber-plan.ts';
/** Kurulum yolculuğunu kapatmadan katlar (yolculuk kendi ilerlemesini korur; T-1124). */
export const JOURNEY_PAUSE_EVENT = 'etkinwms:journey-pause';
/**
 * T-1105 (kullanıcı 27 Ekim: "yazı ve tarif değil, işi yaptırsın") + T-1124 (28 Ekim: "sırasıyla odaklanmıyor"): işlem rehberi kartı.
 * Ortak buzlu perde yapılacak yer(ler)in çevresini delik bırakıp bütün ekranı örter; adım başında hedef görünür alana gelir ve klavye
 * odağı ilk boş alana geçer (`useRehberHedef`). Kullanıcı delikteki gerçek işi yapınca (ekranın bitti işareti görününce; `guideAdvance`)
 * adım kendiliğinden ilerler; ölçülemeyen adımlarda küçük geri / ileri okları kalır. Kart deliği örtmeyen köşeye oturur. Perdeye dokunmak
 * ya da rehberin bölümünden çıkmak rehberi KAPATMAZ, yüzen simgeye katlar: kaldığın yerden devam · baştan · başka bölüm · kapat.
 * Eylem/izin/stok komutu çağırmaz.
 */
export function KalipRehberKart({ guide, title, step, folded, here, onStep, onFinish, onFold, onResume, onRestart, onOther, onClose, onOpenScreen }: {
    guide: OpGuide;
    title: string;
    step: number;
    /** Katlı (yüzen simge): perde yok. */
    folded: boolean;
    /** Rehberin bölümündeyiz (değilsek kart katlı çizilir). */
    here: boolean;
    onStep: (n: number) => void;
    onFinish: () => void;
    onFold: (katli: boolean) => void;
    onResume: () => void;
    onRestart: () => void;
    onOther: () => void;
    onClose: () => void;
    onOpenScreen: () => void;
}) {
    const t = useTranslations('operationGuide'), sesliOku = useSesliOku();
    const steps = GUIDE_INSTRUCTIONS[guide];
    const instruction = steps[step] ?? steps[0]!;
    const progress = t('step', { n: step + 1, total: steps.length });
    const text = t(`instructions.${instruction.key}`);
    const acik = !folded && here;
    const { delik, yok } = useRehberHedef(instruction.target, acik, `${guide}:${step}`);
    // İş yapıldı mı: ekranın bitti işareti (sıradaki adımların da) görününce ilerle; son adım bitince rehber biter.
    useEffect(() => {
        if (!here) return undefined;
        const bak = (): void => {
            const n = guideAdvance(steps, step, gorunurMu);
            if (n === step) return;
            feedback.ok();
            if (n >= steps.length) onFinish();
            else onStep(n);
        };
        bak();
        const id = window.setInterval(bak, 300);
        return () => window.clearInterval(id);
    }, [here, steps, step, onStep, onFinish]);
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
    // Kart delikleri örtmesin: ölçüsüne göre köşe seçilir.
    const ref = useRef<HTMLElement>(null);
    const [yer, setYer] = useState<KartYeri>({ left: 12, bottom: 136 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (el === null || !acik) return;
        const r = el.getBoundingClientRect();
        const y = kartYeri(delik ?? [], window.innerWidth, window.innerHeight, r.width, r.height);
        setYer(o => o.left === y.left && o.right === y.right && o.top === y.top && o.bottom === y.bottom ? o : y);
    }, [delik, acik, text, yok]);
    const style: CSSProperties = { left: yer.left ?? 'auto', right: yer.right ?? 'auto', top: yer.top ?? 'auto', bottom: yer.bottom ?? 'auto', zIndex: 42 };
    const common = { role: 'region' as const, 'aria-label': `${t('title')}: ${title}`, 'data-testid': 'working-guide', 'data-step': instruction.key, 'data-guide-id': guide };
    if (!acik) {
        // Yüzen simge: kaldığın yerden devam (rehberin ekranına döner) · baştan · başka bölüm · kapat.
        return <section ref={ref} className="ycoach working folded" style={{ zIndex: 42 }} {...common} data-folded="true">
      <button className="ynb" type="button" onClick={() => { feedback.minor(); onResume(); }} data-testid="guide-expand" title={title}>{t('resumeHere')} · {progress}</button>
      <button type="button" className="cbtn" onClick={() => { feedback.minor(); onRestart(); }} aria-label={t('restart')} title={t('restart')} data-testid="guide-restart"><RehberIkon d={BICON.undo}/></button>
      <button type="button" className="cbtn" onClick={() => { feedback.minor(); onOther(); }} aria-label={t('other')} title={t('other')} data-testid="guide-other"><RehberIkon d={LICON.grid}/></button>
      <button type="button" className="cbtn" onClick={onClose} aria-label={t('close')} data-testid="guide-close"><RehberIkon d={JICON.close}/></button>
    </section>;
    }
    return <>{delik !== null ? <KalipPerdeKatman onClose={() => { feedback.minor(); onFold(true); }} label={t('adim.free')} delik={delik}/> : null}<section ref={ref} className="ycoach working" style={style} {...common} data-folded="false">
      <div className="cth"><span className="cstep" aria-live="polite">{title} · {progress}</span><button type="button" className="cbtn" onClick={() => sesliOku(text)} aria-label={t('speak')}><RehberIkon d={[JICON.speak, JICON.speakWave]}/></button><button type="button" className="cbtn" onClick={onClose} aria-label={t('close')} data-testid="guide-close"><RehberIkon d={JICON.close}/></button></div>
      <p className="ctx" data-testid="guide-text">{text}</p>
      {yok ? <button type="button" className="ynb go" onClick={onOpenScreen} data-testid="guide-open-screen">{t('open')}</button> : null}
      <button type="button" className="yalt" onClick={onRestart} data-testid="guide-restart">{t('restart')}</button>
      <div className="ynav"><button type="button" className="ynb" onClick={() => onStep(Math.max(0, step - 1))} aria-label={t('prev')}><RehberIkon d={JICON.back}/></button><span/><button type="button" className="ynb" onClick={() => step + 1 >= steps.length ? onFinish() : onStep(step + 1)} aria-label={t('next')} data-testid="guide-next"><RehberIkon d={JICON.next}/></button></div>
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
/** Rehberin ekranına dönüş için saklanan sorgu: yalnız bilinen anahtarlar ve biçimler (kimlik UUID, tür sabit listeden). */
function safeQuery(raw: string): string { const q = new URLSearchParams(raw), out = new URLSearchParams(); for (const k of ['task', 'receipt', 'id', 'wh']) {
    const v = q.get(k);
    if (v !== null && /^[a-f0-9-]{36}$/i.test(v))
        out.set(k, v);
} for (const k of ['kind', 'new']) {
    const v = q.get(k);
    if (v !== null && ['COUNT', 'TRANSFER', 'STOCK_OUT'].includes(v))
        out.set(k, v);
} return out.toString(); }
/**
 * T-1124: işlem rehberleri + rehber seçici. Durum `rehber-durum.ts` (aktarma rehberiyle ortak): başka bölüme geçmek rehberi kapatmaz
 * (katlı simge), başka rehber başlatmak öncekinin adımını silmez; seçici her rehberin kaldığı adımı gösterir ve oradan sürdürür.
 * Kurulum yolculuğu kapatılmaz, yalnız katlanır (`JOURNEY_PAUSE_EVENT`).
 */
export function KalipIslemRehberleri({ userId, slug, dark }: {
    userId: string;
    slug: string;
    dark: boolean;
}) {
    const t = useTranslations('operationGuide'), ctx = useKabuk(), path = usePathname(), search = useSearchParams(), router = useRouter();
    const query = search.toString();
    const allowed = ctx?.guides?.operations ?? [];
    const aktar = useAdimRehberleri();
    const base = ctx?.base ?? `/t/${encodeURIComponent(slug)}`;
    const [d, guncelle] = useRehberDurum(`${userId}:${slug}`);
    const [picker, setPicker] = useState(false);
    const pickerRef = useRef<HTMLElement>(null);
    useModalFocus(picker, pickerRef, { onClose: () => setPicker(false), initial: 'container' });
    const k = kimlikCoz(d.aktif);
    const guide = k?.tur === 'op' && allowed.includes(k.guide) ? k.guide : null;
    const id = guide === null ? null : opKimlik(guide);
    const step = id === null ? 0 : Math.min(d.adimlar[id] ?? 0, GUIDE_INSTRUCTIONS[guide!].length - 1);
    const here = guide !== null && guideScreen(guide, path, query);
    const yerOf = (g: OpGuide): string => { const y = d.yerler[opKimlik(g)]; return y !== undefined && y.startsWith(`${base}/`) && guideScreen(g, y.split('?')[0]!, y.split('?')[1] ?? '') ? y : guideHref(base, g); };
    // Rehberin ekranındayken yer saklanır (ör. seçilen kabul belgesi): "Kaldığın yerden devam" buraya döner.
    useEffect(() => {
        if (id === null || !here) return;
        const q = safeQuery(query);
        guncelle(x => yerKaydet(x, id, `${path}${q ? `?${q}` : ''}`));
    }, [id, here, path, query, guncelle]);
    // İki rehber motoru (işlem/aktarma ↔ kurulum) aynı anda çizilmez: etkin rehber varken kurulum yolculuğu gizli kalır (kapanmaz).
    const setOwner = ctx?.setGuideOwner, owner = ctx?.guideOwner;
    useEffect(() => {
        if (d.aktif !== null && owner !== 'setup') setOwner?.('operation');
        else if (d.aktif === null && owner === 'operation') setOwner?.(null);
    }, [d.aktif, owner, setOwner]);
    function start(g: OpGuide, bastan = false): void {
        if (!allowed.includes(g))
            return;
        const there = guideScreen(g, path, query);
        const run = (): void => {
            setPicker(false);
            guncelle(x => baslat(x, opKimlik(g), bastan));
            setOwner?.('operation');
            window.dispatchEvent(new Event(JOURNEY_PAUSE_EVENT));
            if (!there)
                router.push(bastan ? guideHref(base, g) : yerOf(g));
        };
        if (there)
            run();
        else
            cikisSor(run);
    }
    useEffect(() => {
        const open = (e: Event): void => {
            if (e instanceof CustomEvent && e.detail === 'list') {
                // Kurulum listesi açılıyor: etkin rehber kapanmaz, katlanır (kurulum bitince/kapanınca simge geri gelir).
                guncelle(x => katla(x, true));
                return;
            }
            if (allowed.length === 0 && aktar.length === 0)
                return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const asked = e instanceof CustomEvent && allowed.includes(e.detail as OpGuide) ? e.detail as OpGuide : null;
            const screen = currentGuide(path, query);
            const g = asked ?? (screen !== null && allowed.includes(screen) ? screen : null);
            if (g !== null) {
                start(g);
                return;
            }
            // Ekranın kendi işlem rehberi yok: bu ekranda süren (katlı) aktarma rehberi varsa açılır, yoksa seçici.
            const a = kimlikCoz(d.aktif);
            if (a?.tur === 'adim' && adimPlani(a.rehber, a.kaynak).some(s => path === `${base}${s.path}`)) {
                setOwner?.('operation');
                guncelle(x => katla(x, false));
                return;
            }
            setOwner?.('operation');
            window.dispatchEvent(new Event(JOURNEY_PAUSE_EVENT));
            setPicker(true);
        };
        window.addEventListener(OP_GUIDE_EVENT, open);
        window.addEventListener(JOURNEY_OPEN_EVENT, open, true);
        return () => { window.removeEventListener(OP_GUIDE_EVENT, open); window.removeEventListener(JOURNEY_OPEN_EVENT, open, true); };
    });
    const ilerleme = (rid: ReturnType<typeof opKimlik>, total: number): string | null => { const n = d.adimlar[rid]; return n === undefined ? null : `${n + 1}/${total}`; };
    return <div className={`dzj${dark ? ' dz-dark' : ''}`}>
    {picker ? <><KalipPerdeKatman onClose={() => setPicker(false)} label={t('close')}/><section className="ysheet" role="dialog" aria-modal="true" aria-label={t('title')} ref={pickerRef} data-testid="guide-picker"><div className="ysh"><b>{t('title')}</b><button type="button" className="ycls" onClick={() => setPicker(false)} aria-label={t('close')}>×</button></div><ol className="ylist">{aktar.map(r => <li className="yst yadim" key={`adim-${r}`} data-testid={`adim-sec-${r}`}><span className="yt"><b>{t(`adim.names.${r}`)}</b></span>{ADIM_KAYNAKLARI.map(kk => { const p = ilerleme(adimKimlik(r, kk), adimPlani(r, kk).length); return <button key={kk} type="button" className="yact" onClick={() => { setPicker(false); window.dispatchEvent(new CustomEvent(ADIM_REHBER_EVENT, { detail: { rehber: r, kaynak: kk } })); }} data-testid={`adim-basla-${r}-${kk}`}>{t(`adim.kaynak.${kk}`)}{p === null ? '' : ` · ${p}`} ›</button>; })}</li>)}{allowed.map(g => { const p = ilerleme(opKimlik(g), GUIDE_INSTRUCTIONS[g].length); return <li className="yst" key={g}><span className="yt"><b>{t(`names.${g}`)}</b><small data-testid={`guide-progress-${g}`}>{p === null ? t('fiveSteps') : t('leftAt', { at: p })}</small></span><button type="button" className="yact" onClick={() => start(g)} data-testid={`guide-start-${g}`}>{p === null ? t('show') : t('resumeHere')} ›</button></li>; })}</ol>{ctx?.guides?.setup.length ? <button type="button" className="ygo" onClick={() => { setPicker(false); window.dispatchEvent(new CustomEvent(JOURNEY_OPEN_EVENT, { cancelable: true, detail: 'list' })); }}>{t('setup')}</button> : null}</section></> : null}
    {guide !== null && id !== null && owner !== 'setup' ? <KalipRehberKart key={guide} guide={guide} title={t(`names.${guide}`)} step={step} folded={d.katli} here={here}
      onStep={n => guncelle(x => adimaGit(x, id, n))}
      onFinish={() => guncelle(x => bitir(x, id))}
      onFold={b => guncelle(x => katla(x, b))}
      onResume={() => { guncelle(x => katla(x, false)); if (!here) cikisSor(() => router.push(yerOf(guide))); }}
      onRestart={() => { guncelle(x => baslat(x, id, true)); if (!here) cikisSor(() => router.push(guideHref(base, guide))); }}
      onOther={() => { guncelle(x => katla(x, true)); setPicker(true); }}
      onClose={() => guncelle(kapat)}
      onOpenScreen={() => cikisSor(() => router.push(yerOf(guide)))}/> : null}
  </div>;
}
