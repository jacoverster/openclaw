# Gondolin Integration Architecture for OpenClaw

## Executive Summary

This document outlines the architectural design for integrating [Gondolin](https://github.com/earendil-works/gondolin) into OpenClaw to provide enhanced security through VM isolation and secret injection. The integration replaces OpenClaw's existing Docker sandbox with Gondolin's QEMU-based VM sandbox.

**Primary Goals:**

1. Run every OpenClaw agent session in a Gondolin VM for complete isolation
2. Use Gondolin's secret injection to protect API keys and credentials from exposure inside the guest

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Current Implementation Issues (2026-02-20)](#current-implementation-issues-2026-02-20)
3. [Current State Analysis](#current-state-analysis)
4. [Gondolin Integration Points](#gondolin-integration-points)
5. [Secret Injection Design](#secret-injection-design)
6. [Implementation Phases](#implementation-phases)
7. [File Changes Summary](#file-changes-summary)
8. [Security Considerations](#security-considerations)

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HOST MACHINE                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    OpenClaw Gateway Process                         │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │              Gondolin Host SDK                                │   │   │
│  │  │  • VM lifecycle management                                    │   │   │
│  │  │  • Secret injection hooks                                     │   │   │
│  │  │  • Network allowlist enforcement                              │   │   │
│  │  │  • VFS provider for workspace                                 │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                       │   │
│  │                     ┌────────▼────────┐                             │   │
│  │                     │   Gondolin VM   │                             │   │
│  │                     │   (QEMU/KVM)    │                             │   │
│  │                     └────────┬────────┘                             │   │
│  │                              │                                       │   │
│  │  ┌──────────────────────────▼──────────────────────────────────┐  │   │
│  │  │                      Guest OS                                │  │   │
│  │  │  ┌────────────────────────────────────────────────────────┐  │  │   │
│  │  │  │              Node.js Runtime                           │  │  │   │
│  │  │  │  ┌──────────────────────────────────────────────────┐  │  │  │   │
│  │  │  │  │         Pi Coding Agent                          │  │  │  │   │
│  │  │  │  │  • Session management                            │  │  │  │   │
│  │  │  │  │  • Tool execution                                │  │  │  │   │
│  │  │  │  │  • LLM communication (with secret placeholders)  │  │  │  │   │
│  │  │  │  └──────────────────────────────────────────────────┘  │  │  │   │
│  │  │  └────────────────────────────────────────────────────────┘  │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

SECRET FLOW (via HTTP Hooks):
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Host resolves real API key from auth profiles/env vars                 │
│  2. Host injects placeholder (GONDOLIN_SECRET_xxx) as env var in VM       │
│  3. Pi agent makes HTTP request with placeholder in Authorization header  │
│  4. Gondolin host intercepts and replaces placeholder with real key       │
│  5. Forwarded request reaches API provider with real credentials           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Replace Docker with Gondolin**: The existing Docker sandbox in `src/agents/sandbox/` is replaced entirely
2. **Use SDK directly**: Use `@earendil-works/gondolin` SDK directly rather than wrapping in custom classes
3. **Run Pi inside Gondolin**: The Pi coding agent runs inside the Gondolin VM guest
4. **Secret injection at HTTP layer**: All API keys use Gondolin's placeholder-based secret injection via `createHttpHooks()`
5. **Workspace via VFS**: The agent's workspace directory is mounted via Gondolin's VFS system using `RealFSProvider`

### Alternative HTTP Config

The SDK also supports passing HTTP config directly to `VM.create()` without using `createHttpHooks()`:

```typescript
const vm = await VM.create({
  dns: { mode: "trusted" },
  http: {
    allowedHosts: ["api.example.com", "*.github.com"],
    secrets: {
      API_KEY: { hosts: ["api.example.com"], value: process.env.API_KEY! },
    },
    blockInternalRanges: true,
  },
});
```

**Note**: For more complex egress control (custom hooks, request/response monitoring), use `createHttpHooks()` instead.

---

## Current Implementation Issues (2026-02-20)

### ✅ FIXED: Extension Factory Not Being Invoked (2026-02-20)

**Root Cause**: The `DefaultResourceLoader` was being created with `extensionFactories` in `attempt.ts`, but `reload()` was never called on it. The Pi SDK's CLI explicitly calls `await resourceLoader.reload()` before using the resource loader (see `main.ts` in the SDK).

**Fix Applied** (in `src/agents/pi-embedded-runner/run/attempt.ts`):

```typescript
const resourceLoader = new DefaultResourceLoader({
  cwd: resolvedWorkspace,
  agentDir,
  settingsManager,
  additionalExtensionPaths: extensionPaths,
  extensionFactories: extensionFactories,
});

// CRITICAL: Call reload() to load extensions from both paths AND factories
// Without this, extensionFactories are never invoked!
await resourceLoader.reload();
```

**Verification**:

- Logs now show: `[Gondolin] Extension factory invoked with pi, registering tools...`
- Logs show: `[Gondolin] Extension initialized successfully with exec, read, write, edit tools`
- Exec tool now runs inside the Gondolin VM instead of on the host

### Summary of Findings

After analyzing the codebase, we identified that the Gondolin integration has a critical issue: **the Pi extension is never being loaded/initialized**.

### How OpenClaw Uses Pi for Agent Sessions

**Flow:**

1. **attempt.ts** creates a `SandboxContext` via `resolveSandboxContext()`
2. **pi-tools.ts** uses the sandbox context to create tools:
   - `createExecTool()` receives sandbox config including `gondolin`
   - Creates sandboxed read/write/edit tools via fsBridge
3. **bash-tools.exec-runtime.ts** decides how to execute commands:
   - Gondolin enabled → runs locally on host (BROKEN - should run in VM!)
   - Sandbox enabled (Docker) → runs via `docker exec`
   - No sandbox → runs locally on host

### Current Docker Sandbox Architecture

| Component    | File                         | Purpose                                            |
| ------------ | ---------------------------- | -------------------------------------------------- |
| Context      | `sandbox/context.ts`         | Resolves whether to use sandbox, creates workspace |
| Docker       | `sandbox/docker.ts`          | Creates/manages Docker containers                  |
| FS Bridge    | `sandbox/fs-bridge.ts`       | File operations with container                     |
| Exec Runtime | `bash-tools.exec-runtime.ts` | Routes exec to Docker or host                      |

**Docker Flow:**

- `ensureSandboxContainer()` creates container with workspace mount
- Commands run via `docker exec` inside container
- Files accessed via fsBridge (proxies to container)

### Current Gondolin Integration (BROKEN)

**In `sandbox/context.ts`:**

```typescript
if (gondolinEnabled) {
  // Skips Docker container creation
  // Sets containerName: "" (empty)
  // Still creates fsBridge
}
```

**In `bash-tools.exec-runtime.ts`:**

```typescript
if (opts.sandbox && gondolinEnabled) {
  // Runs LOCALLY ON HOST - NOT in VM!
  // Comment says: "Full Gondolin VM integration requires separate process supervisor hook"
}
```

**Pi Extension** (`gondolin.ts`):

- Attempts to override exec/read/write/edit to run in VM
- BUT the extension is NOT being loaded properly (factory never invoked)

### The Core Problem

The gondolin integration has TWO separate mechanisms that BOTH don't work:

1. **Exec Runtime** (`bash-tools.exec-runtime.ts`): Runs commands on host, not in VM
2. **Pi Extension** (`gondolin.ts`): Never gets loaded/initialized

### Key Files That Need Changes

| File                                          | Issue                                         |
| --------------------------------------------- | --------------------------------------------- |
| `src/agents/pi-extensions/gondolin.ts`        | Export pattern doesn't match official example |
| `src/agents/sandbox/context.ts`               | Passes gondolin config but doesn't use VM     |
| `src/agents/bash-tools.exec-runtime.ts`       | Runs commands locally instead of in VM        |
| `src/agents/pi-embedded-runner/extensions.ts` | Extension factory not being invoked           |

### Fix Strategy

Based on the analysis, we have two main options:

**Option A: Fix Pi Extension Loading (Recommended)**

- Refactor `gondolin.ts` to match official example pattern
- Export default function directly instead of using factory wrapper
- Pass config via simpler mechanism (env vars or file)
- Use `createBashTool` instead of custom exec tool

**Option B: Direct Integration**

- Remove Pi extension approach entirely
- Integrate Gondolin SDK directly in `bash-tools.exec-runtime.ts`
- Use VM for exec instead of Docker or host

**Option C: Hybrid**

- Keep Docker as fallback
- Add Gondolin VM support via direct SDK integration
- Use Pi extension only for read/write/edit overrides

---

## Current State Analysis

### Current Agent Execution Flow

```
User Request
     │
     ▼
┌─────────────────────────────────────────┐
│  runEmbeddedPiAgent()                    │
│  (src/agents/pi-embedded-runner/run.ts) │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  getApiKeyForModel()                    │
│  (src/agents/model-auth.ts)             │
│  • Resolves from env vars               │
│  • Auth profiles (JSON)                 │
│  • Config file                          │
│  • OAuth tokens                         │
└────────────────┬────────────────────────┘
                 │
                 ▼ (API key injected into environment)
┌─────────────────────────────────────────┐
│  createAgentSession()                  │
│  (@mariozechner/pi-coding-agent)       │
│  • Runs in current process              │
│  • Uses Docker sandbox                 │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Pi Coding Agent                       │
│  • Executes tools                      │
│  • Makes LLM API calls                 │
│  • Accesses filesystem                 │
└─────────────────────────────────────────┘
```

### Current Credential Handling

Credentials are resolved from multiple sources (in priority order):

1. **Environment variables**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
2. **Auth profiles**: `~/.openclaw/auth-profiles.json`
3. **Config file**: `~/.openclaw/settings.json` → `models.providers`
4. **OAuth tokens**: Stored in auth profile, refreshed automatically

### Current Sandbox

- **Type**: Docker-based (src/agents/sandbox/docker.ts)
- **Security**:
  - Container isolation
  - Network isolation
  - Filesystem mounts for workspace
  - Tool policy enforcement

---

## Gondolin Integration Points

### 1. VM Lifecycle Management

**New File**: `src/agents/gondolin/vm-manager.ts`

```typescript
// Key interfaces
export interface GondolinVMConfig {
  workspaceDir: string;
  allowedHosts: string[];
  secrets: Record<string, GondolinSecret>;
  vfsMounts?: VFSMountConfig[];
}

export interface GondolinSecret {
  hosts: string[]; // Allowed hosts for this secret
  value: string; // Real secret value (resolved from auth profiles)
}

export class GondolinVMManager {
  async createVM(config: GondolinVMConfig): Promise<GondolinVM>;
  async destroyVM(vmId: string): Promise<void>;
  async execInVM(vmId: string, command: string[]): Promise<ExecResult>;
  async attachVM(vmId: string): Promise<void>; // For interactive shell
}
```

### 2. Secret Injection Integration

**New File**: `src/agents/gondolin/secret-injector.ts`

```typescript
// Key interfaces
export interface SecretInjectionConfig {
  // Maps provider/host to secret env var name
  secrets: Record<string, ProviderSecret>;
}

export interface ProviderSecret {
  envVar: string; // e.g., "ANTHROPIC_API_KEY"
  placeholder: string; // e.g., "GONDOLIN_SECRET_abc123"
  hosts: string[]; // e.g., ["api.anthropic.com"]
  value: string; // Real API key (from getApiKeyForModel)
}

export function createSecretInjector(apiKeys: ResolvedProviderAuth[]): SecretInjectionConfig {
  // 1. For each API key, create a secret config
  // 2. Map provider endpoints to hosts
  // 3. Return config for createHttpHooks
}
```

### 3. Sandbox Integration

**Modified File**: `src/agents/sandbox/config.ts`

Add gondolin as a new sandbox type:

```typescript
export type SandboxType = "docker" | "gondolin";

export interface GondolinSandboxConfig {
  type: "gondolin";
  workspaceDir: string;
  // SDK config options passed through
  sandbox?: {
    imagePath?: string;
  };
  dns?: {
    mode: "synthetic" | "trusted" | "open";
    syntheticHostMapping?: "per-host" | "single";
  };
  http?: {
    allowedHosts: string[];
    secrets?: Record<string, { hosts: string[]; value: string }>;
    blockInternalRanges?: boolean;
  };
}
```

### 4. Agent Execution Integration

**Modified File**: `src/agents/pi-embedded-runner/run.ts`

The main change is how the agent session is created and where it runs:

```typescript
// Current flow (simplified):
const apiKeyInfo = await getApiKeyForModel({ model, cfg });
await createAgentSession({
  cwd: resolvedWorkspace,
  agentDir,
  authStorage: params.authStorage,
  modelRegistry: params.modelRegistry,
  // ... other params
});

// New flow with Gondolin SDK:
import { VM, createHttpHooks, RealFSProvider } from "@earendil-works/gondolin";

const apiKeyInfo = await getApiKeyForModel({ model, cfg });

// 1. Create HTTP hooks with secret injection
const { httpHooks, env } = createHttpHooks({
  allowedHosts: resolveAllowedHostsForModel(model),
  secrets: {
    [apiKeyInfo.envVar]: {
      hosts: getHostsForProvider(apiKeyInfo.provider),
      value: apiKeyInfo.apiKey,
    },
  },
});

// 2. Create Gondolin VM with secret injection
const vm = await VM.create({
  httpHooks,
  env: {
    // Guest only sees placeholders!
    [apiKeyInfo.envVar]: env[apiKeyInfo.envVar],
  },
  vfs: {
    mounts: {
      "/workspace": new RealFSProvider(resolvedWorkspace),
    },
  },
});

// 3. Run Pi agent inside VM using vm.exec()
// String form runs via login shell (/bin/sh -lc "...")
const result = await vm.exec(`cd /workspace && node -e "${agentCode}"`);

// Or use array form for direct execution (absolute path required)
// const result = await vm.exec(["/bin/node", "-e", agentCode]);

console.log(result.stdout);
console.log(result.stderr);
console.log(result.exitCode);

// Cleanup
await vm.close();
```

---

## Secret Injection Design

### Overview

Gondolin's secret injection works at the HTTP layer via `createHttpHooks()`:

1. **HTTP Hooks Creation**: Call `createHttpHooks()` with allowed hosts and secrets
2. **Placeholder Generation**: The function generates random placeholders (e.g., `GONDOLIN_SECRET_a1b2c3d4`)
3. **Env Var Injection**: Placeholders are injected as environment variables in the guest via the `env` return value
4. **HTTP Interception**: When the guest makes HTTP requests, gondolin's host-side proxy intercepts
5. **Replacement**: Placeholders in headers/query params are replaced with real values
6. **Forwarding**: Request is forwarded to the actual API endpoint

### What Is Substituted

By default, placeholder substitution happens in **request headers**:

- Plain header values (e.g., `Authorization: Bearer $TOKEN`)
- `Authorization: Basic ...` and `Proxy-Authorization: Basic ...` (decodes, replaces, re-encodes)
- Optional: URL query string (`replaceSecretsInQuery: true`)

**Not substituted**: Request body, URL path, Response content

### Host Matching

Each secret has its own host allowlist (`secrets.NAME.hosts`). Patterns are case-insensitive and support `*` wildcards.

### Implementation Details

#### Step 1: Collect API Keys

```typescript
// In run.ts, before creating VM
const apiKeys = await resolveAllApiKeysForRun(params);

// Returns:
// [
//   { provider: "anthropic", apiKey: "sk-ant-...", hosts: ["api.anthropic.com"], envVar: "ANTHROPIC_API_KEY" },
//   { provider: "openai", apiKey: "sk-...", hosts: ["api.openai.com"], envVar: "OPENAI_API_KEY" },
//   { provider: "github", apiKey: "ghp_...", hosts: ["api.github.com"], envVar: "GITHUB_TOKEN" },
// ]
```

#### Step 2: Create HTTP Hooks with Secret Injection

```typescript
import { createHttpHooks, RealFSProvider } from "@earendil-works/gondolin";

const secretsConfig: Record<string, { hosts: string[]; value: string }> = {};
const envVars: Record<string, string> = {};

for (const apiKey of apiKeys) {
  secretsConfig[apiKey.envVar] = {
    hosts: apiKey.hosts,
    value: apiKey.apiKey,
  };
}

const { httpHooks, env } = createHttpHooks({
  allowedHosts: [
    "api.anthropic.com",
    "api.openai.com",
    "api.github.com",
    // ... other model providers
  ],
  secrets: secretsConfig,
  blockInternalRanges: true,
});

// env now contains placeholders like { ANTHROPIC_API_KEY: "GONDOLIN_SECRET_xxx", ... }
```

#### Step 3: Pass to VM Creation

```typescript
const vm = await VM.create({
  httpHooks,
  env: {
    // Guest only sees placeholders, not real values!
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    GITHUB_TOKEN: env.GITHUB_TOKEN,
    // ... other env vars
  },
  vfs: {
    mounts: {
      "/workspace": new RealFSProvider(workspaceDir),
    },
  },
});
```

### Host Allowlist Strategy

Each model provider maps to specific hosts:

| Provider    | Hosts                             |
| ----------- | --------------------------------- |
| anthropic   | api.anthropic.com                 |
| openai      | api.openai.com, openai.azure.com  |
| github      | api.github.com                    |
| huggingface | api.huggingface.co                |
| ollama      | localhost:11434                   |
| bedrock     | \*.bedrock.amazonaws.com          |
| google      | generativelanguage.googleapis.com |

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic gondolin VM creation and destruction using SDK

**Files Created:**

- `src/agents/gondolin/index.ts` - Module exports (re-exports SDK)
- `src/agents/gondolin/types.ts` - Additional type definitions if needed

**Changes:**

- Add `@earendil-works/gondolin` dependency to package.json
- Create config option for sandbox type
- Use `VM.create()` directly from SDK

**Tests:**

- VM creation/destruction
- Basic command execution via `vm.exec()`
- Platform detection (macOS/Linux)

### Phase 2: Secret Injection (Week 3-4)

**Goal**: API keys use gondolin secret injection via `createHttpHooks()`

**Changes:**

- Use `createHttpHooks()` from SDK to create HTTP hooks
- Pass both `httpHooks` and `env` to `VM.create()`
- Modify `src/agents/model-auth.ts` to support placeholder resolution
- Modify `src/agents/pi-embedded-runner/run.ts` to use secret injection

**Tests:**

- Verify placeholders are injected in VM
- Verify HTTP requests have real values
- Verify placeholders never appear in logs

### Phase 3: Workspace Integration (Week 5-6)

**Goal**: Agent workspace accessible inside VM using SDK VFS providers

**Changes:**

- Use `RealFSProvider` from SDK for workspace mounts
- Configure VFS mounts in `VM.create()` call
- Use SDK's `vm.readFile()`, `vm.writeFile()`, `vm.deleteFile()` for file operations
- Handle persistent storage for session files

**Tests:**

- Files created in VM persist to host
- Session files accessible after VM restart
- File operations work correctly

### Phase 4: Tool Execution (Week 7-8)

**Goal**: Bash tools execute inside Gondolin VM with PTY support

**Changes:**

- Modify `src/agents/bash-tools.exec.ts` to use `vm.exec()`
- Implement interactive shell support using PTY (`pty: true` option)
- Use SDK streaming for large outputs
- Use exec result helpers (`json<T>()`, `lines()`)

**Tests:**

- Bash commands execute in VM
- PTY support for interactive commands
- Tool output captured correctly
- Streaming works for large outputs

### Phase 5: Advanced Features (Week 9-10)

**Goal**: Implement disk checkpoints, ingress, and session management

**Changes:**

- Implement disk checkpoints using `vm.checkpoint()` and `checkpoint.resume()`
- Add ingress for exposing guest services to host via `vm.enableIngress()`
- Add session management using SDK functions (`listSessions`, `findSession`, etc.)
- Configure DNS mode (synthetic vs trusted)

**Tests:**

- Checkpoint creation and resume work correctly
- Ingress routing works
- Session management functions operate correctly
- DNS resolution works for allowed hosts

### Phase 6: Migration & Cleanup (Week 11-12)

**Goal**: Complete migration from Docker

**Changes:**

- Make gondolin the default sandbox
- Remove Docker sandbox code paths
- Update documentation

**Tests:**

- Full end-to-end agent runs
- Performance benchmarking
- Migration tooling

---

## File Changes Summary

### New Files

| File                           | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `src/agents/gondolin/index.ts` | Module exports (re-exports SDK)         |
| `src/agents/gondolin/types.ts` | Additional type definitions (if needed) |

**Note**: Most functionality is provided directly by the SDK (`@earendil-works/gondolin`):

- `VM` class for lifecycle management
- `createHttpHooks` for secret injection
- `RealFSProvider`, `MemoryProvider` for VFS
- Session management functions
- Image management functions

### Modified Files

| File                                           | Changes                                   |
| ---------------------------------------------- | ----------------------------------------- |
| `src/agents/sandbox/config.ts`                 | Add gondolin sandbox type                 |
| `src/agents/sandbox/index.ts`                  | Export gondolin sandbox                   |
| `src/agents/pi-embedded-runner/run.ts`         | Use `VM.create()` and secret injection    |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Execute in VM using `vm.exec()`           |
| `src/agents/model-auth.ts`                     | Support placeholder resolution            |
| `src/agents/bash-tools.exec.ts`                | Use `vm.exec()` with PTY support          |
| `src/agents/cli-credentials.ts`                | Support gondolin secrets                  |
| `package.json`                                 | Add `@earendil-works/gondolin` dependency |

### Removed Files (Phase 6)

| File                                      | Reason               |
| ----------------------------------------- | -------------------- |
| `src/agents/sandbox/docker.ts`            | Replaced by gondolin |
| `src/agents/sandbox/docker.config-hash-*` | Not needed           |

---

## Security Considerations

### Threat Model

Gondolin protects against:

1. **Credential Theft**: API keys not readable inside VM
2. **Network Egress**: Only allowed hosts reachable
3. **Filesystem Access**: Controlled via VFS mounts
4. **VM Escape**: QEMU isolation (host trusted)

### Operational Security

1. **No Secrets in Logs**: Placeholders never logged
2. **No Secrets in Image**: Guest image contains no real keys
3. **Host Allowlist**: Only documented endpoints reachable
4. **Audit Trail**: All network requests traceable

### Migration Path

1. **Opt-in First**: New `sandbox.type: "gondolin"` config option
2. **Gradual Rollout**: Percentage-based deployment
3. **Default Flip**: Make gondolin default after stability
4. **Deprecation**: Remove Docker sandbox after transition

### Performance Impact

- **Startup**: Gondolin VM boot ~3-5 seconds (vs Docker ~1-2s)
- **Network**: HTTP proxy adds ~5-10ms latency per request
- **Storage**: VFS adds minimal overhead

---

## Appendix: Configuration Schema

### New Config Options

```typescript
// In config types
interface GondolinConfig {
  enabled: boolean;
  dnsMode?: "synthetic" | "trusted" | "open";
  allowedHosts?: string[];
  vfs?: {
    workspaceMount: string;
    sessionMount?: string;
  };
}

// In sandbox config
interface OpenClawConfig {
  sandbox?: {
    type: "docker" | "gondolin";
    gondolin?: GondolinConfig;
  };
}
```

### CLI Usage

```bash
# Run agent with gondolin
openclaw agent --sandbox gondolin "Fix the bug"

# Interactive shell
openclaw gondolin bash

# List VMs
openclaw gondolin list
```

---

## References

- [Gondolin GitHub](https://github.com/earendil-works/gondolin)
- [Gondolin Security Docs](https://earendil-works.github.io/gondolin/security/)
- [Gondolin Secrets Docs](https://earendil-works.github.io/gondolin/secrets/)
- [Pi Gondolin Example](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts)
