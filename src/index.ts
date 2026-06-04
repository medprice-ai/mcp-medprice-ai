import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"

import { z } from "zod"

import { Server } from "@modelcontextprotocol/sdk/server/index.js"

import { StdioServerTransport }
from "@modelcontextprotocol/sdk/server/stdio.js"

import {
  CallToolRequestSchema,
  ListToolsRequestSchema
}
from "@modelcontextprotocol/sdk/types.js"

const packageDefinition =
  protoLoader.loadSync(
    "proto/hospital_procedure_cost.proto",
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    }
  )

const proto =
  grpc.loadPackageDefinition(
    packageDefinition
  ) as any

const Service =
 proto.org.medical.price.transparency.api
   .HospitalProcedureCostService

const client =
 new Service(
   process.env.GRPC_HOST,
   grpc.credentials.createSsl()
 )


const server =
 new Server(
   {
     name:
       "medical-price-mcp",
     version:
       "0.0.1"
   },
   {
     capabilities: {
       tools: {}
     }
   }
 )


server.setRequestHandler(
 ListToolsRequestSchema,

 async () => ({
   tools: [
     {
       name:
         "get_hospital_procedure_cost",
       description:
         "Lookup hospital procedure cost",
       inputSchema: {
         type: "object",
         properties: {
           code_type: {
             type: "string"
           },
           code: {
             type: "string"
           }
         },
         required: [
           "code_type",
           "code"
         ]
       }
     }
   ]
 })
)

server.setRequestHandler(
 CallToolRequestSchema,
 async (request) => {
   if (
     request.params.name !==
     "get_hospital_procedure_cost"
   ) {
     throw new Error(
       "unknown tool"
     )
   }

   const args =
     z.object({
       code_type:
         z.string(),
       code:
         z.string()
     }).parse(
       request.params.arguments
     )

   const response =
     await new Promise(
       (
         resolve,
         reject
       ) => {
         client
          .GetHospitalProcedureCost(
            {
              code_type:
                args.code_type,
              code:
                args.code,
              methodology:
                ""
            },
            (
              err: any,
              resp: any
            ) => {
              if (err)
                reject(err)
              else
                resolve(resp)
            }
          )
       }
     )
   return {
     content: [
       {
         type: "text",
         text:
          JSON.stringify(
            response,
            null,
            2
          )
       }
     ]
   }
 })



async function main() {
 await server.connect(
   new StdioServerTransport()
 )
}

main()