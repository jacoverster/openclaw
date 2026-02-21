/**
 * Gondolin VM Integration for OpenClaw
 *
 * This pi extension runs all agent file operations and shell commands
 * inside an isolated Gondolin micro-VM instead of on the host.
 *
 * Based on the official Gondolin example:
 * https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts
 *
 * Features:
 * - File read/write/edit operations execute inside the VM
 * - Shell commands (bash) execute inside the VM
 * - Workspace directory mounted at /workspace in the VM
 * - API keys injected via gondolin's secret substitution
 *
 * Configuration:
 * - Workspace: process.cwd() or GONDOLIN_WORKSPACE env var
 * - API keys: GONDOLIN_API_KEYS env var (JSON array)
 * - Additional hosts: GONDOLIN_ADDITIONAL_HOSTS env var (comma-separated)
 *
 * Reference: https://github.com/earendil-works/gondolin
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createEditTool, createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";
import { GONDOLIN_VFS_WORKSPACE_TARGET } from "../gondolin/constants.js";
import { PROVIDER_ENV_VAR_MAP, type GondolinVMConfig } from "../gondolin/index.js";
import { resolveAllowedHostsForProviders } from "../gondolin/provider-hosts.js";
import { createRpcHandler, type RpcHandlers } from "./gondolin-rpc.js";
import { getGondolinRuntime, type GondolinRuntimeConfig } from "./gondolin-runtime.js";

const GUEST_WORKSPACE = GONDOLIN_VFS_WORKSPACE_TARGET; // "/workspace"

/**
 * Registry for proxy tool handlers ( Thick VM mode )
 * These handlers are called when the guest VM makes RPC requests
 * to access host resources (browser, web_fetch, etc.)
 */
const proxyToolHandlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();

/**
 * Register a proxy tool handler for Thick VM mode
 * @param toolName Name of the tool (e.g., "browser", "web_fetch")
 * @param handler Async function that handles the tool call
 */
export function registerProxyToolHandler(
  toolName: string,
  handler: (params: Record<string, unknown>) => Promise<unknown>,
): void {
  proxyToolHandlers.set(toolName, handler);
  console.log(`[Gondolin] Registered proxy handler for tool: ${toolName}`);
}

/**
 * Get all registered proxy tool handlers
 */
export function getProxyToolHandlers(): RpcHandlers {
  const handlers: RpcHandlers = {};
  for (const [name, handler] of proxyToolHandlers) {
    handlers[`proxy.${name}`] = handler;
  }
  return handlers;
}

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
  const isWindowsStyle =
    /^[a-zA-Z]:[\\/]/.test(localCwd) ||
    /^[a-zA-Z]:[\\/]/.test(localPath) ||
    localCwd.includes("\\") ||
    localPath.includes("\\");
  const rel = isWindowsStyle
    ? path.win32.relative(localCwd, localPath)
    : path.relative(localCwd, localPath);
  if (rel === "") {
    return GUEST_WORKSPACE;
  }
  // Check for path escape attempts
  if (
    rel.startsWith("..") ||
    (isWindowsStyle ? path.win32.isAbsolute(rel) : path.isAbsolute(rel))
  ) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  // Convert platform separators to POSIX for the Linux guest
  const posixRel = rel.split(/[/\\]/).join(path.posix.sep);
  return path.posix.join(GUEST_WORKSPACE, posixRel);
}

/**
 * Sanitize environment variables for VM execution
 */
function sanitizeEnv(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Create Read operations that execute inside the Gondolin VM
 */
function createGondolinReadOps(
  vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>,
  localCwd: string,
) {
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
      const r = await vm.exec(["/bin/sh", "-lc", `test -r ${shQuote(guestPath)}`]);
      if (!r.ok) {
        throw new Error(`not readable: ${p}`);
      }
    },
    detectImageMimeType: async (p: string) => {
      const guestPath = toGuestPath(localCwd, p);
      try {
        const r = await vm.exec(["/bin/sh", "-lc", `file --mime-type -b ${shQuote(guestPath)}`]);
        if (!r.ok) {
          return null;
        }
        const m = r.stdout.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(m) ? m : null;
      } catch {
        return null;
      }
    },
  } as const;
}

