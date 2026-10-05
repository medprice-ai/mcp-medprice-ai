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
3. Registers six MCP tools (defined once in `toolDefinitions` and reused for both the `capabilities.tools` map and the `"tools/list"` handler, so tool metadata can't drift between the two):
   - `list_hospitals` — lists supported hospitals with their `hospital_id`, EIN, name, structured_locations (addresses with geocoded coordinates where available), last_updated_on, and revision history (each revision's date, `revision_id`, whether it has payer-specific rate data, and `added_at` — when medprice itself ingested that revision, server-set at insert time, as opposed to the revision date's source-file-reported update date; upstream `medprice-ai` PR #579, issue #559 — not yet deployed to production as of this writing, see the staleness caveat below)
   - `get_hospital_chargemaster_cost` — looks up cost stats for a single hospital (identified by `hospital_id`) and billing code; accepts an optional `revision_id` (from `list_hospitals`) to price a past revision instead of the latest one
   - `batch_get_hospital_chargemaster_cost` — batch counterpart to `get_hospital_chargemaster_cost`: prices up to 100 `(code_type, code)` pairs at one hospital in a single call (upstream issue #870, PR #875). Use instead of N sequential `get_hospital_chargemaster_cost` calls when pricing a fixed set of codes at one hospital.
   - `list_hospital_code_costs` — looks up cost stats for a billing code across every hospital with a matching chargemaster entry, paginated (added for issue #240 upstream — see below). Avoids a `list_hospitals` + N × `get_hospital_chargemaster_cost` round trip for "which hospital is cheapest for X" questions.
   - `list_code_types` — lists every distinct billing code type (e.g. CPT, MS-DRG) catalogued in the backend's `public.code_catalog`, with each type's distinct code count and total hospital reports. Unpaginated (upstream issue #286).
   - `list_codes` — lists every distinct code under a given code type, paginated, with a raw chargemaster description and reporting-hospital count per code (upstream issue #286). Use to discover which codes exist under a code system before pricing them with `get_hospital_chargemaster_cost` / `list_hospital_code_costs`. Accepts an optional `sort` (`CODE_SORT_UNSPECIFIED`, the default, code-alphabetical; `CODE_SORT_HOSPITAL_COUNT_DESC`, most-hospitals-reporting first; `CODE_SORT_SAMPLE_COUNT_DESC`, largest CMS pricing sample size first; `CODE_SORT_CODE_DESC`, reverse code-alphabetical; or `CODE_SORT_RELEVANCE`, best text match first) to get pre-sorted "top codes" pages in one round trip instead of fetching every page and sorting client-side (upstream issue #399). Also accepts an optional `query` for case-insensitive text search (code prefix plus raw/friendly description substrings) — when set, `code_type` may be left empty to search across code types, with each result's `code_type` telling the hits apart, and `CODE_SORT_RELEVANCE` becomes the default ordering (upstream issue #911/PR #913).

   `list_hospitals` and `list_hospital_code_costs` default/cap their `page_size` at 500 (widened from 20/100 as an LLM stopgap — upstream issue #163) and include a `total_count` field in their responses so a caller can sanity-check "got N of total_count" instead of only seeing `next_page_token`.
4. Selects transport based on `TRANSPORT` env var:
   - `TRANSPORT=http` — starts an HTTP server on `PORT` (default `3000`), handles all requests at `POST /mcp` via `createMcpHandler` (`@modelcontextprotocol/server`) wrapped in `toNodeHandler` (`@modelcontextprotocol/node`) — stateless (fresh `Server` per exchange), and serves both legacy (2025-and-earlier) and modern (2026-07-28+) protocol revisions from the same `createMcpServer` factory. A bare `Server` + Node HTTP transport (no `createMcpHandler`) only ever speaks the legacy set in `SUPPORTED_PROTOCOL_VERSIONS` — `createMcpHandler` is what adds modern-era support on top. Before handing a request to `createMcpHandler`, the handler pre-parses the body and strips the modern `_meta` envelope when its `io.modelcontextprotocol/protocolVersion` names a legacy version (`downgradeLegacyEnvelope`, upstream issue #43) — `createMcpHandler` otherwise classifies any envelope-bearing request as modern regardless of the version named inside it, which is a hard rejection for a client sending a legacy version inside a modern envelope. Stripping the envelope re-classifies the request as legacy so it's served from the `MCP-Protocol-Version` header instead, going with whatever version the client actually declared.
   - default — connects via `StdioServerTransport` over stdin/stdout

**Proto services** (backend is Scala/ScalaPB, repo `medprice-ai`):
- `HospitalRegistryService.ListHospitals` — returns a paginated list of hospitals with their opaque `hospital_id`
- `HospitalCodeCostService.GetHospitalCodeCost` — returns cost stats (min/max/avg/median/std_dev) for a single hospital identified by `hospital_id`
- `HospitalCodeCostService.BatchGetHospitalCodeCost` — batch counterpart to `GetHospitalCodeCost`: returns one `HospitalCostResult` per requested `(code_type, code)` for a single `hospital_id`, in request order
- `HospitalCodeCostService.ListHospitalCodeCosts` — returns cost stats for every hospital with a matching chargemaster entry for a `(code_type, code)`, paginated
- `HospitalCodeCostService.ListCodeTypes` — returns every distinct code_type present in the backend's `public.code_catalog`, unpaginated
- `HospitalCodeCostService.ListCodes` — returns every distinct code under a given code_type, paginated, backed by the same `public.code_catalog`

`hospital_code_cost.proto`'s `BatchGetHospitalCodeCost` RPC and its `CodeRef`/`HospitalCodeCostBatchRequest`/`HospitalCodeCostBatchResponse` messages (upstream PR #875, issue #870) are still commented `PROTOTYPE` in the upstream `.proto` source, but the RPC itself has graduated — `medprice-ai-web` calls it in production (`lib/procedureCosts.ts`) and it's confirmed working against `api.medprice.ai:443` — so it's exposed here as the `batch_get_hospital_chargemaster_cost` MCP tool. Don't take the stale `PROTOTYPE` comment at face value next time this file is re-synced; re-check with upstream/the backend owner before downgrading its treatment. `hospital_registry.proto`'s `ResolveLegacyHospitalId` RPC, by contrast, genuinely is internal-only — a URL-migration compat shim for `medprice-ai-web`, not something a new caller should construct — so it stays unexposed.

`proto/` here must be kept in sync by hand with `medprice-ai`'s `grpc/src/main/proto/` (there's no submodule/codegen link between the repos) — diff against that repo when the backend adds fields or RPCs. Pushing to `medprice-ai`'s `master` only publishes a new Docker image, it doesn't roll out to Cloud Run (see that repo's `scripts/deploy-gcloud.sh`), so a newly-added RPC can return `UNIMPLEMENTED` against production (`api.medprice.ai:443`) until `medprice-ai` is redeployed there — check against a locally-run backend (`GRPC_HOST=localhost:9090 GRPC_INSECURE=true`) if prod hasn't caught up yet. As of this writing all six RPCs above, `HospitalRevisionRecord.added_at` (upstream PR #579), and `ListCodesRequest.query`/`CODE_SORT_RELEVANCE` (upstream PR #913) are confirmed working against production.

`hospital_id`/`revision_id` are opaque `string` values, not small integers, and their underlying value scheme can change on the backend without a proto/wire-format change (e.g. `medprice-ai` PR #496 switched them from stringified Postgres auto-increment PKs to SHA-256 hashes of each row's natural key). Never parse, sort, or hardcode them as numbers here — treat them purely as pass-through handles, same as `next_page_token`.

**Stale files**: `src/server.ts` and `src/grpc.ts` are early prototypes — `server.ts` references an unimported symbol and `grpc.ts` references a non-existent proto. Neither is used by `src/index.ts`.
