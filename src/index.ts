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
  process.env.GRPC_INSECURE === "true" || process.env.GRPC_INSECURE === "1"
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl()

const logStream = process.env.TRANSPORT === "http" ? process.stdout : process.stderr

function log(level: "INFO" | "WARN" | "ERROR", message: string, extra?: Record<string, unknown>) {
  logStream.write(JSON.stringify({ severity: level, message, ...extra }) + "\n")
}

function stripSyntheticOneofs(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, nestedValue) =>
      key.startsWith("_") ? undefined : nestedValue
    )
  )
}

const hospitalChargemasterCostOutputSchema = {
  type: "object",
  properties: {
    hospital: {
      type: "string",
      description: "Hospital name returned by the MedPrice AI backend."
    },
    found: {
      type: "boolean",
      description: "Whether a matching chargemaster cost record was found."
    },
    cost: {
      type: "object",
      properties: {
        code_type: { type: "string" },
        code: { type: "string" },
        min: { type: "string" },
        max: { type: "string" },
        avg: { type: "string" },
        median: { type: "string" },
        std_dev: { type: "string" }
      }
    },
    description: {
      type: "object",
      properties: {
        hospital_name: { type: "string" },
        location: { type: "string" },
        code_description: { type: "string" },
        methodology_note: { type: "string" }
      }
    }
  }
}

const hospitalCostResultSchema = {
  type: "object",
  properties: {
    hospital: {
      type: "string",
      description: "Hospital name returned by the MedPrice AI backend."
    },
    found: {
      type: "boolean",
      description: "Whether a matching chargemaster cost record was found."
    },
    cost: {
      type: "object",
      properties: {
        code_type: { type: "string" },
        code: { type: "string" },
        min: { type: "string" },
        max: { type: "string" },
        avg: { type: "string" },
        median: { type: "string" },
        std_dev: { type: "string" }
      }
    },
    description: {
      type: "object",
      properties: {
        hospital_name: { type: "string" },
        location: { type: "string" },
        code_description: { type: "string" },
        methodology_note: { type: "string" }
      }
    },
    hospital_id: {
      type: "string",
      description: "Opaque hospital identifier to use with get_hospital_chargemaster_cost or list_hospitals."
    }
  }
}

const listHospitalCodeCostsOutputSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      description: "One entry per hospital with a matching chargemaster entry for this code (its latest revision only) - hospitals with no data for this code are omitted, not returned with found=false.",
      items: hospitalCostResultSchema
    },
    next_page_token: {
      type: "string",
      description: "Opaque pagination token, empty when there are no more results."
    },
    total_count: {
      type: "integer",
      description: "Total number of matching results across all pages, not just this page's results.length. Compare against results.length (plus any prior pages) to confirm you have the complete set before concluding a hospital or code has no data."
    }
  }
}

