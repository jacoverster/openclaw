---
name: gondolin
description: Comprehensive guide for using the Gondolin SDK (@earendil-works/gondolin) to create and manage isolated VMs for safe execution of untrusted code. Use when Claude needs to: (1) Run code in an isolated sandbox environment, (2) Execute commands safely with network controls, (3) Set up ingress to expose guest services to the host, (4) Manage VFS mounts and storage checkpoints, (5) Configure HTTP egress policies and secrets injection.
---

# Gondolin SDK

Gondolin is a VM-based isolation system that provides strong security boundaries for running untrusted code. The SDK (`@earendil-works/gondolin`) enables programmatic control of VM lifecycle, networking, storage, and execution.

## Quick Start

```ts
import { VM } from "@earendil-works/gondolin";

const vm = await VM.create();

// String form runs via `/bin/sh -lc "..."`
const result = await vm.exec("curl -sS -f https://example.com/");

console.log("exitCode:", result.exitCode);
console.log("stdout:\n", result.stdout);
console.log("stderr:\n", result.stderr);

await vm.close();
```

## Typical SDK Flow

1. Create a VM with `VM.create(...)`
2. Run commands via `vm.exec(...)` or open an interactive shell
3. Configure optional policy/hooks (network, ingress, SSH, VFS)
4. Close the VM with `vm.close()`

## VM Lifecycle

### Creating a VM

```ts
const vm = await VM.create({
  // Configure sandbox settings
  sandbox: {
    // Custom image path for guest assets
    imagePath: "./my-assets",
  },

  // Network configuration
  dns: {
    mode: "synthetic", // "synthetic" | "trusted" | "open"
    syntheticHostMapping: "per-host",
  },

  // VFS mounts
  vfs: {
    mounts: {
      "/workspace": new RealFSProvider("/host/workspace"),
      "/scratch": new MemoryProvider(),
    },
  },

  // Auto-start (default: true)
  autoStart: true,
});
```

### Lifecycle Methods

- `vm.start()` - Explicitly start the VM (if autoStart: false)
- `vm.close()` - Shutdown the VM and cleanup resources
- `vm.id` - Session UUID for CLI integration (`gondolin list`, `gondolin attach`)

### Session Management

```ts
// Customize session label
const vm = await VM.create({ sessionLabel: "my-task" });

// Access session utilities
import {
  listSessions,
  findSession,
  gcSessions,
  connectToSession,
} from "@earendil-works/gondolin";
```

## Command Execution

### vm.exec()

The primary method for running commands inside the guest. Returns an `ExecProcess` that is both Promise-like and Stream-like.

**Two forms:**

- **String form**: `vm.exec("...")` - runs via login shell (`/bin/sh -lc "..."`)
- **Array form**: `vm.exec([cmd, ...argv])` - executes directly (must use absolute path, no $PATH search)

```ts
// Shell features (pipelines, $VARS, globbing, $(...))
const result = await vm.exec("echo $HOME | wc -c");

// Direct execution (absolute path required)
const result = await vm.exec(["/bin/echo", "hello"]);
```

### ExecResult Properties

```ts
const result = await vm.exec("echo hello; echo err >&2; exit 7");

console.log("exitCode:", result.exitCode); // 7
console.log("ok:", result.ok); // false (shorthand for exitCode === 0)
console.log("stdout:\n", result.stdout); // "hello\n"
console.log("stderr:\n", result.stderr); // "err\n"

// Helpers
result.json<T>(); // Parse stdout as JSON
result.lines(); // Split stdout into lines
```

### Streaming Output

```ts
const proc = vm.exec("for i in 1 2 3; do echo $i; sleep 1; done", {
  stdout: "pipe",
});

for await (const chunk of proc) {
  process.stdout.write(chunk);
}

const result = await proc;
console.log(result.exitCode);
```

### Process Attachment (PTY)

```ts
const proc = vm.exec(["/bin/bash", "-i"], {
  stdin: true,
  pty: true,
  stdout: "pipe",
  stderr: "pipe",
});

proc.attach(
  process.stdin as NodeJS.ReadStream,
  process.stdout as NodeJS.WriteStream,
  process.stderr as NodeJS.WriteStream,
);

const result = await proc;
```

### Avoiding Large Buffers

```ts
// Drop stdout/stderr for commands with large output
const result = await vm.exec(["/bin/cat", "/some/huge/file"], {
  buffer: false,
});

// Or stream with backpressure
const proc = vm.exec(["/bin/cat", "/huge"], { stdout: "pipe", buffer: false });
for await (const chunk of proc) process.stdout.write(chunk);
```

