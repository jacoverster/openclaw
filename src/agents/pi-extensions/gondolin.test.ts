import { describe, expect, it, vi } from "vitest";
import {
  createGondolinExtension,
  toGuestPath,
  shQuote,
  type GondolinExtensionOptions,
  type GondolinApiKeyConfig,
  __testing,
} from "./gondolin.js";

// Mock the gondolin module
vi.mock("@earendil-works/gondolin", () => ({
  VM: {
    create: vi.fn().mockResolvedValue({
      id: "test-vm-id",
      exec: vi.fn().mockResolvedValue({
        ok: true,
        exitCode: 0,
        stdout: "test output",
        stdoutBuffer: Buffer.from("test output"),
        stderr: "",
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
  RealFSProvider: vi.fn().mockImplementation(() => ({})),
  createHttpHooks: vi.fn().mockReturnValue({
    httpHooks: {},
    env: { ANTHROPIC_API_KEY: "GONDOLIN_SECRET_ANTHROPIC" },
  }),
}));

describe("gondolin path utilities", () => {
  describe("toGuestPath", () => {
    it("returns /workspace for same path", () => {
      const result = toGuestPath("/home/user/project", "/home/user/project");
      expect(result).toBe("/workspace");
    });

    it("converts relative paths to /workspace paths", () => {
      const result = toGuestPath("/home/user/project", "/home/user/project/src/index.ts");
      expect(result).toBe("/workspace/src/index.ts");
    });

    it("throws on path escape attempt (..)", () => {
      expect(() => toGuestPath("/home/user/project", "/home/user/../etc/passwd")).toThrow(
        "path escapes workspace"
      );
    });

    it("throws on absolute path outside workspace", () => {
      expect(() => toGuestPath("/home/user/project", "/etc/passwd")).toThrow(
        "path escapes workspace"
      );
    });

    it("converts Windows-style paths to POSIX", () => {
      const result = toGuestPath("C:\\Users\\project", "C:\\Users\\project\\src\\index.ts");
      expect(result).toBe("/workspace/src/index.ts");
    });
  });

  describe("shQuote", () => {
    it("wraps simple string in single quotes", () => {
      expect(shQuote("hello")).toBe("'hello'");
    });

    it("escapes single quotes", () => {
      expect(shQuote("hello'world")).toBe("'hello'\\''world'");
    });

    it("handles empty string", () => {
      expect(shQuote("")).toBe("''");
    });

    it("handles string with multiple single quotes", () => {
      expect(shQuote("it's a test's")).toBe("'it'\\''s a test'\\''s'");
    });
  });
});

describe("gondolin extension", () => {
  describe("createGondolinExtension", () => {
    it("creates an extension function", () => {
      const extension = createGondolinExtension();
      expect(typeof extension).toBe("function");
    });

    it("accepts sessionLabel option", () => {
      const extension = createGondolinExtension({
        sessionLabel: "test-session",
      });
      expect(typeof extension).toBe("function");
    });

    it("accepts apiKeys option", () => {
      const apiKeys: GondolinApiKeyConfig[] = [
        { provider: "anthropic", apiKey: "sk-ant-test" },
        { provider: "openai", apiKey: "sk-test" },
      ];
      const extension = createGondolinExtension({
        apiKeys,
      });
      expect(typeof extension).toBe("function");
    });

    it("accepts dnsMode option", () => {
      const extension = createGondolinExtension({
        dnsMode: "trusted",
      });
      expect(typeof extension).toBe("function");
    });

    it("accepts additionalHosts option", () => {
      const extension = createGondolinExtension({
        additionalHosts: ["api.example.com", "*.github.com"],
      });
      expect(typeof extension).toBe("function");
    });

    it("accepts enableIngress option", () => {
      const extension = createGondolinExtension({
        enableIngress: true,
      });
      expect(typeof extension).toBe("function");
    });

    it("accepts all options together", () => {
      const options: GondolinExtensionOptions = {
        sessionLabel: "full-test",
        apiKeys: [{ provider: "anthropic", apiKey: "sk-ant-test" }],
        dnsMode: "synthetic",
        additionalHosts: ["api.example.com"],
        enableIngress: false,
      };
      const extension = createGondolinExtension(options);
      expect(typeof extension).toBe("function");
    });

    it("accepts empty options", () => {
      const extension = createGondolinExtension({});
      expect(typeof extension).toBe("function");
    });
  });

  describe("default export", () => {
    it("exports a default extension", () => {
      expect(typeof createGondolinExtension()).toBe("function");
    });
  });
});

describe("GondolinApiKeyConfig interface", () => {
  it("accepts provider and apiKey", () => {
    const config: GondolinApiKeyConfig = {
      provider: "anthropic",
      apiKey: "sk-ant-test123",
    };
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("sk-ant-test123");
  });

  it("accepts optional mode", () => {
    const config: GondolinApiKeyConfig = {
      provider: "openai",
      apiKey: "sk-test",
      mode: "env",
    };
    expect(config.mode).toBe("env");
  });
});

describe("__testing exports", () => {
  it("exports toGuestPath", () => {
    expect(__testing.toGuestPath).toBeDefined();
    expect(typeof __testing.toGuestPath).toBe("function");
  });

  it("exports shQuote", () => {
    expect(__testing.shQuote).toBeDefined();
    expect(typeof __testing.shQuote).toBe("function");
  });

  it("exports sanitizeEnv", () => {
    expect(__testing.sanitizeEnv).toBeDefined();
    expect(typeof __testing.sanitizeEnv).toBe("function");
  });
});
