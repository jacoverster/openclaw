import { VM, createHttpHooks, RealFSProvider, type VM as VMType } from "@earendil-works/gondolin";
import type { SandboxGondolinConfig } from "./types.js";

export interface GondolinVMConfig {
  agentId: string;
  workspacePath: string;
  gondolin: SandboxGondolinConfig;
  apiKeys: Record<string, string>;
  allowedHosts: string[];
}

export interface GondolinProxyToolPayload {
  action: string;
  [key: string]: unknown;
}

export interface GondolinProxyToolResult {
  success: boolean;
  text?: string;
  screenshot?: string;
  dom?: {
    title: string;
    headings: string[];
    links: { href: string; text: string }[];
    structuredData?: Record<string, unknown>;
  };
  error?: string;
}

export type ProxyToolHandler = (
  payload: GondolinProxyToolPayload,
) => Promise<GondolinProxyToolResult>;

/**
 * GondolinVMManager - manages Gondolin micro-VMs for agent sandboxing
 *
 * This implements the "Thick VM" architecture where:
 * - The full PI agent loop runs inside the Gondolin VM
 * - Native tools (read/write/edit/exec) run directly in VM
 * - Proxied tools (browser, web_fetch, etc.) RPC back to host
 * - LLM API calls go through Gondolin's HTTP hooks for secret injection
 */
export class GondolinVMManager {
  private vms: Map<string, VMType> = new Map();
  private proxyHandlers: Map<string, ProxyToolHandler> = new Map();
  private config: GondolinVMConfig | null = null;
  private idleTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private checkpoints: Map<string, string> = new Map(); // agentId -> checkpointPath

  // Configuration for lifecycle management
  private readonly IDLE_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes
  private readonly CHECKPOINT_DIR = "/tmp/gondolin-checkpoints";

  /**
   * Initialize the VM manager with configuration
   */
  async initialize(config: GondolinVMConfig): Promise<void> {
    this.config = config;
  }

  /**
   * Register a proxy tool handler (for browser, web_fetch, etc.)
   */
  registerProxyToolHandler(toolName: string, handler: ProxyToolHandler): void {
    this.proxyHandlers.set(toolName, handler);
  }

  /**
   * Get or create a VM for an agent
   */
  async getOrCreateVM(agentId: string): Promise<VMType> {
    const existing = this.vms.get(agentId);
    if (existing) {
      // Reset idle timeout on access
      this.resetIdleTimeout(agentId);
      return existing;
    }

    if (!this.config) {
      throw new Error("GondolinVMManager not initialized");
    }

    const vm = await this.createVM(agentId);
    this.vms.set(agentId, vm);

    // Start idle timeout for this VM
    this.resetIdleTimeout(agentId);

    return vm;
  }

  /**
   * Reset the idle timeout for an agent's VM
   * Called on each VM access to keep the VM alive
   */
  private resetIdleTimeout(agentId: string): void {
    // Clear existing timeout
    const existing = this.idleTimeouts.get(agentId);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timeout to shutdown VM after 45 minutes of inactivity
    const timeout = setTimeout(async () => {
      console.log(`[Gondolin] VM for agent ${agentId} idle for 45 minutes, shutting down...`);
      await this.shutdownVM(agentId);
    }, this.IDLE_TIMEOUT_MS);

    this.idleTimeouts.set(agentId, timeout);
  }

  /**
   * Create a checkpoint after FS-modifying operations
   * This enables fast resume and protects against malicious FS damage
   */
  async createCheckpoint(agentId: string): Promise<string | null> {
    const vm = this.vms.get(agentId);
    if (!vm) {
      return null;
    }

    try {
      // Use Gondolin's checkpoint API if available
      if (typeof vm.checkpoint === "function") {
        const checkpointPath = `${this.CHECKPOINT_DIR}/${agentId}-${Date.now()}.qcow2`;
        await vm.checkpoint(checkpointPath);
        this.checkpoints.set(agentId, checkpointPath);
        console.log(`[Gondolin] Created checkpoint for agent ${agentId}: ${checkpointPath}`);
        return checkpointPath;
      }
      console.log("[Gondolin] VM.checkpoint not available, skipping checkpoint");
      return null;
    } catch (error) {
      console.error(`[Gondolin] Failed to create checkpoint for ${agentId}:`, error);
      return null;
    }
  }

  /**
   * Resume from a checkpoint if available
   */
  async resumeFromCheckpoint(agentId: string): Promise<VMType | null> {
    const checkpointPath = this.checkpoints.get(agentId);
    if (!checkpointPath) {
      return null;
    }

    try {
      // Use Gondolin's checkpoint resume API if available
      // This would require access to the checkpoint object
      console.log("[Gondolin] Would resume from checkpoint: " + checkpointPath);
      return null;
    } catch (error) {
      console.error("[Gondolin] Failed to resume from checkpoint:", error);
      return null;
    }
  }

