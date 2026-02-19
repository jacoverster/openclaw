# Physical Integration Test Plan

## Overview

This test plan covers physical integration testing for the `feat-gondolin-sandboxing` branch. Tests should be executed on real hardware/infrastructure to validate the changes work correctly in production-like environments.

---

## Test Categories

### 1. Gondolin Sandbox Integration

**Objective:** Verify the Gondolin VM-based isolation system works correctly for safe code execution.

#### Prerequisites

- Docker installed and running
- Node.js 22+ installed
- Access to `@earendil-works/gondolin` package

#### Test Cases

| ID     | Test Case                                   | Expected Result                                      | Priority |
| ------ | ------------------------------------------- | ---------------------------------------------------- | -------- |
| GON-01 | Create a basic Gondolin VM                  | VM instance created successfully                     | Critical |
| GON-02 | Execute command inside VM                   | Command runs and returns correct output              | Critical |
| GON-03 | Test VM network isolation                   | VM cannot access internet (if mode set to synthetic) | High     |
| GON-04 | Test VFS mounts                             | Host files accessible inside guest                   | High     |
| GON-05 | Test secrets injection                      | API keys available inside guest, not visible to host | High     |
| GON-06 | Test ingress (expose guest service to host) | HTTP service in guest accessible from host           | Medium   |
| GON-07 | Test VM cleanup                             | VM closes cleanly, resources freed                   | High     |
| GON-08 | Test exec cancellation                      | Long-running command can be aborted                  | Medium   |

#### Test Commands

```bash
# Test VM creation and exec
pnpm tsx test-gondolin-vm.ts

# Test network isolation
pnpm tsx test-gondolin-network.ts

# Test secrets injection
pnpm tsx test-gondolin-secrets.ts

# Test ingress
pnpm tsx test-gondolin-ingress.ts
```

---

### 2. Boot-md Hook Changes

**Objective:** Verify boot-md runs once at gateway startup with correct workspace directory.

#### Prerequisites

- OpenClaw gateway installed
- Valid `BOOT.md` file in workspace
- Gateway configuration set up

#### Test Cases

| ID      | Test Case                            | Expected Result               | Priority |
| ------- | ------------------------------------ | ----------------------------- | -------- |
| BOOT-01 | Gateway startup with BOOT.md         | Boot checklist runs once      | Critical |
| BOOT-02 | Gateway startup without BOOT.md      | No error, gracefully skipped  | High     |
| BOOT-03 | Gateway startup with multiple agents | Runs once with main workspace | High     |
| BOOT-04 | BOOT.md with actionable content      | Content is processed          | Critical |

#### Test Commands

```bash
# Start gateway and check boot-md runs
openclaw gateway run --debug

# Check logs for boot-md execution
tail -f ~/.openclaw/logs/gateway.log | grep boot-md
```

---

### 3. Heartbeat Behavior Changes

**Objective:** Verify heartbeat runs correctly with the new behavior (runs even when HEARTBEAT.md doesn't exist).

#### Prerequisites

- OpenClaw gateway running
- WhatsApp or other messaging channel configured

#### Test Cases

| ID    | Test Case                                | Expected Result              | Priority |
| ----- | ---------------------------------------- | ---------------------------- | -------- |
| HB-01 | Heartbeat with HEARTBEAT.md (empty)      | Heartbeat skipped            | High     |
| HB-02 | Heartbeat with HEARTBEAT.md (actionable) | Heartbeat runs               | Critical |
| HB-03 | Heartbeat without HEARTBEAT.md           | Heartbeat runs (LLM decides) | Critical |
| HB-04 | Heartbeat with cron event                | Uses cron prompt             | High     |
| HB-05 | Heartbeat with wake event                | Uses wake prompt             | High     |
| HB-06 | Heartbeat with exec event                | Uses exec prompt             | High     |

#### Test Commands

```bash
# Trigger manual heartbeat
openclaw infra heartbeat --agent main --reason manual

# Check heartbeat status
openclaw status --deep | grep heartbeat

# Verify cron event triggers heartbeat
openclaw cron run --job test-cron --force
```

---

### 4. End-to-End Scenarios

**Objective:** Verify complete workflows work correctly after changes.

#### Test Cases

| ID     | Test Case                   | Expected Result                               | Priority |
| ------ | --------------------------- | --------------------------------------------- | -------- |
| E2E-01 | Full sandbox workflow       | VM executes code, returns result, cleans up   | Critical |
| E2E-02 | Gateway boot with heartbeat | Gateway starts, boot-md runs, heartbeat works | High     |
| E2E-03 | Agent message with sandbox  | Message triggers sandbox execution            | Critical |

---

## Test Environment Setup

### Required Services

- Docker daemon running
- OpenClaw gateway installed
- At least one messaging channel configured (WhatsApp/Telegram/Discord)

### Environment Variables

```bash
export GONDOLIN_ENABLED=true
export OPENCLAW_LOG_LEVEL=debug
```

### Test Data

- Test workspace directory: `/tmp/openclaw-test-workspace`
- Test BOOT.md: `/tmp/openclaw-test-workspace/BOOT.md`
- Test HEARTBEAT.md: `/tmp/openclaw-test-workspace/HEARTBEAT.md`

---

## Success Criteria

- All Critical (P0) tests pass
- All High Priority (P1) tests pass
- No regressions in existing functionality
- Gateway starts cleanly with new code

---

## Known Limitations

- Gondolin requires Docker - tests will fail without Docker
- Network isolation tests require isolated network environment
- Some heartbeat tests require real messaging channel credentials
