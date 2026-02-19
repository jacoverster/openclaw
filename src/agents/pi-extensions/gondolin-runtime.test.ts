import { describe, expect, it, beforeEach } from "vitest";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import {
  setGondolinRuntime,
  getGondolinRuntime,
  clearGondolinRuntime,
  type GondolinRuntimeConfig,
} from "./gondolin-runtime.js";

// Mock SessionManager
const createMockSessionManager = (): SessionManager => {
  return {
    // Minimal mock - just enough for the test
  } as unknown as SessionManager;
};

describe("gondolin-runtime", () => {
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
  });

  describe("setGondolinRuntime / getGondolinRuntime", () => {
    it("should store and retrieve gondolin runtime config", () => {
      const config: GondolinRuntimeConfig = {
        workspaceDir: "/home/user/test-project",
        sessionLabel: "test-session",
        apiKeys: [
          { provider: "anthropic", apiKey: "sk-ant-test" },
        ],
        additionalHosts: ["api.example.com"],
        dnsMode: "synthetic",
        enableIngress: false,
      };

      setGondolinRuntime(mockSessionManager, config);
      const retrieved = getGondolinRuntime(mockSessionManager);

      expect(retrieved).toEqual(config);
    });

    it("should return null when no config is set", () => {
      const retrieved = getGondolinRuntime(mockSessionManager);
      expect(retrieved).toBeNull();
    });

    it("should overwrite existing config", () => {
      const config1: GondolinRuntimeConfig = {
        workspaceDir: "/path/one",
      };

      const config2: GondolinRuntimeConfig = {
        workspaceDir: "/path/two",
        apiKeys: [{ provider: "openai", apiKey: "sk-test" }],
      };

      setGondolinRuntime(mockSessionManager, config1);
      setGondolinRuntime(mockSessionManager, config2);

      const retrieved = getGondolinRuntime(mockSessionManager);
      expect(retrieved?.workspaceDir).toBe("/path/two");
      expect(retrieved?.apiKeys).toHaveLength(1);
    });

    it("should handle empty config", () => {
      const config: GondolinRuntimeConfig = {
        workspaceDir: "/workspace",
      };

      setGondolinRuntime(mockSessionManager, config);
      const retrieved = getGondolinRuntime(mockSessionManager);

      expect(retrieved?.workspaceDir).toBe("/workspace");
      expect(retrieved?.apiKeys).toBeUndefined();
    });
  });

  describe("clearGondolinRuntime", () => {
    it("should clear the stored config", () => {
      const config: GondolinRuntimeConfig = {
        workspaceDir: "/test",
      };

      setGondolinRuntime(mockSessionManager, config);
      clearGondolinRuntime(mockSessionManager);

      const retrieved = getGondolinRuntime(mockSessionManager);
      expect(retrieved).toBeNull();
    });
  });

  describe("session-scoped storage", () => {
    it("should store config separately for different session managers", () => {
      const mockSessionManager2 = createMockSessionManager();

      const config1: GondolinRuntimeConfig = {
        workspaceDir: "/workspace1",
      };

      const config2: GondolinRuntimeConfig = {
        workspaceDir: "/workspace2",
      };

      setGondolinRuntime(mockSessionManager, config1);
      setGondolinRuntime(mockSessionManager2, config2);

      expect(getGondolinRuntime(mockSessionManager)?.workspaceDir).toBe("/workspace1");
      expect(getGondolinRuntime(mockSessionManager2)?.workspaceDir).toBe("/workspace2");
    });

    it("should handle null session manager gracefully", () => {
      setGondolinRuntime(null as unknown as SessionManager, {
        workspaceDir: "/test",
      });

      const retrieved = getGondolinRuntime(null as unknown as SessionManager);
      expect(retrieved).toBeNull();
    });
  });
});
