/**
 * Gondolin VM integration for OpenClaw
 *
 * This module provides integration with Gondolin (https://github.com/earendil-works/gondolin)
 * to run OpenClaw agent sessions in isolated VMs with secret injection.
 *
 * Key features:
 * - VM lifecycle management (VM.create(), vm.close())
 * - Secret injection for API keys (createSecretInjector())
 * - VFS workspace mounting (RealFSProvider, MemoryProvider)
 * - Network allowlist enforcement
 * - HTTP ingress for exposing guest services
 *
 * Reference: https://github.com/earendil-works/gondolin
 * SDK Docs: https://earendil-works.github.io/gondolin/
 */

// VM management
export {
  createGondolinVM,
  createSecretInjector,
  createWorkspaceVFS,
  validateVMConfig,
  listGondolinSessions,
  findGondolinSession,
} from "./vm-manager.js";

export type {
  ResolvedApiKey,
} from "./vm-manager.js";

// Types from gondolin SDK
export type {
  GondolinVM,
  GondolinVMConfig,
  GondolinExecResult,
  GondolinDNSMode,
  GondolinVFSMounts,
  GondolinHttpHooksResult,
  GondolinVFSProvider,
  GondolinRealFSProvider,
  GondolinMemoryProvider,
  GondolinIngress,
  GondolinIngressRoute,
  GondolinCheckpoint,
  GondolinExecOptions,
  GondolinIngressOptions,
  GondolinIngressHooks,
  GondolinError,
  GondolinErrorCode,
} from "./types.js";

// Constants
export {
  GONDOLIN_VM_DEFAULT_MEMORY_MB,
  GONDOLIN_VM_DEFAULT_CPUS,
  GONDOLIN_DNS_MODE_DEFAULT,
} from "./constants.js";
