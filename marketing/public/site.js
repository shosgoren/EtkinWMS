/* Etkin WMS — üretilmiş dosya (marketing/build.mjs). Elle düzenlemeyin. */
(function () {
"use strict";
// Etkin WMS satış sitesi — küçük şablon çalışma zamanı (T-941).
// `landing.dc.html` şablonunu (Claude Design `.dc.html` biçimi) tarayıcıda çizer:
//   {{a.b}} delikleri, <sc-if value>, <sc-for list as>, on<Olay>="{{fn}}" ve
//   data-dc-options="yol" (select seçenekleri). Ön-çizilmiş HTML yerinde güncellenir
//   (sc-if/sc-for blokları yorum işaretleriyle sınırlanır; React parçaları gibi konum korunur).
// eval / new Function yoktur; CSP `script-src 'self'` ile çalışır.

const HOLE = /\{\{([\w.]+)\}\}/g;
const SINGLE = /^\{\{([\w.]+)\}\}$/;
const OPEN = "[";
const CLOSE = "]";
const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.__mounted = false;
    this.__queued = false;
  }
  setState(update) {
    Object.assign(this.state, typeof update === "function" ? update(this.state) : update);
    if (!this.__mounted || this.__queued) return;
    this.__queued = true;
    queueMicrotask(() => {
      this.__queued = false;
      if (this.__render) this.__render();
    });
  }
}

function lookup(scope, path) {
  if (path === "true") return true;
  if (path === "false") return false;
  let v = scope;
  for (const k of path.split(".")) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}

function text(v) {
  return v === null || v === undefined || v === false ? "" : String(v);
}

function singleHole(str) {
  const m = SINGLE.exec(str || "");
  return m ? m[1] : null;
}

/** Şablon düğümlerini (template içeriği) gerçek düğümlere çizer. */
function renderInto(nodes, scope, out, handlers) {
  for (const n of nodes) {
    if (n.nodeType === 3) {
      const t = n.textContent || "";
      HOLE.lastIndex = 0;
      if (!HOLE.test(t)) {
        out.appendChild(document.createTextNode(t));
        continue;
      }
      HOLE.lastIndex = 0;
      let last = 0;
      let m;
      while ((m = HOLE.exec(t)) !== null) {
        if (m.index > last) out.appendChild(document.createTextNode(t.slice(last, m.index)));
        const span = document.createElement("span");
        span.textContent = text(lookup(scope, m[1]));
        out.appendChild(span);
        last = HOLE.lastIndex;
      }
      if (last < t.length) out.appendChild(document.createTextNode(t.slice(last)));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.localName;
    if (tag === "sc-if") {
      out.appendChild(document.createComment(OPEN));
      if (lookup(scope, singleHole(n.getAttribute("value")) || "false")) renderInto(n.childNodes, scope, out, handlers);
      out.appendChild(document.createComment(CLOSE));
      continue;
    }
    if (tag === "sc-for") {
      out.appendChild(document.createComment(OPEN));
      const list = lookup(scope, singleHole(n.getAttribute("list")) || "") || [];
      const as = n.getAttribute("as") || "item";
      for (const item of list) {
        const child = Object.create(scope);
        child[as] = item;
        renderInto(n.childNodes, child, out, handlers);
      }
      out.appendChild(document.createComment(CLOSE));
      continue;
    }
    const el = n.namespaceURI === "http://www.w3.org/2000/svg"
      ? document.createElementNS(n.namespaceURI, n.localName)
      : document.createElement(tag);
    for (const a of Array.from(n.attributes)) {
      const name = a.name;
      if (name.startsWith("hint-")) continue;
      if (/^on[a-z]+$/i.test(name)) {
        const fn = lookup(scope, singleHole(a.value) || "");
        if (typeof fn === "function") {
          handlers.push(fn);
          el.setAttribute("data-dc-" + name.slice(2).toLowerCase(), String(handlers.length - 1));
        }
        continue;
      }
      const only = singleHole(a.value);
      if (only !== null) {
        const v = lookup(scope, only);
        if (v === null || v === undefined || v === false) continue;
        el.setAttribute(name, String(v));
        continue;
      }
      el.setAttribute(name, a.value.replace(HOLE, (_m, p) => text(lookup(scope, p))));
    }
    if (tag === "select" && n.hasAttribute("data-dc-options")) {
      for (const o of lookup(scope, n.getAttribute("data-dc-options") || "") || []) {
        const opt = document.createElement("option");
        opt.textContent = text(o && typeof o === "object" ? o.n : o);
        el.appendChild(opt);
      }
    } else {
      renderInto(n.childNodes, scope, el, handlers);
    }
    out.appendChild(el);
  }
}

/** Çocuk listesini öğelere ayırır: tekil düğüm veya [ … ] bloğu. */
function itemsOf(nodes) {
  const root = [];
  const stack = [root];
  for (const node of nodes) {
    const top = stack[stack.length - 1];
    if (node.nodeType === 8 && node.data === OPEN) {
      const block = { open: node, close: null, items: [] };
      top.push(block);
      stack.push(block.items);
      continue;
    }
    if (node.nodeType === 8 && node.data === CLOSE && stack.length > 1) {
      stack.pop();
      const parentList = stack[stack.length - 1];
      parentList[parentList.length - 1].close = node;
      continue;
    }
    top.push({ node });
  }
  return root;
}

function nodesOfItem(item) {
  if (item.node) return [item.node];
  const out = [item.open];
  for (const it of item.items) out.push(...nodesOfItem(it));
  if (item.close) out.push(item.close);
  return out;
}

function sameKind(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.localName === b.localName && a.namespaceURI === b.namespaceURI));
}

function syncAttributes(from, to) {
  const skipValue = FORM_TAGS.has(from.tagName);
  for (const a of Array.from(from.attributes)) {
    if (skipValue && (a.name === "value" || a.name === "checked")) continue;
    if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
  }
  for (const a of Array.from(to.attributes)) {
    if (skipValue && (a.name === "value" || a.name === "checked")) continue;
    if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  }
}

function morphNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  syncAttributes(from, to);
  if (from.tagName === "INPUT" || from.tagName === "TEXTAREA") return;
  if (from.tagName === "SELECT") {
    const keep = from.selectedIndex;
    morphList(from, itemsOf(Array.from(from.childNodes)), itemsOf(Array.from(to.childNodes)), null);
    if (keep >= 0 && keep < from.options.length) from.selectedIndex = keep;
    return;
  }
  morphList(from, itemsOf(Array.from(from.childNodes)), itemsOf(Array.from(to.childNodes)), null);
}

/** `parent` içinde `before` düğümünden önce kalan öğe listesini hedefe uyarlar. */
function morphList(parent, fromItems, toItems, before) {
  const count = Math.max(fromItems.length, toItems.length);
  for (let i = 0; i < count; i++) {
    const f = fromItems[i];
    const t = toItems[i];
    if (t === undefined) {
      if (f !== undefined) for (const node of nodesOfItem(f)) node.remove();
      continue;
    }
    const ref = f !== undefined ? nodesOfItem(f)[0] : before;
    if (f !== undefined && f.node && t.node && sameKind(f.node, t.node)) {
      morphNode(f.node, t.node);
      continue;
    }
    if (f !== undefined && !f.node && !t.node) {
      morphList(parent, f.items, t.items, f.close);
      continue;
    }
    for (const node of nodesOfItem(t)) parent.insertBefore(node, ref || null);
    if (f !== undefined) for (const node of nodesOfItem(f)) node.remove();
  }
}

/**
 * @param {HTMLElement} root ön-çizilmiş içerik kabı
 * @param {HTMLTemplateElement} tpl şablon
 * @param {any} comp bileşen örneği
 */
function mount(root, tpl, comp) {
  let handlers = [];
  const draw = () => {
    const next = [];
    const frag = document.createDocumentFragment();
    renderInto(Array.from(tpl.content.childNodes), comp.renderVals(), frag, next);
    handlers = next;
    morphList(root, itemsOf(Array.from(root.childNodes)), itemsOf(Array.from(frag.childNodes)), null);
    const lang = comp.state.lang || comp.props.lang;
    if (lang && document.documentElement.lang !== lang) document.documentElement.lang = lang;
  };
  for (const type of ["click", "input", "change"]) {
    root.addEventListener(type, (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-dc-" + type + "]") : null;
      if (!target || !root.contains(target)) return;
      const fn = handlers[Number(target.getAttribute("data-dc-" + type))];
      if (typeof fn === "function") fn(event);
    });
  }
  comp.__render = draw;
  draw();
  comp.__mounted = true;
  if (typeof comp.componentDidMount === "function") comp.componentDidMount();
}

