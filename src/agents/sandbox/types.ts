import type { SandboxFsBridge } from "./fs-bridge.js";
import type { SandboxDockerConfig } from "./types.docker.js";

export type { SandboxDockerConfig } from "./types.docker.js";

/**
 * Gondolin VM configuration for sandbox isolation
 */
export type SandboxGondolinConfig = {
  /** Enable gondolin VM isolation */
  enabled: boolean;
  /** VM memory in MB (default: 4096) */
  memoryMb?: number;
  /** Number of CPUs (default: 2) */
  cpus?: number;
  /** DNS mode: synthetic | trusted | open */
  dnsMode?: "synthetic" | "trusted" | "open";
  /** Additional hosts to allow */
  additionalHosts?: string[];
  /** Workspace mount mode: ro | rw */
  workspaceMode?: "ro" | "rw";
  /** Enable HTTP ingress for exposing guest services */
  enableIngress?: boolean;
};

export type SandboxToolPolicy = {
  allow?: string[];
  deny?: string[];
};

export type SandboxToolPolicySource = {
  source: "agent" | "global" | "default";
  /**
   * Config key path hint for humans.
   * (Arrays use `agents.list[].…` form.)
   */
  key: string;
};

export type SandboxToolPolicyResolved = {
  allow: string[];
  deny: string[];
  sources: {
    allow: SandboxToolPolicySource;
    deny: SandboxToolPolicySource;
  };
};

export type SandboxWorkspaceAccess = "none" | "ro" | "rw";

export type SandboxBrowserConfig = {
  enabled: boolean;
  image: string;
  containerPrefix: string;
  cdpPort: number;
  vncPort: number;
  noVncPort: number;
  headless: boolean;
  enableNoVnc: boolean;
  allowHostControl: boolean;
  autoStart: boolean;
  autoStartTimeoutMs: number;
  binds?: string[];
};

export type SandboxPruneConfig = {
  idleHours: number;
  maxAgeDays: number;
};

export type SandboxScope = "session" | "agent" | "shared";

export type SandboxConfig = {
  mode: "off" | "non-main" | "all";
  scope: SandboxScope;
  workspaceAccess: SandboxWorkspaceAccess;
  workspaceRoot: string;
  docker: SandboxDockerConfig;
  browser: SandboxBrowserConfig;
  tools: SandboxToolPolicy;
  prune: SandboxPruneConfig;
  gondolin: SandboxGondolinConfig;
};

export type SandboxBrowserContext = {
  bridgeUrl: string;
  noVncUrl?: string;
  containerName: string;
};

export type SandboxContext = {
  enabled: boolean;
  sessionKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  workspaceAccess: SandboxWorkspaceAccess;
  containerName: string;
  containerWorkdir: string;
  docker: SandboxDockerConfig;
  tools: SandboxToolPolicy;
  browserAllowHostControl: boolean;
  browser?: SandboxBrowserContext;
  fsBridge?: SandboxFsBridge;
  /** When true, sandbox uses Gondolin VM instead of Docker container */
  gondolin?: SandboxGondolinConfig;
};

export type SandboxWorkspaceInfo = {
  workspaceDir: string;
  containerWorkdir: string;
};
