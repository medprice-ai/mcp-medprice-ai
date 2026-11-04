import * as grpc from "@grpc/grpc-js"

import * as protoLoader from "@grpc/proto-loader"

// Smoke test for gRPC connectivity: GRPC_HOST=<host:port> HOSPITAL_ID=<id from list_hospitals> npx tsx src/test.ts
const packageDefinition =
  protoLoader.loadSync(
    "proto/provider_code_cost.proto",
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

const service =
  proto.ai.medprice.api
    .ProviderCodeCostService

const grpcCredentials =
  process.env.GRPC_INSECURE === "true"
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl()

const client =
  new service(

    process.env.GRPC_HOST,

    grpcCredentials

  )

client.GetHospitalProviderCodeCosts(

  {

    hospital_id: process.env.HOSPITAL_ID ?? "",

    code_type: "MS-DRG",

    code: "652",

    group_by: "GROUP_BY_ALL"

  },

  (err: any, response: any) => {

    console.log("error:")

    console.log(err)

    console.log("response:")

    console.log(response)

  }

)
