# mcp-medical-transparency

## Install in Claude Code

```bash
claude mcp add --env GRPC_HOST=<host:port> --transport stdio mcp-medical-transparency \
  -- npx tsx /path/to/mcp-medical-transparency/src/index.ts
```

Replace `<host:port>` with your gRPC backend address and `/path/to/mcp-medical-transparency` with the absolute path to this repo.

To share the server with everyone in a project, add `--scope project` (writes to `.mcp.json`). To make it available across all your projects, use `--scope user`.

## Test gRPC connectivity

Run connectivity to gRPC backend with

```
GRPC_HOST=... npx tsx src/test.ts
```