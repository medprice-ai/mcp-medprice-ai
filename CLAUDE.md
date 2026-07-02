# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run the MCP server (stdio, default):
```
GRPC_HOST=<host:port> npx tsx src/index.ts
```

Run the MCP server (streamable HTTP, for cloud deployment):
```
TRANSPORT=http GRPC_HOST=<host:port> npx tsx src/index.ts
```

`PORT` defaults to `3000`. All requests go to `POST /mcp`.

Test gRPC connectivity directly:
```
GRPC_HOST=<host:port> npx tsx src/test.ts
```

Against a local plaintext gRPC server (e.g. `localhost:9090`), set `GRPC_INSECURE=true` to skip TLS:
```
GRPC_HOST=localhost:9090 GRPC_INSECURE=true npx tsx src/index.ts
```

Type-check without emitting:
```
npx tsc --noEmit
```

There are no npm scripts defined; run `tsx` directly.

## Architecture

This is a **TypeScript MCP (Model Context Protocol) server** that exposes hospital chargemaster cost data to AI assistants by proxying a gRPC backend.

**Data flow**: MCP client (e.g. Claude) → stdio → MCP server (`src/index.ts`) → gRPC over TLS (default) → backend (`GRPC_HOST`)

**`src/index.ts`** is the sole production entry point. It:
1. Loads `proto/hospital_code_cost.proto` and `proto/hospital_registry.proto` at startup via `@grpc/proto-loader`
2. Creates gRPC clients to `GRPC_HOST` (SSL by default, no auth config — uses system certs; set `GRPC_INSECURE=true` or `GRPC_INSECURE=1` to use plaintext credentials instead, for local dev against a non-TLS server)
3. Registers two MCP tools:
   - `list_hospitals` — lists supported hospitals with their `hospital_id`, EIN, name, locations, and last_updated_on
   - `get_hospital_chargemaster_cost` — looks up cost stats for a single hospital (identified by `hospital_id`) and billing code
4. Selects transport based on `TRANSPORT` env var:
   - `TRANSPORT=http` — starts an HTTP server on `PORT` (default `3000`), handles all requests at `POST /mcp` via `StreamableHTTPServerTransport` (stateless, suitable for Cloud Run)
   - default — connects via `StdioServerTransport` over stdin/stdout

**Proto services** (backend is Scala/ScalaPB):
- `HospitalRegistryService.ListHospitals` — returns a paginated list of hospitals with their opaque `hospital_id`
- `HospitalCodeCostService.GetHospitalCodeCost` — returns cost stats (min/max/avg/median/std_dev) for a single hospital identified by `hospital_id`

**Stale files**: `src/server.ts` and `src/grpc.ts` are early prototypes — `server.ts` references an unimported symbol and `grpc.ts` references a non-existent proto. Neither is used by `src/index.ts`.
