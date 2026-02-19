/**
 * Gondolin VM Integration for OpenClaw
 *
 * This pi extension runs all agent file operations and shell commands
 * inside an isolated Gondolin micro-VM instead of on the host.
 *
 * Features:
 * - File read/write/edit operations execute inside the VM
 * - Shell commands (exec/bash) execute inside the VM
 * - Workspace directory mounted at /workspace in the VM
 * - API keys injected via gondolin's secret substitution
 *
 * Reference: https://github.com/earendil-works/gondolin
 */

import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";

import { GONDOLIN_VFS_WORKSPACE_TARGET } from "../gondolin/constants.js";
import { PROVIDER_ENV_VAR_MAP, type GondolinVMConfig } from "../gondolin/index.js";

const GUEST_WORKSPACE = GONDOLIN_VFS_WORKSPACE_TARGET; // "/workspace"

/**
 * API key configuration for secret injection
 */
export interface GondolinApiKeyConfig {
  /** Provider name (e.g., "anthropic", "openai") */
  provider: string;
  /** The actual API key value */
  apiKey: string;
  /** Optional mode (e.g., "env" for env var) */
  mode?: string;
}

/**
 * Try to load the gondolin SDK lazily
 * Returns null if not installed
 */
async function tryLoadGondolin(): Promise<typeof import("@earendil-works/gondolin") | null> {
  try {
    return await import("@earendil-works/gondolin");
  } catch {
    return null;
  }
}

/**
 * Get environment variable name for a provider
 */
