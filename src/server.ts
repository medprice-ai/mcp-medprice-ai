import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  StdioServerTransport
} from "@modelcontextprotocol/sdk/server/stdio.js";

const server =
  new Server(
    {
      name: "medical-price-transparency",
      version: "0.0.1"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({
    tools: [
      {
        name: "hello",
        description: "test"
      }
    ]
  })
);

await server.connect(
  new StdioServerTransport()
);
