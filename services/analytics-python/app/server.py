"""Uvicorn entrypoint. Kept separate from the factory so tests import cleanly."""

from __future__ import annotations

import uvicorn

from app.main import create_app

app = create_app()


def main() -> None:  # pragma: no cover - thin wrapper
    uvicorn.run(app, host="0.0.0.0", port=8082)


if __name__ == "__main__":  # pragma: no cover
    main()
