import grpc from "@grpc/grpc-js"

import protoLoader
from "@grpc/proto-loader"

const packageDef =
 protoLoader.loadSync(
   "proto/transparency.proto"
 )

const proto =
 grpc.loadPackageDefinition(
   packageDef
 ) as any

export const client =
 new proto.TransparencyService(
   process.env.GRPC_HOST!,
   grpc.credentials.createSsl()
 )