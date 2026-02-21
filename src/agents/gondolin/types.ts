/**
 * TypeScript type definitions for Gondolin VM integration
 *
 * These types mirror the @earendil-works/gondolin SDK API
 * Reference: https://github.com/earendil-works/gondolin
 */

/**
 * DNS configuration modes
 */
export type GondolinDNSMode = "synthetic" | "trusted" | "open";

/**
 * ExecResult from vm.exec()
 * Both Promise-like and Stream-like
 */
export interface GondolinExecResult {
  /** Exit code (null if signal killed) */
  readonly exitCode: number | null;
  /** Whether exitCode === 0 */
  readonly ok: boolean;
  /** Standard output */
  readonly stdout: string;
  /** Standard error */
  readonly stderr: string;

  /** Parse stdout as JSON */
  json<T>(): T;
  /** Split stdout into lines */
  lines(): string[];
}

/**
 * Gondolin VM instance
 * Created via VM.create()
 */
export interface GondolinVM {
  /** Session UUID */
  readonly id: string;

  /**
   * Execute a command in the VM
   * String form: runs via login shell (/bin/sh -lc "...")
   * Array form: executes directly (must use absolute path)
   */
  exec(command: string | string[], options?: GondolinExecOptions): Promise<GondolinExecResult>;

  /**
   * Read a file from the guest
   */
  readFile(path: string, options?: { encoding?: string }): Promise<string>;

  /**
   * Write a file to the guest
   */
  writeFile(path: string, data: string | Uint8Array): Promise<void>;

