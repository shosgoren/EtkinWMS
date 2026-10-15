#!/bin/bash
# Canlı compose/Caddy ayarını günceller (ADR-026 T-994 demo-leads birimi, ADR-027 panel servisi ve yonet. alan adı).
# install.sh tek seferliktir; /opt/etkinwms/automation/{compose.yml,Caddyfile} sürümle güncellenmez. Bu betik, VPS yöneticisinin
# depodan kopyaladığı iki dosyayı doğrular, kurar ve servisleri mevcut sürümle (state.json etiketi) yeniden ayağa kaldırır.
# Kullanım (root): bash update-config.sh <klasör>   — klasörde compose.yml (deploy/vps/automation/) ve Caddyfile (deploy/vps/) olmalı.
# Sır içermez; dosyalar değer taşımaz. Hata olursa eski dosyalar yerinde kalır (önce doğrulama, sonra kurulum).
set -euo pipefail
umask 022
test "$(id -u)" = 0
src=${1:?klasör gerekli}
test -f "$src/compose.yml"
test -f "$src/Caddyfile"
auto=/opt/etkinwms/automation
test -f "$auto/state.json"
tag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag"])' "$auto/state.json")
[[ $tag =~ ^[A-Za-z0-9._-]+$ ]]
docker image inspect "etkinwms:$tag" >/dev/null
# 1. Doğrula (kurmadan önce).
WMS_RELEASE="$tag" docker compose -p etkinwms-motive -f "$src/compose.yml" config --quiet
docker run --rm -v "$(readlink -f "$src/Caddyfile"):/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# 2. Eskiyi yedekle, yeniyi kur.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
cp -p "$auto/compose.yml" "$auto/compose.yml.$stamp"
cp -p "$auto/Caddyfile" "$auto/Caddyfile.$stamp"
install -m 644 -o root -g root "$src/compose.yml" "$auto/compose.yml"
install -m 644 -o root -g root "$src/Caddyfile" "$auto/Caddyfile"
# 3. Servisleri mevcut sürümle güncelle; Caddy tek dosya bağlaması yeni dosyayı görsün diye yeniden başlatılır.
WMS_RELEASE="$tag" docker compose -p etkinwms-motive -f "$auto/compose.yml" up -d --no-build --wait --wait-timeout 180
WMS_RELEASE="$tag" docker compose -p etkinwms-motive -f "$auto/compose.yml" restart proxy
echo "tamam: sürüm $tag, yedek: compose.yml.$stamp / Caddyfile.$stamp"
