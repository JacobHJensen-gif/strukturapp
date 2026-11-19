import os
from pathlib import Path
from urllib.parse import urlparse


def secret_key() -> str:
    key = os.environ.get("SECRET_KEY", "")
    if len(key) < 32:
        raise RuntimeError("SECRET_KEY must be configured with at least 32 characters")
    return key


DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/hverdagsro.db")
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "480"))
LOCAL_AI_MODEL = os.environ.get("LOCAL_AI_MODEL", "").strip()
LOCAL_AI_URL = os.environ.get("LOCAL_AI_URL", "http://127.0.0.1:11434").rstrip("/")

if DATABASE_URL.startswith("sqlite:///") and DATABASE_URL != "sqlite:///:memory:":
    Path(DATABASE_URL.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)

parsed_ai_url = urlparse(LOCAL_AI_URL)
if parsed_ai_url.scheme != "http" or parsed_ai_url.hostname not in {"127.0.0.1", "localhost", "::1"}:
    raise RuntimeError("LOCAL_AI_URL must point to a local HTTP service")
