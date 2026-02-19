/**
 * Provider to host mapping for Gondolin network allowlists
 *
 * Maps OpenClaw model providers to their API endpoint hosts
 * for use in Gondolin's network allowlist configuration.
 */

/**
 * Maps provider names to their allowed hosts
 */
export interface ProviderHostMap {
  [provider: string]: string[];
}

/**
 * Default host mappings for all supported model providers
 */
export const DEFAULT_PROVIDER_HOSTS: ProviderHostMap = {
  // Anthropic
  anthropic: ["api.anthropic.com"],
  "anthropic-beta": ["api.anthropic.com"],

  // OpenAI
  openai: ["api.openai.com"],
  "azure-openai": ["*.openai.azure.com"],

  // Google
  google: ["generativelanguage.googleapis.com"],
  gemini: ["generativelanguage.googleapis.com"],

  // GitHub
  github: ["api.github.com"],

  // HuggingFace
  huggingface: ["api.huggingface.co", "huggingface.co"],

  // Ollama (local)
  ollama: ["localhost:11434", "127.0.0.1:11434"],

  // AWS Bedrock
  bedrock: ["*.bedrock.amazonaws.com"],

  // OpenRouter
  openrouter: ["openrouter.ai", "api.openrouter.ai"],

  // Together AI
  together: ["api.together.xyz"],

  // Groq
  groq: ["api.groq.com"],

  // Mistral
  mistral: ["api.mistral.ai"],

  // Cohere
  cohere: ["api.cohere.ai"],

  // Voyage AI
  voyage: ["api.voyageai.com"],

  // Replicate
  replicate: ["api.replicate.com"],

  // Perplexity
  perplexity: ["api.perplexity.ai"],

  // xAI
  xai: ["api.x.ai"],

  // MiniMax
  minimax: ["api.minimax.chat"],

  // Moonshot
  moonshot: ["api.moonshot.cn"],

  // DeepSeek
  deepseek: ["api.deepseek.com"],

  // Zhipu/GLM
  glm: ["open.bigmodel.cn"],

  // Qianfan (Baidu)
  qianfan: ["qianfan.baidubce.com"],

  // Ollama (custom host variations)
  "ollama-native": ["localhost:11434", "127.0.0.1:11434"],
};

/**
 * Get the list of allowed hosts for a given provider
 * @param provider The provider name (e.g., "anthropic", "openai")
 * @returns Array of allowed host patterns
 */
export function resolveAllowedHostsForProvider(provider: string): string[] {
  // Try exact match first
  if (DEFAULT_PROVIDER_HOSTS[provider]) {
    return DEFAULT_PROVIDER_HOSTS[provider];
  }

  // Try normalized provider ID
  const normalized = normalizeProviderId(provider);
  if (DEFAULT_PROVIDER_HOSTS[normalized]) {
    return DEFAULT_PROVIDER_HOSTS[normalized];
  }

  // Fallback: try substring match
  for (const [key, hosts] of Object.entries(DEFAULT_PROVIDER_HOSTS)) {
    if (provider.toLowerCase().includes(key.toLowerCase()) ||
        key.toLowerCase().includes(provider.toLowerCase())) {
      return hosts;
    }
  }

  // Default fallback - allow common API domains
  return [];
}

/**
 * Normalize provider ID to standard format
 */
function normalizeProviderId(provider: string): string {
  // Remove common prefixes/suffixes
  let normalized = provider.toLowerCase()
    .replace(/^(https?:\/\/)?/, "")
    .replace(/\/v[0-9]+$/, "")
    .replace(/^api\./, "")
    .replace(/\.com$/, "")
    .replace(/-/g, "");

  // Map known variations
  const mappings: Record<string, string> = {
    "openai": "openai",
    "anthropic": "anthropic",
    "google": "google",
    "gemini": "google",
    "amazon": "bedrock",
    "aws": "bedrock",
  };

  return mappings[normalized] || provider;
}

/**
 * Get all allowed hosts from a list of providers
 * @param providers List of provider names
 * @returns Deduplicated array of allowed hosts
 */
export function resolveAllowedHostsForProviders(providers: string[]): string[] {
  const hostSet = new Set<string>();

  for (const provider of providers) {
    const hosts = resolveAllowedHostsForProvider(provider);
    for (const host of hosts) {
      hostSet.add(host);
    }
  }

  return Array.from(hostSet);
}

/**
 * Get default hosts that should always be allowed
 * (e.g., for OpenClaw's internal communication)
 */
export function getDefaultAllowedHosts(): string[] {
  return [
    // OpenClaw's own services (if any)
    "localhost:*",
    "127.0.0.1:*",
  ];
}
