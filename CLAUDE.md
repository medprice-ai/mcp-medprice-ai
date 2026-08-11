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
3. Registers three MCP tools (defined once in `toolDefinitions` and reused for both the `capabilities.tools` map and the `ListToolsRequestSchema` handler, so tool metadata can't drift between the two):
   - `list_hospitals` — lists supported hospitals with their `hospital_id`, EIN, name, structured_locations (addresses with geocoded coordinates where available), last_updated_on, and revision history (each revision's date, `revision_id`, and whether it has payer-specific rate data)
   - `get_hospital_chargemaster_cost` — looks up cost stats for a single hospital (identified by `hospital_id`) and billing code; accepts an optional `revision_id` (from `list_hospitals`) to price a past revision instead of the latest one
   - `list_hospital_code_costs` — looks up cost stats for a billing code across every hospital with a matching chargemaster entry, paginated (added for issue #240 upstream — see below). Avoids a `list_hospitals` + N × `get_hospital_chargemaster_cost` round trip for "which hospital is cheapest for X" questions.
4. Selects transport based on `TRANSPORT` env var:
   - `TRANSPORT=http` — starts an HTTP server on `PORT` (default `3000`), handles all requests at `POST /mcp` via `StreamableHTTPServerTransport` (stateless, suitable for Cloud Run)
   - default — connects via `StdioServerTransport` over stdin/stdout

**Proto services** (backend is Scala/ScalaPB, repo `medprice-ai`):
- `HospitalRegistryService.ListHospitals` — returns a paginated list of hospitals with their opaque `hospital_id`
- `HospitalCodeCostService.GetHospitalCodeCost` — returns cost stats (min/max/avg/median/std_dev) for a single hospital identified by `hospital_id`
- `HospitalCodeCostService.ListHospitalCodeCosts` — returns cost stats for every hospital with a matching chargemaster entry for a `(code_type, code)`, paginated

`proto/` here must be kept in sync by hand with `medprice-ai`'s `grpc/src/main/proto/` (there's no submodule/codegen link between the repos) — diff against that repo when the backend adds fields or RPCs. As of this writing `ListHospitalCodeCosts` works against a locally-run backend (`GRPC_HOST=localhost:9090 GRPC_INSECURE=true`) but returns `UNIMPLEMENTED` against production (`api.medprice.ai:443`) until `medprice-ai` is redeployed — pushing to `medprice-ai`'s `master` only publishes a new Docker image, it doesn't roll out to Cloud Run (see that repo's `scripts/deploy-gcloud.sh`).

**Stale files**: `src/server.ts` and `src/grpc.ts` are early prototypes — `server.ts` references an unimported symbol and `grpc.ts` references a non-existent proto. Neither is used by `src/index.ts`.
