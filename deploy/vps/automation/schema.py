#!/usr/bin/python3
"""Exact ordered migration file fingerprint, independent of filesystem paths."""
import hashlib
import json
from pathlib import Path
import sys

folder = Path(sys.argv[1])
files = sorted(list(folder.glob('*.up.sql')) + list(folder.glob('*.down.sql')))
if not files:
    raise SystemExit('NO_MIGRATIONS')
rows = [(p.name, hashlib.sha256(p.read_bytes()).hexdigest()) for p in files]
print(hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest())
