"""İmaj derlemesinde modelleri sabit revizyondan indirir ve SHA-256 + boyutla doğrular (T-1002, T-1106).

Çalışma anında ağ yoktur; modeller imaja gömülüdür.
- `whisper`: Hugging Face `Systran/faster-whisper-small` (MIT, CTranslate2 biçimi) — konuşma → yazı.
- `ema`: Hugging Face `canberkkkkkk/ema-lightning` (Apache-2.0) — yazı → Türkçe ses (Q-129). Ağırlıklar `torch.load(weights_only=True)`
  ile açılır (pickle kodu çalışmaz).
Kullanım: python -I fetch_model.py <whisper|ema> <hedef-dizin>
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "whisper": (
        "Systran/faster-whisper-small",
        "536b0662742c02347bc0e980a01041f333bce120",
        {
            "config.json": ("b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828", 2370),
            "model.bin": ("3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671", 483546902),
            "tokenizer.json": ("fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab", 2203239),
            "vocabulary.txt": ("34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913", 459861),
        },
    ),
    "ema": (
        "canberkkkkkk/ema-lightning",
        "e7c96f2fc0ba843cd0f86e02786655bb56f50df8",
        {
            "ema.pt": ("95aec03dafbe0e1d69bca774ab597c779464729a14bc99bfcb52480090c7dfe6", 22285878),
            "decoder.pt": ("9595819b173f411340f63d11332695121a97f8bf1f6d8b6fef0b21cf99c7ad67", 12103269),
        },
    ),
}


def main() -> None:
    repo, revision, files = MODELS[sys.argv[1]]
    target = Path(sys.argv[2])
    target.mkdir(parents=True, exist_ok=True)
    failed = []
    for name, (sha, size) in files.items():
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
        digest = hashlib.sha256()
        total = 0
        part = target / (name + ".part")
        with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as out:
            commit = response.headers.get("X-Repo-Commit", "?")
            while block := response.read(1 << 20):
                total += len(block)
                if total > size:
                    raise SystemExit(f"{name}: beklenenden büyük")
                digest.update(block)
                out.write(block)
        if total != size or digest.hexdigest() != sha:
            part.unlink()
            failed.append(f"{name}: SHA-256/boyut uyuşmuyor (gelen {digest.hexdigest()} {total} bayt, revizyon {commit})")
            continue
        part.rename(target / name)
        print(f"{name}: doğrulandı ({size} bayt)")
    if failed:
        raise SystemExit("\n".join(failed))


if __name__ == "__main__":
    main()
