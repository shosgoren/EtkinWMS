import { expect,test } from "@playwright/test";
import { localClient,loginEmptyTenant,scrubSecretInputs } from "./support/empty-tenant.ts";
test.use({...localClient("198.51.100.12"),trace:"off"});
test.afterEach(async({page})=>scrubSecretInputs(page));
test("stock receipt, draft review, approval, posting and insufficient issue",async({page,browser},info)=>{
 const testClient=localClient(info.project.name.includes("mobile")?"198.51.100.132":"198.51.100.131");
 if(testClient.extraHTTPHeaders!==undefined)await page.setExtraHTTPHeaders(testClient.extraHTTPHeaders);
 const {slug}=await loginEmptyTenant(page,info.project.name.includes("mobile")?"stockMobile":"stockDesktop"),suffix=info.project.name;
 await page.goto(`/t/${slug}/warehouses?new=1`);
 const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
 await dialog.locator('input[name="name"]').fill(`Pilot ${suffix}`);
 await dialog.getByRole("button",{name:"Kaydet",exact:true}).click();
 await expect(dialog.locator('input[name="name"]')).toHaveCount(0);
 await page.goto(`/t/${slug}/warehouses`);
 const card=page.getByTestId("warehouse-card").filter({hasText:`Pilot ${suffix}`});
 const href=await card.getByRole("link",{name:"Lokasyonları aç"}).getAttribute("href");
 expect(href).toBeTruthy();await page.goto(`${href}?bulk=1`);
 const bulk=page.getByRole("dialog");await expect(bulk.getByRole("button",{name:"50 lokasyonu oluştur"})).toBeVisible();
 await bulk.getByRole("button",{name:"50 lokasyonu oluştur"}).click();
 await page.goto(`/t/${slug}/items?new=1`);
 await expect(dialog).toBeVisible();await dialog.locator('input[name="name"]').fill(`Pilot ürün ${suffix}`);
 await dialog.getByRole("button",{name:"Kaydet",exact:true}).click();await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
 const path=`/t/${slug}/stock/documents`;
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
  await expect(page.getByRole("button",{name:"Taslağı kaydet"})).toBeDisabled();
  await page.getByRole("searchbox",{name:"Ürün",exact:true}).fill(`Pilot ürün ${suffix}`);await page.getByRole("option").first().click();
  await page.getByLabel(/Miktar/).fill(quantity);await page.getByLabel("İşlem açıklaması").fill(`Pilot test ${suffix}`);
  const summary=page.getByRole("region",{name:"İşlem özeti"});await expect(summary).toContainText(`${quantity} ADET`);await expect(summary).toContainText("A-01-01");
  const dimensions=await page.evaluate<{width:number;viewport:number}>("({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})");expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  await page.getByRole("button",{name:"Taslağı kaydet"}).click();await expect(page).toHaveURL(/documents\?id=/);
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
 await expect(dialog).toBeVisible();await dialog.locator('input[name="name"]').fill(`Target ${suffix}`);
 await dialog.getByRole("button",{name:"Kaydet",exact:true}).click();await expect(dialog.locator('input[name="name"]')).toHaveCount(0);
 await page.goto(`/t/${slug}/warehouses`);
 const targetHref=await page.getByTestId("warehouse-card").filter({hasText:`Target ${suffix}`}).getByRole("link",{name:"Lokasyonları aç"}).getAttribute("href");
 expect(targetHref).toBeTruthy();await page.goto(`${targetHref}?bulk=1`);
 await page.getByRole("button",{name:"50 lokasyonu oluştur"}).click();await expect(page.getByRole("button",{name:"50 lokasyonu oluştur"})).toHaveCount(0);
 await page.goto(`${path}?new=TRANSFER`);
 for(const [name,query] of [["Depo",`Pilot ${suffix}`],["Konum","A-01-01"],["Hedef depo",`Target ${suffix}`],["Hedef konum","A-01-01"],["Ürün",`Pilot ürün ${suffix}`]]) {
  await page.getByRole("searchbox",{name,exact:true}).fill(query!);await page.getByRole("option").first().click();
 }
 await page.getByLabel(/Miktar/).fill("3");await page.getByLabel("İşlem açıklaması").fill("Transfer test");
 await page.getByRole("button",{name:"Transferi onayla ve işle"}).click();await expect(page).toHaveURL(/documents\?id=/);
 await expect(page.getByRole("status").filter({hasText:"Stoka işlendi"})).toBeVisible();
 await expect(page.getByRole("link",{name:/Bağlı stok belgesi/})).toContainText("GRS-");
 await stockHas(`Pilot ürün ${suffix}`,"7");await stockHas(`Pilot ürün ${suffix}`,"3");

 await page.goto(`/t/${slug}/items?new=1`);await expect(dialog).toBeVisible();await dialog.locator('input[name="name"]').fill(`Pilot mamul ${suffix}`);
 await dialog.getByRole("button",{name:"Kaydet",exact:true}).click();await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
 await page.locator('input[name="barcode"]').fill(`PILOT-MAMUL-${suffix}`);await page.getByRole("button",{name:"Barkodu ekle"}).click();await expect(page.getByText("Barkod eklendi.")).toBeVisible();
 await page.goto(`/t/${slug}/production?new=1`);
 await page.getByLabel("Reçete kodu",{exact:true}).fill(`RECIPE-${suffix}`);await page.getByLabel("Reçete adı",{exact:true}).fill(`Pilot reçete ${suffix}`);
 await page.getByRole("searchbox",{name:"Mamul",exact:true}).fill(`Pilot mamul ${suffix}`);await page.getByRole("option").first().click();
 await page.getByLabel(/Üretilecek miktar/).fill("1");
 await page.getByRole("searchbox",{name:"Malzeme 1",exact:true}).fill(`Pilot ürün ${suffix}`);await page.getByRole("option").first().click();
 await page.getByLabel(/Reçete miktarı/).fill("2");await page.getByRole("button",{name:"Reçeteyi kaydet"}).click();await expect(page).toHaveURL(/production\?id=/);
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
 await expect(dialog).toBeVisible();await dialog.locator('input[name="name"]').fill(`Sevk ${suffix}`);
 await expect(dialog.locator('input[name="code"]')).not.toHaveAttribute("readonly","");
 await dialog.locator('input[name="code"]').fill("SHIP");await dialog.locator('select[name="kind"]').selectOption("STAGING");await dialog.getByRole("button",{name:"Kaydet",exact:true}).click();await expect(dialog).toBeHidden();
 await page.goto(`/t/${slug}/stock`);await page.getByRole("link",{name:"Sevkiyat",exact:true}).click();
 async function newOrder(quantity:string,reference:string){
  await page.getByRole("link",{name:"Yeni sipariş",exact:true}).click();await page.getByLabel("Müşteri / sipariş açıklaması").fill(reference);
  await page.getByRole("searchbox",{name:"Ürün 1",exact:true}).fill(`Pilot mamul ${suffix}`);await page.getByRole("option").first().click();
  await page.getByLabel(/Sipariş miktarı/).fill(quantity);await expect(page.getByRole("region",{name:"İşlemi kontrol et"})).toContainText(`${quantity} ADET`);
  await page.getByRole("button",{name:"Siparişi oluştur",exact:true}).click();await expect(page).toHaveURL(/shipping\?id=/);
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

});
