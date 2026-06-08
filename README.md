# mcp-medical-transparency

A hosted MCP server exposing US hospital procedure cost data to AI assistants.

- **MCP endpoint**: `https://mcp.medprice.ai/mcp`
- **gRPC backend**: `api.medprice.ai:443`

## Install in Claude Code

```bash
claude mcp add --transport http mcp-medical-transparency https://mcp.medprice.ai/mcp
```

To share with everyone in a project, add `--scope project` (writes to `.mcp.json`). To make it available across all your projects, use `--scope user`.

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
