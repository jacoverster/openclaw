import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveContextWindowInfo } from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { resolveAllowedHostsForProviders } from "../gondolin/provider-hosts.js";
import { setCompactionSafeguardRuntime } from "../pi-extensions/compaction-safeguard-runtime.js";
import { setContextPruningRuntime } from "../pi-extensions/context-pruning/runtime.js";
import { computeEffectiveSettings } from "../pi-extensions/context-pruning/settings.js";
import { makeToolPrunablePredicate } from "../pi-extensions/context-pruning/tools.js";
import { setGondolinRuntime } from "../pi-extensions/gondolin-runtime.js";
import { createGondolinExtension } from "../pi-extensions/gondolin.js";
import { ensurePiCompactionReserveTokens } from "../pi-settings.js";
import { resolveSandboxConfigForAgent } from "../sandbox/config.js";
import { isCacheTtlEligibleProvider, readLastCacheTtlTimestamp } from "./cache-ttl.js";

function resolvePiExtensionPath(id: string): string {
  const self = fileURLToPath(import.meta.url);
  const dir = path.dirname(self);
  // In dev this file is `.ts` (tsx), in production it's `.js`.
  const ext = path.extname(self) === ".ts" ? "ts" : "js";
  return path.join(dir, "..", "pi-extensions", `${id}.${ext}`);
}

function resolveContextWindowTokens(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  model: Model<Api> | undefined;
}): number {
  return resolveContextWindowInfo({
    cfg: params.cfg,
    provider: params.provider,
    modelId: params.modelId,
    modelContextWindow: params.model?.contextWindow,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  }).tokens;
}

function buildContextPruningExtension(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: Model<Api> | undefined;
}): { additionalExtensionPaths?: string[] } {
  const raw = params.cfg?.agents?.defaults?.contextPruning;
  if (raw?.mode !== "cache-ttl") {
    return {};
  }
  if (!isCacheTtlEligibleProvider(params.provider, params.modelId)) {
    return {};
  }

  const settings = computeEffectiveSettings(raw);
  if (!settings) {
    return {};
  }

  setContextPruningRuntime(params.sessionManager, {
    settings,
    contextWindowTokens: resolveContextWindowTokens(params),
    isToolPrunable: makeToolPrunablePredicate(settings.tools),
    lastCacheTouchAt: readLastCacheTtlTimestamp(params.sessionManager),
  });

  return {
    additionalExtensionPaths: [resolvePiExtensionPath("context-pruning")],
  };
}

function resolveCompactionMode(cfg?: OpenClawConfig): "default" | "safeguard" {
  return cfg?.agents?.defaults?.compaction?.mode === "safeguard" ? "safeguard" : "default";
}

/**
 * Build gondolin extension configuration
 * Returns the extension path and sets up runtime config if gondolin is enabled
 */
function buildGondolinExtension(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  workspaceDir: string;
  provider: string;
  modelId: string;
  modelRegistry: unknown;
}): { additionalExtensionPaths?: string[]; extensionFactories?: ExtensionFactory[] } {
  // Resolve sandbox config to check if gondolin is enabled
  const sandboxCfg = resolveSandboxConfigForAgent(params.cfg, params.modelId);
  const gondolinCfg = sandboxCfg.gondolin;

  // Check if gondolin is enabled
  if (!gondolinCfg?.enabled) {
    return {};
  }

  // Get allowed hosts from provider
  const allowedHosts = resolveAllowedHostsForProviders([params.provider]);
  if (gondolinCfg.additionalHosts) {
    allowedHosts.push(...gondolinCfg.additionalHosts);
  }

  // Try to get API key from model registry
  let apiKeys: Array<{ provider: string; apiKey: string }> = [];
  try {
    // @ts-expect-error - modelRegistry is from pi-coding-agent
    const getApiKey = params.modelRegistry?.getApiKey?.bind(params.modelRegistry);
    if (typeof getApiKey === "function") {
      // @ts-expect-error - modelRegistry is from pi-coding-agent
      const apiKey = params.modelRegistry.getApiKey(params.provider);
      if (apiKey) {
        apiKeys = [
          {
            provider: params.provider,
            apiKey,
          },
        ];
      }
    }
  } catch {
    // Ignore errors - API key retrieval is best-effort
  }

  // Set runtime configuration for the gondolin extension
  setGondolinRuntime(params.sessionManager, {
    workspaceDir: params.workspaceDir,
    sessionLabel: `openclaw-${params.modelId}-${Date.now()}`,
    apiKeys,
    additionalHosts: allowedHosts,
    dnsMode: gondolinCfg.dnsMode,
    enableIngress: gondolinCfg.enableIngress,
  });

  return {
    additionalExtensionPaths: [resolvePiExtensionPath("gondolin")],
    extensionFactories: [createGondolinExtension()],
  };
}

export function buildEmbeddedExtensionPaths(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: Model<Api> | undefined;
  workspaceDir?: string;
  modelRegistry?: unknown;
}): { extensionPaths: string[]; extensionFactories: ExtensionFactory[] } {
  const paths: string[] = [];
  const factories: ExtensionFactory[] = [];
  if (resolveCompactionMode(params.cfg) === "safeguard") {
    const compactionCfg = params.cfg?.agents?.defaults?.compaction;
    const contextWindowInfo = resolveContextWindowInfo({
      cfg: params.cfg,
      provider: params.provider,
      modelId: params.modelId,
      modelContextWindow: params.model?.contextWindow,
      defaultTokens: DEFAULT_CONTEXT_TOKENS,
    });
    setCompactionSafeguardRuntime(params.sessionManager, {
      maxHistoryShare: compactionCfg?.maxHistoryShare,
      contextWindowTokens: contextWindowInfo.tokens,
    });
    paths.push(resolvePiExtensionPath("compaction-safeguard"));
  }
  const pruning = buildContextPruningExtension(params);
  if (pruning.additionalExtensionPaths) {
    paths.push(...pruning.additionalExtensionPaths);
  }

  // Build gondolin extension if enabled
  console.log(
    "[Gondolin] Building gondolin extension with config:",
    JSON.stringify({
      hasConfig: !!params.cfg,
      sandbox: params.cfg?.agents?.defaults?.sandbox,
      gondolin: params.cfg?.agents?.defaults?.sandbox?.gondolin,
    }),
  );
  const gondolin = buildGondolinExtension({
    cfg: params.cfg,
    sessionManager: params.sessionManager,
    workspaceDir: params.workspaceDir ?? "",
    provider: params.provider,
    modelId: params.modelId,
    modelRegistry: params.modelRegistry,
  });
  if (gondolin.additionalExtensionPaths) {
    paths.push(...gondolin.additionalExtensionPaths);
  }
  if (gondolin.extensionFactories) {
    factories.push(...gondolin.extensionFactories);
  }

  return { extensionPaths: paths, extensionFactories: factories };
}

export { ensurePiCompactionReserveTokens };
