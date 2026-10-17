#!/bin/bash
# T-410: canlı Docker Compose proje adını `etkinwms-motive` → `etkinwms` olarak bir kez taşır. Veri silinmez:
#   - uygulama birimleri (caddy-data, caddy-config, marketing-leads, demo-leads) yeni projeye KOPYALANIR; eski birimler yerinde kalır;
#   - veritabanı ayrı projededir (`etkinwms-database`); konteynerine dokunulmaz, yalnız yeni uygulama ağına (`etkinwms_default`) ek
#     bağlantı (takma ad `etkinwms-postgres`) verilir; eski ağ bağlantısı da kalır (DB konteyneri yeniden oluşturulana dek gerekli);
#   - yeni compose/Caddyfile kurulur (aynı commit; T-407 SITE_CONTENT_URL dahil), state.json'a `project: etkinwms` yazılır ve aynı commit'teki
#     release.py kurulur (proje/ağ adını state.json'dan okur).
# Herhangi bir adımda hata → yeni kaynaklar (konteyner, ağ, KOPYA birimler) kaldırılır, dosyalar geri yüklenir, eski proje ayağa kalkar.
# Kesinti: eski yığının durmasından yeni yığının sağlıklı olmasına kadar (hedef < 2 dk). Yayın kilidi boyunca alınır (eşzamanlı yayın yok).
# Kullanım (root): bash rename-project.sh <klasör>   — klasörde compose.yml (deploy/vps/automation/), Caddyfile (deploy/vps/) ve
# release.py (deploy/vps/automation/) olmalı. Sır içermez; çıktıya değer yazılmaz.
set -Eeuo pipefail
umask 022
test "$(id -u)" = 0
given=${1:?klasör gerekli}
OLD=etkinwms-motive
NEW=etkinwms
NEW_NET=etkinwms_default
DB=etkinwms-postgres
VOLS=(caddy-data caddy-config marketing-leads demo-leads)
BASE=${ETKINWMS_BASE:-/opt/etkinwms}
RELEASE_BIN=${ETKINWMS_RELEASE_BIN:-/usr/local/sbin/etkinwms-release}
HEALTH_URL=${ETKINWMS_HEALTH_URL:-https://wms.etkinyazilim.com/api/health}
auto=$BASE/automation

for f in compose.yml Caddyfile release.py; do test -f "$given/$f"; done
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
install -m 600 -o root -g root "$given/compose.yml" "$src/compose.yml"
install -m 600 -o root -g root "$given/Caddyfile" "$src/Caddyfile"
install -m 600 -o root -g root "$given/release.py" "$src/release.py"

# Önkoşullar: eski adla kurulu, yeni adın hiçbir kaynağı yok.
test -f "$auto/state.json"
project=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("project", "etkinwms-motive"))' "$auto/state.json")
if [ "$project" != "$OLD" ]; then echo "zaten taşınmış: proje $project"; exit 1; fi
tag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag"])' "$auto/state.json")
[[ $tag =~ ^[A-Za-z0-9._-]+$ ]]
docker image inspect "etkinwms:$tag" >/dev/null
grep -qx "name: $NEW" "$src/compose.yml"
grep -q "PROJECTS = {'etkinwms-motive': 'etkinwms-motive_default', 'etkinwms': 'etkinwms_default'}" "$src/release.py"
python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$src/release.py"
for v in "${VOLS[@]}"; do
  docker volume inspect "${OLD}_$v" >/dev/null
  if docker volume inspect "${NEW}_$v" >/dev/null 2>&1; then echo "hata: ${NEW}_$v zaten var"; exit 1; fi
done
if docker network inspect "$NEW_NET" >/dev/null 2>&1; then echo "hata: $NEW_NET zaten var"; exit 1; fi
test "$(docker inspect -f '{{.State.Running}}' "$DB")" = true

healthy() {
  python3 -I - "$HEALTH_URL" <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=10) as r:
        d = json.load(r)
    sys.exit(0 if all(d.get(k) == 'ok' for k in ['status', 'db', 'queue', 'worker']) else 1)
except Exception:
    sys.exit(1)
PY
}

# Doğrula (hiçbir şey değişmeden): yeni compose yeni adla, Caddyfile, mevcut yığın sağlıklı.
WMS_RELEASE="$tag" docker compose -p "$NEW" -f "$src/compose.yml" config --quiet
docker run --rm -v "$(readlink -f "$src/Caddyfile"):/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
healthy || { echo "hata: mevcut yığın sağlıksız; taşıma başlatılmadı"; exit 1; }

