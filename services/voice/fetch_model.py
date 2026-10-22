"""İmaj derlemesinde faster-whisper `small` modelini sabit revizyondan indirir ve SHA-256 ile doğrular (T-1002).

Çalışma anında ağ yoktur; model imaja gömülüdür. Kaynak: Hugging Face `Systran/faster-whisper-small` (MIT, CTranslate2 biçimi).
Kullanım: python -I fetch_model.py <hedef-dizin>
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

REPO = "Systran/faster-whisper-small"
REVISION = "536b0662742c02347bc0e980a01041f333bce120"
FILES = {
    "config.json": ("b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828", 2370),
    "model.bin": ("3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671", 483546902),
    "tokenizer.json": ("fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab", 2203239),
    "vocabulary.txt": ("34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913", 459861),
}


def main() -> None:
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    for name, (sha, size) in FILES.items():
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
        digest = hashlib.sha256()
        total = 0
        part = target / (name + ".part")
        with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as out:
            while block := response.read(1 << 20):
                total += len(block)
                if total > size:
                    raise SystemExit(f"{name}: beklenenden büyük")
                digest.update(block)
                out.write(block)
        if total != size or digest.hexdigest() != sha:
            raise SystemExit(f"{name}: SHA-256/boyut uyuşmuyor")
        part.rename(target / name)
        print(f"{name}: doğrulandı ({size} bayt)")


if __name__ == "__main__":
    main()