function getEnvVarName(provider: string): string {
  return PROVIDER_ENV_VAR_MAP[provider.toLowerCase()] || `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Shell quote a value for POSIX shell
 */
export function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Convert a local path to a guest path inside the VM
 * Maps paths relative to localCwd into /workspace
 */
export function toGuestPath(localCwd: string, localPath: string): string {
  const rel = path.relative(localCwd, localPath);
  if (rel === "") return GUEST_WORKSPACE;
  // Check for path escape attempts
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  // Convert platform separators to POSIX for the Linux guest
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(GUEST_WORKSPACE, posixRel);
}

/**
 * Sanitize environment variables for VM execution
 */
function sanitizeEnv(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Create Read operations that execute inside the Gondolin VM
 */
function createGondolinReadOps(vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>, localCwd: string) {
  return {
    readFile: async (p: string) => {
      const guestPath = toGuestPath(localCwd, p);
      const r = await vm.exec(["/bin/cat", guestPath]);
      if (!r.ok) {
        throw new Error(`cat failed (${r.exitCode}): ${r.stderr}`);
      }
      return r.stdoutBuffer;
    },
    access: async (p: string) => {
      const guestPath = toGuestPath(localCwd, p);
      const r = await vm.exec([
        "/bin/sh",
        "-lc",
        `test -r ${shQuote(guestPath)}`,
      ]);
      if (!r.ok) {
        throw new Error(`not readable: ${p}`);
      }
    },
    detectImageMimeType: async (p: string) => {
      const guestPath = toGuestPath(localCwd, p);
      try {
        const r = await vm.exec([
          "/bin/sh",
          "-lc",
          `file --mime-type -b ${shQuote(guestPath)}`,
        ]);
        if (!r.ok) return null;
        const m = r.stdout.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m)
          ? m
          : null;
      } catch {
        return null;
      }
    },
  } as const;
}

/**
 * Create Write operations that execute inside the Gondolin VM
 */
function createGondolinWriteOps(vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>, localCwd: string) {
  return {
    writeFile: async (p: string, content: string) => {
      const guestPath = toGuestPath(localCwd, p);
      const dir = path.posix.dirname(guestPath);

      // Base64 roundtrip to avoid quoting issues
      const b64 = Buffer.from(content, "utf8").toString("base64");
      const script = [
        `set -eu`,
        `mkdir -p ${shQuote(dir)}`,
        `echo ${shQuote(b64)} | base64 -d > ${shQuote(guestPath)}`,
      ].join("\n");

      const r = await vm.exec(["/bin/sh", "-lc", script]);
      if (!r.ok) {
        throw new Error(`write failed (${r.exitCode}): ${r.stderr}`);
      }
    },
    mkdir: async (dir: string) => {
      const guestDir = toGuestPath(localCwd, dir);
      const r = await vm.exec(["/bin/mkdir", "-p", guestDir]);
      if (!r.ok) {
        throw new Error(`mkdir failed (${r.exitCode}): ${r.stderr}`);
      }
    },
  } as const;
}

/**
 * Create Edit operations that execute inside the Gondolin VM
 * (read + write combined)
 */
function createGondolinEditOps(vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>, localCwd: string) {
  const r = createGondolinReadOps(vm, localCwd);
  const w = createGondolinWriteOps(vm, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile } as const;
}

/**
 * Options for Gondolin extension
 */
export interface GondolinExtensionOptions {
  /** Session label for VM identification */
  sessionLabel?: string;
  /** API keys for secret injection */
  apiKeys?: GondolinApiKeyConfig[];
  /** Additional allowed hosts beyond defaults */
  additionalHosts?: string[];
  /** DNS mode: synthetic | trusted | open */
  dnsMode?: "synthetic" | "trusted" | "open";
  /** Enable ingress for exposing guest services */
  enableIngress?: boolean;
}

/**
 * Create a Gondolin extension for OpenClaw
 *
 * @param options Configuration options for the VM
 */
export function createGondolinExtension(options?: GondolinExtensionOptions) {
  return function gondolinExtension(pi: ExtensionAPI) {
    const localCwd = process.cwd();

    // Create local tool instances (we'll wrap them)
    const localRead = createReadTool(localCwd);
    const localWrite = createWriteTool(localCwd);
    const localEdit = createEditTool(localCwd);

    // VM state
    let vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>> | null = null;
    let vmStarting: Promise<typeof vm> | null = null;

    /**
     * Ensure the VM is started, starting it lazily if needed
     */
    async function ensureVm(ctx?: ExtensionContext): Promise<typeof vm> {
      if (vm) return vm;
      if (vmStarting) return vmStarting;

      vmStarting = (async () => {
        const gondolin = await tryLoadGondolin();
        if (!gondolin) {
          throw new Error(
            "@earendil-works/gondolin is not installed. Run: pnpm add @earendil-works/gondolin"
          );
        }

        ctx?.ui.setStatus(
          "gondolin",
          ctx.ui.theme.fg("accent", `Gondolin: starting (mount ${GUEST_WORKSPACE})`)
        );

        // Build secrets config from API keys
        const secrets: Record<string, { hosts: string[]; value: string }> = {};
        const allowedHostsSet = new Set<string>(options?.additionalHosts ?? []);

        if (options?.apiKeys) {
          for (const { provider, apiKey } of options.apiKeys) {
            if (!apiKey) continue;

            const envVarName = getEnvVarName(provider);
            // Add provider-specific hosts (simplified - full implementation would use provider-hosts.ts)
            const hosts: string[] = [];
            
            secrets[envVarName] = {
              hosts,
              value: apiKey,
            };
          }
        }

        // Build VM config
        const vmConfig: GondolinVMConfig = {
          sessionLabel: options?.sessionLabel,
          vfs: {
            mounts: {
              [GUEST_WORKSPACE]: new (gondolin.RealFSProvider)(localCwd),
            },
          },
          dns: {
            mode: options?.dnsMode ?? "synthetic",
          },
          autoStart: true,
        };

        // Add HTTP hooks with secret injection if we have API keys
        if (options?.apiKeys && options.apiKeys.length > 0 && gondolin.createHttpHooks) {
          const { httpHooks, env } = gondolin.createHttpHooks({
            allowedHosts: Array.from(allowedHostsSet),
            secrets,
          });
          
          vmConfig.httpHooks = httpHooks;
          vmConfig.env = env;
        } else if (allowedHostsSet.size > 0) {
          // Just set allowed hosts without secrets
          vmConfig.http = {
            allowedHosts: Array.from(allowedHostsSet),
          };
        }

        const created = await gondolin.VM.create(vmConfig);
        vm = created;

        ctx?.ui.setStatus(
          "gondolin",
          ctx.ui.theme.fg(
            "accent",
            `Gondolin: running (${localCwd} -> ${GUEST_WORKSPACE})`
          )
        );
        ctx?.ui.notify(
          `Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}`,
          "info"
        );

        return created;
      })();

      return vmStarting;
    }

    /**
     * Handle session start - eagerly create VM so user sees errors early
     */
    pi.on("session_start", async (_event, ctx) => {
      try {
        await ensureVm(ctx);
      } catch (err) {
        ctx.ui.setStatus(
          "gondolin",
          ctx.ui.theme.fg("error", `Gondolin: ${err instanceof Error ? err.message : "failed to start"}`)
        );
      }
    });

    /**
     * Handle session shutdown - clean up VM
     */
    pi.on("session_shutdown", async (_event, ctx) => {
      if (!vm) return;

      ctx.ui.setStatus(
        "gondolin",
        ctx.ui.theme.fg("muted", "Gondolin: stopping")
      );

      try {
        await vm.close();
      } catch (err) {
        ctx.ui.setStatus(
          "gondolin",
          ctx.ui.theme.fg("error", `Gondolin cleanup error: ${err instanceof Error ? err.message : String(err)}`)
        );
      } finally {
        vm = null;
        vmStarting = null;
      }
    });

    /**
     * Register the read tool with VM operations
     */
    pi.registerTool({
      ...localRead,
      async execute(id, params, signal, onUpdate, ctx) {
        const activeVm = await ensureVm(ctx);
        const tool = createReadTool(localCwd, {
          operations: createGondolinReadOps(activeVm, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      },
    });

    /**
     * Register the write tool with VM operations
     */
    pi.registerTool({
      ...localWrite,
      async execute(id, params, signal, onUpdate, ctx) {
        const activeVm = await ensureVm(ctx);
        const tool = createWriteTool(localCwd, {
          operations: createGondolinWriteOps(activeVm, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      },
    });

    /**
     * Register the edit tool with VM operations
     */
    pi.registerTool({
      ...localEdit,
      async execute(id, params, signal, onUpdate, ctx) {
        const activeVm = await ensureVm(ctx);
        const tool = createEditTool(localCwd, {
          operations: createGondolinEditOps(activeVm, localCwd),
        });
        return tool.execute(id, params, signal, onUpdate);
      },
    });

    /**
     * Override system prompt to show /workspace as the working directory
     */
    pi.on("before_agent_start", async (event, ctx) => {
      await ensureVm(ctx);
      const modified = event.systemPrompt.replace(
        `Current working directory: ${localCwd}`,
        `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM, mounted from host: ${localCwd})`
      );
      return { systemPrompt: modified };
    });
  };
}

/**
 * Default gondolin extension with sensible defaults
 */
export default createGondolinExtension();

/**
 * Internal functions exported for testing
 */
export const __testing = {
  toGuestPath,
  shQuote,
  sanitizeEnv,
} as const;
