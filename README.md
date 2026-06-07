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