import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

import { authMiddleware } from "./authMiddleware.js";
import { requireRoles } from "./rbac.js";

const config = { JWT_SECRET: "test-jwt-secret-that-is-at-least-32" };
const identity = {
  sub: "user-1",
  operatorId: "11111111-1111-1111-1111-111111111111",
  role: "OPERATOR_ADMIN",
  typ: "access",
  iss: "core-java",
};

describe("auth middleware and rbac", () => {
  it("attaches verified identity", () => {
    const token = jwt.sign(identity, config.JWT_SECRET, { expiresIn: 300 });
    const req = { header: () => `Bearer ${token}` } as any;
    const next = vi.fn();

    authMiddleware(config)(req, response() as any, next);

    expect(next).toHaveBeenCalled();
    expect(req.identity).toMatchObject({ operatorId: identity.operatorId, role: identity.role });
  });

  it("rejects missing tokens", () => {
    const res = response();
    authMiddleware(config)({ header: () => undefined } as any, res as any, vi.fn());

    expect(res.statusCode).toBe(401);
  });

  it("forbids roles outside the allowed set", () => {
    const res = response();
    requireRoles("SUBSCRIBER")({ identity: { role: "OPERATOR_ADMIN" } } as any, res as any, vi.fn());

    expect(res.statusCode).toBe(403);
  });
});

function response(): { statusCode: number; status(code: number): any; json(body: unknown): any } {
  return {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
}