### Cancellation

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 1000);

try {
  const result = await vm.exec(["/bin/sleep", "10"], { signal: ac.signal });
} catch (err) {
  // "exec aborted"
}
```

## File Operations

Host-driven file operations inside the guest:

```ts
// Read text
const osRelease = await vm.readFile("/etc/os-release", { encoding: "utf-8" });

// Stream-read large file
const stream = await vm.readFileStream("/var/log/messages");
for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// Write text (overwrites existing file)
await vm.writeFile("/tmp/hello.txt", "hello from host\n");

// Stream-write from Node readable
await vm.writeFile(
  "/tmp/payload.bin",
  Readable.from([Buffer.from([0xde, 0xad])]),
);

// Delete file
await vm.deleteFile("/tmp/hello.txt");

// Delete recursively / ignore missing
await vm.deleteFile("/tmp/some-dir", { recursive: true, force: true });
```

## Networking

### Secrets Handling (SDK)

Gondolin allows you to inject API keys/tokens into the guest without the guest directly reading them:

```ts
import { VM, createHttpHooks } from "@earendil-works/gondolin";

const { httpHooks, env } = createHttpHooks({
  allowedHosts: ["api.github.com"],
  secrets: {
    GITHUB_TOKEN: {
      hosts: ["api.github.com"],
      value: process.env.GITHUB_TOKEN!,
    },
  },
});

const vm = await VM.create({ httpHooks, env });
```

**Important**: Pass both `httpHooks` and `env`. If you only pass `httpHooks`, the guest won't have placeholder env vars.

#### What Is Substituted

By default, placeholder substitution happens in **request headers**:

- Plain header values (e.g., `Authorization: Bearer $TOKEN`)
- `Authorization: Basic ...` and `Proxy-Authorization: Basic ...` (decodes, replaces, re-encodes)
- Optional: URL query string (`replaceSecretsInQuery: true`)

**Not substituted**: Request body, URL path, Response content

#### Host Matching

Each secret has its own host allowlist (`secrets.NAME.hosts`). Patterns are case-insensitive and support `*` wildcards.

#### Operational Guidance

- Prefer header-based auth over query parameters
- Keep `replaceSecretsInQuery` disabled unless required
- Do not pass real secrets via `VM.env` or image build config
- Do not mount host secret files (`~/.aws`, `.env`, etc.) into guest
- Treat allowed hosts as trusted egress

### HTTP Egress Control

### HTTP Egress Control

Configure allowed hosts and secrets injection:

```ts
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

**HTTP Hooks for egress:**

```ts
import { createHttpHooks } from "@earendil-works/gondolin";

const { httpHooks, env } = createHttpHooks({
  allowedHosts: ["api.example.com", "*.github.com"],
  secrets: {
    API_KEY: { hosts: ["api.example.com"], value: process.env.API_KEY! },
  },
  blockInternalRanges: true,
  isRequestAllowed: (req) => req.method !== "DELETE",
  isIpAllowed: ({ ip }) => !ip.startsWith("203.0.113."),
  onRequestHead: async (req) => {
    console.log(req.url);
    return req;
  },
  onResponse: async (res, req) => {
    console.log(req.url, res.status);
    return res;
  },
});
```

### Ingress (Expose Guest Services to Host)

Ingress exposes HTTP servers running inside the guest to the host machine. It works by:

1. Starting a guest helper (`sandboxingress`) that opens TCP connections to guest loopback
2. Starting a host-side HTTP gateway on a host port
3. Routing requests to guest-local servers based on `/etc/gondolin/listeners`

```ts
const vm = await VM.create();

// Enable ingress gateway
const ingress = await vm.enableIngress({
  listenHost: "127.0.0.1",
  listenPort: 0, // ephemeral port
});

console.log("Ingress:", ingress.url);

// Route all requests to guest server on port 8000
vm.setIngressRoutes([{ prefix: "/", port: 8000, stripPrefix: true }]);

// Start server in guest (blocks exec - use carefully)
const server = vm.exec(["/bin/sh", "-lc", "python -m http.server 8000"], {
  buffer: false,
  stdout: "inherit",
  stderr: "inherit",
});

// ... guest service available at ingress.url

await ingress.close();
await vm.close();
```

#### Routing Table

Routes are configured in `/etc/gondolin/listeners`. Format: `<prefix> :<port> [key=value ...]`

```
# Send everything to port 8000
/ :8000

# Route /api/* to port 9000, strip prefix
/api :9000

# Disable prefix stripping
/api :9000 strip_prefix=false
```

