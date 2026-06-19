import { type Request, type Response } from "express";
import { z } from "zod";

import { errorBody, requireIdentity } from "../auth/authMiddleware.js";
import { mintServiceToken, type ServiceTarget } from "../auth/serviceToken.js";
import { type Config } from "../config.js";

export type ForwardOptions = Readonly<{
  config: Config;
  target: ServiceTarget;
  baseUrl: string;
  path: (req: Request) => string;
  bodySchema?: z.ZodTypeAny;
  querySchema?: z.ZodTypeAny;
  paramSchema?: z.ZodTypeAny;
  publicRoute?: boolean;
  /** Override the body sent upstream (e.g. inject a cookie-sourced value). */
  requestBody?: (req: Request) => unknown;
  /**
   * Inspect/transform the upstream response before it is sent to the client.
   * May set cookies on `res`. Returns the (possibly new) body to emit.
   */
  onResponse?: (req: Request, res: Response, status: number, body: unknown) => unknown;
}>;

export function forward(options: ForwardOptions) {
  return async (req: Request, res: Response): Promise<void> => {
    const paramResult = parseSchema(options.paramSchema, req.params);
    const queryResult = parseSchema(options.querySchema, req.query);
    const bodyResult = parseSchema(options.bodySchema, req.body);
    const failure = paramResult.error ?? queryResult.error ?? bodyResult.error;
    if (failure) {
      res.status(400).json(errorBody("VALIDATION_ERROR", failure));
      return;
    }

    const url = new URL(options.path(req), options.baseUrl);
    const query = (queryResult.value ?? req.query) as Record<string, unknown>;
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers();
    headers.set("accept", "application/json");
    const sendsBody = req.method !== "GET" && req.method !== "HEAD";
    const contentType = req.header("content-type");
    if (options.requestBody && sendsBody) {
      headers.set("content-type", "application/json");
    } else if (contentType && sendsBody) {
      headers.set("content-type", contentType);
    }
    const idempotencyKey = req.header("idempotency-key");
    if (idempotencyKey) {
      headers.set("idempotency-key", idempotencyKey);
    }
    if (!options.publicRoute) {
      const identity = requireIdentity(req);
      headers.set("authorization", `Bearer ${mintServiceToken(identity, options.target, options.config)}`);
      headers.set("x-operator-id", identity.operatorId);
      headers.set("x-actor-role", identity.role);
      if (identity.subscriberId) {
        headers.set("x-actor-subscriber-id", identity.subscriberId);
      }
    }

    try {
      const body = options.requestBody ? options.requestBody(req) : (bodyResult.value ?? req.body ?? {});
      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: sendsBody ? JSON.stringify(body) : undefined,
      });
      const raw = await readUpstream(upstream);
      const content = options.onResponse ? options.onResponse(req, res, upstream.status, raw) : raw;
      res.status(upstream.status);
      if (content === undefined) {
        res.end();
      } else {
        res.json(content);
      }
    } catch {
      res.status(502).json(errorBody("BAD_GATEWAY", "Upstream service unavailable"));
    }
  };
}

type ParseResult = Readonly<{ value?: unknown; error?: string }>;

function parseSchema(schema: z.ZodTypeAny | undefined, value: unknown): ParseResult {
  if (!schema) {
    return {};
  }
  const result = schema.safeParse(value);
  if (result.success) {
    return { value: result.data };
  }
  return { error: result.error.issues[0]?.message ?? "Invalid request" };
}

async function readUpstream(response: globalThis.Response): Promise<unknown | undefined> {
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return errorBody("BAD_GATEWAY", "Invalid upstream response");
  }
}
