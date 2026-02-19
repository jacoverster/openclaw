/**
 * Tests for sandbox context behavior when Gondolin is enabled.
 *
 * These tests validate that the sandbox config correctly resolves
 * Gondolin settings and that the Gondolin config is properly
 * integrated into the sandbox pipeline.
 *
 */

import { describe, expect, it } from "vitest";
import { resolveSandboxGondolinConfig } from "../sandbox/config.js";
import type { SandboxGondolinConfig } from "../sandbox/types.js";
import {
  createGondolinSandboxConfig,
  validateGondolinConfig,
  mergeGondolinConfigs,
  type GondolinSandboxConfig,
} from "./sandbox-config.js";
import { resolveAllowedHostsForProviders } from "./provider-hosts.js";
import {
  GONDOLIN_VFS_WORKSPACE_TARGET,
  GONDOLIN_DNS_MODE_DEFAULT,
  GONDOLIN_VFS_DEFAULT_WORKSPACE_MODE,
} from "./constants.js";

describe("sandbox context with Gondolin enabled", () => {
  describe("resolveSandboxGondolinConfig", () => {
    it("should default to disabled when no config provided", () => {
      const config = resolveSandboxGondolinConfig({});
      expect(config.enabled).toBe(false);
    });

    it("should enable gondolin from global config", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true },
      });
      expect(config.enabled).toBe(true);
    });

    it("should let agent config override global config", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: false },
        agentGondolin: { enabled: true },
      });
      expect(config.enabled).toBe(true);
    });

    it("should resolve default memory and cpus", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true },
      });
      expect(config.memoryMb).toBe(4096);
      expect(config.cpus).toBe(2);
    });

    it("should resolve custom memory and cpus from agent config", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true, memoryMb: 2048 },
        agentGondolin: { memoryMb: 8192, cpus: 4 },
      });
      expect(config.memoryMb).toBe(8192);
      expect(config.cpus).toBe(4);
    });

    it("should default dnsMode to synthetic (GON-03)", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true },
      });
      expect(config.dnsMode).toBe("synthetic");
    });

    it("should resolve trusted dnsMode", () => {
      const config = resolveSandboxGondolinConfig({
        agentGondolin: { enabled: true, dnsMode: "trusted" },
      });
      expect(config.dnsMode).toBe("trusted");
    });

    it("should resolve open dnsMode", () => {
      const config = resolveSandboxGondolinConfig({
        agentGondolin: { enabled: true, dnsMode: "open" },
      });
      expect(config.dnsMode).toBe("open");
    });

    it("should default workspaceMode to rw (GON-04)", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true },
      });
      expect(config.workspaceMode).toBe("rw");
    });

    it("should resolve ro workspaceMode", () => {
      const config = resolveSandboxGondolinConfig({
        agentGondolin: { enabled: true, workspaceMode: "ro" },
      });
      expect(config.workspaceMode).toBe("ro");
    });

    it("should default enableIngress to false (GON-06)", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true },
      });
      expect(config.enableIngress).toBe(false);
    });

    it("should resolve enableIngress from agent config", () => {
      const config = resolveSandboxGondolinConfig({
        agentGondolin: { enabled: true, enableIngress: true },
      });
      expect(config.enableIngress).toBe(true);
    });

    it("should resolve additionalHosts from agent config", () => {
      const config = resolveSandboxGondolinConfig({
        agentGondolin: {
          enabled: true,
          additionalHosts: ["custom.api.example.com"],
        },
      });
      expect(config.additionalHosts).toContain("custom.api.example.com");
    });

    it("should default additionalHosts to empty array", () => {
      const config = resolveSandboxGondolinConfig({
        globalGondolin: { enabled: true },
      });
      expect(config.additionalHosts).toEqual([]);
    });
  });

  describe("Gondolin sandbox config creation (GON-01)", () => {
    it("should create config with workspace mount at /workspace", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/home/user/workspace",
        []
      );

      expect(config.mounts).toBeDefined();
      expect(config.mounts?.length).toBeGreaterThanOrEqual(1);
      const workspaceMount = config.mounts?.find(
        (m) => m.target === GONDOLIN_VFS_WORKSPACE_TARGET
      );
      expect(workspaceMount).toBeDefined();
      expect(workspaceMount?.source).toBe("/home/user/workspace");
      expect(workspaceMount?.mode).toBe(GONDOLIN_VFS_DEFAULT_WORKSPACE_MODE);
    });

    it("should set default DNS mode to synthetic", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/workspace",
        []
      );

      expect(config.network?.dnsMode).toBe(GONDOLIN_DNS_MODE_DEFAULT);
    });

    it("should include provider hosts in network allowlist (GON-03)", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/workspace",
        ["anthropic", "openai"]
      );

      expect(config.network?.allowedHosts).toContain("api.anthropic.com");
      expect(config.network?.allowedHosts).toContain("api.openai.com");
    });

    it("should include secrets for API key injection (GON-05)", () => {
      const secrets = {
        ANTHROPIC_API_KEY: {
          hosts: ["api.anthropic.com"],
          value: "sk-ant-test123",
        },
        OPENAI_API_KEY: {
          hosts: ["api.openai.com"],
          value: "sk-test456",
        },
      };

      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/workspace",
        ["anthropic", "openai"],
        secrets
      );

      expect(config.http?.secrets).toBeDefined();
      expect(config.http?.secrets?.ANTHROPIC_API_KEY.value).toBe("sk-ant-test123");
      expect(config.http?.secrets?.OPENAI_API_KEY.value).toBe("sk-test456");
    });
  });

  describe("Gondolin network isolation (GON-03)", () => {
    it("should resolve allowed hosts for synthetic mode", () => {
      const hosts = resolveAllowedHostsForProviders(["anthropic"]);
      expect(hosts).toContain("api.anthropic.com");
      // Should NOT contain hosts from other providers
      expect(hosts).not.toContain("api.openai.com");
    });

    it("should resolve allowed hosts for multiple providers", () => {
      const hosts = resolveAllowedHostsForProviders([
        "anthropic",
        "openai",
        "google",
      ]);
      expect(hosts).toContain("api.anthropic.com");
      expect(hosts).toContain("api.openai.com");
      expect(hosts).toContain("generativelanguage.googleapis.com");
    });

    it("should deduplicate hosts", () => {
      const hosts = resolveAllowedHostsForProviders([
        "anthropic",
        "anthropic",
      ]);
      const count = hosts.filter((h) => h === "api.anthropic.com").length;
      expect(count).toBe(1);
    });

    it("should validate trusted mode requires DNS servers", () => {
      const result = validateGondolinConfig({
        enabled: true,
        dnsMode: "trusted",
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "dnsServers required when dnsMode is 'trusted'"
      );
    });

    it("should validate trusted mode with DNS servers passes", () => {
      const result = validateGondolinConfig({
        enabled: true,
        dnsMode: "trusted",
        dnsServers: ["8.8.8.8"],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("Gondolin VFS mounts (GON-04)", () => {
    it("should mount workspace at /workspace by default", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/home/user/project",
        []
      );

      const wsMount = config.mounts?.find(
        (m) => m.target === "/workspace"
      );
      expect(wsMount).toBeDefined();
      expect(wsMount?.source).toBe("/home/user/project");
    });

    it("should support additional custom mounts", () => {
      const config = createGondolinSandboxConfig(
        {
          enabled: true,
          mounts: [
            { source: "/data/models", target: "/models", mode: "ro" },
          ],
        },
        "/workspace",
        []
      );

      expect(config.mounts).toHaveLength(2);
      const customMount = config.mounts?.find((m) => m.target === "/models");
      expect(customMount).toBeDefined();
      expect(customMount?.mode).toBe("ro");
    });

    it("should validate mount source is required", () => {
      const result = validateGondolinConfig({
        enabled: true,
        mounts: [{ source: "", target: "/test", mode: "rw" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("mount.source is required");
    });

    it("should validate mount target is required", () => {
      const result = validateGondolinConfig({
        enabled: true,
        mounts: [{ source: "/test", target: "", mode: "rw" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("mount.target is required");
    });
  });

  describe("Gondolin secrets injection (GON-05)", () => {
    it("should include secrets in config when provided", () => {
      const secrets = {
        ANTHROPIC_API_KEY: {
          hosts: ["api.anthropic.com"],
          value: "sk-ant-test",
        },
      };

      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/workspace",
        [],
        secrets
      );

      expect(config.http?.secrets).toEqual(secrets);
    });

    it("should not include http.secrets when no secrets provided", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/workspace",
        []
      );

      expect(config.http?.secrets).toBeUndefined();
    });

    it("should merge additional hosts with provider hosts for secrets", () => {
      const config = createGondolinSandboxConfig(
        {
          enabled: true,
          allowedHosts: ["custom.api.example.com"],
        },
        "/workspace",
        ["anthropic"],
        {
          ANTHROPIC_API_KEY: {
            hosts: ["api.anthropic.com"],
            value: "sk-ant-test",
          },
        }
      );

      expect(config.network?.allowedHosts).toContain("api.anthropic.com");
      expect(config.network?.allowedHosts).toContain(
        "custom.api.example.com"
      );
    });
  });

  describe("Gondolin config merge", () => {
    it("should merge base and override configs", () => {
      const base: GondolinSandboxConfig = {
        enabled: false,
        dnsMode: "synthetic",
        resources: { memoryMB: 4096, cpus: 2 },
      };

      const override: Partial<GondolinSandboxConfig> = {
        enabled: true,
        resources: { cpus: 4 },
      };

      const merged = mergeGondolinConfigs(base, override);
      expect(merged.enabled).toBe(true);
      expect(merged.dnsMode).toBe("synthetic");
      expect(merged.resources?.memoryMB).toBe(4096);
      expect(merged.resources?.cpus).toBe(4);
    });

    it("should concatenate allowedHosts from both configs", () => {
      const base: GondolinSandboxConfig = {
        enabled: true,
        allowedHosts: ["host1.example.com"],
      };

      const override: Partial<GondolinSandboxConfig> = {
        allowedHosts: ["host2.example.com"],
      };

      const merged = mergeGondolinConfigs(base, override);
      expect(merged.allowedHosts).toContain("host1.example.com");
      expect(merged.allowedHosts).toContain("host2.example.com");
    });
  });

  describe("SandboxGondolinConfig type shape", () => {
    it("should have all required fields", () => {
      const config: SandboxGondolinConfig = {
        enabled: true,
        memoryMb: 4096,
        cpus: 2,
        dnsMode: "synthetic",
        additionalHosts: [],
        workspaceMode: "rw",
        enableIngress: false,
      };

      expect(config.enabled).toBe(true);
      expect(config.memoryMb).toBe(4096);
      expect(config.cpus).toBe(2);
      expect(config.dnsMode).toBe("synthetic");
      expect(config.additionalHosts).toEqual([]);
      expect(config.workspaceMode).toBe("rw");
      expect(config.enableIngress).toBe(false);
    });

    it("should allow optional fields to be undefined", () => {
      const config: SandboxGondolinConfig = {
        enabled: false,
      };

      expect(config.enabled).toBe(false);
      expect(config.memoryMb).toBeUndefined();
      expect(config.cpus).toBeUndefined();
      expect(config.dnsMode).toBeUndefined();
    });
  });
});
