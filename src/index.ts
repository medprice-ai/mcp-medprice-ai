import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as path from "path"

import { z } from "zod"

import { Server } from "@modelcontextprotocol/sdk/server/index.js"

import { StdioServerTransport }
from "@modelcontextprotocol/sdk/server/stdio.js"

import { StreamableHTTPServerTransport }
from "@modelcontextprotocol/sdk/server/streamableHttp.js"

import * as http from "http"

import {
  CallToolRequestSchema,
  ListToolsRequestSchema
}
from "@modelcontextprotocol/sdk/types.js"

const grpcHost = process.env.GRPC_HOST
if (!grpcHost) {
  process.stderr.write("FATAL: GRPC_HOST env var is not set\n")
  process.exit(1)
}

// Defaults to TLS so production (no env override) stays secure.
// Set GRPC_INSECURE=true for local dev against a plaintext gRPC server.
const grpcCredentials =
  process.env.GRPC_INSECURE === "true"
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl()

const logStream = process.env.TRANSPORT === "http" ? process.stdout : process.stderr

function log(level: "INFO" | "WARN" | "ERROR", message: string, extra?: Record<string, unknown>) {
  logStream.write(JSON.stringify({ severity: level, message, ...extra }) + "\n")
}

const protoLoaderOptions: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
}

let client: any
let registryClient: any

try {
  const costPackage = grpc.loadPackageDefinition(
    protoLoader.loadSync(
      path.resolve(__dirname, "../proto/hospital_code_cost.proto"),
      protoLoaderOptions
    )
  ) as any

  client = new costPackage.ai.medprice.api.HospitalCodeCostService(
    grpcHost,
    grpcCredentials
  )

  const registryPackage = grpc.loadPackageDefinition(
    protoLoader.loadSync(
      path.resolve(__dirname, "../proto/hospital_registry.proto"),
      protoLoaderOptions
    )
  ) as any

  registryClient = new registryPackage.ai.medprice.api.HospitalRegistryService(
    grpcHost,
    grpcCredentials
  )

  log("INFO", "proto loaded, gRPC clients ready", {
    grpc_host: grpcHost,
    grpc_tls: process.env.GRPC_INSECURE !== "true"
  })
} catch (err) {
  log("ERROR", "FATAL: failed to initialize gRPC client", { error: String(err) })
  process.exit(1)
}


