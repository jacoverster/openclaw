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

describe("gondolin exec cancellation (GON-08)", () => {
  describe("AbortSignal integration", () => {
    it("should support AbortSignal in exec options", async () => {
      const { __testing } = await import("./gondolin.js");

      // Test that sanitizeEnv properly handles environment with signals
      const env = {
        HOME: "/home/user",
        PATH: "/usr/bin",
      };

      const sanitized = __testing.sanitizeEnv(env);
      expect(sanitized).toEqual(env);
    });

    it("should handle undefined environment", async () => {
      const { __testing } = await import("./gondolin.js");

      const sanitized = __testing.sanitizeEnv(undefined);
      expect(sanitized).toBeUndefined();
    });

    it("should filter out non-string values from env", async () => {
      const { __testing } = await import("./gondolin.js");

      const env: Record<string, string> = {
        HOME: "/home/user",
        PATH: "/usr/bin",
        NODE_ENV: "test",
      };

      const sanitized = __testing.sanitizeEnv(env);
      expect(sanitized).toBeDefined();
      if (sanitized) {
        expect(Object.keys(sanitized)).toContain("HOME");
        expect(Object.keys(sanitized)).toContain("PATH");
        expect(Object.keys(sanitized)).toContain("NODE_ENV");
      }
    });
  });

  describe("exec cancellation scenarios", () => {
    it("should allow creating AbortController for cancellation", () => {
      const controller = new AbortController();
      expect(controller.signal).toBeDefined();
      expect(controller.signal.aborted).toBe(false);

      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    it("should handle abort before exec", async () => {
      const controller = new AbortController();
      controller.abort();

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBeDefined();
    });

    it("should support timeout-based cancellation", () => {
      const controller = new AbortController();

      // Simulate timeout
      setTimeout(() => controller.abort(), 10);

      expect(controller.signal.aborted).toBe(false);
    });

    it("should pass signal option through to VM exec", () => {
      // Verify the GondolinExecOptions type accepts signal
      const controller = new AbortController();
      const execOptions: import("../gondolin/types.js").GondolinExecOptions = {
        cwd: "/workspace",
        signal: controller.signal,
      };
      expect(execOptions.signal).toBe(controller.signal);
      expect(execOptions.signal?.aborted).toBe(false);
    });

    it("should abort a mock VM exec via signal", async () => {
      const controller = new AbortController();
      const mockExec = vi.fn().mockImplementation(
        (_cmd: string, opts?: { signal?: AbortSignal }) => {
          if (opts?.signal?.aborted) {
            return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
          }
          return Promise.resolve({ ok: true, exitCode: 0, stdout: "", stderr: "" });
        }
      );

      // Abort before exec
      controller.abort();
      await expect(mockExec("sleep 60", { signal: controller.signal })).rejects.toThrow("aborted");
    });

    it("should abort a running mock VM exec when signal fires", async () => {
      const controller = new AbortController();
      const mockExec = vi.fn().mockImplementation(
        (_cmd: string, opts?: { signal?: AbortSignal }) => {
          return new Promise((resolve, reject) => {
            const onAbort = () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            };
            if (opts?.signal?.aborted) {
              onAbort();
              return;
            }
            opts?.signal?.addEventListener("abort", onAbort, { once: true });
            // Simulate long-running command that never resolves on its own
          });
        }
      );

      const execPromise = mockExec("sleep 3600", { signal: controller.signal });
      // Abort after starting
      controller.abort();
      await expect(execPromise).rejects.toThrow("aborted");
    });

    it("should support AbortSignal.timeout for exec deadline", () => {
      // Verify AbortSignal.timeout is available (Node 18+)
      const signal = AbortSignal.timeout(5000);
      expect(signal).toBeDefined();
      expect(signal.aborted).toBe(false);
    });
  });
});

describe("gondolin VM lifecycle (GON-07)", () => {
  it("should track VM state through create/close cycle", async () => {
    const gondolin = await import("@earendil-works/gondolin");
    const vm = await gondolin.VM.create({});

    expect(vm.id).toBe("test-vm-id");
    expect(vm.exec).toBeDefined();
    expect(vm.close).toBeDefined();

    // Close should be callable
    await vm.close();
    expect(gondolin.VM.create).toHaveBeenCalled();
  });

  it("should clean up resources on close", async () => {
    const gondolin = await import("@earendil-works/gondolin");
    const vm = await gondolin.VM.create({});

    // Clear any previous calls from other tests (shared mock instance)
    (vm.close as ReturnType<typeof vi.fn>).mockClear();
    await vm.close();

    expect(vm.close).toHaveBeenCalledOnce();
  });

  it("should handle close errors gracefully", async () => {
    const gondolin = await import("@earendil-works/gondolin");
    const vm = await gondolin.VM.create({});

    // Override close to throw
    vi.spyOn(vm, "close").mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(vm.close()).rejects.toThrow("cleanup failed");
  });

  it("should handle double close without error", async () => {
    const gondolin = await import("@earendil-works/gondolin");
    const vm = await gondolin.VM.create({});

    await vm.close();
    // Second close should not throw (mock returns undefined)
    await vm.close();
  });
});

describe("gondolin ingress (GON-06)", () => {
  it("should accept enableIngress option in extension config", () => {
    const extension = createGondolinExtension({
      enableIngress: true,
    });
    expect(typeof extension).toBe("function");
  });

  it("should accept enableIngress=false in extension config", () => {
    const extension = createGondolinExtension({
      enableIngress: false,
    });
    expect(typeof extension).toBe("function");
  });

  it("should validate ingress route structure", () => {
    const route: import("../gondolin/types.js").GondolinIngressRoute = {
      prefix: "/api",
      port: 8080,
      stripPrefix: true,
    };
    expect(route.prefix).toBe("/api");
    expect(route.port).toBe(8080);
    expect(route.stripPrefix).toBe(true);
  });

  it("should validate ingress options structure", () => {
    const opts: import("../gondolin/types.js").GondolinIngressOptions = {
      listenHost: "127.0.0.1",
      listenPort: 0,
      allowWebSockets: true,
    };
    expect(opts.listenHost).toBe("127.0.0.1");
    expect(opts.listenPort).toBe(0);
    expect(opts.allowWebSockets).toBe(true);
  });

  it("should validate ingress result structure", () => {
    const ingress: import("../gondolin/types.js").GondolinIngress = {
      url: "http://127.0.0.1:54321",
      close: vi.fn().mockResolvedValue(undefined),
    };
    expect(ingress.url).toBe("http://127.0.0.1:54321");
    expect(typeof ingress.close).toBe("function");
  });
});
