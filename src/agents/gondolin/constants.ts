/**
 * Constants for Gondolin VM configuration
 */

// Default VM resources
export const GONDOLIN_VM_DEFAULT_MEMORY_MB = 4096; // 4GB
export const GONDOLIN_VM_DEFAULT_CPUS = 2;

// DNS modes for network configuration (default)
export const GONDOLIN_DNS_MODE_DEFAULT = "synthetic" as const;

// VM lifecycle timeouts (in milliseconds)
export const GONDOLIN_VM_BOOT_TIMEOUT_MS = 30_000;
export const GONDOLIN_VM_DESTROY_TIMEOUT_MS = 10_000;
export const GONDOLIN_VM_EXEC_TIMEOUT_MS = 300_000; // 5 minutes for commands
export const GONDOLIN_VM_HEALTH_CHECK_INTERVAL_MS = 5_000;

// Network configuration
export const GONDOLIN_VM_IP = "192.168.127.3";
export const GONDOLIN_VM_GATEWAY = "192.168.127.1";
export const GONDOLIN_VM_SUBNET = "255.255.255.0";

// VFS mount defaults
export const GONDOLIN_VFS_DEFAULT_WORKSPACE_MODE = "rw" as const;
export const GONDOLIN_VFS_WORKSPACE_TARGET = "/workspace";
export const GONDOLIN_VFS_SESSION_TARGET = "/session";

// Platform requirements
export const GONDOLIN_REQUIRED_COMMANDS = ["qemu-system-x86_64"] as const;
export const GONDOLIN_SUPPORTED_PLATFORMS = ["linux", "darwin"] as const;
export type GondolinPlatform = (typeof GONDOLIN_SUPPORTED_PLATFORMS)[number];
