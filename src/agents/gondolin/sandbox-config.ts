/**
 * Gondolin sandbox configuration for OpenClaw
 *
 * This module provides configuration helpers for integrating
 * Gondolin as a sandbox type in OpenClaw's sandbox system.
 */

import type {
  GondolinDNSMode,
  GondolinVFSMount,
  GondolinVMConfig,
} from "./types.js";

import {
  GONDOLIN_DNS_MODE_DEFAULT,
  GONDOLIN_VFS_DEFAULT_WORKSPACE_MODE,
  GONDOLIN_VFS_WORKSPACE_TARGET,
} from "./constants.js";

import { resolveAllowedHostsForProviders } from "./provider-hosts.js";

/**
 * Configuration for Gondolin sandbox in OpenClaw
 */
export interface GondolinSandboxConfig {
  /** Enable Gondolin sandbox */
  enabled: boolean;

  /** DNS resolution mode */
  dnsMode?: GondolinDNSMode;

  /** Custom DNS servers (for trusted mode) */
  dnsServers?: string[];

  /** Additional allowed hosts beyond model providers */
  allowedHosts?: string[];

  /** VM resource configuration */
  resources?: {
    /** Memory in MB */
    memoryMB?: number;
    /** Number of CPUs */
    cpus?: number;
  };

  /** Custom environment variables (non-secret) */
  env?: Record<string, string>;

  /** Custom VFS mounts */
  mounts?: GondolinVFSMount[];

  /** VM image to use (default: gondolin default) */
  image?: string;
}

/**
 * Create a full GondolinVMConfig from OpenClaw's sandbox config
 *
 * @param options Sandbox configuration options
 * @param workspaceDir Host path to workspace directory
 * @param providers List of model providers (for host allowlist)
 * @param secrets Secret configuration for injection
 * @returns Full VM configuration for Gondolin
 */
export function createGondolinSandboxConfig(
  options: GondolinSandboxConfig,
  workspaceDir: string,
  providers: string[],
  secrets?: Record<string, { hosts: string[]; value: string }>
): GondolinVMConfig {
  // Resolve allowed hosts from providers
  const providerHosts = resolveAllowedHostsForProviders(providers);
  const additionalHosts = options.allowedHosts || [];
  const allHosts = [...providerHosts, ...additionalHosts];

  // Build VFS mounts
  const mounts: GondolinVFSMount[] = [
    {
      source: workspaceDir,
      target: GONDOLIN_VFS_WORKSPACE_TARGET,
      mode: GONDOLIN_VFS_DEFAULT_WORKSPACE_MODE,
    },
  ];

  // Add custom mounts
  if (options.mounts) {
    mounts.push(...options.mounts);
  }

  // Build the VM config
  const config: GondolinVMConfig = {
    workspaceDir,
    mounts,
    network: {
      dnsMode: options.dnsMode || GONDOLIN_DNS_MODE_DEFAULT,
      dnsServers: options.dnsServers,
      allowedHosts: allHosts,
    },
    resources: options.resources,
    env: options.env,
    image: options.image,
  };

  // Add secrets if provided
  if (secrets) {
    config.http = {
      ...config.http,
      secrets,
    };
  }

  return config;
}

/**
 * Merge multiple sandbox configs
 */
export function mergeGondolinConfigs(
  base: GondolinSandboxConfig,
  override: Partial<GondolinSandboxConfig>
): GondolinSandboxConfig {
  return {
    enabled: override.enabled ?? base.enabled,
    dnsMode: override.dnsMode ?? base.dnsMode,
    dnsServers: override.dnsServers ?? base.dnsServers,
    allowedHosts: [
      ...(base.allowedHosts || []),
      ...(override.allowedHosts || []),
    ],
    resources: {
      ...base.resources,
      ...override.resources,
    },
    env: {
      ...base.env,
      ...override.env,
    },
    mounts: [
      ...(base.mounts || []),
      ...(override.mounts || []),
    ],
    image: override.image ?? base.image,
  };
}

/**
 * Validate Gondolin sandbox configuration
 */
export function validateGondolinConfig(
  config: GondolinSandboxConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.enabled) {
    // Validate DNS mode
    if (config.dnsMode && !["synthetic", "trusted", "open"].includes(config.dnsMode)) {
      errors.push(`Invalid dnsMode: ${config.dnsMode}`);
    }

    // Validate DNS servers for trusted mode
    if (config.dnsMode === "trusted" && (!config.dnsServers || config.dnsServers.length === 0)) {
      errors.push("dnsServers required when dnsMode is 'trusted'");
    }

    // Validate resources
    if (config.resources) {
      if (config.resources.memoryMB !== undefined && config.resources.memoryMB < 512) {
        errors.push("memoryMB must be at least 512MB");
      }
      if (config.resources.cpus !== undefined && config.resources.cpus < 1) {
        errors.push("cpus must be at least 1");
      }
    }

    // Validate mounts
    if (config.mounts) {
      for (const mount of config.mounts) {
        if (!mount.source) {
          errors.push("mount.source is required");
        }
        if (!mount.target) {
          errors.push("mount.target is required");
        }
        if (!["ro", "rw"].includes(mount.mode || "rw")) {
          errors.push(`Invalid mount mode: ${mount.mode}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
