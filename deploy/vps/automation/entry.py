#!/usr/bin/python3
"""SSH forced command: two operations only. This file and home/.ssh are root-owned."""
import os
import re
import subprocess
import sys

raw = os.environ.get('SSH_ORIGINAL_COMMAND', '')
if raw == 'check' or re.fullmatch(r'deploy [0-9a-f]{40} [0-9a-f]{64} [0-9a-f]{64}', raw):
    sys.exit(subprocess.call(['/usr/bin/sudo', '-n', '/usr/local/sbin/etkinwms-release', *raw.split()]))
print('ETKINWMS_COMMAND_REJECTED', file=sys.stderr)
sys.exit(1)
