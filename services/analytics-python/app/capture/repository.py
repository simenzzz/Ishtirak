"""Compatibility exports for capture-store ports and the SQLite adapter."""

from app.capture.sqlite_repository import CaptureRepository, SqliteCaptureRepository

__all__ = ["CaptureRepository", "SqliteCaptureRepository"]