  /**
   * Create a new Gondolin VM for an agent
   */
  private async createVM(agentId: string): Promise<VMType> {
    if (!this.config) {
      throw new Error("GondolinVMManager not initialized");
    }

    const { workspacePath, gondolin, apiKeys, allowedHosts } = this.config;

    // Build secrets array from API keys
    const secrets: { value: string; hosts: string[] }[] = [];
    for (const [provider, key] of Object.entries(apiKeys)) {
      if (key) {
        // Map provider names to host patterns
        const hosts = this.getHostsForProvider(provider, allowedHosts);
        secrets.push({ value: key, hosts });
      }
    }

    // Create HTTP hooks for secret injection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { httpHooks, env: hookEnv } = createHttpHooks({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      secrets: secrets as unknown as any,
      allowedHosts,
      blockInternalRanges: true,
      replaceSecretsInQuery: false, // safer default
    });

    // Create the VM options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vmOptions: any = {
      sessionLabel: `openclaw-agent-${agentId}`,
      httpHooks,
      env: {
        ...hookEnv, // only placeholders - real secrets never enter VM
        NODE_ENV: process.env.NODE_ENV || "production",
        WORKSPACE: "/workspace",
        AGENT_ID: agentId,
      },
      memoryMb: gondolin.memoryMb || 4096,
      cpus: gondolin.cpus || 2,
      dnsMode: gondolin.dnsMode || "synthetic",
      mounts: {
        "/workspace": new RealFSProvider(workspacePath),
      },
    };

    // Create the VM
    const vm = await VM.create(vmOptions);

    // Start the VM
    await vm.start();

    // Register RPC handlers for proxied tools
    this.registerVMHandlers();

    return vm;
  }

  /**
   * Map provider names to allowed host patterns
   */
  private getHostsForProvider(provider: string, allowedHosts: string[]): string[] {
    const providerHosts: Record<string, string[]> = {
      openai: ["api.openai.com", "openai.com"],
      anthropic: ["api.anthropic.com", "anthropic.com"],
      google: ["*.googleapis.com", "generativelanguage.googleapis.com"],
      googleai: ["generativelanguage.googleapis.com"],
      ollama: ["localhost", "127.0.0.1"],
      azure: ["*.openai.azure.com", "*.azure.com"],
      bedrock: ["*.amazonaws.com"],
    };

    const normalized = provider.toLowerCase().replace(/_api_key$/i, "");
    const hosts = providerHosts[normalized] || [];

    // Filter to only hosts that are in the allowed list
    return hosts.filter((host) => {
      // Check if host matches any allowed pattern
      return allowedHosts.some((allowed) => {
        if (allowed === "*") {
          return true;
        }
        if (allowed.startsWith("*.")) {
          const suffix = allowed.slice(1);
          return host.endsWith(suffix) || host.includes(suffix);
        }
        return host === allowed || host.endsWith(`.${allowed}`);
      });
    });
  }

  /**
   * Register RPC handlers on a VM
   */
  private registerVMHandlers(): void {
    // Set up RPC handler for proxied tools
    // This uses Gondolin's built-in mechanism for custom commands
    for (const [toolName] of this.proxyHandlers) {
      const rpcMethod = `proxy.${toolName}`;
      // Note: Full RPC implementation would require extending Gondolin's control channel
      // For now, we register the handler for future use
      console.log(`[Gondolin] Registered proxy handler for: ${rpcMethod}`);
    }
  }

  /**
   * Execute a command in the VM
   */
  async execInVM(
    agentId: string,
    command: string | string[],
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const vm = await this.getOrCreateVM(agentId);

    const cmd = Array.isArray(command) ? command : command.split(" ");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execOptions: any = {
      cwd: options?.cwd,
      env: options?.env,
    };
    if (options?.timeoutMs) {
      execOptions.timeoutMs = options.timeoutMs;
    }

    const result = await vm.exec(cmd, execOptions);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  /**
   * Get VM status
   */
  async getVMStatus(agentId: string): Promise<{
    running: boolean;
    uptime?: number;
    memory?: number;
  }> {
    const vm = this.vms.get(agentId);
    if (!vm) {
      return { running: false };
    }

    // VM status check - depends on Gondolin API
    return {
      running: true,
      // Would need to implement uptime tracking
    };
  }

  /**
   * Shutdown a VM
   */
  async shutdownVM(agentId: string): Promise<void> {
    const vm = this.vms.get(agentId);
    if (vm) {
      await vm.close();
      this.vms.delete(agentId);
    }
  }

  /**
   * Shutdown all VMs
   */
  async shutdownAll(): Promise<void> {
    for (const [agentId, vm] of this.vms) {
      try {
        await vm.close();
      } catch (error) {
        console.error(`[Gondolin] Error shutting down VM for ${agentId}:`, error);
      }
    }
    this.vms.clear();
  }
}

// Singleton instance
let gondolinVMManager: GondolinVMManager | null = null;

/**
 * Get the global GondolinVMManager instance
 */
export function getGondolinVMManager(): GondolinVMManager {
  if (!gondolinVMManager) {
    gondolinVMManager = new GondolinVMManager();
  }
  return gondolinVMManager;
}

/**
 * Initialize the GondolinVMManager
 */
export async function initGondolinVMManager(config: GondolinVMConfig): Promise<GondolinVMManager> {
  const manager = getGondolinVMManager();
  await manager.initialize(config);
  return manager;
}
