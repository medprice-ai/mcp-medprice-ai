# mcp-medprice-ai

A hosted MCP server exposing US hospital chargemaster cost data to AI assistants.

- **MCP endpoint**: `https://mcp.medprice.ai/mcp`
- **gRPC backend**: `api.medprice.ai:443`

## Install in Claude Code

```bash
claude mcp add --transport http mcp-medprice-ai https://mcp.medprice.ai/mcp
```

To share with everyone in a project, add `--scope project` (writes to `.mcp.json`). To make it available across all your projects, use `--scope user`.

## Usage

The server exposes three tools:

- **`list_hospitals`** — returns the supported hospitals with their `hospital_id`, EIN, name, structured_locations (addresses with geocoded coordinates where available), last_updated_on, and revision history (each revision's date, `revision_id`, and whether it has payer-specific rate data).
- **`get_hospital_chargemaster_cost`** — looks up cost stats for a billing code at a single hospital.
- **`list_hospital_code_costs`** — looks up cost stats for a billing code across every hospital that has a matching chargemaster entry, paginated. Use this instead of calling `get_hospital_chargemaster_cost` once per hospital when comparing prices for the same procedure across hospitals.

The typical flow is to call `list_hospitals` first to discover available hospitals and their IDs, then call `get_hospital_chargemaster_cost` with the desired `hospital_id` — or call `list_hospital_code_costs` directly when the question is about a code across hospitals rather than one specific hospital. Once installed, you can just ask your assistant something like:

> What's the fee schedule cost of MS-DRG 652 at Medical City Alliance?

The assistant will call `list_hospitals` to find the hospital's ID, then call `get_hospital_chargemaster_cost` with:

```json
{
  "hospital_id": "1",
  "code_type": "MS-DRG",
  "code": "652",
  "methodology": "fee schedule"
}
```

and returns:

```json
{
  "hospital": "MEDICAL CITY ALLIANCE",
  "found": true,
  "cost": {
    "code_type": "MS-DRG",
    "code": "652",
    "min": "26851.11",
    "max": "190885.00",
    "avg": "34387.70",
    "median": "28084.07",
    "std_dev": "13735.94"
  },
  "description": {
    "hospital_name": "MEDICAL CITY ALLIANCE",
    "location": "3101 N Tarrant Pkwy, Fort Worth, TX, 76177",
    "code_description": "KIDNEY TRANSPLANT",
    "methodology_note": "fee schedule"
  }
}
```

### Tool reference

#### `list_hospitals`

- **`page_size`** (optional) — maximum number of hospitals to return. Defaults to 500 (the entire current registry in one call), capped at 500.
- **`page_token`** (optional) — opaque token from a previous response's `next_page_token`, for pagination. If `next_page_token` is non-empty, keep calling with it until it's empty rather than assuming one page is the full list.

Each hospital's `revisions` array now includes a `revision_id` per revision (in addition to `revision_date` and `has_payer_data`) — pass it as `get_hospital_chargemaster_cost`'s `revision_id` to price that specific past revision instead of the hospital's latest one.

#### `get_hospital_chargemaster_cost`

- **`hospital_id`** (required) — opaque hospital identifier from `list_hospitals`.
- **`code_type`** (required) — code system, e.g. `APR-DRG`, `CDM`, `CPT`, `HCPCS`, `MS-DRG`, `RC`. Hospitals may also support additional proprietary code types.
- **`code`** (required) — the billing/chargemaster code.
- **`methodology`** (optional) — one of `case rate`, `fee schedule`, `other`, `percent of total billed charges`, `per diem`. Omit to aggregate across all methodologies.
- **`revision_id`** (optional) — a `revision_id` from `list_hospitals`, to price that specific past revision instead of the hospital's latest one.

#### `list_hospital_code_costs`

Like `get_hospital_chargemaster_cost`, but returns one result per hospital that has a matching chargemaster entry for the code, instead of requiring a `hospital_id` up front — useful for "which hospital is cheapest for X" questions without a `list_hospitals` + N × `get_hospital_chargemaster_cost` round trip.

- **`code_type`** (required) — same as above.
- **`code`** (required) — same as above.
- **`methodology`** (optional) — same as above.
- **`page_size`** (optional) — maximum number of results to return. Defaults to 500 (every matching hospital in one call at the current registry size), capped at 500.
- **`page_token`** (optional) — opaque token from a previous response's `next_page_token`, for pagination. If `next_page_token` is non-empty, keep calling with it until it's empty rather than assuming one page is the full list.

Returns `results` (each shaped like a `get_hospital_chargemaster_cost` response, plus a `hospital_id` to link back to `list_hospitals`/`get_hospital_chargemaster_cost`) and `next_page_token`. Only hospitals with a matching entry (their latest revision) are included — there are no `found: false` entries.

## Development

### Run locally against the production gRPC backend

```bash
GRPC_HOST=api.medprice.ai:443 npx tsx src/index.ts
```

### Run locally against a custom gRPC backend

```bash
GRPC_HOST=<host:port> npx tsx src/index.ts
```

### Run as HTTP server

```bash
TRANSPORT=http GRPC_HOST=api.medprice.ai:443 npx tsx src/index.ts
```

All MCP requests go to `POST /mcp`. `PORT` defaults to `3000`.

### Test gRPC connectivity

```bash
GRPC_HOST=api.medprice.ai:443 npx tsx src/test.ts
```

## Docker

### Build

```bash
docker build -t mcp-medprice-ai .
```

### Run

```bash
docker run --rm -p 3000:3000 \
  -e GRPC_HOST=api.medprice.ai:443 \
  mcp-medprice-ai
```

`TRANSPORT=http` and `PORT=3000` are set by default in the image. Override `PORT` if needed:

```bash
docker run --rm -p 8080:8080 \
  -e GRPC_HOST=api.medprice.ai:443 \
  -e PORT=8080 \
  mcp-medprice-ai
```
