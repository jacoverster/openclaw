/**
 * Gondolin runtime settings registry
 *
 * Stores gondolin configuration that the extension reads when activated.
 * This allows passing configuration from the agent runtime to the extension
 * without requiring options at extension load time.
 */

import { createSessionManagerRuntimeRegistry } from "./session-manager-runtime-registry.js";

/**
 * Runtime configuration for Gondolin VM
 */
export interface GondolinRuntimeConfig {
  /** Workspace directory to mount in the VM */
  workspaceDir: string;
  /** Session label for VM identification */
  sessionLabel?: string;
  /** API keys for secret injection */
  apiKeys?: Array<{
    provider: string;
    apiKey: string;
    mode?: string;
  }>;
  /** Additional allowed hosts beyond defaults */
  additionalHosts?: string[];
  /** DNS mode: synthetic | trusted | open */
  dnsMode?: "synthetic" | "trusted" | "open";
  /** Enable ingress for exposing guest services */
  enableIngress?: boolean;
}

/**
 * Registry for gondolin runtime configuration
 * Keyed by SessionManager instance
 */
const gondolinRuntimeRegistry = createSessionManagerRuntimeRegistry<GondolinRuntimeConfig>();

/**
 * Set gondolin runtime configuration for a session
 */
export function setGondolinRuntime(
  sessionManager: unknown,
  config: GondolinRuntimeConfig
): void {
  gondolinRuntimeRegistry.set(sessionManager, config);
}

/**
 * Get gondolin runtime configuration for a session
 */
export function getGondolinRuntime(
  sessionManager: unknown
): GondolinRuntimeConfig | null {
  return gondolinRuntimeRegistry.get(sessionManager);
}

/**
 * Clear gondolin runtime configuration
 */
export function clearGondolinRuntime(sessionManager: unknown): void {
  gondolinRuntimeRegistry.set(sessionManager, null);
}
