#!/bin/bash
# Canlı compose/Caddy ayarını günceller (ADR-026 T-994 demo-leads birimi, ADR-027 panel servisi ve yonet. alan adı).
# install.sh tek seferliktir; /opt/etkinwms/automation/{compose.yml,Caddyfile} sürümle güncellenmez. Bu betik, VPS yöneticisinin
# depodan kopyaladığı iki dosyayı doğrular, kurar ve servisleri mevcut sürümle (state.json etiketi) yeniden ayağa kaldırır.
# Kullanım (root): bash update-config.sh <klasör>   — klasörde compose.yml (deploy/vps/automation/) ve Caddyfile (deploy/vps/) olmalı.
# Sır içermez; dosyalar değer taşımaz. Doğrulama hatasında hiçbir şey değişmez; kurulumdan sonraki hatada eski dosyalara dönülür.
set -Eeuo pipefail
umask 022
test "$(id -u)" = 0
given=${1:?klasör gerekli}
test -f "$given/compose.yml"
test -f "$given/Caddyfile"
# Doğrulanan ile kurulan aynı dosya olsun (T-401 inceleme m-3): önce kök sahipli geçici klasöre kopyala, yalnız onu kullan.
src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
install -m 600 -o root -g root "$given/compose.yml" "$src/compose.yml"
install -m 600 -o root -g root "$given/Caddyfile" "$src/Caddyfile"
auto=/opt/etkinwms/automation
test -f "$auto/state.json"
tag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag"])' "$auto/state.json")
[[ $tag =~ ^[A-Za-z0-9._-]+$ ]]
# T-410: proje adı state.json'dan (yeniden adlandırmadan önce kayıt yoksa eski ad); yalnız iki ad kabul edilir.
project=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("project", "etkinwms-motive"))' "$auto/state.json")
[[ $project == etkinwms || $project == etkinwms-motive ]]
# Kurulacak dosyanın proje adı (compose `name:`) da aynı olmalı: başka projeye ait dosya bu betikle kurulmaz.
grep -qx "name: $project" "$src/compose.yml"
docker image inspect "etkinwms:$tag" >/dev/null
# T-1002: ses servisi (profil `voice`) yalnız state'te kayıtlı ses imajı varsa başlar (release.py ile aynı kural); yoksa compose onu atlar.
unset COMPOSE_PROFILES WMS_VOICE_RELEASE
voice=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("voice") or "")' "$auto/state.json")
if [[ -n $voice ]]; then
  [[ $voice =~ ^[0-9a-f]{40}$ ]]
  docker image inspect "etkinwms-voice:$voice" >/dev/null
  export COMPOSE_PROFILES=voice WMS_VOICE_RELEASE="$voice"
fi
# 1. Doğrula (kurmadan önce).
WMS_RELEASE="$tag" docker compose -p "$project" -f "$src/compose.yml" config --quiet
docker run --rm -v "$(readlink -f "$src/Caddyfile"):/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# 2. Eskiyi yedekle, yeniyi kur.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
cp -p "$auto/compose.yml" "$auto/compose.yml.$stamp"
cp -p "$auto/Caddyfile" "$auto/Caddyfile.$stamp"
# Bundan sonraki her hata eski dosyalara döner ve servisleri onlarla yeniden ayağa kaldırır.
rollback() {
  echo "hata: eski ayara dönülüyor ($stamp)" >&2
  cp -p "$auto/compose.yml.$stamp" "$auto/compose.yml"
  cp -p "$auto/Caddyfile.$stamp" "$auto/Caddyfile"
  WMS_RELEASE="$tag" docker compose -p "$project" -f "$auto/compose.yml" up -d --no-build --remove-orphans --wait --wait-timeout 180 || true
  WMS_RELEASE="$tag" docker compose -p "$project" -f "$auto/compose.yml" restart proxy || true
  rm -rf "$src"
}
trap 'rollback' ERR
install -m 644 -o root -g root "$src/compose.yml" "$auto/compose.yml"
install -m 644 -o root -g root "$src/Caddyfile" "$auto/Caddyfile"
# 3. Servisleri mevcut sürümle güncelle; Caddy tek dosya bağlaması yeni dosyayı görsün diye yeniden başlatılır.
WMS_RELEASE="$tag" docker compose -p "$project" -f "$auto/compose.yml" up -d --no-build --wait --wait-timeout 180
WMS_RELEASE="$tag" docker compose -p "$project" -f "$auto/compose.yml" restart proxy
trap - ERR
echo "tamam: sürüm $tag, yedek: compose.yml.$stamp / Caddyfile.$stamp"