window.EtkinDC = { DCLogic, mount };

})();
window.EtkinDCProps = {"accent":"#F4C542","lang":"tr","heroScene":"film","filmSpeed":6.5,"camera":"follow","autoplay":true,"speed":3.6,"phoneSpeed":5,"motion":true};
(function () {
"use strict";
const DCLogic = window.EtkinDC.DCLogic;
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { lang: null, open: 0, step: 0, playing: props.autoplay !== false, sel: null, view: null, filmIdx: 0, appOn: false, phScene: 0, phPlaying: true, offline: false, queue: 0, synced: false };
  }
  componentDidMount() {
    this.schedule();
    this.phSchedule();
    this.filmSchedule();
  }
  componentWillUnmount() {
    clearTimeout(this._t);
    clearTimeout(this._pt);
    clearTimeout(this._ft);
    clearTimeout(this._fa);
  }
  filmDur() {
    return Math.max(4, Number(this.props.filmSpeed) || 6.5);
  }
  filmGo(i) {
    
    clearTimeout(this._fa);
    this.setState({ filmIdx: i, appOn: false });
    if (i === 3) {
      this._fa = setTimeout(() => { this.setState({ appOn: true }); }, this.filmDur() * 450);
    }
  }
  filmSchedule() {
    
    clearTimeout(this._ft);
    var extra = this.state.filmIdx === 3 ? 1.6 : 1;
    this._ft = setTimeout(() => {
      if (this.props.motion !== false) this.filmGo((this.state.filmIdx + 1) % 4);
      this.filmSchedule();
    }, this.filmDur() * 1000 * extra);
  }
  phGo(n) {
    var s = this.state;
    this.setState({ phScene: n, queue: s.offline ? s.queue + 1 : 0, synced: false });
  }
  phSchedule() {
    
    clearTimeout(this._pt);
    var ms = Math.max(3.5, Number(this.props.phoneSpeed) || 5) * 1000;
    this._pt = setTimeout(() => {
      if (this.state.phPlaying && this.props.motion !== false) this.phGo((this.state.phScene + 1) % 6);
      this.phSchedule();
    }, ms);
  }
  schedule() {
    
    clearTimeout(this._t);
    var ms = Math.max(2.4, Number(this.props.speed) || 3.6) * 1000;
    this._t = setTimeout(() => {
      if (this.state.playing && this.props.motion !== false) {
        this.setState({ step: (this.state.step + 1) % 6 });
      }
      this.schedule();
    }, ms);
  }
  dict() {
    return {
      tr: {
        navSolution: 'Çözüm', navSectors: 'Sektörler', navRental: 'Kiralama modeli', navFaq: 'Sorular',
        login: 'Uygulamaya giriş', loginShort: 'GİRİŞ',
        eyebrow: 'UÇTAN UCA İZLENEBİLİRLİK',
        title1: 'Girişten sevkiyata kesintisiz kontrolün', title2: 'en kolay hali.',
        qrLine: 'Tekil QR kod ile girişten üretime, üretimden sevkiyata kayıpsız izlenebilirlik.',
        heroSub: 'Koli, paket, varil ya da palet; kabul anında her birine kendi QR etiketi basılır. Depodan üretime, yarı mamulden mamule ve sevkiyata kadar her hareket iz bırakır. Ekran kullanıcıyı doğru işleme yönlendirir: eğitim gerekmez, birkaç dokunuş yeter.',
        cta1: 'İşletmeniz için demo iste', cta2b: 'Yolculuğu izleyin',
        heroChips: [{ n: 'Anında tekil QR etiket' }, { n: 'Eğitimsiz, yönlendirmeli kullanım' }, { n: 'Az dokunuş, akıllı öneri' }, { n: 'Veriden değere' }],
        repr: 'Temsili veriler',
        mapTitle: 'CANLI SAHA', viewLabel: 'Kamera', vFollow: 'Takip', vIso: 'İzometrik', vTop: 'Plan',
        zDock: 'Ürün kabul', zProd: 'Üretim', zRacks: 'Raflar', zShip: 'Sevkiyat', suggest: 'Öneri: A-03',
        filmK: 'SAHADAN', filmNav: 'Sahneler',
        film: [
          ['Dokunmatik ekranda ürün kabul', 'Gelen koli, paket ve varil kioskta tek dokunuşla kayda girer.'],
          ['Anında tekil QR etiket', 'Taşınabilir yazıcı, her pakete kendi QR kodunu basar.'],
          ['Okut, öneriyi al', 'Telefonla okutulan QR ürünü tanır ve doğru rafı önerir.'],
          ['Her şey cebinizde', 'Transferden sevkiyata tüm işlemler tek uygulamada, birkaç dokunuşla.']
        ],
        flowLabel: 'Operasyon adımları',
        stepLabel: 'ADIM', prev: 'Önceki adım', next: 'Sonraki adım', play: 'Oynat', pause: 'Duraklat',
        logLabel: 'HAREKET KAYDI', cellLabel: 'Raf', slotPick: 'RAF GÖZÜ SEÇİN',
        stStock: 'Stokta', stEmpty: 'Boş', stCheck: 'Kontrol', stNew: 'Yeni yerleşti', emptyName: 'Boş göz', emptyCode: '—', emptyUnit: 'yerleştirmeye hazır',
        products: [['AMB-001', 'Ambalaj malzemesi', 'adet'], ['HAM-024', 'Hammadde', 'kg'], ['URN-108', 'Mamul ürün', 'adet']],
        flowSteps: [
          { s: 'Kabul', t: 'Kabulde tekil QR', d: 'Koli, paket, varil ya da palet; gelen her birime kabul anında kendi QR etiketi basılır. İzlenebilirlik ilk dokunuşta başlar.', log: 'HAM-024 · QR oluşturuldu' },
          { s: 'Okut', t: 'Okut, öneriyi al', d: 'QR okutulduğu an sistem ürünü tanır ve en uygun rafı önerir. Kullanıcı ne yapacağını düşünmez; ekran yönlendirir.', log: 'HAM-024 okutuldu · öneri A-03' },
          { s: 'Yerleştir', t: 'Önerilen rafa yerleştir', d: 'Tek dokunuşla onay; konum anında stok kaydına işlenir. Arama yok, tahmin yok.', log: 'HAM-024 → A-03' },
          { s: 'Yarı mamul', t: 'Üretimde yarı mamul', d: 'Hammadde üretime çıkar; yarı mamul kendi QR’ıyla kayda girer ve kullanılan hammaddeye bağlanır.', log: 'YM-024 · yarı mamul' },
          { s: 'Mamul', t: 'Yarı mamulden mamule', d: 'Son işlemden çıkan mamul, hammadde ve yarı mamul geçmişiyle birlikte izlenebilir hâle gelir.', log: 'URN-108 · mamul girişi' },
          { s: 'Sevkiyat', t: 'Sevkiyat ve tam iz', d: 'Yüklenen her paketin kabulden sevkiyata tüm yolculuğu tek QR okutmasıyla görülür. Veri, değere dönüşür.', log: 'URN-108 sevk edildi' }
        ],
        solKicker: 'DAHA AZ DOKUNUŞ. DAHA ÇOK DEĞER.',
        solA: 'Veri girmek için değil,', solB: 'iş yapmak için.',
        solSub: 'Etkin WMS kullanıcıyı ekran ekran doğru işleme götürür. Az dokunuşla toplanan veri, izlenebilir ve raporlanabilir bilgiye dönüşür.',
        f1Title: 'Uçtan uca izlenebilirlik', f1Body: 'Girişten üretime, yarı mamulden mamule ve sevkiyata kadar her hareket kayıt altında. Bir paketin tüm geçmişi tek okutmayla önünüzde.', f1Tag: 'Kabul → üretim → sevkiyat',
        f2Title: 'Yönlendirmeli kullanım', f2Body: 'Yazılımı hiç bilmeyen biri bile doğru işlemi yapar: sistem sıradaki adımı ve uygun rafı önerir. Eğitim yükü en aza iner.', f2Tag: 'Az dokunuş · akıllı öneri',
        f3Title: 'Tekil QR & anlık etiket', f3Body: 'Kabulde her koli, paket, varil ya da palete kendi QR’ı basılır. Aynı ürünün iki paketi bile birbirine karışmaz.', f3Tag: 'Telefon · notebook · etiket yazıcı',
        secKicker: 'SEKTÖRÜNÜZ FARKLI. İHTİYACINIZ TANIDIK.',
        secA: 'Sizin ürününüz.', secB: 'Sizin iş akışınız.',
        secSub: 'Bir sektöre sıkışan yazılım yerine, ürün ve birim yapınıza uyarlanabilen bir stok altyapısı.',
        sectors: [{ i: '01', n: 'Üretim' }, { i: '02', n: 'Toptan ticaret' }, { i: '03', n: 'Depo & lojistik' }, { i: '04', n: 'Perakende' }],
        scnKicker: 'ÖRNEK KULLANIM SENARYOSU',
        scnTitle: 'Hammaddeden mamule, aynı düzen.',
        scnBody: 'Kg, metre veya adet: malzeme ve ürünlerinizi kendi birimleriyle takip edin. Üretim tüketimi ve mamul girişinin pilot kapsamını işletmenize göre planlayalım.',
        scnLink: 'Bu akışı birlikte inceleyelim',
        flow: [{ k: '01', t: 'Hammadde', s: 'Ürün kabul · tekil QR' }, { k: '02', t: 'Üretim', s: 'İşlem takibi' }, { k: '03', t: 'Mamul', s: 'Sevkiyat' }],
        mobKicker: 'SAHADA, CEBİNİZDE',
        mobA: 'Donanım bağımsız.', mobB: 'İnternet kesilse de iş durmaz.',
        mobBody: 'Etkin WMS web üzerinden çalışır; telefon, tablet ya da el terminali fark etmez, kurulum gerekmez. Bağlantı koptuğunda işlemler cihazda sıraya alınır, bağlantı geri geldiğinde kendiliğinden senkronize olur.',
        mobChips: [{ n: 'Web tabanlı, kurulum yok' }, { n: 'Telefon · tablet · el terminali' }, { n: 'Çevrimdışı çalışma' }, { n: 'Bluetooth etiket yazıcı' }, { n: 'Sesli komut' }],
        phScenes: [
          ['Görevlerim', '5 bölüm; kalan iş ve kalem tek bakışta'],
          ['Satın alma girişi', 'Barkodu okut, lot ve SKT kendiliğinden dolsun'],
          ['Tekil QR bas', 'Ambalajı seç, etiketler anında çıksın'],
          ['Rotayla toplama', 'Raf raf, fotoğraflı ürün ve büyük sayaç'],
          ['Kör sayım', 'Say; fark varsa sistem uyarsın'],
          ['Gün tamam', 'Her işlem geri alınabilir, iz kesintisiz']
        ],
        gxHello: 'Günaydın, Ali', gxShift: 'VARDİYA 08:00–17:00 · ANA DEPO', gxLeft: 'KALAN', gxDone: 'BİTEN', gxProb: 'SORUN',
        gxS1: 'Giriş Görevi', gxS2: 'Çıkış Görevi', gxS3: 'Transfer Görevi', gxS4: 'Üretim Transfer', gxS5: 'Sayım Görevi',
        gxS1n: '2 SİPARİŞ · 6 KALEM', gxS2n: '3 SİPARİŞ · 8 KALEM', gxS3n: '2 FİŞ · 3 KALEM', gxS4n: '2 EMİR · 5 KALEM', gxS5n: '2 SAYIM · 3 KALEM',
        gxScan: 'OKUT · BAŞLA', gxRecv: 'PO-0412 · GİRİŞ', gxRecvSub: 'ÖRNEK KİMYA · 0/4 KALEM', gxRecvSub2: 'ÖRNEK KİMYA · 1/4 KALEM · 6 QR',
        gxBc: '▮▮ BARKODLU · LOT OTO', gxStd: '▮▮ STANDART · QR YOK', gxFromBc: '✦ BARKODDAN OKUNDU', gxPack: 'QR HANGİ AMBALAJA?', gxLt: 'LİTRE', gxCan: 'BİDON = 20 L',
        gxCreate: 'OLUŞTUR + YAZDIR · 6 QR', gxPrinted: '6 ETİKET BASILDI', gxBoxName: 'Koli 40×30', gxPaint: 'Boya 2,5 L', gxPrimer: 'Astar 1 L', gxVarnish: 'Vernik 0,75 L', gxSil: 'Silikon 310 ml',
        gxPick: 'SO-0091 · TOPLAMA', gxAt: 'B-01 RAFINDASINIZ', gxPcs: 'ADET', gxOne: 'OKUT +1',
        gxCount: 'SYM-0103 · SAYIM', gxBlind: 'KÖR SAYIM', gxCounted: 'L SAYILDI', gxDiff: 'SAYIM FARKI', gxDiffQ: 'Bir kez daha saymak ister misiniz?',
        gxDay: 'GÜN TAMAM', gxDaySub: '11 GÖREV · 25 KALEM', gxUndo: 'GERİ AL', gxUndoL: 'Her işlem geri alınabilir',
        offLabel: 'İnternet kesintisini dene', offHint: 'Anahtarı açın: işlemler cihazda kuyruğa alınır. Kapatınca hepsi senkronize olur.',
        netOn: 'Çevrimiçi', netOff: 'Çevrimdışı · {n} kuyrukta', syncedMsg: 'Kuyruktaki işlemler senkronize edildi',
        phPlay: 'Oynat', phPause: 'Duraklat', phFoot: 'Temsili akış',
        ph0k: 'ÜRÜN KABUL', ph0t: 'Yeni giriş', fProd: 'ÜRÜN', vProd: 'HAM-024 · Hammadde', fPack: 'PAKET TİPİ', packs: ['Koli', 'Paket', 'Varil', 'Palet'], fQty: 'MİKTAR', vQty: '250 kg', bQr: 'QR oluştur', qrDone: 'Tekil QR oluşturuldu',
        ph1k: 'ETİKET', ph1t: 'Bluetooth yazıcıdan bas', bt: 'Taşınabilir yazıcı · bağlı', printing: 'Basılıyor…', printed: 'Etiket basıldı',
        ph2k: 'OKUT & YERLEŞTİR', ph2t: 'Okut, öneriyi onayla', scanned: 'Okundu: HAM-024-P0193', sugK: 'ÖNERİLEN RAF', sugV: 'A-03 · üst kat', bOk: 'Onayla', placed: 'Konum kaydedildi',
        ph3k: 'ÜRETİM EMRİ', ph3t: 'Söyleyin ya da seçin', say: 'Yarı mamul YM-024 üret', recipe: 'REÇETE · YM-024', r1n: 'Hammadde', r1q: '120 kg', r2n: 'Ambalaj malzemesi', r2q: '40 adet', orPick: 'veya listeden seçin',
        ph4k: 'TRANSFER', ph4t: 'Okut, miktar otomatik', scanIt: 'Okut', autoQty: 'Miktarlar reçeteden otomatik gelir', moved: 'Üretime transfer edildi',
        ph5k: 'MAMUL & SEVKİYAT', ph5t: 'Tam iz, tek QR', newQr: 'Yeni QR: URN-108-0042', chain: ['Kabul · QR', 'Raf A-03', 'Transfer', 'Üretim · YM-024', 'Mamul · URN-108'], ready: 'Sevkiyata hazır',
        bullets: [{ n: 'Telefon ve notebook kamerasıyla QR ve barkod okutma' }, { n: 'Klavye gibi çalışan barkod okuyucularla kullanım' }, { n: 'A4 deneme baskısı ve mm ölçüsü seçilen etiketler' }],
        mobNote: 'Bluetooth ve USB yazıcı desteği cihaza ve işletim sistemine göre değişir; pilot kurulumda uyumluluk testi yapılır.',
        phoneWh: 'Merkez · Saha', phoneKicker: 'GÜNLÜK AKIŞ', phoneTitle: 'İşiniz sırada.',
        p1Kicker: 'ÜRÜN KABUL', p1Title: 'Gelen malzemeyi kontrol edin.', p1Path: 'Ürün → miktar → konum', p1Btn: 'İşleme devam et',
        p2Kicker: 'YERLEŞTİRME', p2Title: 'Doğru ürün. Doğru konum.',
        tab1: 'Kabul', tab2: 'Yerleştir', tab3: 'Çıkış',
        rentKicker: 'AYLIK KİRALAMA MODELİ',
        rentA: 'İhtiyacınız kadar başlayın.', rentB: 'İşinizle birlikte büyütün.',
        rentBody: 'Depo sayınız, kullanıcılarınız ve iş akışınız için uygun kapsamı belirleyelim. Standart bir fiyat tablosu yerine işletmenize uygun teklif hazırlayalım.',
        rentBodyPlans: 'Paketlerden birini seçin; depo sayınıza ve iş akışınıza özel kapsam için teklif de hazırlayabiliriz.',
        planRec: 'ÖNERİLEN', planPer: '/ AY · KDV HARİÇ', planNote: 'Fiyatlar aylık ve KDV hariçtir. Yükseltme hemen, düşürme sonraki dönemden geçerlidir.',
        planU: { unl: 'Sınırsız', a: 'yönetici', f: 'saha personeli', w: 'depo', i: 'kalem', qr: 'QR paket etiketi', ship: 'Sevkiyat ve toplama', prod: 'Üretim ve reçete', api: 'ERP / API bağlantısı' },
        steps: [
          { n: '1', t: 'İhtiyacı birlikte belirleyelim', s: 'Ürünler, depolar, cihazlar ve günlük işlemler.' },
          { n: '2', t: 'Pilot kurulumu deneyin', s: 'Gerçek senaryonuzla barkod, stok ve etiket kontrolü.' },
          { n: '3', t: 'Aylık modelle devam edin', s: 'Mutabık kalınan kapsam ve kullanım koşullarıyla.' }
        ],
        faqKicker: 'AKLINIZDAKİ SORULAR', faqTitle: 'Başlamadan önce.',
        faq: [
          ['Yalnız üretim yapan firmalar için mi?', 'Hayır. Ürün, stok birimi ve depo yapısı farklı sektörlere uyarlanabilir. İhtiyacınız olan iş akışları pilot kapsamı belirlenirken netleştirilir.'],
          ['Android el terminali için native uygulama şart mı?', 'Her cihaz için şart değil. Barkodu klavye girdisi olarak ileten terminaller web arayüzüyle kullanılabilir. Özel tarayıcı SDK’sı veya doğrudan cihaz bağlantısı gerekiyorsa cihaz bazında değerlendirilir.'],
          ['Her yazıcıdan doğrudan etiket alabilir miyim?', 'Tarayıcının yazdırma penceresi üzerinden işletim sisteminin tanıdığı yazıcılara çıktı alınabilir. Etiket ölçüsü ayarlanabilir. Doğrudan USB/Bluetooth baskı her cihazda aynı değildir; sürücü ve cihaz testi gerekir.'],
          ['Aylık ücret ve kurulum neye göre belirlenir?', 'Depo ve kullanıcı sayısı, süreç kapsamı, cihazlar ve ihtiyaç duyulan kurulum desteği değerlendirilir. Teklif aşamasında aylık kullanım ve varsa kurulum bedelleri ayrı açıklanır.'],
          ['Bugün tüm modülleri kullanabilir miyim?', 'Etkin WMS pilot kurulum aşamasındadır. Kullanılabilir ekranlar, üretim/sevkiyat kapsamı ve cihaz desteği demo sırasında açıkça gösterilir; devreye alma kabul testleri tamamlanınca yapılır.']
        ],
        demoKicker: 'SİZİN DEPONUZLA BAŞLAYALIM.',
        demoA: 'İş akışınızı anlatın.', demoB: 'Birlikte netleştirelim.',
        demoBody: 'Firmanızı ve ihtiyacınızı bırakın. Size uygun demo ve pilot kapsamı için iletişime geçelim.',
        demoChips: [{ n: 'Birden fazla depo' }, { n: 'Kamera ile barkod' }, { n: 'Etiket çıktısı' }],
        fName: 'Adınız', fCompany: 'Firma', fEmail: 'İş e-postası', fSector: 'Sektörünüz', fNeed: 'İhtiyacınız',
        options: [{ id: 'manufacturing', n: 'Üretim', icon: 'M3 21V10l6 3V8l6 3V3h6v18H3Z' }, { id: 'wholesale', n: 'Toptan ticaret', icon: 'M3 8l9-5 9 5v13H3V8ZM3 8l9 5 9-5M12 13v8' }, { id: 'logistics', n: 'Depo ve lojistik', icon: 'M2 7h13v11H2V7ZM15 11h4l3 4v3h-7M5 18v3M18 18v3' }, { id: 'retail', n: 'Perakende', icon: 'M3 9l2-6h14l2 6M4 9v12h16V9M9 21v-8h6v8' }, { id: 'other', n: 'Diğer', icon: 'M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h6v6h-6v-6Z' }],
        fNeedHint: 'Kimlik numarası, sağlık bilgisi, şifre veya müşterilerinize ait kişisel veri yazmayın.',
        fConsentA: 'Demo talebime ilişkin', notice: 'Aydınlatma Metni', fConsentB: '’ni okudum.',
        privacy: 'Aydınlatma Metni', fSubmit: 'Teklif ve demo iste',
        fSending: 'Talebiniz gönderiliyor…', fSendingBtn: 'Gönderiliyor…', fErr: 'Gönderilemedi', fRetry: 'tekrar dene', fLimit: 'Çok fazla deneme oldu. Biraz sonra tekrar deneyin.', fInvalid: 'Eksik ya da hatalı alanları düzeltin.',
        fDoneTitle: 'Talebiniz alındı', fDoneBody: 'Talebinizi görmek için e-postanıza iletilen güvenli bağlantıyı açın. Kısa aralıklarla yeni bağlantı gönderilmez.', fRef: 'Talep no', fHome: 'Ana sayfaya dön',
        eNameReq: 'Adınızı yazın.', eCompanyReq: 'Firma adını yazın.', eEmailReq: 'E-posta adresinizi yazın.', eEmailBad: 'Geçerli bir e-posta yazın (ör. ad@firma.com).', eConsentReq: 'Devam etmek için Aydınlatma Metni kutusunu işaretleyin.',
        footTag: 'Uçtan uca izlenebilir depo yönetimi.'
      },
      en: {
        navSolution: 'Solution', navSectors: 'Industries', navRental: 'Rental model', navFaq: 'FAQ',
        login: 'Sign in', loginShort: 'SIGN IN',
        eyebrow: 'END-TO-END TRACEABILITY',
        title1: 'Seamless control from receiving to shipping,', title2: 'made simple.',
        qrLine: 'Lossless traceability with unique QR codes, from receiving to production and from production to shipping.',
        heroSub: 'Carton, parcel, drum or pallet: each one gets its own QR label the moment it’s received. Every movement leaves a trace, from storage to production, semi-finished to finished goods, all the way to shipping. The screen guides each user to the right action: no training needed, just a few taps.',
        cta1: 'Request a demo for your business', cta2b: 'Follow the journey',
        heroChips: [{ n: 'Instant unique QR labels' }, { n: 'Guided, training-free use' }, { n: 'Fewer taps, smart suggestions' }, { n: 'From data to value' }],
        repr: 'Representative data',
        mapTitle: 'LIVE FLOOR', viewLabel: 'Camera', vFollow: 'Follow', vIso: 'Isometric', vTop: 'Plan',
        zDock: 'Receiving', zProd: 'Production', zRacks: 'Racks', zShip: 'Shipping', suggest: 'Suggested: A-03',
        filmK: 'ON THE FLOOR', filmNav: 'Scenes',
        film: [
          ['Receiving on a touchscreen', 'Incoming cartons, parcels and drums are recorded at the kiosk with one tap.'],
          ['Instant unique QR label', 'A portable printer gives every package its own QR code.'],
          ['Scan, get the suggestion', 'A phone scan recognises the item and suggests the right slot.'],
          ['Everything in your pocket', 'From transfer to shipping, every action in one app, in a few taps.']
        ],
        flowLabel: 'Operation steps',
        stepLabel: 'STEP', prev: 'Previous step', next: 'Next step', play: 'Play', pause: 'Pause',
        logLabel: 'MOVEMENT LOG', cellLabel: 'Slot', slotPick: 'PICK A RACK SLOT',
        stStock: 'In stock', stEmpty: 'Empty', stCheck: 'Check', stNew: 'Just placed', emptyName: 'Empty slot', emptyCode: '—', emptyUnit: 'ready for put-away',
        products: [['AMB-001', 'Packaging material', 'pcs'], ['HAM-024', 'Raw material', 'kg'], ['URN-108', 'Finished product', 'pcs']],
        flowSteps: [
          { s: 'Receive', t: 'A unique QR at receiving', d: 'Carton, parcel, drum or pallet: every unit gets its own QR label the moment it’s received. Traceability starts with the first touch.', log: 'HAM-024 · QR created' },
          { s: 'Scan', t: 'Scan, get the suggestion', d: 'The moment the QR is scanned, the system recognises the item and suggests the best slot. Users don’t have to think; the screen guides them.', log: 'HAM-024 scanned · suggest A-03' },
          { s: 'Put away', t: 'Into the suggested slot', d: 'One tap to confirm; the location is written to the stock record instantly. No searching, no guessing.', log: 'HAM-024 → A-03' },
          { s: 'Semi-finished', t: 'Semi-finished in production', d: 'Raw material goes to production; the semi-finished item gets its own QR and is linked to the raw material it used.', log: 'YM-024 · semi-finished' },
          { s: 'Finished', t: 'From semi-finished to finished', d: 'The finished product leaves the last operation traceable along with its raw-material and semi-finished history.', log: 'URN-108 · goods receipt' },
          { s: 'Shipping', t: 'Shipping, fully traced', d: 'Each loaded package’s whole journey, from receiving to shipping, is one QR scan away. Data turns into value.', log: 'URN-108 shipped' }
        ],
        solKicker: 'FEWER TAPS. MORE VALUE.',
        solA: 'Not for entering data,', solB: 'for getting work done.',
        solSub: 'Etkin WMS walks each user, screen by screen, to the right action. Data captured in a few taps becomes traceable, reportable information.',
        f1Title: 'End-to-end traceability', f1Body: 'Every movement is recorded, from receiving to production, semi-finished to finished goods and shipping. A package’s full history is one scan away.', f1Tag: 'Receiving → production → shipping',
        f2Title: 'Guided use', f2Body: 'Even someone who has never used the software does the right thing: the system suggests the next step and the right slot. Training effort drops to a minimum.', f2Tag: 'Fewer taps · smart suggestions',
        f3Title: 'Unique QR & instant labels', f3Body: 'Every carton, parcel, drum or pallet gets its own QR at receiving. Even two packages of the same product never get mixed up.', f3Tag: 'Phone · laptop · label printer',
        secKicker: 'YOUR INDUSTRY IS DIFFERENT. YOUR NEEDS ARE FAMILIAR.',
        secA: 'Your products.', secB: 'Your workflow.',
        secSub: 'Instead of software locked into one industry, a stock foundation that adapts to your product and unit structure.',
        sectors: [{ i: '01', n: 'Manufacturing' }, { i: '02', n: 'Wholesale' }, { i: '03', n: 'Warehousing & logistics' }, { i: '04', n: 'Retail' }],
        scnKicker: 'EXAMPLE SCENARIO',
        scnTitle: 'From raw material to finished goods, one system.',
        scnBody: 'Kilograms, metres or units: track materials and products in their own units. We’ll plan the pilot scope for production consumption and finished-goods receipt around your business.',
        scnLink: 'Let’s review this flow together',
        flow: [{ k: '01', t: 'Raw material', s: 'Goods receipt' }, { k: '02', t: 'Production', s: 'Process tracking' }, { k: '03', t: 'Finished goods', s: 'Shipping' }],
        mobKicker: 'ON THE FLOOR, IN YOUR POCKET',
        mobA: 'Hardware-independent.', mobB: 'Work goes on, even offline.',
        mobBody: 'Etkin WMS runs on the web: phone, tablet or handheld terminal, nothing to install. If the connection drops, actions are queued on the device and sync automatically when it’s back.',
        mobChips: [{ n: 'Web-based, no install' }, { n: 'Phone · tablet · handheld' }, { n: 'Works offline' }, { n: 'Bluetooth label printer' }, { n: 'Voice commands' }],
        phScenes: [
          ['My tasks', '5 sections; work and lines left at a glance'],
          ['Purchase receiving', 'Scan the barcode; lot and expiry fill in'],
          ['Print unique QR', 'Pick the pack; labels print instantly'],
          ['Route picking', 'Shelf by shelf, with photo and big counter'],
          ['Blind count', 'Count; the system flags any variance'],
          ['Day complete', 'Every action can be undone, unbroken trace']
        ],
        gxHello: 'Good morning, Ali', gxShift: 'SHIFT 08:00–17:00 · MAIN WH', gxLeft: 'LEFT', gxDone: 'DONE', gxProb: 'ISSUES',
        gxS1: 'Receiving', gxS2: 'Picking', gxS3: 'Transfers', gxS4: 'To production', gxS5: 'Cycle count',
        gxS1n: '2 ORDERS · 6 LINES', gxS2n: '3 ORDERS · 8 LINES', gxS3n: '2 SLIPS · 3 LINES', gxS4n: '2 ORDERS · 5 LINES', gxS5n: '2 COUNTS · 3 LINES',
        gxScan: 'SCAN · START', gxRecv: 'PO-0412 · RECEIVING', gxRecvSub: 'ÖRNEK KİMYA · 0/4 LINES', gxRecvSub2: 'ÖRNEK KİMYA · 1/4 LINES · 6 QR',
        gxBc: '▮▮ BARCODE · AUTO LOT', gxStd: '▮▮ STANDARD · NO QR', gxFromBc: '✦ READ FROM BARCODE', gxPack: 'QR ON WHICH PACK?', gxLt: 'LITRE', gxCan: 'CAN = 20 L',
        gxCreate: 'CREATE + PRINT · 6 QR', gxPrinted: '6 LABELS PRINTED', gxBoxName: 'Box 40×30', gxPaint: 'Paint 2.5 L', gxPrimer: 'Primer 1 L', gxVarnish: 'Varnish 0.75 L', gxSil: 'Silicone 310 ml',
        gxPick: 'SO-0091 · PICKING', gxAt: 'YOU ARE AT B-01', gxPcs: 'PCS', gxOne: 'SCAN +1',
        gxCount: 'SYM-0103 · COUNT', gxBlind: 'BLIND COUNT', gxCounted: 'L COUNTED', gxDiff: 'COUNT VARIANCE', gxDiffQ: 'Would you like to count once more?',
        gxDay: 'DAY COMPLETE', gxDaySub: '11 TASKS · 25 LINES', gxUndo: 'UNDO', gxUndoL: 'Every action can be undone',
        offLabel: 'Try an internet outage', offHint: 'Turn it on: actions queue on the device. Turn it off and everything syncs.',
        netOn: 'Online', netOff: 'Offline · {n} queued', syncedMsg: 'Queued actions synced',
        phPlay: 'Play', phPause: 'Pause', phFoot: 'Representative flow',
        ph0k: 'RECEIVING', ph0t: 'New receipt', fProd: 'ITEM', vProd: 'HAM-024 · Raw material', fPack: 'PACKAGE TYPE', packs: ['Carton', 'Parcel', 'Drum', 'Pallet'], fQty: 'QUANTITY', vQty: '250 kg', bQr: 'Create QR', qrDone: 'Unique QR created',
        ph1k: 'LABEL', ph1t: 'Print over Bluetooth', bt: 'Portable printer · connected', printing: 'Printing…', printed: 'Label printed',
        ph2k: 'SCAN & PUT AWAY', ph2t: 'Scan, confirm the suggestion', scanned: 'Scanned: HAM-024-P0193', sugK: 'SUGGESTED SLOT', sugV: 'A-03 · upper level', bOk: 'Confirm', placed: 'Location saved',
        ph3k: 'PRODUCTION ORDER', ph3t: 'Say it or pick it', say: 'Produce semi-finished YM-024', recipe: 'RECIPE · YM-024', r1n: 'Raw material', r1q: '120 kg', r2n: 'Packaging material', r2q: '40 pcs', orPick: 'or pick from the list',
        ph4k: 'TRANSFER', ph4t: 'Scan, quantities auto-fill', scanIt: 'Scan', autoQty: 'Quantities come from the recipe', moved: 'Transferred to production',
        ph5k: 'FINISHED & SHIPPING', ph5t: 'Full trace, one QR', newQr: 'New QR: URN-108-0042', chain: ['Receipt · QR', 'Slot A-03', 'Transfer', 'Production · YM-024', 'Finished · URN-108'], ready: 'Ready to ship',
        bullets: [{ n: 'QR and barcode scanning with phone and laptop cameras' }, { n: 'Works with scanners that type like a keyboard' }, { n: 'A4 test prints and labels sized in mm' }],
        mobNote: 'Bluetooth and USB printer support varies by device and operating system; compatibility is tested during pilot setup.',
        phoneWh: 'Main · Field', phoneKicker: 'DAILY FLOW', phoneTitle: 'Your work, in order.',
        p1Kicker: 'GOODS RECEIPT', p1Title: 'Check incoming materials.', p1Path: 'Item → quantity → location', p1Btn: 'Continue',
        p2Kicker: 'PUT-AWAY', p2Title: 'Right item. Right place.',
        tab1: 'Receive', tab2: 'Put away', tab3: 'Issue',
        rentKicker: 'MONTHLY RENTAL MODEL',
        rentA: 'Start with what you need.', rentB: 'Grow as your business grows.',
        rentBody: 'Let’s define the right scope for your warehouses, users and workflow. Instead of a fixed price list, we prepare an offer that fits your business.',
        rentBodyPlans: 'Pick one of our plans; we can also prepare an offer scoped to your warehouses and workflow.',
        planRec: 'RECOMMENDED', planPer: '/ MO · EXCL. VAT', planNote: 'Prices are monthly and exclude VAT. Upgrades apply immediately, downgrades from the next period.',
        planU: { unl: 'Unlimited', a: 'admins', f: 'field staff', w: 'warehouses', i: 'items', qr: 'QR package labels', ship: 'Shipping and picking', prod: 'Production and recipes', api: 'ERP / API connection' },
        steps: [
          { n: '1', t: 'Define the need together', s: 'Products, warehouses, devices and daily operations.' },
          { n: '2', t: 'Try the pilot setup', s: 'Barcode, stock and label checks with your real scenario.' },
          { n: '3', t: 'Continue on a monthly plan', s: 'With the agreed scope and terms of use.' }
        ],
        faqKicker: 'QUESTIONS ON YOUR MIND', faqTitle: 'Before you start.',
        faq: [
          ['Is it only for manufacturers?', 'No. Product, stock-unit and warehouse structures adapt to different industries. The workflows you need are clarified while the pilot scope is defined.'],
          ['Do Android handhelds need a native app?', 'Not for every device. Terminals that send barcodes as keyboard input work with the web interface. If a dedicated scanner SDK or direct device connection is needed, it’s assessed device by device.'],
          ['Can I print labels from any printer?', 'You can print through the browser’s print dialog to any printer your operating system recognises, and label size is adjustable. Direct USB/Bluetooth printing differs by device and needs driver and device testing.'],
          ['What sets the monthly fee and setup cost?', 'We look at the number of warehouses and users, process scope, devices and the setup support you need. The offer states monthly usage and any setup fees separately.'],
          ['Can I use every module today?', 'Etkin WMS is in its pilot-setup phase. Available screens, production/shipping scope and device support are shown openly in the demo; go-live follows completed acceptance tests.']
        ],
        demoKicker: 'LET’S START WITH YOUR WAREHOUSE.',
        demoA: 'Tell us your workflow.', demoB: 'We’ll shape it together.',
        demoBody: 'Leave your company details and what you need. We’ll get in touch about the right demo and pilot scope.',
        demoChips: [{ n: 'Multiple warehouses' }, { n: 'Camera barcode' }, { n: 'Label printing' }],
        fName: 'Your name', fCompany: 'Company', fEmail: 'Work email', fSector: 'Industry', fNeed: 'What you need',
        options: [{ id: 'manufacturing', n: 'Manufacturing', icon: 'M3 21V10l6 3V8l6 3V3h6v18H3Z' }, { id: 'wholesale', n: 'Wholesale', icon: 'M3 8l9-5 9 5v13H3V8ZM3 8l9 5 9-5M12 13v8' }, { id: 'logistics', n: 'Warehousing & logistics', icon: 'M2 7h13v11H2V7ZM15 11h4l3 4v3h-7M5 18v3M18 18v3' }, { id: 'retail', n: 'Retail', icon: 'M3 9l2-6h14l2 6M4 9v12h16V9M9 21v-8h6v8' }, { id: 'other', n: 'Other', icon: 'M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h6v6h-6v-6Z' }],
        fNeedHint: 'Please do not include ID numbers, health data, passwords or your customers’ personal data.',
        fConsentA: 'I have read the', notice: 'Privacy Notice', fConsentB: ' for my demo request.',
        privacy: 'Privacy Notice', fSubmit: 'Request an offer & demo',
        fSending: 'Sending your request…', fSendingBtn: 'Sending…', fErr: 'Could not send', fRetry: 'try again', fLimit: 'Too many attempts. Please try again a little later.', fInvalid: 'Please fix the missing or invalid fields.',
        fDoneTitle: 'Request received', fDoneBody: 'Open the secure link sent to your email to view your request. New links are not sent at short intervals.', fRef: 'Request no', fHome: 'Back to home',
        eNameReq: 'Please enter your name.', eCompanyReq: 'Please enter your company.', eEmailReq: 'Please enter your email address.', eEmailBad: 'Please enter a valid email (e.g. name@company.com).', eConsentReq: 'Please tick the Privacy Notice box to continue.',
        footTag: 'End-to-end traceable warehouse management.'
      }
    };
  }
  renderVals() {
    
    var lang = this.state.lang || this.props.lang || 'tr';
    var d = this.dict();
    var t = d[lang] || d.tr;
    var fk = this.state.formKey || '';
    var fe = this.state.fe || {};
    var fBusy = fk === 'fSending' || fk === 'fLeaving';
    var fErrRow = fk === 'fErr' || fk === 'fLimit' || fk === 'fInvalid';
    // T-407 (üretim düzeltmesi): panelden yayınlanan içerik (boot.js `props.site`). Metin Türkçedir; İngilizce görünümde tasarım metni kalır.
    var site = this.props.site && typeof this.props.site === 'object' ? this.props.site : null;
    if (site && lang === 'tr') t = Object.assign({}, t, { title1: site.title1, title2: site.title2, heroSub: site.subtitle });
    var step = this.state.step;
    var playing = this.state.playing && this.props.motion !== false;
    var accent = this.props.accent || '#F4C542';
    var mix = (p, c) => { return 'color-mix(in srgb, ' + accent + ' ' + p + '%, ' + c + ')'; };

    /* ── materials: [top, south, east] ── */
    var M = {
      slab: ['linear-gradient(rgba(23,46,66,.07) .12cqw, transparent .12cqw) 0 0 / 2.8cqw 2.8cqw, linear-gradient(90deg, rgba(23,46,66,.07) .12cqw, transparent .12cqw) 0 0 / 2.8cqw 2.8cqw, #F7F5F0', '#D9D2C4', '#C4BCAC'],
      navy: ['#2E4D69', '#172E42', '#0E2131'],
      navyD: ['#3A5D7C', '#1F3B54', '#152C40'],
      steel: ['#E9EFF4', '#C7D4DF', '#AABBCA'],
      steelD: ['#94A7B8', '#74899C', '#5C7083'],
      machine: ['#DCEAF5', '#B7CCDD', '#97B1C6'],
      kraft: ['#E8CDA2', '#CDAA77', '#B08B58'],
      kraft2: ['#DDBE8E', '#C29E69', '#A5804D'],
      check: ['#F7DC8A', '#E2BF5C', '#C9A43F'],
      semi: ['#A9CBE6', '#82A9CC', '#668EB3'],
      acc: [accent, mix(82, '#172E42'), mix(66, '#172E42')],
      wall: ['#DDE5EC', '#C3D0DB', '#A7B8C7'],
      trailer: ['linear-gradient(90deg, #FFFFFF 0 64%, ' + accent + ' 64% 80%, #FFFFFF 80%)', 'linear-gradient(90deg, #E8ECEF 49.3%, #8DA1B3 49.3% 50.7%, #E8ECEF 50.7%)', '#CDD5DC'],
      laser: ['rgba(229,72,77,.22)', 'rgba(229,72,77,.4)', 'rgba(229,72,77,.4)'],
      beam: [mix(60, 'transparent'), mix(28, 'transparent'), mix(20, 'transparent')]
    };
    var C = (x, y, w, dd, h, z, m, cls) => {
      var c = M[m];
      return { x: x, y: y, w: w, d: dd, h: h, z: z, t: c[0], s: c[1], e: c[2], cls: 'cube' + (cls ? ' ' + cls : '') };
    };

    /* ── racks data ── */
    var pattern = { A: ['s0', 's1', 'e', 'c2'], B: ['s2', 'e', 's0', 's1'], C: ['s1', 's0', 's2', 'e'] };
    var rowY = { A: 8, B: 22, C: 36 };
    var slotX = [33, 42.5, 52, 61.5];
    var sel = this.state.sel;

    var cubes = [];
    cubes.push(C(0, 0, 100, 100, 1.6, -1.6, 'slab'));
    /* truck (back right) */
    var truckCls = step === 5 ? 'truck go' : 'truck';
    cubes.push(C(83, 2.5, 11, 6.5, 4.6, 0, 'navy', truckCls));
    cubes.push(C(82, 9.5, 13, 23, 6.2, 0, 'trailer', truckCls));
    /* racks */
    var slots = [];
    var selInfo = null;
    ['A', 'B', 'C'].forEach((r) => {
      var ry = rowY[r];
      [32.5, 42, 51.5, 61, 70.5].forEach((ux) => { cubes.push(C(ux, ry, 1, 7, 9.8, 0, 'navy')); });
      cubes.push(C(32.5, ry, 39, 7, .35, 3.2, 'acc'));
      cubes.push(C(32.5, ry, 39, 7, .35, 6.6, 'acc'));
      pattern[r].forEach((p, i) => {
        var id = r + '-0' + (i + 1);
        var kind = p.charAt(0), pi = Number(p.charAt(1));
        var x0 = slotX[i];
        if (id === 'A-03' && step === 2) { kind = 'n'; pi = 1; }
        if (kind === 's') {
          cubes.push(C(x0 + 1.2, ry + .9, 7, 5.2, 2.5, 0, 'kraft'));
          cubes.push(C(x0 + 1.2, ry + .9, 7, 5.2, 2.5, 3.55, 'kraft2'));
        } else if (kind === 'c') {
          cubes.push(C(x0 + 1.2, ry + .9, 7, 5.2, 2.5, 0, 'check'));
        }
        if (id === sel || (step === 1 && id === 'A-03')) cubes.push(C(x0 + .3, ry + .3, 8.9, 6.4, 13, 0, 'beam', 'beamcol'));
        var prod = kind === 'e' ? null : t.products[pi];
        var key = kind === 's' ? 'stock' : kind === 'c' ? 'check' : kind === 'n' ? 'new' : 'empty';
        var st = kind === 's' ? t.stStock : kind === 'c' ? t.stCheck : kind === 'n' ? t.stNew : t.stEmpty;
        var info = {
          id: id, state: st,
          name: prod ? prod[1] : t.emptyName,
          code: prod ? prod[0] : t.emptyCode,
          unit: prod ? prod[2] : t.emptyUnit,
          badge: key === 'stock' ? '#DCEAF5' : key === 'check' ? '#FFF0C2' : key === 'new' ? accent : '#EEF1F4'
        };
        if (id === sel) selInfo = info;
        slots.push({
          id: id,
          cls: 'slotbtn ' + key + (id === sel ? ' sel' : ''),
          pressed: id === sel ? 'true' : 'false',
          aria: t.cellLabel + ' ' + id + ': ' + info.name + ', ' + st,
          pick: () => { this.setState({ sel: id }); }
        });
      });
    });
    /* scan gate */
    cubes.push(C(26, 51.5, 1.2, 1.2, 6.2, 0, 'navy'));
    cubes.push(C(26, 62, 1.2, 1.2, 6.2, 0, 'navy'));
    cubes.push(C(26, 51.5, 1.2, 11.7, .8, 6.2, 'acc'));
    cubes.push(C(26.45, 52.7, .3, 9.3, 6, .1, 'laser', step === 1 ? 'laser on' : 'laser'));
    /* receiving dock */
    cubes.push(C(1, 60, 1.2, 37, 4.2, 0, 'wall'));
    cubes.push(C(3, 86, 26, 5.5, .9, 0, 'steel'));
    cubes.push(C(3, 86.8, 4, 3.9, 2, .9, 'kraft', 'conv'));
    cubes.push(C(3, 86.8, 4, 3.9, 2, .9, 'kraft2', 'conv c2'));
    cubes.push(C(3, 86.8, 4, 3.9, 2, .9, 'kraft', 'conv c3'));
    /* production */
    cubes.push(C(54, 64, 16, 12, 4.2, 0, 'machine'));
    cubes.push(C(59.5, 67, 5, 6, 1.3, 4.2, 'navy', step === 3 ? 'piston on' : 'piston'));
    cubes.push(C(66, 65, 2.2, 2.2, 3, 4.2, 'steelD'));
    cubes.push(C(55, 65, 1.6, 1.6, 1.1, 4.2, step === 3 ? 'acc' : 'steelD', step === 3 ? 'blink' : ''));
    cubes.push(C(70, 72, 8.5, 5, 1.4, 0, 'steel'));
    cubes.push(C(60, 82, 10, 8, 2.6, 0, 'machine'));
    cubes.push(C(68.5, 83, 1.4, 1.4, 1, 2.6, step === 4 ? 'acc' : 'steelD', step === 4 ? 'blink' : ''));
    /* QR label printer at receiving */
    cubes.push(C(9, 79, 5, 4, 2.4, 0, 'steel'));
    cubes.push(C(10, 80.2, 3, .5, 1.3, 2.4, 'acc', step === 0 ? 'blink' : ''));

    /* ── forklift ── */
    var FL = [
      { x: 6, y: 74, r: 0, f: .3 },
      { x: 20, y: 55.5, r: 0, f: .3 },
      { x: 53.75, y: 17, r: -90, f: 3.7 },
      { x: 46, y: 70, r: 0, f: .3 },
      { x: 53, y: 81.5, r: 0, f: .3 },
      { x: 83, y: 34, r: -90, f: 1.6 }
    ][step];
    var fl = {
      x: FL.x, y: FL.y, r: FL.r,
      parts: [
        C(0, 15, 66, 70, 1.9, 0, 'navy'),
        C(6, 18, 8, 9, 3.7, 0, 'navyD'),
        C(6, 73, 8, 9, 3.7, 0, 'navyD'),
        C(4, 14, 46, 72, .3, 3.7, 'navyD'),
        C(66, 10, 9, 80, 4.8, 0, 'steelD'),
        C(75, 24, 25, 11, .25, FL.f, 'steelD', 'mov'),
        C(75, 65, 25, 11, .25, FL.f, 'steelD', 'mov'),
        C(22, 40, 12, 20, .6, 4, 'acc', 'blink')
      ]
    };

    /* ── the package ── */
    var PK = [
      { x: 22, y: 86.8, z: .9 },
      { x: 23.1, y: 56, z: .55 },
      { x: 54.5, y: 9.5, z: 3.55 },
      { x: 71.5, y: 72.5, z: 1.4 },
      { x: 62.75, y: 84, z: 2.6 },
      { x: 83.75, y: 32.2, z: 1.85 }
    ][step];
    var pm = step >= 4 ? M.navy : step === 3 ? M.semi : M.kraft;
    var pkCode = step >= 4 ? 'URN-108' : step === 3 ? 'YM-024' : 'HAM-024';
    var pk = { x: PK.x, y: PK.y, z: PK.z, t: pm[0], s: pm[1], e: pm[2], cls: 'cube mov' + (step === 5 ? ' loaded' : '') };

    /* ── camera ── */
    var view = this.state.view || this.props.camera || 'follow';
    var V = { follow: { tilt: 52, rz: 45, s: 1.75 }, iso: { tilt: 58, rz: 45, s: 1 }, top: { tilt: 0, rz: 0, s: .98 } }[view] || { tilt: 58, rz: 45, s: 1 };
    var W = 56, rad = Math.PI / 180;
    var px = 0, py = 3;
    if (view === 'follow') {
      var fx = PK.x + 2.25, fy = PK.y + 2, fz = PK.z;
      var dx = (fx - 50) / 100 * W, dy = (fy - 50) / 100 * W;
      var a = V.rz * rad, ti = V.tilt * rad;
      var sx = dx * Math.cos(a) - dy * Math.sin(a);
      var sy = (dx * Math.sin(a) + dy * Math.cos(a)) * Math.cos(ti) - fz * Math.sin(ti);
      px = -sx * V.s; py = -sy * V.s + 4;
    } else if (view === 'top') { py = -3; }
    var r2 = (n) => { return Math.round(n * 100) / 100; };
    var world = 'translate(-50%, -50%) translate(' + r2(px) + 'cqw, ' + r2(py) + 'cqw) scale(' + V.s + ') rotateX(' + V.tilt + 'deg) rotateZ(' + V.rz + 'deg)';
    var bb = (z) => { return 'translateZ(' + z + 'cqw) rotateZ(' + (-V.rz) + 'deg) rotateX(' + (-V.tilt) + 'deg) translate(-50%, -100%)'; };

    var zoneOn = [step <= 1, step === 2, step === 3 || step === 4, step === 5];
    var tags = [
      { x: 15, y: 76, z: 6, l: t.zDock, on: zoneOn[0] },
      { x: 52, y: 5, z: 12, l: t.zRacks, on: zoneOn[1] },
      { x: 62, y: 69, z: 7.5, l: t.zProd, on: zoneOn[2] },
      { x: 88.5, y: 14, z: 9, l: t.zShip, on: zoneOn[3] }
    ].map((g) => {
      return { x: g.x, y: g.y, l: g.l, tf: bb(g.z), cls: 'tag', bg: g.on ? '#172E42' : '#FFFFFF', fg: g.on ? '#FFFFFF' : '#172E42' };
    });
    tags.push({ x: PK.x + 2.25, y: PK.y + 2, l: 'QR · ' + pkCode, tf: bb(PK.z + 3.4), cls: 'tag' + (step === 5 ? ' loaded' : ''), bg: accent, fg: '#172E42' });
    if (step === 1) tags.push({ x: 56.75, y: 11.5, l: t.suggest, tf: bb(14.5), cls: 'tag', bg: '#172E42', fg: '#FFFFFF' });

    var decals = [
      { x: 2, y: 61, w: 28, h: 37, l: t.zDock, on: zoneOn[0] },
      { x: 30, y: 3, w: 44, h: 46, l: t.zRacks, on: zoneOn[1] },
      { x: 49, y: 58, w: 32, h: 36, l: t.zProd, on: zoneOn[2] },
      { x: 78, y: 1, w: 21, h: 42, l: t.zShip, on: zoneOn[3] }
    ].map((z) => { return { x: z.x, y: z.y, w: z.w, h: z.h, l: z.l, cls: z.on ? 'decal on' : 'decal' }; });

    var views = [['follow', t.vFollow], ['iso', t.vIso], ['top', t.vTop]].map((v) => {
      return { l: v[1], cls: 'vbtn' + (v[0] === view ? ' on' : ''), pressed: v[0] === view ? 'true' : 'false', go: () => { this.setState({ view: v[0] }); } };
    });

    var fs = t.flowSteps;
    var pills = fs.map((f, i) => {
      return {
        n: String(i + 1), t: f.s,
        cls: 'pill' + (i === step ? ' on' : i < step ? ' done' : ''),
        selected: i === step ? 'true' : 'false',
        go: () => { this.setState({ step: i, playing: false }); }
      };
    });
    var log = fs.slice(0, step + 1).map((f, i) => {
      return { n: f.log, dot: i === step ? accent : '#DCEAF5' };
    }).reverse();

    var open = this.state.open;
    var faq = t.faq.map((f, i) => {
      var isOpen = open === i;
      return {
        q: f[0], a: f[1], isOpen: isOpen,
        cls: isOpen ? 'faq open' : 'faq',
        expanded: isOpen ? 'true' : 'false',
        toggle: () => { this.setState({ open: this.state.open === i ? -1 : i }); }
      };
    });
    var motion = this.props.motion !== false;

    /* ── animated phone ── */
    var ps = this.state.phScene;
    var phPlaying = this.state.phPlaying && motion;
    var ph = { s0: ps === 0, s1: ps === 1, s2: ps === 2, s3: ps === 3, s4: ps === 4, s5: ps === 5 };
    var phScenes = t.phScenes.map((sc, i) => {
      var on = i === ps;
      return {
        n: '0' + (i + 1), t: sc[0], d: sc[1], on: on,
        current: on ? 'step' : 'false',
        cls: 'scn' + (on ? ' on' : i < ps ? ' done' : ''),
        go: () => { this.phGo(i); this.setState({ phPlaying: false }); }
      };
    });
    var phPacks = t.packs.map((n, i) => { return { n: n, cls: i === 3 ? 'pack sel' : 'pack' }; });
    var phChain = t.chain.map((n, i) => { return { n: n, cls: 'pop d' + (i + 2) }; });
    var off = this.state.offline;
    var net = {
      cls: 'netpill ' + (off ? 'net-off' : 'net-on'),
      label: off ? t.netOff.replace('{n}', String(this.state.queue)) : t.netOn,
      synced: !off && this.state.synced
    };
    /* ── hero: miniature film or 3D ── */
    var isFilm = (this.props.heroScene || 'film') !== '3d';
    var fi = this.state.filmIdx;
    var prevI = (fi + 3) % 4;
    var fcls = (i) => { return 'slide' + (i === 3 ? ' zoom' : '') + (i === fi ? ' on' : i === prevI ? ' prev' : ''); };
    var cap = isFilm
      ? { k: t.filmK + ' · 0' + (fi + 1) + ' / 04', t: t.film[fi][0], d: t.film[fi][1] }
      : { k: t.stepLabel + ' 0' + (step + 1) + ' / 06 · ' + pkCode, t: t.flowSteps[step].t, d: t.flowSteps[step].d };
    var heroX = {
      isFilm: isFilm, is3d: !isFilm, cap: cap,
      fs: { c0: fcls(0), c1: fcls(1), c2: fcls(2), c3: fcls(3) },
      filmDurS: this.filmDur() * (fi === 3 ? 1.6 : 1),
      appOn: true,
      cineCls: 'cine' + (this.state.appOn && fi === 3 ? ' app' : ''),
      fdots: t.film.map((f, i) => {
        return { l: f[0], cls: 'fdot' + (i === fi ? ' on' : ''), pressed: i === fi ? 'true' : 'false', go: () => { this.filmGo(i); this.filmSchedule(); } };
      })
    };
    var phX = {
      ph: ph, phScenes: phScenes, phPacks: phPacks, phChain: phChain, net: net,
      phDur: Math.max(3.5, Number(this.props.phoneSpeed) || 5),
      phBarCls: 'scnbar' + (phPlaying ? '' : ' paused'),
      phPlaying: phPlaying, phPaused: !phPlaying,
      phPlayingStr: phPlaying ? 'true' : 'false',
      phPlayLabel: phPlaying ? t.phPause : t.phPlay,
      phToggle: () => { this.setState({ phPlaying: !this.state.phPlaying }); },
      phCounter: '0' + (ps + 1) + ' / 06',
      offCls: 'switch' + (off ? ' on' : ''),
      offPressed: off ? 'true' : 'false',
      offToggle: () => {
        var s = this.state;
        if (s.offline) this.setState({ offline: false, synced: s.queue > 0, queue: 0 });
        else this.setState({ offline: true, queue: 0, synced: false });
      }
    };

    // Fiyat bölümü (T-407): yayındaki paketler panelden gelir (üretim düzeltmesi: tuvaldeki örnek üç paket yerine `props.site.plans`).
    var planSrc = site && Array.isArray(site.plans) ? site.plans.map((p) => {
      return { n: p.name, price: p.price, rec: p.recommended === true, l: { a: p.limits.admins, f: p.limits.field, w: p.limits.warehouses, i: p.limits.items }, f: p.features };
    }) : [];
    var pu = t.planU;
    var money = (p) => { var n = Number(p); return p === '' || !isFinite(n) ? p : n.toLocaleString('tr-TR', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }); };
    var lim = (v, u) => { return v === 0 ? pu.unl + ' ' + u : Number(v).toLocaleString('tr-TR') + ' ' + u; };
    var plans = planSrc.map((p) => {
      var lines = [lim(p.l.a, pu.a), lim(p.l.f, pu.f), lim(p.l.w, pu.w), lim(p.l.i, pu.i)];
      ['qr', 'ship', 'prod', 'api'].forEach((k) => { if (p.f[k]) lines.push(pu[k]); });
      return { n: p.n, price: money(p.price), rec: !!p.rec, lines: lines.map((l) => { return { l: l }; }),
               bg: p.rec ? '#FFFFFF' : 'rgba(255,255,255,.06)', fg: p.rec ? '#172E42' : '#FFFFFF', ring: p.rec ? '3px ' + accent : '1px rgba(255,255,255,.16)', ck: p.rec ? '#2F7D5B' : accent };
    });

    var base = {
      t: t, faq: faq, plans: plans, hasPlans: plans.length > 0, rentBody: plans.length > 0 ? t.rentBodyPlans : t.rentBody,
      cubes: cubes, fl: fl, pk: pk, pkCode: pkCode, tags: tags, decals: decals, world: world, views: views,
      slots: slots, sel: selInfo, pills: pills, log: log,
      cur: fs[step],
      counter: '0' + (step + 1) + ' / 06',
      progress: Math.round((step + 1) / 6 * 100),
      playing: playing, paused: !playing,
      playingStr: playing ? 'true' : 'false',
      playLabel: playing ? t.pause : t.play,
      toggle: () => { this.setState({ playing: !this.state.playing }); },
      next: () => { this.setState({ step: (this.state.step + 1) % 6, playing: false }); },
      prev: () => { this.setState({ step: (this.state.step + 5) % 6, playing: false }); },
      accent: accent,
      rootCls: motion ? 'wms' : 'wms still',
      trCls: lang === 'tr' ? 'on' : '',
      enCls: lang === 'en' ? 'on' : '',
      trPressed: lang === 'tr' ? 'true' : 'false',
      enPressed: lang === 'en' ? 'true' : 'false',
      setTr: () => { this.setState({ lang: 'tr' }); },
      setEn: () => { this.setState({ lang: 'en' }); },
      lang: lang,
      // T-431: demo formu durumu (boot.js yazar): null | fSending | fLeaving | fOk | fErr | fLimit | fInvalid; alan hataları `fe` (kod, metin değil: dil değişince çevrilir).
      formOpen: fk !== 'fOk',
      formDone: fk === 'fOk',
      formSending: fk === 'fSending',
      formIdle: fk !== 'fSending',
      formBoxCls: 'dform' + (fk === 'fLeaving' ? ' leaving' : ''),
      formBusy: fBusy ? 'true' : 'false',
      formBusyAttr: fBusy ? 'true' : null,
      formMsg: fk === 'fOk' ? t.fDoneTitle + '. ' + t.fDoneBody : fk === 'fSending' ? t.fSending : fErrRow ? t[fk] : '',
      formCls: 'fstatus' + (fErrRow ? ' err' : ' sr'),
      formErrRow: fErrRow,
      formRetry: fk === 'fErr',
      formRef: this.state.formRef || '',
      retry: () => { var f = document.getElementById('demo-form'); if (!f || !f.requestSubmit) return; var b = f.querySelector('.fsubmit'); if (b) b.focus(); f.requestSubmit(); },
      fe: {
        name: fe.name ? 'true' : null, nameDesc: fe.name ? 'err-name' : null, nameMsg: fe.name ? t.eNameReq : '',
        company: fe.company ? 'true' : null, companyDesc: fe.company ? 'err-company' : null, companyMsg: fe.company ? t.eCompanyReq : '',
        email: fe.email ? 'true' : null, emailDesc: fe.email ? 'err-email' : null, emailMsg: fe.email === 'bad' ? t.eEmailBad : fe.email ? t.eEmailReq : '',
        consent: fe.consent ? 'true' : null, consentDesc: fe.consent ? 'err-consent' : null, consentMsg: fe.consent ? t.eConsentReq : ''
      }
    };
    for (var k in phX) base[k] = phX[k];
    for (var h in heroX) base[h] = heroX[h];
    return base;
  }
}
window.EtkinDCComponent = Component;
})();
// Shared marketing form behaviour. Draft values stay in the current DOM only.
window.EtkinFormUI = {
  mountPrivacy() {
    const overlay = document.querySelector('.demo-privacy');
    const card = overlay?.querySelector('[role="dialog"]');
    const root = document.getElementById('dc-root');
    if (!overlay || !card || !root) return;
    let opener = null;
    let scroll = 0;
    let overflow = '';
    const close = () => {
      overlay.hidden = true;
      root.inert = false;
      document.body.style.overflow = overflow;
      window.scrollTo(0, scroll);
      opener?.focus({ preventScroll: true });
    };
    document.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (overlay.contains(link) && link.getAttribute('href') === '/#demo') {
        event.preventDefault();
        history.back();
        return;
      }
      if (link.getAttribute('href') !== '/privacy' || !overlay.hidden) return;
      event.preventDefault();
      opener = link;
      scroll = window.scrollY;
      overflow = document.body.style.overflow;
      history.pushState({ demoPrivacy: true }, '', '/privacy');
      overlay.hidden = false;
      root.inert = true;
      document.body.style.overflow = 'hidden';
      card.focus();
    });
    window.addEventListener('popstate', () => {
      if (!overlay.hidden) close();
      else if (history.state?.demoPrivacy) {
        overlay.hidden = false;
        root.inert = true;
        document.body.style.overflow = 'hidden';
        card.focus();
      }
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); history.back(); }
      if (event.key !== 'Tab') return;
      const links = [...card.querySelectorAll('a[href],button,[tabindex="0"]')];
      const first = links[0], last = links.at(-1);
      if (!first) { event.preventDefault(); card.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
  },
};

