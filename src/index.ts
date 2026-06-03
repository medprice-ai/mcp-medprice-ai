import {
 Server
}
from "@modelcontextprotocol/sdk/server/index.js"

import {
 StdioServerTransport
}
from "@modelcontextprotocol/sdk/server/stdio.js"

const server =
 new Server(
   {
      name:
        "medical-price-mcp",

      version:
        "1.0.0"
   },

   {
      capabilities: {
         tools: {}
      }
   }
 )
