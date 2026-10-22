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
