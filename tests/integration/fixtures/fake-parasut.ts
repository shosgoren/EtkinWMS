// T-991: sahte Paraşüt API v4 sunucusu (gerçek ağ yok). Birim, entegrasyon ve e2e testleri aynı sahteyi kullanır. Yalnız 127.0.0.1'e bağlanır.
// Belgedeki şekiller (https://apidocs.parasut.com/swagger.json): OAuth `POST /oauth/token` (password / refresh_token; yenilemede YENİ yenileme
// belirteci), `GET /v4/me?include=companies`, şirket kapsamında products / contacts / warehouses (GET sayfalı, `filter[...]`, POST),
// shipment_documents POST, stock_updates POST. Her istek `requests`e yazılır (gövde dahil) — testler sırrın yalnız token ucuna gittiğini denetler.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRecord {
  relationships?: Record<string, unknown>;
  id: string;
  attributes: Record<string, unknown>;
}

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly body: string;
}

export interface FakeParasutOptions {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly username?: string;
  readonly password?: string;
  readonly companyId?: string;
  readonly companyName?: string;
  /** Erişim belirteci ömrü (sn); varsayılan 7200 (belge). */
  readonly expiresIn?: number;
  readonly authorizationCode?:string;
  readonly redirectUri?:string;
  readonly port?: number;
}

export interface FakeParasut {
  readonly url: string;
  readonly opts: Required<Omit<FakeParasutOptions, "port">>;
  readonly companies: {id:string;name:string}[];
  readonly products: FakeRecord[];
  readonly categories: FakeRecord[];
  readonly contacts: FakeRecord[];
  readonly warehouses: FakeRecord[];
  readonly shipments: { body: unknown }[];
  readonly stockUpdates: { body: unknown }[];
  readonly requests: FakeRequest[];
  /** Sonraki N isteğe 429 döner (ilk istekte `Retry-After: 1`). */
  rateLimitNext: number;
  /** İrsaliye POST yanıt durumu (ör. 500, 422) ya da "drop" (bağlantıyı yanıtsız kapatır). */
  shipmentFailure: number | "drop" | null;
  /** T-1135: stok güncelleme POST yanıt durumu (ör. 422) — null ise kabul. */
  stockFailure: number | null;
  /** Geçerli yenileme belirteci (döner). */
  refreshToken: string;
  accessToken: string;
  /** Erişim belirtecini geçersiz kılar (401 → yenileme). */
  expireAccess(): void;
  /** Yenileme belirtecini iptal eder (yenileme 400 invalid_grant). */
  revokeRefresh(): void;
  close(): Promise<void>;
}

let seq = 1000;
const nextId = (): string => String(++seq);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** Sentetik varsayılan bilgiler (sır değildir; e2e formu bunlarla doldurur). */
export const FAKE_PARASUT_DEFAULTS = Object.freeze({
  clientId: "fake-client",
  clientSecret: "fake-client-secret-value",
  username: "muhasebe@example.test",
  password: "fake-parasut-password",
  companyId: "115",
  companyName: "Örnek Muhasebe A.Ş",
  expiresIn: 7200,
  authorizationCode:"fake-authorization-code",
  redirectUri:"https://wms.example.test/api/integrations/parasut/callback",
});

