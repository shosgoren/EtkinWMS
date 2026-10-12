#!/bin/bash
# Run once by the already-authorized VPS administrator, with PUBLIC key argument.
set -euo pipefail
umask 077
test "$(id -u)" = 0
/usr/sbin/sshd -T | grep -qx 'permituserenvironment no'
cd "$(dirname "$0")"
key_file=${1:?public key file required}
test -f "$key_file"
ssh-keygen -lf "$key_file" >/dev/null
test "$(wc -l < "$key_file")" = 1
grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+ [A-Za-z0-9_-]+$' "$key_file"
test ! -e /opt/etkinwms/automation/state.json
test ! -e /etc/sudoers.d/etkinwms-deploy
! id etkinwms-deploy >/dev/null 2>&1
release=$(readlink -f /opt/etkinwms/current)
case "$release" in /opt/etkinwms/releases/*) ;; *) exit 1;; esac
test -f "$release/deploy/vps/compose.yml"
test -f "$release/deploy/vps/Caddyfile"
test -d "$release/packages/db/migrations"
install -d -m 700 -o root -g root /opt/etkinwms/automation
install -m 755 -o root -g root release.py /usr/local/sbin/etkinwms-release
install -m 755 -o root -g root entry.py /usr/local/bin/etkinwms-deploy-entry
install -m 644 -o root -g root compose.yml /opt/etkinwms/automation/compose.yml
install -m 644 -o root -g root "$release/deploy/vps/Caddyfile" /opt/etkinwms/automation/Caddyfile
python3 schema.py "$release/packages/db/migrations" > /opt/etkinwms/automation/approved-schema.sha256
python3 - "$release" <<'PY'
import json,sys
from pathlib import Path
release=Path(sys.argv[1]); tag=release.name
# Existing guided release uses matching image tag; exact matching is checked below.
schema=Path('/opt/etkinwms/automation/approved-schema.sha256').read_text().strip()
Path('/opt/etkinwms/automation/state.json').write_text(json.dumps({'tag':tag,'compose':str(release/'deploy/vps/compose.yml'),'release':str(release),'schema':schema}))
PY
tag=$(basename "$release")
docker image inspect "etkinwms:$tag" >/dev/null
useradd --system --create-home --home-dir /var/lib/etkinwms-deploy --shell /bin/sh etkinwms-deploy
chown root:root /var/lib/etkinwms-deploy
chmod 755 /var/lib/etkinwms-deploy
install -d -m 755 -o root -g root /var/lib/etkinwms-deploy/.ssh
printf 'restrict,command="/usr/local/bin/etkinwms-deploy-entry" %s\n' "$(cat "$key_file")" > /var/lib/etkinwms-deploy/.ssh/authorized_keys
chmod 644 /var/lib/etkinwms-deploy/.ssh/authorized_keys
cat > /etc/sudoers.d/etkinwms-deploy <<'EOF'
Defaults:etkinwms-deploy !setenv
etkinwms-deploy ALL=(root) NOPASSWD: /usr/local/sbin/etkinwms-release *
EOF
chmod 440 /etc/sudoers.d/etkinwms-deploy
visudo -cf /etc/sudoers.d/etkinwms-deploy >/dev/null
cat > /etc/ssh/sshd_config.d/90-etkinwms-deploy.conf <<'EOF'
Match User etkinwms-deploy
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    X11Forwarding no
    ForceCommand /usr/local/bin/etkinwms-deploy-entry
Match all
EOF
if ! /usr/sbin/sshd -t; then
    rm -f /etc/ssh/sshd_config.d/90-etkinwms-deploy.conf
    exit 1
fi
systemctl reload ssh
/usr/local/sbin/etkinwms-release check
