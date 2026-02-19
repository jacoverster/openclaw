import { describe, expect, it } from "vitest";
import {
  createGondolinSandboxConfig,
  mergeGondolinConfigs,
  validateGondolinConfig,
  type GondolinSandboxConfig,
} from "./sandbox-config.js";

describe("sandbox-config", () => {
  describe("createGondolinSandboxConfig", () => {
    it("should create basic config with default values", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/home/user/workspace",
        []
      );

      expect(config.workspaceDir).toBe("/home/user/workspace");
      expect(config.mounts).toHaveLength(1);
      expect(config.mounts?.[0].target).toBe("/workspace");
      expect(config.mounts?.[0].mode).toBe("rw");
    });

    it("should include provider hosts in allowedHosts", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/home/user/workspace",
        ["anthropic", "openai"]
      );

      expect(config.network?.allowedHosts).toContain("api.anthropic.com");
      expect(config.network?.allowedHosts).toContain("api.openai.com");
    });

    it("should merge additional hosts with provider hosts", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true, allowedHosts: ["custom.api.example.com"] },
        "/home/user/workspace",
        ["anthropic"]
      );

      expect(config.network?.allowedHosts).toContain("api.anthropic.com");
      expect(config.network?.allowedHosts).toContain("custom.api.example.com");
    });

    it("should set dnsMode from options", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true, dnsMode: "trusted", dnsServers: ["8.8.8.8"] },
        "/home/user/workspace",
        []
      );

      expect(config.network?.dnsMode).toBe("trusted");
      expect(config.network?.dnsServers).toContain("8.8.8.8");
    });

    it("should include resources when specified", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true, resources: { memoryMB: 8192, cpus: 4 } },
        "/home/user/workspace",
        []
      );

      expect(config.resources?.memoryMB).toBe(8192);
      expect(config.resources?.cpus).toBe(4);
    });

    it("should include secrets when provided", () => {
      const secrets = {
        ANTHROPIC_API_KEY: {
          hosts: ["api.anthropic.com"],
          value: "sk-ant-test123",
        },
      };

      const config = createGondolinSandboxConfig(
        { enabled: true },
        "/home/user/workspace",
        [],
        secrets
      );

      expect(config.http?.secrets).toEqual(secrets);
    });

    it("should include custom mounts", () => {
      const config = createGondolinSandboxConfig(
        {
          enabled: true,
          mounts: [{ source: "/data", target: "/data", mode: "ro" }],
        },
        "/home/user/workspace",
        []
      );

      expect(config.mounts).toHaveLength(2); // workspace + custom
      expect(config.mounts).toContainEqual({
        source: "/data",
        target: "/data",
        mode: "ro",
      });
    });

    it("should include custom image", () => {
      const config = createGondolinSandboxConfig(
        { enabled: true, image: "custom-image:latest" },
        "/home/user/workspace",
        []
      );

      expect(config.image).toBe("custom-image:latest");
    });
  });

  describe("mergeGondolinConfigs", () => {
    it("should merge enabled flag (override wins)", () => {
      const base: GondolinSandboxConfig = { enabled: false };
      const override: Partial<GondolinSandboxConfig> = { enabled: true };

      const result = mergeGondolinConfigs(base, override);
      expect(result.enabled).toBe(true);
    });

    it("should merge dnsMode (override wins)", () => {
      const base: GondolinSandboxConfig = { enabled: true, dnsMode: "synthetic" };
      const override: Partial<GondolinSandboxConfig> = { dnsMode: "trusted" };

      const result = mergeGondolinConfigs(base, override);
      expect(result.dnsMode).toBe("trusted");
    });

    it("should concatenate allowedHosts arrays", () => {
      const base: GondolinSandboxConfig = {
        enabled: true,
        allowedHosts: ["host1.example.com"],
      };
      const override: Partial<GondolinSandboxConfig> = {
        allowedHosts: ["host2.example.com"],
      };

      const result = mergeGondolinConfigs(base, override);
      expect(result.allowedHosts).toContain("host1.example.com");
      expect(result.allowedHosts).toContain("host2.example.com");
    });

    it("should merge resources (shallow merge)", () => {
      const base: GondolinSandboxConfig = {
        enabled: true,
        resources: { memoryMB: 4096, cpus: 2 },
      };
      const override: Partial<GondolinSandboxConfig> = {
        resources: { cpus: 4 },
      };

      const result = mergeGondolinConfigs(base, override);
      expect(result.resources?.memoryMB).toBe(4096);
      expect(result.resources?.cpus).toBe(4);
    });

    it("should merge env (shallow merge)", () => {
      const base: GondolinSandboxConfig = {
        enabled: true,
        env: { VAR1: "value1" },
      };
      const override: Partial<GondolinSandboxConfig> = {
        env: { VAR2: "value2" },
      };

      const result = mergeGondolinConfigs(base, override);
      expect(result.env?.VAR1).toBe("value1");
      expect(result.env?.VAR2).toBe("value2");
    });

    it("should concatenate mounts arrays", () => {
      const base: GondolinSandboxConfig = {
        enabled: true,
        mounts: [{ source: "/a", target: "/a", mode: "rw" }],
      };
      const override: Partial<GondolinSandboxConfig> = {
        mounts: [{ source: "/b", target: "/b", mode: "ro" }],
      };

      const result = mergeGondolinConfigs(base, override);
      expect(result.mounts).toHaveLength(2);
    });

    it("should use base values when override is undefined", () => {
      const base: GondolinSandboxConfig = {
        enabled: true,
        dnsMode: "synthetic",
        image: "base-image:latest",
      };
      const override: Partial<GondolinSandboxConfig> = {};

      const result = mergeGondolinConfigs(base, override);
      expect(result.dnsMode).toBe("synthetic");
      expect(result.image).toBe("base-image:latest");
    });
  });

  describe("validateGondolinConfig", () => {
    it("should return valid for empty config when disabled", () => {
      const result = validateGondolinConfig({ enabled: false });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return error for invalid dnsMode", () => {
      const result = validateGondolinConfig({
        enabled: true,
        dnsMode: "invalid" as "synthetic",
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid dnsMode: invalid");
    });

    it("should return error for trusted mode without dnsServers", () => {
      const result = validateGondolinConfig({
        enabled: true,
        dnsMode: "trusted",
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("dnsServers required when dnsMode is 'trusted'");
    });

    it("should return error for memory below minimum", () => {
      const result = validateGondolinConfig({
        enabled: true,
        resources: { memoryMB: 256 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("memoryMB must be at least 512MB");
    });

    it("should return error for cpus below minimum", () => {
      const result = validateGondolinConfig({
        enabled: true,
        resources: { cpus: 0 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("cpus must be at least 1");
    });

    it("should return error for mount without source", () => {
      const result = validateGondolinConfig({
        enabled: true,
        mounts: [{ source: "", target: "/test", mode: "rw" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("mount.source is required");
    });

    it("should return error for mount without target", () => {
      const result = validateGondolinConfig({
        enabled: true,
        mounts: [{ source: "/test", target: "", mode: "rw" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("mount.target is required");
    });

    it("should return error for invalid mount mode", () => {
      const result = validateGondolinConfig({
        enabled: true,
        mounts: [{ source: "/test", target: "/test", mode: "invalid" as "ro" | "rw" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid mount mode: invalid");
    });

    it("should pass for valid config", () => {
      const result = validateGondolinConfig({
        enabled: true,
        dnsMode: "synthetic",
        resources: { memoryMB: 4096, cpus: 2 },
        mounts: [{ source: "/data", target: "/data", mode: "rw" }],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass for trusted mode with dnsServers", () => {
      const result = validateGondolinConfig({
        enabled: true,
        dnsMode: "trusted",
        dnsServers: ["8.8.8.8", "1.1.1.1"],
      });
      expect(result.valid).toBe(true);
    });
  });
});
