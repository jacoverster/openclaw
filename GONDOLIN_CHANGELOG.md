# Changelog: feat-gondolin-sandboxing

## Summary

This branch introduces the **Gondolin sandboxing system** for isolated VM-based execution of untrusted code, simplifies the boot-md hook to run once per gateway startup, and refactors the heartbeat subsystem to simplify wake reason handling.

**Total changes:** 42 files, +3602 insertions, -732 deletions

---

## Changes

### Features

#### Gondolin Sandbox Integration

- **New Gondolin agent** (`src/agents/gondolin/`) - VM-based isolation system for safe code execution
  - `constants.ts` - Constants for Gondolin integration
  - `index.ts` - Main agent entry point
  - `provider-hosts.ts` - Provider host configurations
  - `sandbox-config.ts` - Sandbox configuration types
  - `types.ts` - TypeScript type definitions
  - `vm-manager.ts` - VM lifecycle management

- **New Pi extensions** for Gondolin (`src/agents/pi-extensions/gondolin*`)
  - `gondolin.ts` - Pi extension implementation
  - `gondolin-runtime.ts` - Runtime integration
  - `gondolin.test.ts` - Unit tests
  - `gondolin-runtime.test.ts` - Runtime tests

- **New sandbox infrastructure** (`src/agents/sandbox*`)
  - `sandbox.ts` - Core sandbox module
  - `config.ts` - Sandbox configuration
  - `types.ts` - Type definitions
  - `sandbox-merge.e2e.test.ts` - E2E tests

- **New configuration types** (`src/config/types.sandbox.ts`) - Sandbox configuration schema

- **New skill documentation** (`.github/skills/gondolin/SKILL.md`) - Gondolin SDK guide

- **New architecture docs** (`docs/gondolin-integration/ARCHITECTURE.md`) - Integration architecture

---

### Fixes

#### Boot-md Hook Simplification

- **Simplified gateway startup hook** - boot-md now runs once per gateway startup instead of iterating over each configured agent
  - Removed per-agent boot-md execution logic
  - Removed `isGatewayStartupEvent` helper function from internal hooks
  - Handler now expects `workspaceDir` in context instead of resolving from agent config
  - Updated `src/gateway/boot.ts` to remove agent-specific parameters

- **Removed tests:**
  - `handler.gateway-startup.integration.test.ts` - Removed per-agent integration test
  - `handler.test.ts` - Removed per-agent test cases
  - Removed `GatewayStartupHookContext` and `GatewayStartupHookEvent` types

#### Heartbeat Refactoring

- **Removed heartbeat-reason module** - Simplified reason classification logic
  - Removed `src/infra/heartbeat-reason.ts` - Standalone reason classification
  - Removed `src/infra/heartbeat-reason.test.ts` - Unit tests
  - Inlined reason classification directly into `heartbeat-runner.ts` and `heartbeat-wake.ts`

- **Changed heartbeat behavior** - Now runs even when HEARTBEAT.md doesn't exist
  - Previously: skipped heartbeat if HEARTBEAT.md was missing
  - Now: runs heartbeat and lets LLM decide what to do (more flexible)
  - Still skips for empty HEARTBEAT.md files (only comments/headers)

- **Removed heartbeat file dependency in tests** - Many test fixtures no longer require HEARTBEAT.md files

---

### Configuration Updates

- Updated `src/config/types.agents.ts` - Agent configuration types
- Updated `src/config/zod-schema.agent-runtime.ts` - Zod schema validation

---

### Tests

- Added new tests for Pi extensions (`gondolin.test.ts`, `gondolin-runtime.test.ts`)
- Added E2E test for sandbox merge (`sandbox-merge.e2e.test.ts`)
- Removed outdated tests for per-agent boot-md execution
- Removed tests for heartbeat-reason module
- Updated existing heartbeat tests to reflect new behavior
