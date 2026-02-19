import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../config/config.js";
import { buildEmbeddedExtensionPaths } from "./extensions.js";
import { setGondolinRuntime } from "../pi-extensions/gondolin-runtime.js";

// Mock dependencies
vi.mock("../sandbox/config.js", () => ({
  resolveSandboxConfigForAgent: vi.fn((_cfg: unknown, _modelId: string) => {
    return {
      gondolin: { enabled: false },
    };
  }),
}));

vi.mock("../gondolin/provider-hosts.js", () => ({
  resolveAllowedHostsForProviders: vi.fn((providers: string[]) => {
    // Return mock hosts based on provider
    const hosts: Record<string, string[]> = {
      anthropic: ["api.anthropic.com"],
      openai: ["api.openai.com"],
    };
    return providers.flatMap((p) => hosts[p] ?? []);
  }),
}));

vi.mock("../pi-extensions/gondolin-runtime.js", () => ({
  setGondolinRuntime: vi.fn(),
  getGondolinRuntime: vi.fn(),
  clearGondolinRuntime: vi.fn(),
}));

// Mock SessionManager
const createMockSessionManager = (): SessionManager => {
  return {
    // Minimal mock - just enough for the test
  } as unknown as SessionManager;
};

describe("buildEmbeddedExtensionPaths", () => {
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager = createMockSessionManager();
  });

  describe("gondolin integration", () => {
    it("should not include gondolin extension when disabled", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            sandbox: {
              mode: "off",
              gondolin: {
                enabled: false,
              },
            },
          },
        },
      } as OpenClawConfig;

      const paths = buildEmbeddedExtensionPaths({
        cfg,
        sessionManager: mockSessionManager,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        model: undefined,
        workspaceDir: "/tmp/test-workspace",
        modelRegistry: null,
      });

      expect(paths).not.toContain(expect.stringContaining("gondolin"));
    });

    it("should include gondolin extension when enabled", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: true,
                dnsMode: "synthetic",
              },
            },
          },
        },
      } as OpenClawConfig;

      const paths = buildEmbeddedExtensionPaths({
        cfg,
        sessionManager: mockSessionManager,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        model: undefined,
        workspaceDir: "/tmp/test-workspace",
        modelRegistry: null,
      });

      expect(paths).toContain(expect.stringContaining("gondolin"));
    });

    it("should set runtime config when gondolin is enabled", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: true,
                dnsMode: "trusted",
                enableIngress: true,
                additionalHosts: ["custom.example.com"],
              },
            },
          },
        },
      } as OpenClawConfig;

      buildEmbeddedExtensionPaths({
        cfg,
        sessionManager: mockSessionManager,
        provider: "openai",
        modelId: "gpt-4o",
        model: undefined,
        workspaceDir: "/tmp/test-workspace",
        modelRegistry: null,
      });

      expect(setGondolinRuntime).toHaveBeenCalledWith(
        mockSessionManager,
        expect.objectContaining({
          workspaceDir: "/tmp/test-workspace",
          dnsMode: "trusted",
          enableIngress: true,
          additionalHosts: expect.arrayContaining(["api.openai.com", "custom.example.com"]),
        })
      );
    });

    it("should include api keys from model registry when available", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: true,
              },
            },
          },
        },
      } as OpenClawConfig;

      // Create mock model registry with getApiKey
      const mockModelRegistry = {
        getApiKey: vi.fn((provider: string) => {
          if (provider === "anthropic") {
            return "sk-ant-test-key";
          }
          return null;
        }),
      };

      buildEmbeddedExtensionPaths({
        cfg,
        sessionManager: mockSessionManager,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        model: undefined,
        workspaceDir: "/tmp/test-workspace",
        modelRegistry: mockModelRegistry,
      });

      expect(setGondolinRuntime).toHaveBeenCalledWith(
        mockSessionManager,
        expect.objectContaining({
          apiKeys: expect.arrayContaining([
            expect.objectContaining({
              provider: "anthropic",
              apiKey: "sk-ant-test-key",
            }),
          ]),
        })
      );
    });

    it("should handle missing model registry gracefully", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: true,
              },
            },
          },
        },
      } as OpenClawConfig;

      // Should not throw when modelRegistry is null/undefined
      expect(() => {
        buildEmbeddedExtensionPaths({
          cfg,
          sessionManager: mockSessionManager,
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
          model: undefined,
          workspaceDir: "/tmp/test-workspace",
          modelRegistry: null,
        });
      }).not.toThrow();

      // Should still set runtime config with empty apiKeys
      expect(setGondolinRuntime).toHaveBeenCalledWith(
        mockSessionManager,
        expect.objectContaining({
          apiKeys: [],
        })
      );
    });

    it("should use workspace dir in runtime config", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: true,
              },
            },
          },
        },
      } as OpenClawConfig;

      buildEmbeddedExtensionPaths({
        cfg,
        sessionManager: mockSessionManager,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        model: undefined,
        workspaceDir: "/home/user/my-project",
        modelRegistry: null,
      });

      expect(setGondolinRuntime).toHaveBeenCalledWith(
        mockSessionManager,
        expect.objectContaining({
          workspaceDir: "/home/user/my-project",
        })
      );
    });
  });
});
