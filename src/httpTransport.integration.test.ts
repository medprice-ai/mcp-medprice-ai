import { type ChildProcess, spawn } from "child_process"
import * as path from "path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

// Spawns the real HTTP entry point (src/index.ts) exactly as production
// runs it, and exercises it over the wire - this is the integration-level
// check for issue #43 (see protocolDowngrade.test.ts for the unit-level
// coverage of the pure downgrade logic). GRPC_HOST points at an address
// nothing is listening on: gRPC client construction doesn't connect eagerly,
// and tools/list is served entirely from the static toolDefinitions map, so
// no gRPC call is ever made for these requests.
const PORT = 34117
const BASE_URL = `http://localhost:${PORT}/mcp`

let server: ChildProcess

function toolsListRequest(id: number, protocolVersion?: string) {
  const params = protocolVersion === undefined
    ? undefined
    : {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": protocolVersion,
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  return { jsonrpc: "2.0", id, method: "tools/list", ...(params !== undefined && { params }) }
}

async function postMcp(body: unknown, headers: Record<string, string>) {
  return fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...headers
    },
    body: JSON.stringify(body)
  })
}

// Modern (2026-07-28) responses are only-JSON; legacy (2025-and-earlier)
// responses come back as a single SSE `event: message` frame. Both carry a
// JSON-RPC body either way, so parse whichever shape came back.
async function readJsonRpcBody(res: Response): Promise<any> {
  const text = await res.text()
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "))
    if (!dataLine) throw new Error(`no SSE data frame in response body: ${text}`)
    return JSON.parse(dataLine.slice("data: ".length))
  }
  return JSON.parse(text)
}

beforeAll(async () => {
  server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      TRANSPORT: "http",
      PORT: String(PORT),
      GRPC_HOST: "127.0.0.1:1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not start in time")), 15000)
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("HTTP server listening")) {
        clearTimeout(timeout)
        resolve()
      }
    })
    server.on("error", reject)
    server.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)))
  })
}, 20000)

afterAll(() => {
  server?.kill()
})

describe("HTTP transport: legacy version inside a modern _meta envelope (issue #43)", () => {
  it("serves a request naming 2025-06-18 inside the envelope instead of rejecting it", async () => {
    const res = await postMcp(toolsListRequest(1, "2025-06-18"), { "MCP-Protocol-Version": "2025-06-18" })

    expect(res.status).toBe(200)
    const json = await readJsonRpcBody(res)
    expect(json.error).toBeUndefined()
    expect(json.result.tools).toBeInstanceOf(Array)
    expect(json.result.tools.length).toBeGreaterThan(0)
  })

  it("serves a request naming 2025-11-25 inside the envelope instead of rejecting it", async () => {
    const res = await postMcp(toolsListRequest(2, "2025-11-25"), { "MCP-Protocol-Version": "2025-11-25" })

    expect(res.status).toBe(200)
    const json = await readJsonRpcBody(res)
    expect(json.error).toBeUndefined()
    expect(json.result.tools).toBeInstanceOf(Array)
  })

  it("still serves a genuine modern (2026-07-28) request via the modern path", async () => {
    const res = await postMcp(toolsListRequest(3, "2026-07-28"), {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list"
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    const json = await readJsonRpcBody(res)
    expect(json.error).toBeUndefined()
    expect(json.result.tools).toBeInstanceOf(Array)
  })

  it("still serves a plain legacy request with no envelope at all", async () => {
    const res = await postMcp(toolsListRequest(4), { "MCP-Protocol-Version": "2025-06-18" })

    expect(res.status).toBe(200)
    const json = await readJsonRpcBody(res)
    expect(json.error).toBeUndefined()
    expect(json.result.tools).toBeInstanceOf(Array)
  })

  it("still rejects malformed JSON with a clean parse error, not a 500", async () => {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: "{not valid json"
    })

    expect(res.status).toBe(400)
    const json = await readJsonRpcBody(res)
    expect(json.error.code).toBe(-32700)
  })
})
