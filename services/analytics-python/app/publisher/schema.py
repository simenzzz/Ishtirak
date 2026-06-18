"""Locate and compile the JSON Schemas used to validate emitted events."""

from __future__ import annotations

import json
import os
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.protocols import Validator


class SchemaNotFoundError(RuntimeError):
    """The contracts directory could not be located; we refuse to emit unvalidated events."""


def load_validator(schema_name: str) -> Validator:
    schema_path = _contracts_dir() / "events" / schema_name
    if not schema_path.is_file():
        raise SchemaNotFoundError(f"event schema not found: {schema_path}")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _contracts_dir() -> Path:
    override = os.environ.get("ISHTIRAK_CONTRACTS_DIR", "").strip()
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "contracts"
        if (candidate / "events").is_dir():
            return candidate
    raise SchemaNotFoundError("could not locate the contracts directory")