exec 9>>"$auto/release.lock"
flock -w 600 9 || { echo "hata: yayın kilidi alınamadı"; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
cp -p "$auto/compose.yml" "$auto/compose.yml.$stamp"
cp -p "$auto/Caddyfile" "$auto/Caddyfile.$stamp"
cp -p "$auto/state.json" "$auto/state.json.$stamp"
cp -p "$RELEASE_BIN" "$RELEASE_BIN.bak-$stamp"
created=0

rollback() {
  set +e
  echo "hata: eski projeye dönülüyor ($stamp)" >&2
  if [ "$created" = 1 ]; then
    WMS_RELEASE="$tag" docker compose -p "$NEW" -f "$auto/compose.yml" rm -sf >/dev/null 2>&1
    docker network disconnect "$NEW_NET" "$DB" >/dev/null 2>&1
    docker network rm "$NEW_NET" >/dev/null 2>&1
    # Yalnız bu çalıştırmada oluşturulan KOPYA birimler; eski birimlere dokunulmaz.
    for v in "${VOLS[@]}"; do docker volume rm "${NEW}_$v" >/dev/null 2>&1; done
  fi
  cp -p "$auto/compose.yml.$stamp" "$auto/compose.yml"
  cp -p "$auto/Caddyfile.$stamp" "$auto/Caddyfile"
  cp -p "$auto/state.json.$stamp" "$auto/state.json"
  cp -p "$RELEASE_BIN.bak-$stamp" "$RELEASE_BIN"
  WMS_RELEASE="$tag" docker compose -p "$OLD" -f "$auto/compose.yml" up -d --no-build --wait --wait-timeout 180
  WMS_RELEASE="$tag" docker compose -p "$OLD" -f "$auto/compose.yml" restart proxy
  if healthy; then echo "eski proje sağlıklı ($OLD)" >&2; else echo "UYARI: eski proje sağlık denetiminden geçmedi" >&2; fi
  exit 1
}
trap rollback ERR

# 1. Eski yığın durur (kesinti başlar). Konteynerler silinmez; geri dönüş için hazır kalır.
WMS_RELEASE="$tag" docker compose -p "$OLD" -f "$auto/compose.yml.$stamp" stop
# 2. Yeni ayar dosyaları.
install -m 644 -o root -g root "$src/compose.yml" "$auto/compose.yml"
install -m 644 -o root -g root "$src/Caddyfile" "$auto/Caddyfile"
# 3. Yeni proje kaynakları (ağ, boş birimler, konteynerler) başlatılmadan oluşturulur.
created=1
WMS_RELEASE="$tag" docker compose -p "$NEW" -f "$auto/compose.yml" create
# 4. Birimler kopyalanır (sahiplik ve izinler korunur); eski birim salt okunur bağlanır.
for v in "${VOLS[@]}"; do
  docker run --rm --entrypoint /bin/sh -v "${OLD}_$v:/from:ro" -v "${NEW}_$v:/to" caddy:2 -c 'cp -a /from/. /to/'
done
# 5. Veritabanı yeni ağa da bağlanır (aynı takma ad).
docker network connect --alias "$DB" "$NEW_NET" "$DB"
# 6. Yeni yığın.
WMS_RELEASE="$tag" docker compose -p "$NEW" -f "$auto/compose.yml" up -d --no-build --wait --wait-timeout 180
ok=0
for _ in $(seq 1 18); do if healthy; then ok=1; break; fi; sleep 5; done
test "$ok" = 1
# 7. Kalıcı kayıt: state.json'a proje adı (atomik), aynı commit'in release.py'si.
python3 -I - "$auto/state.json" "$NEW" <<'PY'
import json, os, sys
path, name = sys.argv[1], sys.argv[2]
state = json.load(open(path))
state['project'] = name
tmp = path + '.new'
with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
    json.dump(state, f)
os.replace(tmp, path)
PY
install -m 755 -o root -g root "$src/release.py" "$RELEASE_BIN"
trap - ERR
# 8. Eski (durmuş) konteynerler kaldırılır; eski birimler ve ağ yerinde kalır (geri dönüş ve DB bağlantısı için).
WMS_RELEASE="$tag" docker compose -p "$OLD" -f "$auto/compose.yml.$stamp" rm -f >/dev/null || echo "uyarı: eski konteynerler kaldırılamadı (çalışmayı etkilemez)"
echo "tamam: proje $NEW, sürüm $tag, yedekler: *.$stamp"
