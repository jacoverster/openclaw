import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_HOSTS,
  resolveAllowedHostsForProvider,
  resolveAllowedHostsForProviders,
  getDefaultAllowedHosts,
} from "./provider-hosts.js";

describe("provider-hosts", () => {
  describe("DEFAULT_PROVIDER_HOSTS", () => {
    it("should include anthropic provider", () => {
      expect(DEFAULT_PROVIDER_HOSTS.anthropic).toContain("api.anthropic.com");
    });

    it("should include openai provider", () => {
      expect(DEFAULT_PROVIDER_HOSTS.openai).toContain("api.openai.com");
    });

    it("should include google/gemini providers", () => {
      expect(DEFAULT_PROVIDER_HOSTS.google).toContain("generativelanguage.googleapis.com");
      expect(DEFAULT_PROVIDER_HOSTS.gemini).toContain("generativelanguage.googleapis.com");
    });

    it("should include ollama provider with localhost", () => {
      expect(DEFAULT_PROVIDER_HOSTS.ollama).toContain("localhost:11434");
    });
  });

  describe("resolveAllowedHostsForProvider", () => {
    it("should return exact match for known provider", () => {
      const hosts = resolveAllowedHostsForProvider("anthropic");
      expect(hosts).toContain("api.anthropic.com");
    });

    it("should return hosts for case-insensitive provider", () => {
      const hosts = resolveAllowedHostsForProvider("ANTHROPIC");
      expect(hosts).toContain("api.anthropic.com");
    });

    it("should return empty array for unknown provider", () => {
      const hosts = resolveAllowedHostsForProvider("unknown-provider");
      expect(hosts).toEqual([]);
    });

    it("should handle azure-openai with wildcard", () => {
      const hosts = resolveAllowedHostsForProvider("azure-openai");
      expect(hosts).toContain("*.openai.azure.com");
    });

    it("should handle ollama variations", () => {
      const hosts = resolveAllowedHostsForProvider("ollama");
      expect(hosts).toContain("localhost:11434");
      expect(hosts).toContain("127.0.0.1:11434");
    });

    it("should handle bedrock with AWS wildcard", () => {
      const hosts = resolveAllowedHostsForProvider("bedrock");
      expect(hosts).toContain("*.bedrock.amazonaws.com");
    });
  });

  describe("resolveAllowedHostsForProviders", () => {
    it("should deduplicate hosts from multiple providers", () => {
      const hosts = resolveAllowedHostsForProviders(["anthropic", "openai", "anthropic"]);
      expect(hosts).toContain("api.anthropic.com");
      expect(hosts).toContain("api.openai.com");
      // Should not have duplicates
      const anthropicCount = hosts.filter((h) => h === "api.anthropic.com").length;
      expect(anthropicCount).toBe(1);
    });

    it("should handle empty array", () => {
      const hosts = resolveAllowedHostsForProviders([]);
      expect(hosts).toEqual([]);
    });

    it("should combine hosts from multiple providers", () => {
      const hosts = resolveAllowedHostsForProviders(["anthropic", "github", "google"]);
      expect(hosts).toContain("api.anthropic.com");
      expect(hosts).toContain("api.github.com");
      expect(hosts).toContain("generativelanguage.googleapis.com");
    });

    it("should handle mixed known and unknown providers", () => {
      const hosts = resolveAllowedHostsForProviders(["anthropic", "unknown"]);
      expect(hosts).toContain("api.anthropic.com");
      expect(hosts.length).toBeGreaterThan(0);
    });
  });

  describe("getDefaultAllowedHosts", () => {
    it("should return localhost entries", () => {
      const hosts = getDefaultAllowedHosts();
      expect(hosts).toContain("localhost:*");
      expect(hosts).toContain("127.0.0.1:*");
    });
  });
});
