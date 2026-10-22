# Müşteri sıfırlama (T-1004)

Kullanıcı kararı 22 Ekim: canlıda gerçek müşteri verisi yok; test için baştan başlanır. Betik:
[`reset-tenants.sql`](reset-tenants.sql). Geri alınamaz; tek geri dönüş yolu 2. adımdaki yedektir.

**Silinir:** bütün müşteri alanları (tenant) ve kiracı kolonlu her tablodaki satırlar (üyelik, davet, saha kullanıcısı/cihazı/
oturumu, katılma talebi, stok/defter/bakiye, belge, görev, sayım, destek, entegrasyon, kiracı audit'i, abonelik, tahakkuk/ödeme),
demo talepleri (DB + satış sitesinin `demo-requests.jsonl` dosyası), operatör dışı bütün kullanıcılar (parola, MFA, oturum,
güvenilir cihaz, güvenlik olayları), hız sınırı sayaçları, kuyruk işleri.
**Kalır:** `wms_platform.operators` e-postasına sahip kullanıcı(lar) — parola, MFA, oturum, güvenilir cihaz; paketler; satış
sayfası; operatörün panel işlem kaydı (`security_events` `platform.*`); tenant'sız genel tanımlar; şema, migration defteri,
roller/grant'lar; pg-boss zamanlamaları; stok tutarlılık sinyalleri (tenant'sız izleme).

## Neden tetikleyiciler adıyla kapatılıyor (`session_replication_role = replica` değil)
- `audit_logs`, `stock_ledger`, `security_events` gibi append-only korumaların çoğu `ENABLE ALWAYS`; replica kipinde de çalışır,
  silmeyi yine engeller.
- Replica kipi FK denetimini de kapatır; eksik bir silme sessizce yetim satır bırakırdı.
- Betik yalnız silinen tablolardaki kullanıcı tetikleyicilerini, aynı transaction içinde, adıyla kapatır; silmeden sonra her
  birini **önceki kipine** (ENABLE / ENABLE ALWAYS / ENABLE REPLICA) döndürür ve bunu doğrular. FK'ler baştan sona açıktır;
  silme sırası FK grafiğinden hesaplanır. Hata olursa transaction düşer, tetikleyiciler de eski hâline döner (DDL transaction'lıdır).
- Sonda: tenant 0; `information_schema`'daki her `tenant_id`/`*_tenant_id` kolonunda dolu satır 0; operatör hesabı, parolası,
  MFA'sı, oturumları, güvenilir cihazları ve panel kaydı sayıları önceki gibi; operatör dışı kullanıcı 0. Biri tutmazsa
  `RAISE EXCEPTION` → hiçbir şey yazılmaz.
- `dry_run` verilmezse kuru koşudur (her şeyi yapar, doğrular, ROLLBACK). Gerçek silme yalnız `-v dry_run=0` ile.

## Komutlar (VPS, root, sırayla)
`SHA` = bu betiği getiren PR'ın main'e birleşme commit'i (raporda verilir).

```bash
# 0) Hazırlık
SHA=<birleşme-commit-sha>
TS=$(date +%Y%m%d-%H%M%S)
P=$(python3 -c 'import json;print(json.load(open("/opt/etkinwms/automation/state.json")).get("project","etkinwms-motive"))'); echo "proje: $P"
curl -fsSL "https://raw.githubusercontent.com/shosgoren/EtkinWMS/$SHA/deploy/vps/ops/reset-tenants.sql" -o /root/reset-tenants.sql
echo "acb2efe16dacddf83a55edd301faa0891f73ee05f91a1400fc6d0330afa0b9dc  /root/reset-tenants.sql" | sha256sum -c -

# a) web, worker ve satış sitesini (demo talebi yazar) durdur; panel açık kalır
IDS=$(for s in web worker marketing; do docker ps -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.service=$s"; done); echo $IDS
docker stop $IDS

# b) yedek (root700 klasör, 600 dosya; release.py'nin "pre-*" temizliği bu dosyaya dokunmaz)
install -d -m 700 /opt/etkinwms/backups
( umask 077; docker exec --user postgres etkinwms-postgres pg_dump -Fc -d etkinwms > /opt/etkinwms/backups/reset-$TS.dump )
head -c 5 /opt/etkinwms/backups/reset-$TS.dump; echo; ls -l /opt/etkinwms/backups/reset-$TS.dump   # PGDMP ve sıfırdan büyük olmalı
docker exec -i --user postgres etkinwms-postgres pg_restore -l < /opt/etkinwms/backups/reset-$TS.dump | grep -c 'TABLE DATA'

# c) kuru koşu: sayıları gösterir, doğrular, ROLLBACK ("KURU KOŞU" ve "doğrulama TAMAM" görülmeli)
docker exec -i --user postgres etkinwms-postgres psql -X -d etkinwms -v dry_run=1 < /root/reset-tenants.sql

# d) gerçek koşu ("doğrulama TAMAM" + "TAMAMLANDI (COMMIT)" görülmeli); ardından satış sitesinin demo talep dosyasını yedeğe taşı
docker exec -i --user postgres etkinwms-postgres psql -X -d etkinwms -v dry_run=0 < /root/reset-tenants.sql
for v in demo-leads marketing-leads; do D=$(docker volume inspect -f '{{.Mountpoint}}' "${P}_$v" 2>/dev/null) && [ -f "$D/demo-requests.jsonl" ] && mv "$D/demo-requests.jsonl" "/opt/etkinwms/backups/reset-$TS-$v-demo-requests.jsonl"; done; ls -l /opt/etkinwms/backups/ | grep "reset-$TS"

# e) web, worker ve satış sitesini başlat; sağlık
docker start $IDS
sleep 30; curl -fsS https://wms.etkinyazilim.com/api/health; echo
```

f) Tarayıcıda `https://yonet.etkinyazilim.com` → operatör e-postası + parola + doğrulama kodu ile gir. Müşteriler listesi
boş, Demo talepleri boş, Paketler duruyor, İşlem kaydında eski panel kayıtları duruyor (firma adı boş görünebilir).
`https://wms.etkinyazilim.com` üzerinden yeni bir hesap/çalışma alanı açılabildiğini dene.

## Hata olursa
- c/d adımında `ERROR` / `RESET_ABORT` / `RESET_VERIFY` çıktıysa hiçbir şey değişmemiştir (tek transaction). Çıktıyı kaydet,
  `docker start $IDS` ile servisleri aç.
- Gerçek koşudan sonra geri dönmek gerekirse (servisler durdurulmuşken):
  `docker exec -i --user postgres etkinwms-postgres pg_restore --clean --if-exists --single-transaction -d etkinwms < /opt/etkinwms/backups/reset-$TS.dump`
  ve taşınan `*-demo-requests.jsonl` dosyalarını eski yerine geri koy.
- Yedek dosyası kişisel veri içerir; işi bitince kullanıcı kararıyla silinir (`/opt/etkinwms/backups/reset-*`).

## Test
`tests/integration/ops/reset-tenants.int.test.ts`: koşuya özel ayrı veritabanında bütün migration'lar + iki kiracılık tam veri
seti + MFA'lı operatör; betik konteynerdeki psql ile kuru ve gerçek koşulur; yetim satır, operatör hesabı, tetikleyici kipleri,
panel yetkisi ve yeni kiracı açılışı doğrulanır. Şema değişip betik bozulursa CI düşer.
