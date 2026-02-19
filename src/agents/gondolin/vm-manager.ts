/**
 * Gondolin VM integration for OpenClaw
 *
 * This module provides integration with the @earendil-works/gondolin SDK
 * to run OpenClaw agent sessions in isolated VMs with secret injection.
 *
 * Reference: https://github.com/earendil-works/gondolin
 */

import type {
  GondolinVM,
  GondolinVMConfig,
  GondolinExecResult,
  GondolinHttpHooksResult,
  GondolinDNSMode,
  GondolinVFSMounts,
} from "./types.js";

// Re-export types
export type {
  GondolinVM,
  GondolinVMConfig,
  GondolinExecResult,
  GondolinDNSMode,
  GondolinVFSMounts,
} from "./types.js";

/**
 * Provider to environment variable name mapping
 */
export const PROVIDER_ENV_VAR_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
  github: "GITHUB_TOKEN",
  huggingface: "HUGGINGFACE_TOKEN",
  bedrock: "AWS_ACCESS_KEY_ID",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cohere: "COHERE_API_KEY",
  voyage: "VOYAGE_API_KEY",
  replicate: "REPLICATE_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  xai: "XAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  glm: "GLM_API_KEY",
  qianfan: "QIANFAN_API_KEY",
  ollama: "OLLAMA_HOST",
};

/**
 * Provider to API host mapping
 */
const PROVIDER_HOSTS: Record<string, string[]> = {
  anthropic: ["api.anthropic.com"],
  openai: ["api.openai.com"],
  "azure-openai": ["*.openai.azure.com"],
  google: ["generativelanguage.googleapis.com"],
  github: ["api.github.com"],
  huggingface: ["api.huggingface.co"],
  bedrock: ["*.bedrock.amazonaws.com"],
  openrouter: ["openrouter.ai", "api.openrouter.ai"],
  together: ["api.together.xyz"],
  groq: ["api.groq.com"],
  mistral: ["api.mistral.ai"],
  cohere: ["api.cohere.ai"],
  voyage: ["api.voyageai.com"],
  replicate: ["api.replicate.com"],
  perplexity: ["api.perplexity.ai"],
  xai: ["api.x.ai"],
  minimax: ["api.minimax.chat"],
  moonshot: ["api.moonshot.cn"],
  deepseek: ["api.deepseek.com"],
  glm: ["open.bigmodel.cn"],
  qianfan: ["qianfan.baidubce.com"],
  ollama: ["localhost:11434"],
};

/**
 * Get environment variable name for a provider
 */
