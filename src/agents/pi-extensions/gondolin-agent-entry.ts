/**
 * Gondolin Agent Entry Point (Thick VM)
 *
 * This file runs inside the Gondolin VM guest and starts the full PI agent loop.
 * It registers native tools (read/write/edit/exec) that operate on the VM's filesystem,
 * and proxies other tools (browser, web_fetch, etc.) back to the host via JSON-RPC.
 *
 * Usage:
 *   node /entry/gondolin-agent-entry.js
 *
 * Environment variables:
 *   AGENT_ID - Unique identifier for this agent session
 *   PI_CONFIG - JSON string with PI agent configuration
 *   RPC_SERIAL_PORT - Virtio serial port for RPC (default: /dev/hvc1)
 */

import * as fs from "node:fs";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { rpcCall } from "./gondolin-rpc.js";

const GUEST_WORKSPACE = "/workspace";
const DEFAULT_RPC_PORT = "/dev/hvc1";

interface AgentConfig {
  agentId: string;
  model?: string;
  thinkingLevel?: string;
  [key: string]: unknown;
}

/**
 * Parse configuration from environment
 */
function parseConfig(): AgentConfig {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    throw new Error("AGENT_ID environment variable is required");
  }

  let piConfig: AgentConfig = { agentId };
  if (process.env.PI_CONFIG) {
    try {
      piConfig = { ...piConfig, ...JSON.parse(process.env.PI_CONFIG) };
    } catch {
      console.warn("[Gondolin] Failed to parse PI_CONFIG, using defaults");
    }
  }

  return piConfig;
}

/**
 * Get the RPC serial port from environment or use default
 */
function getRpcPort(): string {
  return process.env.RPC_SERIAL_PORT || DEFAULT_RPC_PORT;
}

/**
 * Simple tool interface for proxied tools
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tool = any;

/**
 * Create native tools that operate inside the VM
 * These read/write/exec directly on the guest filesystem
 */
function createNativeTools(cwd: string): Tool[] {
  return [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd)];
}

/**
 * Create proxied tools that call back to the host via RPC
 */
function createProxiedTools(): Tool[] {
  const toolNames = ["browser", "web_fetch", "web_search", "image", "tts", "cron", "message"];

  return toolNames.map(
    (name): Tool => ({
      name,
      description: `${name} tool (proxied to host)`,
      parameters: {
        type: "object" as const,
        properties: {},
      },
      execute: async (id: string, params: Record<string, unknown>) => {
        const rpcPort = getRpcPort();
        console.log(`[Gondolin] Proxying ${name} to host via ${rpcPort}`);

        try {
          const result = await rpcCall(`proxy.${name}`, {
            toolCallId: id,
            params,
          });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            details: { ok: false, exitCode: 1 },
          };
        }
      },
    }),
  );
}

/**
 * Main entry point - starts the PI agent inside the VM
 */
async function main() {
  console.log("[Gondolin] Agent entry starting...");

  const config = parseConfig();
  const rpcPort = getRpcPort();
  const cwd = GUEST_WORKSPACE;

  console.log(`[Gondolin] Agent ID: ${config.agentId}`);
  console.log(`[Gondolin] RPC Port: ${rpcPort}`);
  console.log(`[Gondolin] Working directory: ${cwd}`);

  // Verify workspace exists
  if (!fs.existsSync(cwd)) {
    console.error(`[Gondolin] Workspace directory does not exist: ${cwd}`);
    process.exit(1);
  }

  // Create native tools (file operations inside VM)
  const nativeTools = createNativeTools(cwd);
  console.log(`[Gondolin] Created ${nativeTools.length} native tools`);

  // Create proxied tools (call back to host)
  const proxiedTools = createProxiedTools();
  console.log(`[Gondolin] Created ${proxiedTools.length} proxied tools`);

  // Combine all tools
  const allTools = [...nativeTools, ...proxiedTools];
  console.log(`[Gondolin] Total tools: ${allTools.length}`);

  // Check if we should run in standalone mode (for testing)
  const standaloneMode = process.env.STANDALONE_MODE === "true";
  if (standaloneMode) {
    console.log("[Gondolin] Running in standalone test mode");
    // In standalone mode, just verify tools are created correctly
    console.log("[Gondolin] Tools:", allTools.map((t) => t.name).join(", "));
    console.log("[Gondolin] Standalone mode complete");
    return;
  }

  // Import and start the PI agent
  // Note: In production, this would call into the pi-coding-agent SDK
  // For now, we set up the tool infrastructure
  console.log("[Gondolin] PI agent infrastructure ready");

  // In a full implementation, we would call:
  // await startPIAgent({
  //   tools: allTools,
  //   config,
  // });

  // For now, just keep the process alive to receive RPC calls
  console.log("[Gondolin] Agent running, waiting for RPC calls...");

  // Set up graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[Gondolin] Received SIGTERM, shutting down...");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("[Gondolin] Received SIGINT, shutting down...");
    process.exit(0);
  });
}

// Run the main function
main().catch((error) => {
  console.error("[Gondolin] Fatal error:", error);
  process.exit(1);
});