const listHospitalsOutputSchema = {
  type: "object",
  properties: {
    hospitals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hospital_id: {
            type: "string",
            description: "Opaque hospital identifier to use with get_hospital_chargemaster_cost."
          },
          ein: {
            type: "string",
            description: "Employer Identification Number for the hospital legal entity."
          },
          hospital_name: { type: "string" },
          locations: {
            type: "array",
            description: "Deprecated - use structured_locations instead.",
            items: { type: "string" }
          },
          structured_locations: {
            type: "array",
            description: "Same addresses as locations, plus geocoded coordinates where available.",
            items: {
              type: "object",
              properties: {
                address: { type: "string" },
                lat: { type: "number" },
                lng: { type: "number" },
                precision: {
                  type: "string",
                  enum: ["LOCATION_PRECISION_UNKNOWN", "LOCATION_PRECISION_STREET", "LOCATION_PRECISION_CITY"],
                  description: "Geocoding precision: STREET is a full street-address match, CITY is a city/state fallback, UNKNOWN means not yet geocoded or precision wasn't recorded."
                }
              }
            }
          },
          last_updated_on: {
            type: "string",
            description: "ISO-8601 date the source file was last updated. Duplicates the last (most recent) entry in revisions."
          },
          revisions: {
            type: "array",
            description: "Every known revision of this hospital's filing, oldest first. Usually a single entry.",
            items: {
              type: "object",
              properties: {
                revision_date: {
                  type: "string",
                  description: "ISO-8601 date this revision's source file was last updated on."
                },
                has_payer_data: {
                  type: "boolean",
                  description: "Whether this revision included payer-specific negotiated-rate data, as opposed to gross/cash price only."
                },
                revision_id: {
                  type: "string",
                  description: "Opaque handle for this specific revision - pass back as revision_id to get_hospital_chargemaster_cost to price this revision instead of the hospital's latest one."
                }
              }
            }
          }
        }
      }
    },
    next_page_token: {
      type: "string",
      description: "Opaque pagination token, empty when there are no more results."
    },
    total_count: {
      type: "integer",
      description: "Total number of hospitals matching this query, across all pages, not just this page's hospitals.length. Compare against hospitals.length (plus any prior pages) before concluding the full hospital list has been seen - e.g. before answering 'does medprice.ai support any hospitals in state X' or similar completeness questions."
    }
  }
}

const listCodeTypesOutputSchema = {
  type: "object",
  properties: {
    code_types: {
      type: "array",
      description: "One entry per distinct code_type present in the catalog, most code-rich first. Unpaginated.",
      items: {
        type: "object",
        properties: {
          code_type: { type: "string", description: "e.g. \"CPT\"" },
          code_count: {
            type: "integer",
            description: "Distinct codes catalogued under this type."
          },
          total_hospital_reports: {
            type: "integer",
            description: "Sum of hospital_count across every code under this type - NOT a distinct-hospital count (a hospital reporting many codes under one type is counted once per code)."
          }
        }
      }
    }
  }
}

const listCodesOutputSchema = {
  type: "object",
  properties: {
    codes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          raw_description: {
            type: "string",
            description: "Raw chargemaster text, picked across reporting hospitals. Not necessarily a human-readable procedure name."
          },
          hospital_count: {
            type: "integer",
            description: "Distinct hospitals reporting this code (latest revision only)."
          }
        }
      }
    },
    next_page_token: {
      type: "string",
      description: "Opaque pagination token, empty when there are no more results."
    },
    total_count: {
      type: "integer",
      description: "Total number of matching codes across all pages."
    }
  }
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


