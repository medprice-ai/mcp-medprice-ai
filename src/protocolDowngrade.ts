import { PROTOCOL_VERSION_META_KEY, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server"

// #43: some client periodically hits prod carrying the modern (2026-07-28)
// per-request _meta envelope while naming a legacy protocol version inside
// it (io.modelcontextprotocol/protocolVersion: "2025-06-18" or
// "2025-11-25" observed). createMcpHandler classifies any request carrying
// the envelope claim as modern regardless of what version it names, so this
// combination is a hard "Unsupported protocol version" rejection - our
// modern leg only serves 2026-07-28. Before #42 added modern-era support,
// the envelope was invisible to the (legacy-only) server and the request
// was served fine from the MCP-Protocol-Version header alone. Stripping the
// envelope when it names a version from the legacy set restores that: the
// request re-classifies as legacy ("no-claim") and is served the same way
// it was before #42, going with the version the client actually declared.
export function downgradeLegacyEnvelope(body: unknown): { body: unknown; downgraded: boolean } {
  let downgraded = false

  const stripIfLegacy = (message: unknown): unknown => {
    if (typeof message !== "object" || message === null) return message
    const params = (message as { params?: unknown }).params
    if (typeof params !== "object" || params === null) return message
    const meta = (params as { _meta?: unknown })._meta
    if (typeof meta !== "object" || meta === null) return message

    const declaredVersion = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY]
    if (typeof declaredVersion !== "string" || !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(declaredVersion)) {
      return message
    }

    downgraded = true
    const { _meta, ...restParams } = params as Record<string, unknown>
    return { ...(message as object), params: restParams }
  }

  return {
    body: Array.isArray(body) ? body.map(stripIfLegacy) : stripIfLegacy(body),
    downgraded
  }
}
