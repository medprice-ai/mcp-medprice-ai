# mcp-medical-transparency

## Transports

The server supports two transports, selected via the `TRANSPORT` env var.

### stdio (default — local use with Claude Desktop / Claude Code)

```bash
GRPC_HOST=<host:port> npx tsx src/index.ts
```

### Streamable HTTP (cloud deployment)

```bash
TRANSPORT=http GRPC_HOST=<host:port> PORT=3000 npx tsx src/index.ts
```

All MCP requests go to `POST /mcp`. `PORT` defaults to `3000`.

## Docker

### Build

```bash
docker build -t mcp-medprice-ai .
```

### Run

```bash
docker run --rm -p 3000:3000 \
  -e GRPC_HOST=<host:port> \
  mcp-medprice-ai
```

`TRANSPORT=http` and `PORT=3000` are set by default in the image. Override `PORT` if needed:

```bash
docker run --rm -p 8080:8080 \
  -e GRPC_HOST=<host:port> \
  -e PORT=8080 \
  mcp-medprice-ai
```

## Install in Claude Code (stdio)

```bash
claude mcp add --env GRPC_HOST=<host:port> --transport stdio mcp-medical-transparency \
  -- npx tsx /path/to/mcp-medical-transparency/src/index.ts
```

Replace `<host:port>` with your gRPC backend address and `/path/to/mcp-medical-transparency` with the absolute path to this repo.

To share the server with everyone in a project, add `--scope project` (writes to `.mcp.json`). To make it available across all your projects, use `--scope user`.

## Install in Claude Code (HTTP)

If you have deployed the server (e.g. Cloud Run), add it as an HTTP MCP server:

```bash
claude mcp add --transport http mcp-medical-transparency https://<your-deployed-url>/mcp
```

## Test gRPC connectivity

```
GRPC_HOST=... npx tsx src/test.ts
```