const toolDefinitions = {
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
        hospital_id: {
          type: "string",
          description: "Opaque hospital identifier from list_hospitals."
        },
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
        },
        revision_id: {
          type: "string",
          description: "Optional. A revision_id from list_hospitals' per-hospital revisions array, to price that specific past revision instead of the hospital's latest one. Omit to use the latest revision."
        }
      },
      required: ["hospital_id", "code_type", "code"]
    },
    outputSchema: hospitalChargemasterCostOutputSchema
  },
  list_hospitals: {
    name: "list_hospitals",
    title: "List supported hospitals",
    description: "Returns the hospitals supported by the medprice.ai API, with their hospital_id (opaque DB key), EIN, name, structured_locations (addresses with geocoded coordinates where available), last_updated_on, and revision history (with per-revision has_payer_data and revision_id). Defaults to returning the entire registry (currently a few hundred hospitals) in one call. If the response's next_page_token is non-empty, the result set was truncated: call this tool again passing that exact value as page_token to get the next page, and keep doing so until next_page_token is empty - do not stop after one page and conclude the list is complete. The response's total_count field (total across all pages) can be compared against how many hospitals you've accumulated so far as a completeness check, e.g. before answering questions like 'does medprice.ai cover any hospitals in Iowa'.",
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
          description: "Maximum number of hospitals to return. Defaults to 500 (covering the entire current registry in one call), capped at 500."
        },
        page_token: {
          type: "string",
          description: "Opaque token from a previous list_hospitals response's next_page_token field. Omit for the first page. Do not pass any other value (e.g. an offset or cursor you construct yourself) here."
        }
      }
    },
    outputSchema: listHospitalsOutputSchema
  },
  list_hospital_code_costs: {
    name: "list_hospital_code_costs",
    title: "List hospital costs for a billing code",
    description: "Returns cost stats for every hospital with a matching chargemaster entry for a code_type/code. Use this instead of calling get_hospital_chargemaster_cost once per hospital when comparing prices for the same procedure across hospitals (e.g. \"which hospital has the cheapest MS-DRG 652?\"). Defaults to returning every matching hospital (currently at most a few hundred) in one call. If the response's next_page_token is non-empty, the result set was truncated: call this tool again passing that exact value as page_token to get the next page, and keep doing so until next_page_token is empty - do not stop after one page and conclude a hospital has no data for this code. The response's total_count field (total across all pages) can be compared against how many results you've accumulated so far as a completeness check.",
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
        },
        page_size: {
          type: "integer",
          description: "Maximum number of results to return. Defaults to 500 (covering every matching hospital in one call at the current registry size), capped at 500."
        },
        page_token: {
          type: "string",
          description: "Opaque token from a previous list_hospital_code_costs response's next_page_token field. Omit for the first page. Do not pass any other value (e.g. an offset or cursor you construct yourself) here."
        }
      },
      required: ["code_type", "code"]
    },
    outputSchema: listHospitalCodeCostsOutputSchema
  },
  list_code_types: {
    name: "list_code_types",
    title: "List billing code types",
    description: "Returns every distinct code_type (e.g. CPT, MS-DRG) with catalogued cost data, along with each type's distinct code count and total hospital reports. Unpaginated. Use this to discover which code systems have data before drilling into list_codes.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {}
    },
    outputSchema: listCodeTypesOutputSchema
  },
  list_codes: {
    name: "list_codes",
    title: "List billing codes for a code type",
    description: "Returns every distinct code catalogued under a given code_type, paginated, with each code's raw chargemaster description and the number of hospitals reporting it. Use this to discover which codes exist under a code system (e.g. all CPT codes) before looking up prices with get_hospital_chargemaster_cost or list_hospital_code_costs.",
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
          description: "Code system to list codes for, e.g. \"CPT\". From list_code_types."
        },
        page_size: {
          type: "integer",
          description: "Maximum number of results to return. Defaults to 500, capped at 500."
        },
        page_token: {
          type: "string",
          description: "Opaque token from a previous list_codes response. Omit for the first page."
        }
      },
      required: ["code_type"]
    },
    outputSchema: listCodesOutputSchema
  }
} as const

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
          tools: toolDefinitions as any
        }
      }
    )

  server.setRequestHandler(
    ListToolsRequestSchema,

    async () => ({
      tools: Object.values(toolDefinitions)
    })
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      if (request.params.name === "get_hospital_chargemaster_cost") {
        const args = z.object({
          hospital_id: z.string(),
          code_type: z.string(),
          code: z.string(),
          methodology: z.string().optional(),
          revision_id: z.string().optional()
        }).parse(request.params.arguments)

        log("INFO", "grpc request", { tool: "get_hospital_chargemaster_cost", hospital_id: args.hospital_id, code_type: args.code_type, code: args.code })
        const grpcStart = Date.now()

        let response: unknown
        try {
          response = await new Promise((resolve, reject) => {
            client.GetHospitalCodeCost(
              { hospital_id: args.hospital_id, code_type: args.code_type, code: args.code, methodology: args.methodology ?? "", revision_id: args.revision_id ?? "" },
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

        log("INFO", "grpc response", { tool: "get_hospital_chargemaster_cost", hospital_id: args.hospital_id, code_type: args.code_type, code: args.code, duration_ms: Date.now() - grpcStart })
        const structuredContent = stripSyntheticOneofs(response)

        return {
          structuredContent,
          content: [{
            type: "text",
            text: JSON.stringify(structuredContent, null, 2)
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
        const structuredContent = stripSyntheticOneofs(response)

        return {
          structuredContent,
          content: [{
            type: "text",
            text: JSON.stringify(structuredContent, null, 2)
          }]
        }
      }

      if (request.params.name === "list_hospital_code_costs") {
        const args = z.object({
          code_type: z.string(),
          code: z.string(),
          methodology: z.string().optional(),
          page_size: z.number().int().optional(),
          page_token: z.string().optional()
        }).parse(request.params.arguments)

        log("INFO", "grpc request", { tool: "list_hospital_code_costs", code_type: args.code_type, code: args.code })
        const grpcStart = Date.now()

        let response: unknown
        try {
          response = await new Promise((resolve, reject) => {
            client.ListHospitalCodeCosts(
              { code_type: args.code_type, code: args.code, methodology: args.methodology ?? "", page_size: args.page_size ?? 0, page_token: args.page_token ?? "" },
              (err: any, resp: any) => {
                if (err) reject(err)
                else resolve(resp)
              }
            )
          })
        } catch (err) {
          log("ERROR", "grpc request failed", { tool: "list_hospital_code_costs", code_type: args.code_type, code: args.code, duration_ms: Date.now() - grpcStart, error: String(err) })
          throw err
        }

        log("INFO", "grpc response", { tool: "list_hospital_code_costs", code_type: args.code_type, code: args.code, duration_ms: Date.now() - grpcStart })
        const structuredContent = stripSyntheticOneofs(response)

        return {
          structuredContent,
          content: [{
            type: "text",
            text: JSON.stringify(structuredContent, null, 2)
          }]
        }
      }

      if (request.params.name === "list_code_types") {
        log("INFO", "grpc request", { tool: "list_code_types" })
        const grpcStart = Date.now()

        let response: unknown
        try {
          response = await new Promise((resolve, reject) => {
            client.ListCodeTypes(
              {},
              (err: any, resp: any) => {
                if (err) reject(err)
                else resolve(resp)
              }
            )
          })
        } catch (err) {
          log("ERROR", "grpc request failed", { tool: "list_code_types", duration_ms: Date.now() - grpcStart, error: String(err) })
          throw err
        }

        log("INFO", "grpc response", { tool: "list_code_types", duration_ms: Date.now() - grpcStart })
        const structuredContent = stripSyntheticOneofs(response)

        return {
          structuredContent,
          content: [{
            type: "text",
            text: JSON.stringify(structuredContent, null, 2)
          }]
        }
      }

      if (request.params.name === "list_codes") {
        const args = z.object({
          code_type: z.string(),
          page_size: z.number().int().optional(),
          page_token: z.string().optional()
        }).parse(request.params.arguments)

        log("INFO", "grpc request", { tool: "list_codes", code_type: args.code_type })
        const grpcStart = Date.now()

        let response: unknown
        try {
          response = await new Promise((resolve, reject) => {
            client.ListCodes(
              { code_type: args.code_type, page_size: args.page_size ?? 0, page_token: args.page_token ?? "" },
              (err: any, resp: any) => {
                if (err) reject(err)
                else resolve(resp)
              }
            )
          })
        } catch (err) {
          log("ERROR", "grpc request failed", { tool: "list_codes", code_type: args.code_type, duration_ms: Date.now() - grpcStart, error: String(err) })
          throw err
        }

        log("INFO", "grpc response", { tool: "list_codes", code_type: args.code_type, duration_ms: Date.now() - grpcStart })
        const structuredContent = stripSyntheticOneofs(response)

        return {
          structuredContent,
          content: [{
            type: "text",
            text: JSON.stringify(structuredContent, null, 2)
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
      } else if (req.url === "/.well-known/openai-apps-challenge") {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end("RrHoI1-vNFS7iMcvXReVWdPygAr062ALBT3dONbZy1k")
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
