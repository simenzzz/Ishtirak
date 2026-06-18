import jwt from "jsonwebtoken";

import { type Config } from "../config.js";
import { type Identity } from "./identity.js";

export type ServiceTarget = "core-java" | "analytics-python";

export function mintServiceToken(
  identity: Identity,
  target: ServiceTarget,
  config: Pick<
    Config,
    "GATEWAY_SERVICE_TOKEN_SECRET" | "GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET" | "SERVICE_TOKEN_TTL_SECS"
  >,
): string {
  const claims = {
    iss: "gateway-node",
    aud: target,
    typ: "service",
    sub: identity.sub,
    operatorId: identity.operatorId,
    role: identity.role,
    ...(identity.subscriberId ? { subscriberId: identity.subscriberId } : {}),
  };
  return jwt.sign(claims, secretForTarget(target, config), {
    algorithm: "HS256",
    expiresIn: config.SERVICE_TOKEN_TTL_SECS,
  });
}

function secretForTarget(
  target: ServiceTarget,
  config: Pick<Config, "GATEWAY_SERVICE_TOKEN_SECRET" | "GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET">,
): string {
  return target === "analytics-python"
    ? config.GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET
    : config.GATEWAY_SERVICE_TOKEN_SECRET;
}