function getEnvVarName(provider: string): string {
  return PROVIDER_ENV_VAR_MAP[provider.toLowerCase()] || `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Get allowed hosts for a provider
 */
function getAllowedHosts(provider: string): string[] {
  return PROVIDER_HOSTS[provider.toLowerCase()] || [];
}

/**
 * Resolved API key from OpenClaw's auth system
 */
export interface ResolvedApiKey {
  provider: string;
  apiKey: string;
  mode?: string;
}

/**
 * Try to load the gondolin SDK
 * Returns null if not available
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryLoadGondolin(): Promise<any> {
  try {
    const gondolin = await import("@earendil-works/gondolin");
    return gondolin;
  } catch {
    return null;
  }
}

/**
 * Create HTTP hooks for secret injection
 *
 * This function wraps gondolin's createHttpHooks.
 * We pass in REAL secret values, and gondolin generates placeholders internally.
 * The returned `env` contains the placeholder env vars to pass to VM.create().
 *
 * @param apiKeys Array of resolved API keys from OpenClaw's auth system
 * @param additionalHosts Additional hosts to allow
 * @returns HTTP hooks result with hooks and env vars (placeholders)
 *
 * @example
 * ```typescript
 * import { VM } from "@earendil-works/gondolin";
 *
 * const apiKeys = [
 *   { provider: "anthropic", apiKey: "sk-ant-..." },
 *   { provider: "openai", apiKey: "sk-..." },
 * ];
 *
 * const { httpHooks, env } = await createSecretInjector(apiKeys);
 *
 * // env contains GONDOLIN_SECRET_xxx placeholders
 * // httpHooks handles substitution
 * const vm = await VM.create({ httpHooks, env });
 * ```
 */
export async function createSecretInjector(
  apiKeys: ResolvedApiKey[],
  additionalHosts: string[] = []
): Promise<GondolinHttpHooksResult> {
  const gondolin = await tryLoadGondolin();

  const allowedHostsSet = new Set<string>(additionalHosts);

  // Build secrets config with REAL values
  // Gondolin will generate placeholders internally
  const secrets: Record<string, { hosts: string[]; value: string }> = {};

  for (const { provider, apiKey } of apiKeys) {
    if (!apiKey) continue;

    const envVarName = getEnvVarName(provider);
    const hosts = getAllowedHosts(provider);

    // Add hosts to allowlist
    for (const host of hosts) {
      allowedHostsSet.add(host);
    }

    // Pass REAL value - gondolin generates placeholder internally
    secrets[envVarName] = {
      hosts,
      value: apiKey,
    };
  }

  let httpHooks: unknown;
  let env: Record<string, string> = {};

  if (gondolin && gondolin.createHttpHooks) {
    // Use actual SDK - it handles placeholder generation
    const result = gondolin.createHttpHooks({
      allowedHosts: Array.from(allowedHostsSet),
      secrets,
    });

    httpHooks = result.httpHooks;
    env = result.env; // This contains GONDOLIN_SECRET_xxx placeholders
  } else {
    // Return placeholder if gondolin not installed
    httpHooks = {
      allowedHosts: Array.from(allowedHostsSet),
      secrets,
      _placeholder: true,
      _note: "Install @earendil-works/gondolin to enable",
    };

    // Build placeholder env vars (what gondolin would return)
    for (const { provider } of apiKeys) {
      if (!provider) continue;
      const envVarName = getEnvVarName(provider);
      env[envVarName] = `GONDOLIN_SECRET_${provider.toUpperCase()}`;
    }
  }

  return { httpHooks, env };
}

/**
 * Create a Gondolin VM for an agent session
 *
 * @param config VM configuration
 * @returns Created VM instance
 *
 * @example
 * ```typescript
 * import { createGondolinVM, createSecretInjector } from "./gondolin";
 *
 * const { httpHooks, env } = await createSecretInjector(apiKeys);
 *
 * const vm = await createGondolinVM({
 *   sessionLabel: "my-agent-session",
 *   env,  // Contains placeholder env vars
 *   httpHooks,  // Handles secret substitution
 *   vfs: {
 *     mounts: {
 *       "/workspace": new RealFSProvider("/host/workspace"),
 *     },
 *   },
 * });
 *
 * const result = await vm.exec("npm install");
 * await vm.close();
 * ```
 */
export async function createGondolinVM(
  config: GondolinVMConfig
): Promise<GondolinVM> {
  const gondolin = await tryLoadGondolin();

  if (!gondolin) {
    throw new Error(
      "@earendil-works/gondolin is not installed. Run: npm install @earendil-works/gondolin"
    );
  }

  const vm = await gondolin.VM.create(config);
  return vm as GondolinVM;
}

/**
 * Create VFS mounts for workspace
 *
 * @param workspaceDir Host path to workspace
 * @param RealFSProvider RealFSProvider class from gondolin
 * @returns VFS mounts configuration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWorkspaceVFS(
  workspaceDir: string,
  RealFSProvider: new (path: string) => any
): { mounts: { "/workspace": any } } {
  return {
    mounts: {
      "/workspace": new RealFSProvider(workspaceDir),
    },
  };
}

/**
 * Validate VM configuration
 */
export function validateVMConfig(
  config: GondolinVMConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate DNS mode
  if (config.dns?.mode && !["synthetic", "trusted", "open"].includes(config.dns.mode)) {
    errors.push(`Invalid dns mode: ${config.dns.mode}`);
  }

  // Validate resources
  if (config.sandbox?.imagePath === "") {
    errors.push("imagePath cannot be empty");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * List active Gondolin sessions
 */
export async function listGondolinSessions(): Promise<string[]> {
  const gondolin = await tryLoadGondolin();

  if (!gondolin || !gondolin.listSessions) {
    return [];
  }

  const sessions = await gondolin.listSessions();
  return sessions.map((s: { id: string }) => s.id);
}

/**
 * Find a session by label
 */
export async function findGondolinSession(
  label: string
): Promise<GondolinVM | null> {
  const gondolin = await tryLoadGondolin();

  if (!gondolin || !gondolin.findSession) {
    return null;
  }

  const session = await gondolin.findSession(label);
  return session as GondolinVM | null;
}