- **Prefix matching**: Longest matching prefix wins (`/api/users` -> `:9000`, `/about` -> `:8000`)
- **Strip prefix**: By default, prefix is stripped before forwarding (`GET /api/users` -> `GET /users`)

#### Ingress Behavior & Limitations

- Gateway only speaks HTTP (HTTP/1.1)
- WebSocket upgrades supported by default (disable via `allowWebSockets: false`)
- Each request uses fresh guest loopback TCP connection
- Guest backend must be reachable on `127.0.0.1:<port>`
- Ingress requires default `/etc/gondolin` mount - do not override it
- 404 = no route matched, 502 = could not connect to backend

```ts
const vm = await VM.create();

// Enable ingress gateway
const ingress = await vm.enableIngress({
  listenHost: "127.0.0.1",
  listenPort: 0, // ephemeral port
});

console.log("Ingress:", ingress.url);

// Route all requests to guest server on port 8000
vm.setIngressRoutes([{ prefix: "/", port: 8000, stripPrefix: true }]);

// Start server in guest (blocks exec - use carefully)
const server = vm.exec(["/bin/sh", "-lc", "python -m http.server 8000"], {
  buffer: false,
  stdout: "inherit",
  stderr: "inherit",
});

// ... guest service available at ingress.url

await ingress.close();
await vm.close();
```

**Ingress Hooks:**

```ts
import { IngressRequestBlockedError } from "@earendil-works/gondolin";

await vm.enableIngress({
  hooks: {
    isAllowed: ({ clientIp, path }) => {
      if (path.startsWith("/admin")) {
        throw new IngressRequestBlockedError(
          `admin blocked for ${clientIp}`,
          403,
          "Forbidden",
          "nope\n",
        );
      }
      return true;
    },
    onRequest: (req) => ({
      // Rewrite /api/* -> /* inside guest
      backendTarget: req.backendTarget.startsWith("/api/")
        ? req.backendTarget.slice(4)
        : req.backendTarget,
      headers: { "x-added": "1", "x-remove": null },
      bufferResponseBody: req.backendTarget.endsWith(".json"),
    }),
    onResponse: (res) => ({
      headers: { "x-ingress": "1" },
      body: res.body
        ? Buffer.from(res.body.toString("utf8").toUpperCase())
        : undefined,
    }),
  },
});
```

## Storage & Snapshots

### VFS Providers

Mount host-backed paths into the guest:

```ts
import { VM, RealFSProvider, MemoryProvider } from "@earendil-works/gondolin";

const vm = await VM.create({
  vfs: {
    mounts: {
      "/workspace": new RealFSProvider("/host/workspace"),
      "/scratch": new MemoryProvider(),
    },
  },
});
```

See [VFS Providers](https://earendil-works.github.io/gondolin/vfs) for blocking, read-only mounts, and hooks.

### Disk Checkpoints (qcow2)

Capture and resume VM disk state:

```ts
const base = await VM.create();

// Install packages / write to root filesystem
await base.exec("apk add git");
await base.exec("echo hello > /etc/my-base-marker");

// Create checkpoint
const checkpointPath = path.resolve("./dev-base.qcow2");
const checkpoint = await base.checkpoint(checkpointPath);

// Resume from checkpoint (multiple times for parallel tasks)
const task1 = await checkpoint.resume();
const task2 = await checkpoint.resume();

// Both VMs start from same disk state, diverge independently
await task1.close();
await task2.close();

// Cleanup
checkpoint.delete();
```

**Notes:**

- Disk-only (no RAM/process restore)
- Checkpoint is a single `.qcow2` file with JSON trailer
- Requires guest assets with `manifest.json` including deterministic `buildId`
- Some paths are tmpfs-backed (`/root`, `/tmp`, `/var/log`) and not checkpointed

## Image Management

```ts
import {
  hasGuestAssets,
  ensureGuestAssets,
  getAssetDirectory,
} from "@earendil-works/gondolin";

console.log("Assets available:", hasGuestAssets());
console.log("Asset directory:", getAssetDirectory());

// Download if needed
const assets = await ensureGuestAssets();
console.log("Kernel:", assets.kernelPath);
```

Override cache location:

```bash
export GONDOLIN_GUEST_DIR=/path/to/assets
```

## Error Handling

- Non-zero exit codes do NOT throw - always check `result.exitCode` or `result.ok`
- Aborting currently rejects the local promise (does not guarantee guest process termination)
- Ingress requires default `/etc/gondolin` mount
