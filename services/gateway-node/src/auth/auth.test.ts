import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";

import { verifyAccessToken } from "./jwtVerify.js";
import { mintServiceToken } from "./serviceToken.js";

const config = {
  JWT_SECRET: "test-jwt-secret-that-is-at-least-32",
  GATEWAY_SERVICE_TOKEN_SECRET: "test-gateway-service-token-secret-32",
  GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET: "test-gateway-analytics-secret-32",
  SERVICE_TOKEN_TTL_SECS: 300,
};

const identity = {
  sub: "user-1",
  operatorId: "11111111-1111-1111-1111-111111111111",
  role: "OPERATOR_ADMIN" as const,
};

describe("gateway auth", () => {
  it("verifies core-java access tokens", () => {
    const token = jwt.sign({ ...identity, typ: "access", iss: "core-java" }, config.JWT_SECRET, {
      expiresIn: 300,
    });

    expect(verifyAccessToken(token, config)).toEqual(identity);
  });

  it("rejects wrong token type", () => {
    const token = jwt.sign({ ...identity, typ: "selection", iss: "core-java" }, config.JWT_SECRET);

    expect(() => verifyAccessToken(token, config)).toThrow();
  });

  it("mints target-specific service tokens", () => {
    const token = mintServiceToken(identity, "analytics-python", config);
    const claims = jwt.verify(token, config.GATEWAY_ANALYTICS_SERVICE_TOKEN_SECRET);

    expect(claims).toMatchObject({
      iss: "gateway-node",
      aud: "analytics-python",
      typ: "service",
      operatorId: identity.operatorId,
      role: identity.role,
    });
    expect(() => jwt.verify(token, config.GATEWAY_SERVICE_TOKEN_SECRET)).toThrow();
  });
});