export async function startFakeParasut(options: FakeParasutOptions = {}): Promise<FakeParasut> {
  const { port: _port, ...given } = options;
  void _port;
  const opts = { ...FAKE_PARASUT_DEFAULTS, ...given };
  let tokenSeq = 0;
  let codeUsed=false;
  const issue = (): { access_token: string; refresh_token: string } => {
    tokenSeq += 1;
    state.accessToken = `acc-${tokenSeq}-${Math.random().toString(36).slice(2)}`;
    state.refreshToken = `ref-${tokenSeq}-${Math.random().toString(36).slice(2)}`;
    return { access_token: state.accessToken, refresh_token: state.refreshToken };
  };
  const state: FakeParasut = {
    url: "",
    opts,
    companies:[{id:opts.companyId,name:opts.companyName}],
    products: [], categories: [],
    contacts: [],
    warehouses: [],
    shipments: [],
    stockUpdates: [],
    requests: [],
    rateLimitNext: 0,
    shipmentFailure: null,
    stockFailure: null,
    refreshToken: "",
    accessToken: "",
    expireAccess() {
      state.accessToken = `expired-${Math.random()}`;
    },
    revokeRefresh() {
      state.refreshToken = `revoked-${Math.random()}`;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
  const collections: Record<string, FakeRecord[]> = { products: state.products, contacts: state.contacts, warehouses: state.warehouses };

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    state.requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, authorization: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? null, body });
    const send = (status: number, json: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1;
      send(429, { errors: [{ title: "Too many requests" }] }, { "retry-after": "1" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      const f = new URLSearchParams(body);
      if (f.get("client_id") !== opts.clientId || f.get("client_secret") !== opts.clientSecret) return send(401, { error: "invalid_client" });
      if(f.get("grant_type")==="authorization_code") {
        if(codeUsed||f.get("code")!==opts.authorizationCode||f.get("redirect_uri")!==opts.redirectUri)return send(400,{error:"invalid_grant"});
        codeUsed=true;return send(200,{...issue(),token_type:"bearer",expires_in:opts.expiresIn});
      }
      if (f.get("grant_type") === "password") {
        if (f.get("username") !== opts.username || f.get("password") !== opts.password || f.get("redirect_uri") !== "urn:ietf:wg:oauth:2.0:oob") return send(400, { error: "invalid_grant" });
        return send(200, { ...issue(), token_type: "bearer", expires_in: opts.expiresIn });
      }
      if (f.get("grant_type") === "refresh_token") {
        if (f.get("refresh_token") !== state.refreshToken) return send(400, { error: "invalid_grant" });
        return send(200, { ...issue(), token_type: "bearer", expires_in: opts.expiresIn });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (req.headers.authorization !== `Bearer ${state.accessToken}` || state.accessToken === "") return send(401, { errors: [{ title: "Unauthorized" }] });
    if (req.method === "GET" && url.pathname === "/v4/me") {
      return send(200, { data: { id: "9", type: "users", attributes: { name: "Muhasebe", email: opts.username } }, included: state.companies.map(c=>({id:c.id,type:"companies",attributes:{name:c.name}})) });
    }
    const product = /^\/v4\/([0-9]+)\/products\/([0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && product !== null) {
      if (product[1] !== opts.companyId) return send(404, {errors:[{title:"Not found"}]});
      const row = state.products.find(r => r.id === product[2]);
      return row === undefined ? send(404,{errors:[{title:"Not found"}]}) : send(200,{data:{...row,type:"products",relationships:row.relationships??{}}});
    }
    const m = /^\/v4\/([0-9]+)\/([a-z_]+)$/.exec(url.pathname);
    if (m === null || m[1] !== opts.companyId) return send(404, { errors: [{ title: "Not found" }] });
    const kind = m[2] as string;
    const col = collections[kind];
    if (req.method === "GET" && col !== undefined) {
      let rows = col;
      for (const [k, v] of url.searchParams) {
        const f = /^filter\[(\w+)\]$/.exec(k);
        if (f !== null) rows = rows.filter((r) => r.attributes[f[1] as string] === v);
      }
      const size = Math.min(25, Number(url.searchParams.get("page[size]") ?? "15"));
      const page = Number(url.searchParams.get("page[number]") ?? "1");
      const slice = rows.slice((page - 1) * size, page * size);
      return send(200, { data: slice.map((r) => ({ id: r.id, type: kind, attributes: r.attributes, relationships: r.relationships ?? {} })), included: kind === "products" && url.searchParams.get("include") === "category" ? state.categories.map((r) => ({ id: r.id, type: "item_categories", attributes: r.attributes })) : [], meta: { current_page: page, total_pages: Math.max(1, Math.ceil(rows.length / size)), total_count: rows.length } });
    }
    let parsed: { data?: { attributes?: Record<string, unknown> } } = {};
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return send(400, { errors: [{ title: "Bad JSON" }] });
    }
    if (req.method === "POST" && col !== undefined) {
      const attrs = parsed.data?.attributes ?? {};
      if (typeof attrs.name !== "string" || attrs.name === "") return send(422, { errors: [{ title: "name required" }] });
      const rec = { id: nextId(), attributes: attrs };
      col.push(rec);
      return send(201, { data: { id: rec.id, type: kind, attributes: rec.attributes } });
    }
    if (req.method === "POST" && kind === "shipment_documents") {
      if (state.shipmentFailure === "drop") {
        req.socket.destroy();
        return;
      }
      if (typeof state.shipmentFailure === "number") return send(state.shipmentFailure, { errors: [{ title: "Rejected" }] });
      state.shipments.push({ body: parsed });
      return send(201, { data: { id: nextId(), type: "shipment_documents", attributes: parsed.data?.attributes ?? {} } });
    }
    if (req.method === "POST" && kind === "stock_updates") {
      if (state.stockFailure !== null) return send(state.stockFailure, { errors: [{ title: "Rejected" }] });
      state.stockUpdates.push({ body: parsed });
      return send(201, { data: { id: nextId(), type: "stock_updates", attributes: {} } });
    }
    send(404, { errors: [{ title: "Not found" }] });
  });
  await new Promise<void>((r) => server.listen(options.port ?? 0, "127.0.0.1", () => r()));
  (state as { url: string }).url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}
