/**
 * Tests for sandbox context Docker bypass when Gondolin is enabled.
 *
 * These tests verify that when Gondolin is enabled in the sandbox config,
 * the Docker container creation is skipped.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as runtimeStatusModule from "./runtime-status.js";

// Mock the entire module
vi.mock("./runtime-status.js", () => ({
  resolveSandboxRuntimeStatus: vi.fn().mockReturnValue({
    agentId: "test-agent",
    sessionKey: "session:test",
    mainSessionKey: "main",
    mode: "all",
    sandboxed: true,
    toolPolicy: { allow: ["*"], deny: [], sources: { allow: [], deny: [] } },
  }),
}));

vi.mock("./docker.js", () => ({
  ensureSandboxContainer: vi.fn().mockResolvedValue("mock-container"),
}));

vi.mock("./browser.js", () => ({
  ensureSandboxBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./fs-bridge.js", () => ({
  createSandboxFsBridge: vi.fn().mockReturnValue({}),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(),
  STATE_DIR: "/tmp/test-state",
}));

vi.mock("../../browser/control-auth.js", () => ({
  resolveBrowserControlAuth: vi.fn().mockReturnValue({}),
  ensureBrowserControlAuth: vi.fn().mockResolvedValue({ auth: {} }),
}));

vi.mock("./prune.js", () => ({
  maybePruneSandboxes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./workspace.js", () => ({
  ensureSandboxWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../skills.js", () => ({
  syncSkillsToWorkspace: vi.fn().mockResolvedValue(undefined),
}));

describe("resolveSandboxContext with Gondolin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip Docker container creation when Gondolin is enabled", async () => {
    // Import after mocks are set up
    const { resolveSandboxContext } = await import("./context.js");

    // Call with Gondolin enabled
    const result = await resolveSandboxContext({
      config: {
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
      },
      sessionKey: "session:test",
    });

    // Verify result
    expect(result).toBeDefined();
    expect(result?.enabled).toBe(true);
    expect(result?.gondolin).toBeDefined();
    expect(result?.gondolin?.enabled).toBe(true);

    // The (no Docker)
    expect(result?.containerName).toBe("");
    expect(result?.containerWorkdir).toBe("/workspace");
  });

  it("should still create Docker container when Gondolin is disabled", async () => {
    // Import after mocks are set up
    const { resolveSandboxContext } = await import("./context.js");
    const { ensureSandboxContainer } = await import("./docker.js");

    // Call with Gondolin disabled
    const result = await resolveSandboxContext({
      config: {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: false,
              },
            },
          },
        },
      },
      sessionKey: "session:test",
    });

    // Verify Docker container was created
    expect(ensureSandboxContainer).toHaveBeenCalled();
    expect(result?.containerName).toBe("mock-container");
    expect(result?.gondolin).toBeUndefined();
  });

  it("should include gondolin config in context when enabled", async () => {
    const { resolveSandboxContext } = await import("./context.js");

    const result = await resolveSandboxContext({
      config: {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              gondolin: {
                enabled: true,
                memoryMb: 8192,
                cpus: 4,
                dnsMode: "synthetic",
              },
            },
          },
        },
      },
      sessionKey: "session:test",
    });

    expect(result?.gondolin).toEqual({
      enabled: true,
      memoryMb: 8192,
      cpus: 4,
      dnsMode: "synthetic",
      additionalHosts: [],
      enableIngress: false,
      workspaceMode: "rw",
    });
  });

  it("should use default Gondolin settings when not specified", async () => {
    const { resolveSandboxContext } = await import("./context.js");

    // Call with minimal config - Gondolin defaults to disabled
    const result = await resolveSandboxContext({
      config: {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              // No gondolin config - should default to disabled
            },
          },
        },
      },
      sessionKey: "session:test",
    });

    // With no gondolin config, Docker should be used
    const { ensureSandboxContainer } = await import("./docker.js");
    expect(ensureSandboxContainer).toHaveBeenCalled();
  });
});