function createMcpServer(): Server {
  const server =
    new Server(
      {
        name:
          "mcp-medprice-ai",
        version:
          "0.0.1"
      },
      {
        capabilities: {
          tools: ({
            get_hospital_chargemaster_cost: {
              name: "get_hospital_chargemaster_cost",
              title: "Get hospital chargemaster cost",
              description: "Lookup hospital chargemaster cost",
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: false
              },
              inputSchema: {
                type: "object",
                properties: {
                  code_type: {
                    type: "string",
                    description: "Code system the chargemaster/billing code belongs to, e.g. APR-DRG, CDM, CPT, HCPCS, MS-DRG, RC. Hospitals may also support additional proprietary code types not listed here."
                  },
                  code: { type: "string" },
                  methodology: {
                    type: "string",
                    enum: [
                      "case rate",
                      "fee schedule",
                      "other",
                      "percent of total billed charges",
                      "per diem"
                    ],
                    description: "Pricing methodology. Omit to aggregate across all methodologies."
                  }
                },
                required: ["code_type", "code"]
              }
            },
            list_hospitals: {
              name: "list_hospitals",
              title: "List supported hospitals",
              description: "Returns the hospitals supported by the medprice.ai API, with their hospital_id (opaque DB key), EIN, name, and locations. Supports pagination.",
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: false
              },
              inputSchema: {
                type: "object",
                properties: {
                  page_size: {
                    type: "integer",
                    description: "Maximum number of hospitals to return. Defaults to 20, capped at 100."
                  },
                  page_token: {
                    type: "string",
                    description: "Opaque token from a previous list_hospitals response. Omit for the first page."
                  }
                }
              }
            }
          } as any)
        }
      }
    )

  server.setRequestHandler(
    ListToolsRequestSchema,

    async () => ({
      tools: [
        {
          name: "get_hospital_chargemaster_cost",
          title: "Get hospital chargemaster cost",
          description: "Lookup hospital chargemaster cost",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false
          },
          inputSchema: {
            type: "object",
            properties: {
              code_type: {
                type: "string",
                description: "Code system the chargemaster/billing code belongs to, e.g. APR-DRG, CDM, CPT, HCPCS, MS-DRG, RC. Hospitals may also support additional proprietary code types not listed here."
              },
              code: {
                type: "string"
              },
              methodology: {
                type: "string",
                enum: [
                  "case rate",
                  "fee schedule",
                  "other",
                  "percent of total billed charges",
                  "per diem"
                ],
                description: "Pricing methodology. Omit to aggregate across all methodologies."
              }
            },
            required: [
              "code_type",
              "code"
            ]
          }
        },
        {
          name: "list_hospitals",
          title: "List supported hospitals",
          description: "Returns the hospitals supported by the medprice.ai API, with their hospital_id (opaque DB key), EIN, name, and locations. Supports pagination.",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false
          },
          inputSchema: {
            type: "object",
            properties: {
              page_size: {
                type: "integer",
                description: "Maximum number of hospitals to return. Defaults to 20, capped at 100."
              },
              page_token: {
                type: "string",
                description: "Opaque token from a previous list_hospitals response. Omit for the first page."
              }
            }
          }
        }
      ]
    })
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      if (request.params.name === "get_hospital_chargemaster_cost") {
        const args = z.object({
          code_type: z.string(),
          code: z.string(),
          methodology: z.string().optional()
        }).parse(request.params.arguments)

        log("INFO", "grpc request", { tool: "get_hospital_chargemaster_cost", code_type: args.code_type, code: args.code })
        const grpcStart = Date.now()

        let response: unknown
        try {
          response = await new Promise((resolve, reject) => {
            client.GetHospitalCodeCost(
              { code_type: args.code_type, code: args.code, methodology: args.methodology ?? "" },
              (err: any, resp: any) => {
                if (err) reject(err)
                else resolve(resp)
              }
            )
          })
        } catch (err) {
          log("ERROR", "grpc request failed", { tool: "get_hospital_chargemaster_cost", code_type: args.code_type, code: args.code, duration_ms: Date.now() - grpcStart, error: String(err) })
          throw err
        }

        log("INFO", "grpc response", { tool: "get_hospital_chargemaster_cost", code_type: args.code_type, code: args.code, duration_ms: Date.now() - grpcStart })

        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              response,
              // proto3 `optional` fields are backed by synthetic oneofs; with
              // oneofs:true the decoder leaks "_fieldName" indicator keys — strip them
              (key, value) => key.startsWith("_") ? undefined : value,
              2
            )
          }]
        }
      }

      if (request.params.name === "list_hospitals") {
        const args = z.object({
          page_size: z.number().int().optional(),
          page_token: z.string().optional()
        }).parse(request.params.arguments)

        log("INFO", "grpc request", { tool: "list_hospitals" })
        const grpcStart = Date.now()

        let response: unknown
        try {
          response = await new Promise((resolve, reject) => {
            registryClient.ListHospitals(
              { page_size: args.page_size ?? 0, page_token: args.page_token ?? "" },
              (err: any, resp: any) => {
                if (err) reject(err)
                else resolve(resp)
              }
            )
          })
        } catch (err) {
          log("ERROR", "grpc request failed", { tool: "list_hospitals", duration_ms: Date.now() - grpcStart, error: String(err) })
          throw err
        }

        log("INFO", "grpc response", { tool: "list_hospitals", duration_ms: Date.now() - grpcStart })

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, (key, value) => key.startsWith("_") ? undefined : value, 2)
          }]
        }
      }

      throw new Error("unknown tool")
    })

  return server
}



async function main() {
  if (process.env.TRANSPORT === "http") {
    const port = parseInt(process.env.PORT ?? "3000")

    const httpServer = http.createServer(async (req, res) => {
      if (req.url === "/mcp") {
        if (req.method !== "POST") {
          // Stateless mode has no sessions, so it can't support the GET/SSE
          // stream or DELETE session-termination the spec otherwise allows.
          res.writeHead(405, { "Content-Type": "application/json", "Allow": "POST" })
          res.end(JSON.stringify({ error: "Method not allowed: this server is stateless and only supports POST" }))
          return
        }

        const chunks: Buffer[] = []
        req.on("data", (chunk: Buffer) => chunks.push(chunk))
        req.on("end", async () => {
          try {
            const body = chunks.length
              ? JSON.parse(Buffer.concat(chunks).toString())
              : undefined
            // Stateless mode: fresh server + transport per request
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
            transport.onerror = (err) => log("ERROR", "MCP transport error", { error: String(err) })
            const mcpServer = createMcpServer()
            await mcpServer.connect(transport)
            await transport.handleRequest(req, res, body)
          } catch (err) {
            log("ERROR", "MCP request error", { error: String(err) })
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ error: String(err) }))
            }
          }
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    httpServer.listen(port, () => {
      log("INFO", `HTTP server listening on port ${port}`, { grpc_host: grpcHost })
    })
  } else {
    try {
      await createMcpServer().connect(new StdioServerTransport())
      log("INFO", "MCP server connected via stdio", { grpc_host: grpcHost })
    } catch (err) {
      log("ERROR", "FATAL: MCP server failed to connect", { error: String(err) })
      process.exit(1)
    }
  }
}

main()