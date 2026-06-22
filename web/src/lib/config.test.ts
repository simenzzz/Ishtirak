import { apiBaseUrl } from "./config";

describe("apiBaseUrl https guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows plain http to loopback hosts in a production build", () => {
    vi.stubEnv("PROD", true);
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"]) {
      vi.stubEnv("VITE_API_URL", url);
      expect(() => apiBaseUrl()).not.toThrow();
    }
  });

  it("rejects plain http to non-loopback hosts in a production build", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_API_URL", "http://api.example.com");
    expect(() => apiBaseUrl()).toThrow("VITE_API_URL must use https in production");
  });

  it("does not treat lookalike hosts as loopback", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_API_URL", "http://localhost.evil.com");
    expect(() => apiBaseUrl()).toThrow("VITE_API_URL must use https in production");
  });

  it("allows https to any host in a production build", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    expect(apiBaseUrl()).toBe("https://api.example.com");
  });

  it("allows plain http to any host outside a production build", () => {
    vi.stubEnv("PROD", false);
    vi.stubEnv("VITE_API_URL", "http://api.example.com");
    expect(() => apiBaseUrl()).not.toThrow();
  });

  it("rejects non-http(s) protocols regardless of build mode", () => {
    vi.stubEnv("PROD", false);
    vi.stubEnv("VITE_API_URL", "ftp://localhost:8080");
    expect(() => apiBaseUrl()).toThrow("VITE_API_URL must use http or https");
  });
});