  /**
   * Delete a file in the guest
   */
  deleteFile(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  /**
   * Enable ingress to expose guest services to host
   */
  enableIngress(options?: GondolinIngressOptions): Promise<GondolinIngress>;

  /**
   * Set ingress routes
   */
  setIngressRoutes(routes: GondolinIngressRoute[]): void;

  /**
   * Create a disk checkpoint
   */
  checkpoint(path: string): Promise<GondolinCheckpoint>;

  /**
   * Start the VM (if autoStart: false)
   */
  start(): Promise<void>;

  /**
   * Shutdown the VM and cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Options for vm.exec()
 */
export interface GondolinExecOptions {
  /** Current working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Stdout handling */
  stdout?: "pipe" | "inherit" | "null";
  /** Stderr handling */
  stderr?: "pipe" | "inherit" | "null";
  /** Stdin handling */
  stdin?: boolean;
  /** PTY allocation */
  pty?: boolean;
  /** Enable/disable output buffering */
  buffer?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Ingress configuration
 */
export interface GondolinIngressOptions {
  /** Host to listen on */
  listenHost?: string;
  /** Port to listen on (0 for ephemeral) */
  listenPort?: number;
  /** Allow WebSocket upgrades */
  allowWebSockets?: boolean;
  /** Ingress hooks */
  hooks?: GondolinIngressHooks;
}

/**
 * Ingress hooks
 */
export interface GondolinIngressHooks {
  /** Check if request is allowed */
  isAllowed?: (req: { clientIp: string; path: string }) => boolean;
  /** Transform request */
  onRequest?: (req: { backendTarget: string; headers: Record<string, string> }) => {
    backendTarget?: string;
    headers?: Record<string, string | null>;
    bufferResponseBody?: boolean;
  };
  /** Transform response */
  onResponse?: (res: { status: number; headers: Record<string, string>; body?: Uint8Array }) => {
    headers?: Record<string, string | null>;
    body?: Uint8Array;
  };
}

/**
 * Ingress instance
 */
export interface GondolinIngress {
  /** Ingress URL */
  readonly url: string;
  /** Close the ingress */
  close(): Promise<void>;
}

/**
 * Ingress route
 */
export interface GondolinIngressRoute {
  /** URL prefix to match */
  prefix: string;
  /** Backend port in guest */
  port: number;
  /** Strip prefix from URL */
  stripPrefix?: boolean;
}

/**
 * Disk checkpoint
 */
export interface GondolinCheckpoint {
  /** Resume from checkpoint */
  resume(): Promise<GondolinVM>;
  /** Delete checkpoint */
  delete(): void;
}

/**
 * VFS Provider types
 */
export interface GondolinVFSMount {
  source: string;
  target: string;
  mode: "ro" | "rw";
}

export interface GondolinVFSMounts {
  [mountPoint: string]: GondolinVFSProvider;
}

/**
 * VFS Provider base interface
 */
export interface GondolinVFSProvider {
  // Provider interface
}

/**
 * Real filesystem provider
 */
export interface GondolinRealFSProvider extends GondolinVFSProvider {
  // Real filesystem provider - implemented as a class, not constructable from interface
}

/**
 * Memory provider
 */
export interface GondolinMemoryProvider extends GondolinVFSProvider {
  // Memory provider - implemented as a class, not constructable from interface
}

/**
 * VM creation options
 */
export interface GondolinVMConfig {
  /** Session label (for CLI integration) */
  sessionLabel?: string;

  /** Sandbox settings */
  sandbox?: {
    /** Custom image path for guest assets */
    imagePath?: string;
  };

  /** Network/DNS configuration */
  dns?: {
    /** DNS mode */
    mode?: GondolinDNSMode;
    /** Synthetic host mapping */
    syntheticHostMapping?: "per-host" | "single";
    /** Trusted DNS servers */
    trustedServers?: string[];
  };

  /** HTTP egress configuration */
  http?: {
    /** Allowed host patterns */
    allowedHosts?: string[];
    /** Secret injection */
    secrets?: Record<string, { hosts: string[]; value: string }>;
    /** Block internal IP ranges */
    blockInternalRanges?: boolean;
    /** Custom request hook */
    isRequestAllowed?: (req: { url: string; method: string }) => boolean;
    /** Custom IP check */
    isIpAllowed?: (req: { ip: string }) => boolean;
    /** Request head hook */
    onRequestHead?: (req: {
      url: string;
      method: string;
      headers: Record<string, string>;
    }) => typeof req;
    /** Response hook */
    onResponse?: (
      res: { status: number; headers: Record<string, string> },
      req: { url: string },
    ) => typeof res;
  };

  /** VFS mounts */
  vfs?: {
    mounts: GondolinVFSMounts;
  };

  /** HTTP hooks (from createHttpHooks) */
  httpHooks?: unknown;

  /** Environment variables */
  env?: Record<string, string>;

  /** Host path to workspace directory (OpenClaw specific helper shape) */
  workspaceDir?: string;

  /** Array mount form used by OpenClaw helper config */
  mounts?: GondolinVFSMount[];

  /** OpenClaw convenience network shape */
  network?: {
    dnsMode?: GondolinDNSMode;
    dnsServers?: string[];
    allowedHosts?: string[];
  };

  /** OpenClaw convenience resource shape */
  resources?: {
    memoryMB?: number;
    cpus?: number;
  };

  /** OpenClaw convenience image field */
  image?: string;

  /** Auto-start VM (default: true) */
  autoStart?: boolean;
}

/**
 * HTTP hooks result from createHttpHooks
 */
export interface GondolinHttpHooksResult {
  /** HTTP hooks for VM.create() */
  httpHooks: unknown;
  /** Environment variables with placeholders */
  env: Record<string, string>;
}

/**
 * Error types for Gondolin operations
 */
export class GondolinError extends Error {
  constructor(
    message: string,
    public readonly code: GondolinErrorCode,
    public readonly vmId?: string,
  ) {
    super(message);
    this.name = "GondolinError";
  }
}

export type GondolinErrorCode =
  | "VM_NOT_FOUND"
  | "VM_STARTUP_FAILED"
  | "VM_EXEC_FAILED"
  | "VM_CLOSE_FAILED"
  | "VM_TIMEOUT"
  | "NETWORK_ERROR"
  | "SECRET_INJECTION_FAILED"
  | "PLATFORM_UNSUPPORTED"
  | "DEPENDENCY_MISSING";