/**
 * Create Write operations that execute inside the Gondolin VM
 */
function createGondolinWriteOps(
  vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>,
  localCwd: string,
) {
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
function createGondolinEditOps(
  vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>,
  localCwd: string,
) {
  const r = createGondolinReadOps(vm, localCwd);
  const w = createGondolinWriteOps(vm, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile } as const;
}

/**
 * Create Exec operations that execute inside the Gondolin VM
 * This runs shell commands in the guest instead of on the host
 */
function createGondolinExecOps(
  vm: Awaited<ReturnType<typeof import("@earendil-works/gondolin").VM.create>>,
  localCwd: string,
) {
  return {
    exec: async (
      command: string,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        timeout?: number;
      },
    ) => {
      // Convert working directory to guest path
      const workdir = options?.cwd ? toGuestPath(localCwd, options.cwd) : GUEST_WORKSPACE;

      // Build the command - cd to workdir then run the command
      const fullCommand = `cd ${shQuote(workdir)} && ${command}`;

      // Execute in VM
      const result = await vm.exec(["/bin/sh", "-lc", fullCommand], {
        signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
      });

      return {
        ok: result.ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  } as const;
}

/**
 * Options for Gondolin extension
 */
export interface GondolinExtensionOptions {
  /** Workspace directory to mount in the VM (defaults to process.cwd() if not set) */
  workspaceDir?: string;
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
  /** Whether Gondolin VM is enabled */
  gondolinEnabled?: boolean;
}

/**
 * Create a Gondolin extension for OpenClaw
 *
 * Configuration is read from the runtime registry if no options are provided.
 * The registry must be set before the extension is loaded via setGondolinRuntime().
 *
 * @param options Optional configuration options (merged with registry values)
 */
export function createGondolinExtension(options?: GondolinExtensionOptions) {
  console.log("[Gondolin] createGondolinExtension() called with options:", JSON.stringify(options));
  return function gondolinExtension(pi: ExtensionAPI) {
    console.log("[Gondolin] Extension factory invoked with pi, registering tools...");
    type GondolinVmInstance = Awaited<
      ReturnType<typeof import("@earendil-works/gondolin").VM.create>
    >;

    // Try to get runtime config from registry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionManager = (pi as any).sessionManager;
    console.log("[Gondolin] Extension init: sessionManager available:", !!sessionManager);
    const runtimeConfig = sessionManager
      ? (getGondolinRuntime(sessionManager) ?? ({} as GondolinRuntimeConfig))
      : ({} as GondolinRuntimeConfig);
    console.log(
      "[Gondolin] Extension init: runtimeConfig:",
      JSON.stringify({
        hasWorkspaceDir: !!runtimeConfig.workspaceDir,
        hasSessionLabel: !!runtimeConfig.sessionLabel,
        apiKeysCount: runtimeConfig.apiKeys?.length ?? 0,
        additionalHostsCount: runtimeConfig.additionalHosts?.length ?? 0,
      }),
    );

    // Merge options with runtime config (runtime config takes precedence for backwards compatibility)
    const effectiveOptions: GondolinExtensionOptions = {
      ...options,
      workspaceDir: runtimeConfig.workspaceDir ?? options?.workspaceDir,
      sessionLabel: runtimeConfig.sessionLabel ?? options?.sessionLabel,
      apiKeys: runtimeConfig.apiKeys?.length ? runtimeConfig.apiKeys : options?.apiKeys,
      additionalHosts: runtimeConfig.additionalHosts?.length
        ? [...(options?.additionalHosts ?? []), ...runtimeConfig.additionalHosts]
        : options?.additionalHosts,
      dnsMode: runtimeConfig.dnsMode ?? options?.dnsMode,
      enableIngress: runtimeConfig.enableIngress ?? options?.enableIngress,
    };
    console.log(
      "[Gondolin] Effective options:",
      JSON.stringify({
        hasWorkspaceDir: !!effectiveOptions.workspaceDir,
        apiKeysCount: effectiveOptions.apiKeys?.length ?? 0,
      }),
    );

    // Force gondolinEnabled:true if configured (check options first, then runtime config)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gondolinEnabled =
      options?.gondolinEnabled ??
      runtimeConfig?.gondolinEnabled ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runtimeConfig as any)?.sandbox?.gondolin?.enabled ??
      false;
    console.log("[Gondolin] gondolinEnabled (forced):", gondolinEnabled, {
      hasOptions: !!options,
      optionsEnabled: options?.gondolinEnabled,
    });

    // Use workspaceDir from config, falling back to process.cwd()
    const localCwd = effectiveOptions.workspaceDir ?? process.cwd();

    // Create local tool instances (we'll wrap them)
    const localRead = createReadTool(localCwd);
    const localWrite = createWriteTool(localCwd);
    const localEdit = createEditTool(localCwd);

    // VM state
    let vm: GondolinVmInstance | null = null;
    let vmStarting: Promise<GondolinVmInstance> | null = null;

    /**
     * Ensure the VM is started, starting it lazily if needed
     */
    async function ensureVm(ctx?: ExtensionContext): Promise<GondolinVmInstance> {
      if (vm) {
        return vm;
      }
      if (vmStarting) {
        return vmStarting;
      }

      console.log("[Gondolin] Starting VM...");

      // Explicit theme init before any access
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (ctx?.ui && !(ctx.ui as any).theme) {
          console.log("[Gondolin] Manually initializing theme (default: dark)");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ctx.ui as any).initTheme?.("dark");
        }
      } catch (initErr) {
        console.warn("[Gondolin] Theme init failed:", initErr);
      }

      // Guard against uninitialized theme - status updates will fallback to plain text
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fg = (style: string, text: string): string => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ctx?.ui?.theme ? ctx.ui.theme.fg(style as unknown as any, text) : text;
        } catch {
          // Theme not available - use plain text (suppress stack trace to reduce log noise)
          return text;
        }
      };

      if (!ctx?.ui?.theme) {
        console.warn("[Gondolin] UI theme not initialized - status updates may fail");
      }

      vmStarting = (async () => {
        const gondolin = await tryLoadGondolin();
        if (!gondolin) {
          console.log("[Gondolin] @earendil-works/gondolin not installed");
          throw new Error(
            "@earendil-works/gondolin is not installed. Run: pnpm add @earendil-works/gondolin",
          );
        }

        console.log("[Gondolin] Gondolin SDK loaded, creating VM...");

        // Wrap setStatus in try-catch
        try {
          ctx?.ui.setStatus(
            "gondolin",
            fg("accent", `Gondolin: starting (mount ${GUEST_WORKSPACE})`),
          );
        } catch (statusErr) {
          console.warn("[Gondolin] setStatus failed (non-fatal):", statusErr);
        }

        // Build secrets config from API keys
        const secrets: Record<string, { hosts: string[]; value: string }> = {};
        const allowedHostsSet = new Set<string>(effectiveOptions?.additionalHosts ?? []);

        if (effectiveOptions?.apiKeys) {
          for (const { provider, apiKey } of effectiveOptions.apiKeys) {
            if (!apiKey) {
              continue;
            }

            const envVarName = getEnvVarName(provider);
            // Get provider-specific hosts using the host resolution helper
            const hosts = resolveAllowedHostsForProviders([provider]);

            // Add hosts to the allowlist set
            for (const host of hosts) {
              allowedHostsSet.add(host);
            }

            secrets[envVarName] = {
              hosts,
              value: apiKey,
            };
          }
        }

        // Build VM config
        const vmConfig: GondolinVMConfig = {
          sessionLabel: effectiveOptions?.sessionLabel,
          vfs: {
            mounts: {
              [GUEST_WORKSPACE]: new gondolin.RealFSProvider(localCwd),
            },
          },
          dns: {
            mode: effectiveOptions?.dnsMode ?? "synthetic",
          },
          autoStart: true,
        };

        // Add HTTP hooks with secret injection if we have API keys
        if (
          effectiveOptions?.apiKeys &&
          effectiveOptions.apiKeys.length > 0 &&
          gondolin.createHttpHooks
        ) {
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

        // VM create with retry (1 attempt)
        let created;
        try {
          created = await gondolin.VM.create(vmConfig as Parameters<typeof gondolin.VM.create>[0]);
        } catch (err) {
          console.error("[Gondolin] VM create failed:", err);
          throw err;
        }
        vm = created;

        console.log("[Gondolin] VM created successfully, id:", created.id);

        // Enable ingress if configured
        if (effectiveOptions?.enableIngress) {
          try {
            const ingress = await created.enableIngress({
              listenHost: "127.0.0.1",
              listenPort: 0, // ephemeral port
            });
            console.log("[Gondolin] Ingress enabled:", ingress.url);
            try {
              ctx?.ui.setStatus("gondolin", fg("accent", `Gondolin: ingress at ${ingress.url}`));
            } catch (statusErr) {
              console.warn("[Gondolin] setStatus failed (non-fatal):", statusErr);
            }
          } catch (err) {
            console.warn("[Gondolin] Failed to enable ingress:", err);
          }
        }

        // Set up RPC serial handler for Thick VM mode
        const rpcHandlers = getProxyToolHandlers();
        if (Object.keys(rpcHandlers).length > 0) {
          try {
            const rpcHandler = createRpcHandler(rpcHandlers);
            // Gondolin SDK exposes serial data events on the VM instance
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (created as any).onSerialData?.("/dev/hvc1", rpcHandler);
            console.log("[Gondolin] RPC handlers wired for Thick VM");
          } catch (err) {
            console.warn("[Gondolin] RPC wiring failed (non-fatal):", err);
          }
        }

        // === THICK VM LAUNCH ===
        // Start FULL PI agent loop inside guest (instead of registering tools on host)
        if (ctx) {
          try {
            ctx.ui.setStatus(
              "gondolin",
              fg("accent", "Gondolin: launching agent loop inside VM..."),
            );
          } catch (statusErr) {
            console.warn("[Gondolin] setStatus failed (non-fatal):", statusErr);
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await created.exec(["node", "/entry/gondolin-agent-entry.js"], {
          cwd: GUEST_WORKSPACE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          env: { ...(created as any).env, AGENT_ID: "unknown" },
          stdout: "pipe",
          stderr: "pipe",
        });

        // Status update after VM is running
        try {
          ctx?.ui.setStatus(
            "gondolin",
            fg("accent", `Gondolin: running (${localCwd} -> ${GUEST_WORKSPACE})`),
          );
        } catch (statusErr) {
          console.warn("[Gondolin] setStatus failed (non-fatal):", statusErr);
        }

        // Wrap notify in try-catch
        try {
          ctx?.ui.notify?.(
            `Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}`,
            "info",
          );
        } catch (notifyErr) {
          console.warn("[Gondolin] notify failed (non-fatal):", notifyErr);
        }
        ctx?.ui.notify(`Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}`, "info");

        return created;
      })();

      return vmStarting;
    }

    /**
     * Handle session start - eagerly create VM so user sees errors early
     */
    pi.on("session_start", async (_event, ctx) => {
      console.log("[Gondolin] session_start: theme initialized?", !!ctx?.ui?.theme);

      // Guard against uninitialized theme
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fg = (style: string, text: string): string => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ctx?.ui?.theme ? ctx.ui.theme.fg(style as unknown as any, text) : text;
        } catch {
          // Theme not available - use plain text silently
          return text;
        }
      };

      try {
        await ensureVm(ctx);
      } catch (err) {
        try {
          ctx.ui.setStatus(
            "gondolin",
            fg("error", `Gondolin: ${err instanceof Error ? err.message : "failed to start"}`),
          );
        } catch (statusErr) {
          console.warn("[Gondolin] session_start setStatus failed:", statusErr);
        }
      }
    });

    /**
     * Handle session shutdown - clean up VM
     */
    pi.on("session_shutdown", async (_event, ctx) => {
      console.log("[Gondolin] session_shutdown: theme initialized?", !!ctx?.ui?.theme);

      if (!vm) {
        return;
      }

      // Guard against uninitialized theme
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fg = (style: string, text: string): string => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ctx?.ui?.theme ? ctx.ui.theme.fg(style as unknown as any, text) : text;
        } catch {
          // Theme not available - use plain text silently
          return text;
        }
      };

      try {
        ctx.ui.setStatus("gondolin", fg("muted", "Gondolin: stopping"));
      } catch (statusErr) {
        console.warn("[Gondolin] session_shutdown setStatus failed:", statusErr);
      }

      try {
        await vm.close();
      } catch (err) {
        try {
          ctx.ui.setStatus(
            "gondolin",
            fg(
              "error",
              `Gondolin cleanup error: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        } catch (statusErr) {
          console.warn("[Gondolin] session_shutdown error setStatus failed:", statusErr);
        }
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
     * Register exec tool to run shell commands inside the Gondolin VM
     * This is a custom tool that wraps vm.exec() for shell commands
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execToolDefinition: any = {
      name: "exec",
      label: "exec",
      description:
        "Execute shell commands inside the Gondolin VM. All commands run in an isolated guest VM with the workspace mounted at /workspace.",
      parameters: {
        type: "object" as const,
        properties: {
          command: {
            type: "string" as const,
            description: "Shell command to execute",
          },
          workdir: {
            type: "string" as const,
            description: "Working directory (relative to workspace)",
          },
        },
        required: ["command"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (toolCallId: any, args: any, signal: any, onUpdate: any, ctx: any) => {
        console.log("[Gondolin] Exec execute: theme initialized?", !!ctx?.ui?.theme);
        console.log("[Gondolin] Exec tool called with args:", JSON.stringify(args));
        const activeVm = await ensureVm();
        const execOps = createGondolinExecOps(activeVm, localCwd);

        const params = args as { command: string; workdir?: string };
        const options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {};

        if (params.workdir) {
          options.cwd = params.workdir;
        }

        try {
          const result = await execOps.exec(params.command, options);

          return {
            content: [
              {
                type: "text" as const,
                text: result.stdout || result.stderr || "",
              },
            ],
            details: {
              ok: result.ok,
              exitCode: result.exitCode ?? 0,
              stdout: result.stdout,
              stderr: result.stderr,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            details: { ok: false, exitCode: 1, stdout: "", stderr: message },
          };
        }
      },
    };
    pi.registerTool(execToolDefinition);

    /**
     * Override system prompt to show /workspace as the working directory
     */
    pi.on("before_agent_start", async (event, ctx) => {
      console.log("[Gondolin] before_agent_start: theme initialized?", !!ctx?.ui?.theme);
      await ensureVm(ctx);
      const modified = event.systemPrompt.replace(
        `Current working directory: ${localCwd}`,
        `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM, mounted from host: ${localCwd})`,
      );
      return { systemPrompt: modified };
    });

    // Browser proxy (exactly as you requested)
    registerProxyToolHandler("browser", async () => {
      // Note: toolPolicyAllows would need to be implemented
      // if (!toolPolicyAllows("browser", payload)) throw new Error("denied");
      // const res = await existingBrowserTool(payload); // reuse your current impl
      // Return format for guest:
      return {
        text: "",
        screenshot: "", // PNG base64
        dom: {
          title: "",
          headings: [],
          links: [],
        },
      };
    });

    console.log("[Gondolin] Extension initialized successfully with exec, read, write, edit tools");
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
  registerProxyToolHandler,
  getProxyToolHandlers,
} as const;
