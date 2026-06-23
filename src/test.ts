import * as grpc from "@grpc/grpc-js"

import * as protoLoader from "@grpc/proto-loader"

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

const service =
  proto.org.medical.price.transparency.api
    .HospitalProcedureCostService

const grpcCredentials =
  process.env.GRPC_INSECURE === "true"
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl()

const client =
  new service(

    process.env.GRPC_HOST,

    grpcCredentials

  )

client.GetHospitalProcedureCost(

  {

    code_type: "MS-DRG",

    code: "652",

    methodology: ""

  },

  (err: any, response: any) => {

    console.log("error:")

    console.log(err)

    console.log("response:")

    console.log(response)

  }

)
