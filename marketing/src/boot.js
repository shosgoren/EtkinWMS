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
  const comp = new window.EtkinDCComponent(props);
  window.EtkinDC.mount(root, tpl, comp);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "demo-form") return;
    event.preventDefault();
    if (comp.state.formKey === "fSending") return;
    const el = form.elements;
    const data = {
      name: String(el.namedItem("name")?.value || ""),
      company: String(el.namedItem("company")?.value || ""),
      email: String(el.namedItem("email")?.value || ""),
      sector: String(el.namedItem("sector")?.value || ""),
      message: String(el.namedItem("message")?.value || ""),
      website: String(el.namedItem("website")?.value || ""),
      consent: Boolean(el.namedItem("consent")?.checked),
    };
    if (!form.checkValidity() || !data.consent) {
      comp.setState({ formKey: "fInvalid", formText: "" });
      form.reportValidity();
      return;
    }
    comp.setState({ formKey: "fSending", formText: "" });
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        comp.setState({ formKey: response.status === 400 ? "fInvalid" : "fErr", formText: "" });
        return;
      }
      if (result && result.ok) form.reset();
      comp.setState({ formKey: "fOk", formText: "" });
    } catch {
      comp.setState({ formKey: "fErr", formText: "" });
    }
  });
})();
