import { expect,test,type Page } from "@playwright/test";
import { localClient,loginEmptyTenant,scrubSecretInputs } from "./support/empty-tenant.ts";
import { db } from "./support/package-receiving.ts";
// Hız sınırı kovası (T-286 emsali, T-1055): tek uzun test aynı kullanıcıyla bir dakikada 120'den çok işlem çağırabiliyor (CI teşhisi: "Çok fazla işlem
// yapıldı"); her adım kendi "web.user" kovasıyla başlar. Üretim eşiği/kuralı değişmez; giriş sayaçlarına dokunulmaz.
const yeniKova=async():Promise<void>=>{if(!process.env.E2E_BASE_URL?.trim())await db("DELETE FROM public.request_rate_limits WHERE scope = 'web.user'");};
test.use({...localClient("198.51.100.12"),trace:"off"});
test.afterEach(async({page})=>scrubSecretInputs(page));
test("stock receipt, draft review, approval, posting and insufficient issue",async({page,browser},info)=>{
 const testClient=localClient(info.project.name.includes("mobile")?"198.51.100.132":"198.51.100.131");
 if(testClient.extraHTTPHeaders!==undefined)await page.setExtraHTTPHeaders(testClient.extraHTTPHeaders);
 test.setTimeout(180_000); // T-977: saha sayım + saha toplama/sevk adımları eklendi; yalnız süre, assertion değişmez
 const {slug}=await loginEmptyTenant(page,info.project.name.includes("mobile")?"stockMobile":"stockDesktop"),suffix=info.project.name;
 await page.goto(`/t/${slug}/warehouses?new=1`);
 // T-990: ekleme pencere değil tam ekran formdur (Kaydet alt çubukta).
 const whForm=page.getByTestId("warehouse-form");await expect(whForm).toBeVisible();await expect(whForm.locator('input[name="code"]')).toHaveValue(/.+/);
 await whForm.locator('input[name="name"]').fill(`Pilot ${suffix}`);
 await page.getByTestId("warehouse-form-save").click();
 await expect(whForm).toHaveCount(0);
 await page.goto(`/t/${slug}/warehouses`);
 const card=page.getByTestId("warehouse-card").filter({hasText:`Pilot ${suffix}`});
 const href=await card.getByRole("link",{name:"Lokasyonları aç"}).getAttribute("href");
 expect(href).toBeTruthy();await page.goto(`${href}?bulk=1`);
 const bulk=page;await expect(page.getByTestId("bulk-form")).toBeVisible();await expect(bulk.getByRole("button",{name:"50 lokasyonu oluştur"})).toBeVisible();
 await bulk.getByRole("button",{name:"50 lokasyonu oluştur"}).click();
 await page.goto(`/t/${slug}/items?new=1`);
 const itemForm=page.getByTestId("item-form");await expect(itemForm).toBeVisible();await expect(itemForm.locator('input[name="code"]')).toHaveValue(/.+/);await itemForm.locator('input[name="name"]').fill(`Pilot ürün ${suffix}`);
 await page.getByTestId("item-form-save").click();await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
 const urunUrl=page.url();
 const path=`/t/${slug}/stock/documents`;
 // T-1037: listenin üstünde ayrı "Stok çıkışı / Transfer" düğmesi yok; YENİ → tür seçimi (giriş · çıkış · transfer).
 await page.goto(path);await expect(page.getByTestId("documents-new-out")).toHaveCount(0);
 await page.getByTestId("documents-new").click();await expect(page).toHaveURL(/new=SEC/);
 await page.getByTestId("documents-new-pick").locator('[data-option="STOCK_OUT"]').click();await expect(page).toHaveURL(/new=STOCK_OUT/);
 // T-972 (liste kalıbı): stok kartı rozeti kullanılabilir miktarı kayan noktasız biçimler ("10.000000" → "10").
 async function stockHas(item:string,qty:string){
  await page.goto(`/t/${slug}/stock?q=${encodeURIComponent(item)}`);
  await expect.poll(async()=>page.getByTestId("stock-card").locator(".qb b").allTextContents()).toEqual(expect.arrayContaining([qty]));
 }
 async function draft(kind:string,quantity:string){
  await page.goto(`${path}?new=${kind}`);
  await page.getByRole("searchbox",{name:"Depo",exact:true}).fill(`Pilot ${suffix}`);
  await page.getByRole("option").filter({hasText:`Pilot ${suffix}`}).click();
  await page.getByRole("searchbox",{name:"Konum",exact:true}).fill("A-01-01");await page.getByRole("option").first().click();
  await page.getByRole("searchbox",{name:"Ürün",exact:true}).fill(`Pilot ürün ${suffix}`);await page.getByRole("option").first().click();
  await page.getByRole("searchbox",{name:"Ürün",exact:true}).fill("missing item");
  await expect(page.locator(".workflow-primary")).toBeDisabled(); // T-1037: formun düğmesi gizli, alt çubuk ana işlemi onu çağırır
  await page.getByRole("searchbox",{name:"Ürün",exact:true}).fill(`Pilot ürün ${suffix}`);await page.getByRole("option").first().click();
  await page.getByLabel(/Miktar/).fill(quantity);await page.getByLabel("İşlem açıklaması").fill(`Pilot test ${suffix}`);
  const summary=page.getByRole("region",{name:"İşlem özeti"});await expect(summary).toContainText(`${quantity} ADET`);await expect(summary).toContainText("A-01-01");
  const dimensions=await page.evaluate<{width:number;viewport:number}>("({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  await page.getByTestId("kalip-form-save").click();await expect(page).toHaveURL(/documents\?id=/);
  await expect(page.getByRole("status").filter({hasText:"Taslak"})).toBeVisible();
  await page.getByRole("button",{name:"Özeti onayla"}).click();await expect(page.getByRole("status").filter({hasText:"Onaylı"})).toBeVisible();
 }
 await draft("STOCK_IN","10");
 await page.getByRole("button",{name:"Stoka işle",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Stoka işlendi"})).toBeVisible();
 await page.reload();await expect(page.getByRole("heading",{level:1})).toContainText("GRS-");
 await stockHas(`Pilot ürün ${suffix}`,"10");
 await draft("STOCK_OUT","99");await page.getByRole("button",{name:"Stoka işle",exact:true}).click();
 await expect(page.getByText(/Bu rafta yeterli mal yok/).first()).toBeVisible();await expect(page.getByRole("status").filter({hasText:"Onaylı"})).toBeVisible();
 await page.getByRole("button",{name:"Belgeyi iptal et"}).click();await expect(page.getByRole("status").filter({hasText:"İptal edildi"})).toBeVisible();
 await stockHas(`Pilot ürün ${suffix}`,"10");
 await page.goto(`/t/${slug}/warehouses?new=1`);
 await expect(whForm).toBeVisible();await expect(whForm.locator('input[name="code"]')).toHaveValue(/.+/);await whForm.locator('input[name="name"]').fill(`Target ${suffix}`);
 await page.getByTestId("warehouse-form-save").click();await expect(whForm).toHaveCount(0);
 await page.goto(`/t/${slug}/warehouses`);
 const targetHref=await page.getByTestId("warehouse-card").filter({hasText:`Target ${suffix}`}).getByRole("link",{name:"Lokasyonları aç"}).getAttribute("href");
 expect(targetHref).toBeTruthy();await page.goto(`${targetHref}?bulk=1`);
 await page.getByRole("button",{name:"50 lokasyonu oluştur"}).click();await expect(page.getByRole("button",{name:"50 lokasyonu oluştur"})).toHaveCount(0);
 await page.goto(`${path}?new=TRANSFER`);
 for(const [name,query] of [["Depo",`Pilot ${suffix}`],["Konum","A-01-01"],["Hedef depo",`Target ${suffix}`],["Hedef konum","A-01-01"],["Ürün",`Pilot ürün ${suffix}`]]) {
  await page.getByRole("searchbox",{name,exact:true}).fill(query!);await page.getByRole("option").first().click();
 }
 await page.getByLabel(/Miktar/).fill("3");await page.getByLabel("İşlem açıklaması").fill("Transfer test");
 await page.getByTestId("kalip-form-save").click();await expect(page).toHaveURL(/documents\?id=/);
 await expect(page.getByRole("status").filter({hasText:"Stoka işlendi"})).toBeVisible();
 await expect(page.getByRole("link",{name:/Bağlı stok belgesi/})).toContainText("GRS-");
 await stockHas(`Pilot ürün ${suffix}`,"7");await stockHas(`Pilot ürün ${suffix}`,"3");

 await page.goto(`/t/${slug}/items?new=1`);await expect(itemForm).toBeVisible();await expect(itemForm.locator('input[name="code"]')).toHaveValue(/.+/);await itemForm.locator('input[name="name"]').fill(`Pilot mamul ${suffix}`);
 await page.getByTestId("item-form-save").click();await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
 await addBarcode(page,`PILOT-MAMUL-${suffix}`);
 await page.goto(`/t/${slug}/production?new=1`);
 await page.getByLabel("Reçete kodu",{exact:true}).fill(`RECIPE-${suffix}`);await page.getByLabel("Reçete adı",{exact:true}).fill(`Pilot reçete ${suffix}`);
 await page.getByRole("searchbox",{name:"Mamul",exact:true}).fill(`Pilot mamul ${suffix}`);await page.getByRole("option").first().click();
 await page.getByLabel(/Üretilecek miktar/).fill("1");
 await page.getByRole("searchbox",{name:"Malzeme 1",exact:true}).fill(`Pilot ürün ${suffix}`);await page.getByRole("option").first().click();
 await page.getByLabel(/Reçete miktarı/).fill("2");await page.getByTestId("kalip-form-save").click();await expect(page).toHaveURL(/production\?id=/);
 const recipeUrl=page.url();
 await page.getByLabel(/Üretilecek miktar/).fill("2");
 for(const [name,query] of [[`Pilot ürün ${suffix}: Depo`,`Pilot ${suffix}`],[`Pilot ürün ${suffix}: Konum`,"A-01-01"],[`Mamul: Pilot mamul ${suffix}: Depo`,`Target ${suffix}`],[`Mamul: Pilot mamul ${suffix}: Konum`,"A-01-01"]]){
  await page.getByRole("searchbox",{name,exact:true}).fill(query!);await page.getByRole("option").first().click();
 }
 await page.getByLabel("Üretim açıklaması").fill("Pilot batch");await page.getByRole("button",{name:"Tüketimi ve üretimi kontrol et"}).click();
 await expect(page.getByRole("region",{name:"Tüketimi ve üretimi kontrol et"})).toContainText("−4.000000 ADET");
 await page.getByRole("button",{name:"Onayla ve üret"}).click();await expect(page).toHaveURL(/documents\?id=/);
 await expect(page.getByRole("status").filter({hasText:"Stoka işlendi"})).toBeVisible();await expect(page.getByRole("link",{name:/Bağlı stok belgesi/})).toContainText("CKS-");
 await stockHas(`Pilot mamul ${suffix}`,"2");
 await stockHas(`Pilot ürün ${suffix}`,"3");
 await page.goto(recipeUrl);await page.getByLabel(/Üretilecek miktar/).fill("99");
 for(const [name,query] of [[`Pilot ürün ${suffix}: Depo`,`Pilot ${suffix}`],[`Pilot ürün ${suffix}: Konum`,"A-01-01"],[`Mamul: Pilot mamul ${suffix}: Depo`,`Target ${suffix}`],[`Mamul: Pilot mamul ${suffix}: Konum`,"A-01-01"]]){
  await page.getByRole("searchbox",{name,exact:true}).fill(query!);await page.getByRole("option").first().click();
 }
 await page.getByLabel("Üretim açıklaması").fill("Insufficient production test");await page.getByRole("button",{name:"Tüketimi ve üretimi kontrol et"}).click();
 await expect(page.getByRole("region",{name:"Tüketimi ve üretimi kontrol et"})).toContainText("−198.000000 ADET");
 const productionDimensions=await page.evaluate<{width:number;viewport:number}>("({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");expect(productionDimensions.width).toBeLessThanOrEqual(productionDimensions.viewport);
 await page.getByRole("button",{name:"Onayla ve üret"}).click();await expect(page.getByText(/Bu rafta yeterli mal yok/).first()).toBeVisible();
 await stockHas(`Pilot mamul ${suffix}`,"2");
 await stockHas(`Pilot ürün ${suffix}`,"3");
 // Existing production output is picked and shipped through the customer-facing workflow.
 // SSR must not expose a clickable launcher before its event handler is ready.
 const previewContext=await browser.newContext({...testClient,javaScriptEnabled:false,storageState:await page.context().storageState()});
 try {
  const preview=await previewContext.newPage();await preview.goto(targetHref!);
  const serverLaunchers=preview.locator('[data-location-tree-ready="false"]').getByRole("button",{name:"Lokasyon ekle",exact:true,includeHidden:true});
  await expect(serverLaunchers).not.toHaveCount(0);
  // JavaScript-disabled streaming may retain multiple previews; every copy must be disabled.
  for(const launcher of await serverLaunchers.all())await expect(launcher).toBeDisabled();
 } finally {await previewContext.close();}
 await page.goto(targetHref!);
 await expect(page.locator('[data-location-tree-ready="true"]')).toHaveCount(1);
 const addLocation=page.getByRole("button",{name:"Lokasyon ekle",exact:true});
 await expect(addLocation).toBeEnabled();await addLocation.click();
 const locForm=page.getByTestId("location-form");await expect(locForm).toBeVisible();await locForm.locator('input[name="name"]').fill(`Sevk ${suffix}`);
 await expect(locForm.locator('input[name="code"]')).not.toHaveAttribute("readonly","");
 await locForm.locator('input[name="code"]').fill("SHIP");await pickKind(page,"STAGING");await page.getByTestId("location-form-save").click();await expect(locForm).toBeHidden();
 await page.goto(`/t/${slug}/stock`);await page.getByRole("link",{name:"Sevkiyat",exact:true}).click();
 async function newOrder(quantity:string,reference:string){
  await page.getByRole("link",{name:"Yeni sipariş",exact:true}).click();await page.getByLabel("Müşteri / sipariş açıklaması").fill(reference);
  await page.getByRole("searchbox",{name:"Ürün 1",exact:true}).fill(`Pilot mamul ${suffix}`);await page.getByRole("option").first().click();
  await page.getByLabel(/Sipariş miktarı/).fill(quantity);await expect(page.getByRole("region",{name:"İşlemi kontrol et"})).toContainText(`${quantity} ADET`);
  await page.getByTestId("kalip-form-save").click();await expect(page).toHaveURL(/shipping\?id=/);
 }
 await newOrder("2",`Pilot müşteri ${suffix}`);
 await page.getByRole("button",{name:"Stok ayır",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"İşlem tamamlandı"})).toBeVisible();
 await page.getByRole("button",{name:"Toplama görevlerini oluştur",exact:true}).click();
 const pick=page.getByRole("region",{name:"2. Raftan sevk alanına topla"});
 await expect(pick.getByRole("heading",{level:3})).toContainText(`Pilot mamul ${suffix}`);
 await pick.getByRole("button",{name:"Elle yaz",exact:true}).first().click();await pick.getByLabel("Kaynak konum kodu").fill("A-01-01");await pick.getByRole("button",{name:"Kullan",exact:true}).click();
 await pick.getByRole("button",{name:"Elle yaz",exact:true}).nth(1).click();await pick.getByLabel("Ürün barkodu",{exact:true}).fill(`PILOT-MAMUL-${suffix}`);await pick.getByRole("button",{name:"Kullan",exact:true}).click();
 await pick.getByLabel(/Bulunan miktar/).fill("2");await pick.getByRole("button",{name:"İşlemi kontrol et",exact:true}).click();
 await expect(pick.getByRole("region",{name:"İşlemi kontrol et"})).toContainText("2.000000 ADET");await pick.getByRole("button",{name:"Toplamayı onayla",exact:true}).click();
 const staged=page.getByRole("region",{name:"3. Sevk alanından çıkış yap"});await expect(staged.getByRole("heading",{level:3})).toContainText(`Pilot mamul ${suffix}`);
 const shippingDimensions=await page.evaluate<{width:number;viewport:number}>("({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");expect(shippingDimensions.width).toBeLessThanOrEqual(shippingDimensions.viewport);
 // Lose only the response after the real first shipment commits; retry must reuse the exact payload/key.
 const shipmentBodies:string[]=[];let releaseShipment!:()=>void;
 const holdShipment=new Promise<void>(resolve=>{releaseShipment=resolve;});
 await page.route("**/shipping?*",async route=>{
  const request=route.request(),body=request.postData()??"";
  if(request.method()==="POST"&&body.includes('"lineId"')){
   shipmentBodies.push(body);
   if(shipmentBodies.length===1){await holdShipment;await route.fetch();await route.abort("failed");return;}
  }
  await route.continue();
 });
 await staged.getByLabel(/Sevk edilecek miktar/).fill("1");await staged.getByRole("button",{name:"İşlemi kontrol et",exact:true}).click();await staged.getByRole("button",{name:"Sevki onayla",exact:true}).click();
 await expect.poll(()=>shipmentBodies.length).toBe(1);await expect(staged.getByRole("button",{name:"Bilgileri değiştir",exact:true})).toBeDisabled();releaseShipment();
 await expect(staged.getByRole("button",{name:"Yeniden dene",exact:true})).toBeVisible();await expect(staged.getByLabel(/Sevk edilecek miktar/)).toBeDisabled();
 await expect(staged.getByRole("button",{name:"Bilgileri değiştir",exact:true})).toHaveCount(0);await staged.getByRole("button",{name:"Yeniden dene",exact:true}).click();
 await expect.poll(()=>shipmentBodies.length).toBe(2);expect(shipmentBodies[1]).toBe(shipmentBodies[0]);
 await page.unroute("**/shipping?*");
 await expect(staged.getByLabel(/Sevk edilecek miktar/)).toHaveValue("1.000000");await expect(page.getByRole("status").filter({hasText:"Açık sipariş"})).toBeVisible();
 await staged.getByRole("button",{name:"İşlemi kontrol et",exact:true}).click();await staged.getByRole("button",{name:"Sevki onayla",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:/^Tamamlandı$/})).toBeVisible();await page.reload();
 await expect(page.getByRole("region",{name:"Son 50 sevk belgesi"}).getByRole("link")).toHaveCount(2);
 await page.getByTestId("kabuk-back").click();await expect(page).toHaveURL(/\/shipping$/);await newOrder("1",`İptal ${suffix}`);
 await page.getByRole("button",{name:"Siparişi iptal et",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Açık sipariş"})).toBeVisible();
 await page.getByRole("button",{name:"İptali onayla",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"İptal edildi"})).toBeVisible();

 // T-977 (B-51): saha sayım — yönetici sayımı başlatır, sahada raf okutulup sayılır (fark uyarısı), onaya gönderilir; yönetici farkı onaylar ve fişi işler.
 async function scanManual(code:string){await page.getByRole("button",{name:"Elle gir"}).click();await page.getByRole("textbox",{name:"Barkod"}).fill(code);await page.getByRole("button",{name:"Onayla",exact:true}).click();}
 await test.step("saha sayım",async()=>{await yeniKova();
  await page.goto(`/t/${slug}/counts?new=1`);
  // T-990: depo seçimi ortak aramalı seçim sayfası (yerel açılır liste yok).
  await page.getByTestId("count-new-form").getByTestId("count-warehouse").click();
  await page.getByRole("listbox").getByRole("option").filter({has:page.locator("b",{hasText:new RegExp(`^Pilot ${suffix}$`)})}).click();await page.getByTestId("count-racks").fill("A-01-01");
  await page.getByLabel(/Kör sayım/).uncheck();await page.getByTestId("kalip-form-save").click();
  await expect(page).toHaveURL(/counts\?id=/);const countUrl=page.url();
  const countStatus=page.getByTestId("count-hero").getByRole("status");await expect(countStatus).toHaveText("Sayılıyor");
  await page.goto(`/t/${slug}/field/tasks`);
  await page.getByTestId("field-task").filter({hasText:"Sayım"}).getByRole("button",{name:"Üstlen"}).click();
  await expect(page.getByRole("status").filter({hasText:"Görevi üstlendin."})).toBeVisible();
  await page.getByTestId("field-task").filter({hasText:"Sayım"}).getByTestId("field-task-start").click();await expect(page).toHaveURL(/field\/count\?task=/);
  await scanManual("A-01-01");
  const line=page.getByTestId("count-line").filter({hasText:`Pilot ürün ${suffix}`});
  await expect(line).toHaveAttribute("data-counted","false");await expect(page.getByTestId("count-missing")).toContainText("1 ürün sayılmadı");
  await line.click();await expect(page.getByText("SİSTEMDE 3 ADET")).toBeVisible();
  await page.getByTestId("count-qty").fill("5");await expect(page.getByTestId("count-diff-warn")).toContainText("Fark var: +2");
  await page.getByTestId("flow-primary").click();await expect(page.getByTestId("count-saved-diff")).toContainText("fark +2");
  await expect(line).toHaveAttribute("data-counted","true");
  await page.getByRole("button",{name:"Sayımı onaya gönder",exact:true}).click();await expect(page.getByText("Sayım onaya gönderildi")).toBeVisible();
  expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  await page.goto(countUrl);await expect(countStatus).toHaveText("Onay bekliyor");
  await page.getByTestId("count-approve").click();await page.getByTestId("count-approve").click();await expect(countStatus).toHaveText("Onaylandı");
  await page.getByTestId("count-post").click();await page.getByTestId("count-post").click();await expect(countStatus).toHaveText("İşlendi");
  await stockHas(`Pilot ürün ${suffix}`,"5");
 });

 // T-977 (B-52/B-63): saha toplama (raf okut → ürün okut → miktar → onay) ve saha sevk (satır → miktar → yükleme onayı).
 await test.step("saha toplama ve sevk",async()=>{await yeniKova();
  await page.goto(href!);await expect(page.locator('[data-location-tree-ready="true"]')).toHaveCount(1);
  await page.getByRole("button",{name:"Lokasyon ekle",exact:true}).click();const locForm2=page.getByTestId("location-form");await expect(locForm2).toBeVisible();
  await locForm2.locator('input[name="name"]').fill(`Sevk 2 ${suffix}`);await expect(locForm2.locator('input[name="code"]')).not.toHaveAttribute("readonly","");await locForm2.locator('input[name="code"]').fill("SHIP");
  await pickKind(page,"STAGING");await page.getByTestId("location-form-save").click();await expect(locForm2).toBeHidden();
  await page.goto(urunUrl);await addBarcode(page,`PILOT-URUN-${suffix}`);
  await page.goto(`/t/${slug}/shipping?new=1`);await page.getByLabel("Müşteri / sipariş açıklaması").fill(`Saha müşteri ${suffix}`);
  await page.getByRole("searchbox",{name:"Ürün 1",exact:true}).fill(`Pilot ürün ${suffix}`);await page.getByRole("option").first().click();
  await page.getByLabel(/Sipariş miktarı/).fill("2");await page.getByTestId("kalip-form-save").click();await expect(page).toHaveURL(/shipping\?id=/);
  const orderUrl=page.url();
  await page.getByRole("button",{name:"Stok ayır",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"İşlem tamamlandı"})).toBeVisible();
  await page.getByRole("button",{name:"Toplama görevlerini oluştur",exact:true}).click();
  await page.getByTestId("shipping-field-pick").click();await expect(page).toHaveURL(/field\/pick\?task=/);
  for(let i=0;i<2;i++){
   if(i===0){await scanManual("WRONG-RAF");await expect(page.getByTestId("scan-alert")).toBeVisible();await page.getByTestId("scan-alert").getByRole("button").click();await expect(page.getByTestId("scan-alert")).toHaveCount(0);}
   await scanManual("A-01-01");await expect(page.getByTestId("saha-verdict")).toContainText("Doğru raf");
   await scanManual(`PILOT-URUN-${suffix}`);await expect(page.getByTestId("verified-ok")).toHaveText("Doğru ürün");
   await page.getByTestId("flow-primary").click();await expect(page.getByRole("heading",{level:1})).toContainText("Toplandı");
   const next=page.getByRole("link",{name:/Sıradaki toplama/});
   if(await next.count()===0)break;
   await next.click();await expect(page).toHaveURL(/field\/pick\?task=/);
  }
  await page.getByRole("link",{name:"Sevke geç",exact:true}).click();await expect(page).toHaveURL(/field\/ship\?order=/);
  // Sevk alanındaki satır sayısı tahsise göre 1 ya da 2 (iki depo); her yüklemeden sonra liste sunucudan yenilenir, sonuncusunda sipariş kapanır.
  const rows=await page.getByTestId("ship-row").count();expect(rows).toBeGreaterThan(0);
  for(let i=0;i<rows;i++){
   await page.getByTestId("ship-row").first().click();await expect(page.getByTestId("ship-qty")).not.toHaveValue("0");await page.getByTestId("flow-primary").click();
   await expect(page.getByTestId("ship-confirm-card")).toBeVisible();await page.getByTestId("flow-primary").click();
   if(i<rows-1)await expect(page.getByTestId("ship-row")).toHaveCount(rows-1-i);
  }
  await expect(page.getByTestId("ship-message")).toContainText("kapandı");
  await page.goto(orderUrl);await expect(page.getByRole("status").filter({hasText:/^Tamamlandı$/})).toBeVisible();
 });
});

/** T-990: lokasyon türü seçim kutusu (radiogroup; yerel select yok). */
async function pickKind(page:Page,kind:string):Promise<void>{const box=page.locator(`[data-alan="kind"] [data-option="${kind}"]`);await box.click();await expect(box).toHaveAttribute("aria-checked","true");}
/** T-990: barkod ekleme ürün kartından tam ekran forma (`barcode-add` → `barcode-form`); T-1049: kartın "Barkodlar" sekmesinde. */
async function addBarcode(page:Page,code:string):Promise<void>{await page.getByTestId("kart-sekme-barkod").click();await page.getByTestId("barcode-add").click();const f=page.getByTestId("barcode-form");await expect(f).toBeVisible();await f.locator('input[name="barcode"]').fill(code);await page.getByTestId("barcode-form-save").click();
 // Teşhis (T-1054): CI'da balon görünmezse adres, form durumu ve görünür durum/uyarı metinleri hata iletisine yazılır (beklenti aynı).
 try{await expect(page.getByText("Barkod eklendi.").first()).toBeVisible();}catch(e){const seen=await page.locator('[role="status"],[role="alert"],[data-testid="kalip-toast"]').allInnerTexts().catch(()=>[]);throw new Error(`Barkod eklendi balonu yok · url=${page.url()} · form=${await f.isVisible().catch(()=>false)} · görünen=${JSON.stringify(seen).slice(0,800)}`,{cause:e});}}
