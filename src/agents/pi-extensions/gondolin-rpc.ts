/**
 * Gondolin RPC - JSON-RPC over Virtio-Serial
 *
 * This module provides RPC communication between the guest VM and host.
 * It uses virtio-serial (hvc1) for communication.
 *
 * Guest side: Sends RPC requests to the host
 * Host side: Handles RPC requests and sends responses back
 */

import * as fs from "node:fs";
import * as readline from "node:readline";

const DEFAULT_SERIAL_PORT = "/dev/hvc1";
const RPC_TIMEOUT_MS = 30000;

/**
 * JSON-RPC message types
 */
export interface RpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Pending RPC call tracker
 */
const pendingCalls = new Map<
  string,
  {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();

let rl: readline.Interface | null = null;
let serialPort: string = DEFAULT_SERIAL_PORT;

/**
 * Generate a unique RPC ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Initialize the RPC reader for incoming messages
 * Should be called once at startup
 */
export function initRpcReader(port: string = DEFAULT_SERIAL_PORT): void {
  serialPort = port;

  // Check if serial port exists (may not exist in all environments)
  if (!fs.existsSync(port)) {
    console.warn(`[Gondolin RPC] Serial port ${port} does not exist, RPC will not work`);
    return;
  }

  const fileStream = fs.createReadStream(port, { encoding: "utf8" });
  rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    try {
      const response = JSON.parse(line) as RpcResponse;
      handleResponse(response);
    } catch {
      console.warn("[Gondolin RPC] Failed to parse RPC response:", line);
    }
  });

  console.log(`[Gondolin RPC] Initialized reader on ${port}`);
}

/**
 * Handle incoming RPC response
 */
function handleResponse(response: RpcResponse): void {
  const pending = pendingCalls.get(response.id);
  if (!pending) {
    console.warn(`[Gondolin RPC] No pending call for ID: ${response.id}`);
    return;
  }

  // Clear timeout
  clearTimeout(pending.timeout);

  if (response.error) {
    pending.reject(new Error(`RPC error: ${response.error.message}`));
  } else {
    pending.resolve(response.result);
  }

  pendingCalls.delete(response.id);
}

/**
 * Make an RPC call to the host
 *
 * @param method The RPC method name (e.g., "proxy.browser")
 * @param params The parameters to pass
 * @param timeout Timeout in milliseconds (default: 30s)
 * @returns The result from the host
 */
export async function rpcCall(
  method: string,
  params: Record<string, unknown>,
  timeout: number = RPC_TIMEOUT_MS,
): Promise<unknown> {
  // Initialize reader if not already done
  if (!rl) {
    initRpcReader(serialPort);
  }

  const id = generateId();
  const request: RpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  const requestStr = JSON.stringify(request) + "\n";

  return new Promise((resolve, reject) => {
    // Set timeout
    const timeoutHandle = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`RPC call ${method} timed out after ${timeout}ms`));
    }, timeout);

    pendingCalls.set(id, { resolve, reject, timeout: timeoutHandle });

    // Write request to serial port
    try {
      fs.appendFileSync(serialPort, requestStr);
    } catch (error) {
      pendingCalls.delete(id);
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to write to serial port: ${String(error)}`));
    }
  });
}

/**
 * Close the RPC connection
 */
export function closeRpc(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
  pendingCalls.clear();
}

/**
 * Host-side: Create an RPC handler that processes requests
 *
 * Usage:
 *   const handler = createRpcHandler({
 *     "proxy.browser": handleBrowserTool,
 *     "proxy.web_fetch": handleWebFetch,
 *   });
 *   vm.onSerialData("/dev/hvc1", handler);
 */
export interface RpcHandlers {
  [method: string]: (params: Record<string, unknown>) => Promise<unknown>;
}

export type RpcHandler = (data: string) => void;

/**
 * Create an RPC handler for the host side
 */
export function createRpcHandler(handlers: RpcHandlers): RpcHandler {
  return (data: string) => {
    try {
      const request = JSON.parse(data) as RpcRequest;

      if (request.method.startsWith("proxy.")) {
        const method = request.method.slice(6); // Remove "proxy." prefix
        const handler = handlers[method];

        if (handler) {
          handler(request.params)
            .then((result) => {
              const response: RpcResponse = {
                jsonrpc: "2.0",
                id: request.id,
                result,
              };
              // This would be written back to the VM
              return response;
            })
            .catch((error) => {
              const response: RpcResponse = {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                  code: -32000,
                  message: error instanceof Error ? error.message : String(error),
                },
              };
              return response;
            });
        }
      }
    } catch (error) {
      console.warn("[Gondolin RPC] Failed to process RPC request:", error);
    }
  };
}