// Etkin WMS satış sitesi — açılış ve demo formu (T-941). Bileşen sınıfı `Component` bu dosyadan
// önce, `EtkinDC.DCLogic` ile tanımlanır (build.mjs birleştirir).

(function boot() {
  const root = document.getElementById("dc-root");
  const tpl = document.getElementById("dc-tpl");
  if (!root || !(tpl instanceof HTMLTemplateElement)) return;
  const props = Object.assign({}, window.EtkinDCProps || {});
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) props.motion = false;
  } catch {
    // eski tarayıcı: hareket varsayılanı korunur
  }
  // T-407: panelden yayınlanan içerik (sunucunun yerleştirdiği, çalıştırılmayan JSON veri bloğu). Yoksa tasarım metni.
  try {
    const block = document.getElementById("site-content");
    if (block) props.site = JSON.parse(block.textContent || "null");
  } catch {
    // biçimsiz blok: tasarım metni
  }
  const comp = new window.EtkinDCComponent(props);
  window.EtkinDC.mount(root, tpl, comp);
  window.EtkinFormUI.mountPrivacy();
  let requestId;
  let requestSnapshot;

  // T-431: demo formu geri bildirimi (ALTIN-KURAL 3): görsel + sesli; çift gönderim engeli; hata olursa girilen bilgi korunur.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // sunucu validateLead ile aynı
  const FIELDS = ["name", "company", "email", "consent"];
  const reduced = () => props.motion === false;
  /** @type {AudioContext | null} */
  let audio = null;
  const unlockAudio = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audio && Ctx) audio = new Ctx();
      if (audio && audio.state === "suspended") void audio.resume();
    } catch {
      audio = null;
    }
  };
  /** Kısa ve yumuşak ses: başarıda yükselen iki nota, uyarı/hatada alçak tek nota. Ses kapalıysa sessizce geçer. */
  const tone = (kind) => {
    try {
      if (!audio) return;
      const notes = kind === "ok" ? [[660, 0], [880, 0.12]] : [[220, 0], [196, 0.14]];
      for (const [freq, at] of notes) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const t0 = audio.currentTime + at;
        osc.type = kind === "ok" ? "sine" : "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0);
        osc.stop(t0 + 0.24);
      }
    } catch {
      // ses desteklenmiyor: görsel geri bildirim yeterli
    }
  };
  /** Bir sonraki çizimden sonra (setState mikro görevde çizer) odağı taşır. */
  const focusLater = (selector) => setTimeout(() => {
    const target = document.querySelector(selector);
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
    }
  }, 0);
  const readForm = (form) => {
    const el = form.elements;
    return {
      name: String(el.namedItem("name")?.value || ""),
      company: String(el.namedItem("company")?.value || ""),
      email: String(el.namedItem("email")?.value || ""),
      sector: String(el.namedItem("sector")?.value || ""),
      message: String(el.namedItem("message")?.value || ""),
      website: String(el.namedItem("website")?.value || ""),
      consent: Boolean(el.namedItem("consent")?.checked),
    };
  };
  /** Alan hataları (kod): name/company/consent "req", email "req" | "bad". */
  const validate = (data) => {
    /** @type {Record<string, string>} */
    const fe = {};
    if (!data.name.trim()) fe.name = "req";
    if (!data.company.trim()) fe.company = "req";
    const email = data.email.trim();
    if (!email) fe.email = "req";
    else if (!EMAIL.test(email)) fe.email = "bad";
    if (!data.consent) fe.consent = "req";
    return fe;
  };
  const busy = () => ["fSending", "fLeaving", "fOk"].includes(comp.state.formKey);

  // Düzeltilen alanın uyarısı yazarken kalkar; hepsi düzelince üstteki kırmızı satır da kalkar.
  const revalidate = (event) => {
    const field = event.target;
    const form = field instanceof Element ? field.closest("form") : null;
    if (!(form instanceof HTMLFormElement) || form.id !== "demo-form") return;
    const current = comp.state.fe || {};
    const name = field.getAttribute("name") || "";
    if (!current[name]) return;
    const fresh = validate(readForm(form));
    const next = {};
    for (const key of FIELDS) if (current[key] && fresh[key]) next[key] = fresh[key];
    const update = { fe: next };
    if (comp.state.formKey === "fInvalid" && Object.keys(next).length === 0) update.formKey = null;
    comp.setState(update);
  };
  document.addEventListener("input", revalidate);
  document.addEventListener("change", revalidate);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "demo-form") return;
    event.preventDefault();
    if (busy()) return; // çift gönderim yok
    unlockAudio();
    const data = readForm(form);
    const fe = validate(data);
    if (Object.keys(fe).length > 0) {
      comp.setState({ formKey: "fInvalid", fe });
      tone("warn");
      focusLater(`#demo-form [name="${FIELDS.find((k) => fe[k])}"]`);
      return;
    }
    const snapshot = JSON.stringify(data);
    if (snapshot !== requestSnapshot) {
      requestId = crypto.randomUUID();
      requestSnapshot = snapshot;
    }
    comp.setState({ formKey: "fSending", fe: {}, formRef: "" });
    const failed = (key) => {
      comp.setState({ formKey: key });
      tone("warn");
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, requestId, locale: comp.state.lang || props.lang || "tr" }),
        signal: ctrl.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result || result.ok !== true) {
        failed(response.status === 400 ? "fInvalid" : response.status === 429 ? "fLimit" : "fErr");
        return;
      }
      tone("ok");
      const done = () => {
        comp.setState({ formKey: "fOk", formRef: "" });
        focusLater("#demo-done-title");
      };
      if (reduced()) done();
      else {
        comp.setState({ formKey: "fLeaving" });
        setTimeout(done, 300);
      }
    } catch {
      failed("fErr");
    } finally {
      clearTimeout(timer);
    }
  });
})();
