"""Runtime configuration, read once from the environment.

Secrets are never defaulted to a real value here. If DATABASE_URL is absent the
API still starts and still plans -- it just cannot persist, and says so with a
503 rather than pretending a run was saved.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path = BASE / ".env") -> None:
    """Minimal .env reader. Values already in the real environment win, so a
    deployment's own configuration is never overwritten by a stray local file."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str | None = os.environ.get("DATABASE_URL")
    max_seconds: float = float(os.environ.get("SCHEDULER_MAX_SECONDS", "20"))
    # Hard ceiling on what a caller may request, so one request cannot pin the
    # solver for an hour and starve everything behind it.
    max_seconds_limit: float = float(os.environ.get("SCHEDULER_SECONDS_LIMIT", "120"))
    cors_origins: tuple = tuple(
        o.strip() for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",") if o.strip()
    )

    @property
    def has_db(self) -> bool:
        return bool(self.database_url)


settings = Settings()
