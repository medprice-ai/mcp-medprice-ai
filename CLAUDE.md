# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run the MCP server:
```
GRPC_HOST=<host:port> npx tsx src/index.ts
```

Test gRPC connectivity directly:
```
GRPC_HOST=<host:port> npx tsx src/test.ts
```

Type-check without emitting:
```
npx tsc --noEmit
```

There are no npm scripts defined; run `tsx` directly.

## Architecture

This is a **TypeScript MCP (Model Context Protocol) server** that exposes hospital medical procedure cost data to AI assistants by proxying a gRPC backend.

**Data flow**: MCP client (e.g. Claude) → stdio → MCP server (`src/index.ts`) → gRPC over TLS → backend (`GRPC_HOST`)

**`src/index.ts`** is the sole production entry point. It:
1. Loads `proto/hospital_procedure_cost.proto` at startup via `@grpc/proto-loader`
2. Creates a gRPC client to `GRPC_HOST` (SSL, no auth config — uses system certs)
3. Registers one MCP tool `get_hospital_procedure_cost` with `code_type` + `code` inputs
4. Connects via `StdioServerTransport` — the process communicates over stdin/stdout as an MCP server

**Proto services** (backend is Scala/ScalaPB):
- `HospitalProcedureCostService.GetHospitalProcedureCost` — returns cost stats (min/max/avg/median/std_dev, procedure count, payer count) for two hospitals: MCA and UIHC
- `PopularCodesService.GetTopCodes` / `GetTopCodesByHospital` — top procedure codes, optionally enriched with cost stats

`popular_codes.proto` defines a `PopularCodesService` that is **not yet wired into the MCP server**.

**Stale files**: `src/server.ts` and `src/grpc.ts` are early prototypes — `server.ts` references an unimported symbol and `grpc.ts` references a non-existent proto. Neither is used by `src/index.ts`.
