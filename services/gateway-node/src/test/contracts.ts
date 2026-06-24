import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test-only helpers for reading the shared `contracts/` source of truth.
 * Not part of the runtime build (see tsconfig `exclude`).
 */

/** Walk up from this file to the repo's `contracts/` directory. */
function contractsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parsePath(dir);
  while (dir !== root) {
    const candidate = join(dir, "contracts");
    if (existsSync(join(candidate, "events"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error("could not locate the contracts/ directory");
}

export function loadEventSchema(file: string): Record<string, unknown> {
  const path = join(contractsDir(), "events", file);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function gatewayOpenApiPath(): string {
  return join(contractsDir(), "openapi", "gateway-node.openapi.yaml");
}
