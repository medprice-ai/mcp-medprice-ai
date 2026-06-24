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

The server exposes one tool, `get_hospital_chargemaster_cost`, which looks up cost stats for a billing code across hospitals. Once installed, you can just ask your assistant something like:

> What's the fee schedule cost of MS-DRG 652 at MedPrice AI's hospitals?

which calls the tool with:

```json
{
  "code_type": "MS-DRG",
  "code": "652",
  "methodology": "fee schedule"
}
```

and returns:

```json
{
  "mca": {
    "hospital": "MCA",
    "found": true,
    "cost": {
      "code_type": "MS-DRG",
      "code": "652",
      "min": "26851.11",
      "max": "190885.00",
      "avg": "34387.70",
      "median": "28084.07",
      "std_dev": "13735.94"
    }
  },
  "uihc": {
    "hospital": "UIHC",
    "found": true,
    "cost": {
      "code_type": "MS-DRG",
      "code": "652",
      "min": "22436.13",
      "max": "170932.00",
      "avg": "22981.01",
      "median": "22884.85",
      "std_dev": "462.26"
    }
  }
}
```

### Tool reference

- **`code_type`** (required) — code system, e.g. `APR-DRG`, `CDM`, `CPT`, `HCPCS`, `MS-DRG`, `RC`. Hospitals may also support additional proprietary code types.
- **`code`** (required) — the billing/chargemaster code.
- **`methodology`** (optional) — one of `case rate`, `fee schedule`, `other`, `percent of total billed charges`, `per diem`. Omit to aggregate across all methodologies.

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
