#!/bin/bash
# Official vendor artifact, pinned publisher digest. No GitHub login/production token needed.
set -euo pipefail
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 'https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_linux_amd64.tar.gz' -o "$work/gh.tar.gz"
printf 'bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386  %s/gh.tar.gz\n' "$work" | sha256sum -c -
tar -xzf "$work/gh.tar.gz" -C "$work"
install -d -m 755 -o root -g root /usr/local/lib/etkinwms-gh
install -m 755 -o root -g root "$work/gh_2.102.0_linux_amd64/bin/gh" /usr/local/lib/etkinwms-gh/gh
/usr/local/lib/etkinwms-gh/gh --version | head -1
