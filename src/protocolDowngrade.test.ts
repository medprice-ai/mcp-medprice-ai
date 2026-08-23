import { describe, expect, it } from "vitest"

import { downgradeLegacyEnvelope } from "./protocolDowngrade"

function requestWithEnvelope(protocolVersion: unknown) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": protocolVersion,
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }
}

describe("downgradeLegacyEnvelope", () => {
  it("strips the envelope when it names a legacy version (issue #43 repro: 2025-06-18)", () => {
    const { body, downgraded } = downgradeLegacyEnvelope(requestWithEnvelope("2025-06-18"))

    expect(downgraded).toBe(true)
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    })
  })

  it("strips the envelope when it names a legacy version (issue #43 repro: 2025-11-25)", () => {
    const { body, downgraded } = downgradeLegacyEnvelope(requestWithEnvelope("2025-11-25"))

    expect(downgraded).toBe(true)
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    })
  })

  it("leaves a genuine modern request (2026-07-28) untouched", () => {
    const request = requestWithEnvelope("2026-07-28")
    const { body, downgraded } = downgradeLegacyEnvelope(request)

    expect(downgraded).toBe(false)
    expect(body).toEqual(request)
  })

  it("leaves an envelope-less request untouched", () => {
    const request = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
    const { body, downgraded } = downgradeLegacyEnvelope(request)

    expect(downgraded).toBe(false)
    expect(body).toEqual(request)
  })

  it("preserves other params fields when stripping _meta", () => {
    const request = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_code_types",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2025-06-18",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    }

    const { body, downgraded } = downgradeLegacyEnvelope(request)

    expect(downgraded).toBe(true)
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_code_types",
        arguments: {}
      }
    })
  })

  it("applies per-message in a JSON-RPC batch array", () => {
    const legacyRequest = requestWithEnvelope("2025-06-18")
    const modernRequest = requestWithEnvelope("2026-07-28")

    const { body, downgraded } = downgradeLegacyEnvelope([legacyRequest, modernRequest])

    expect(downgraded).toBe(true)
    expect(Array.isArray(body)).toBe(true)
    const [first, second] = body as unknown[]
    expect(first).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    expect(second).toEqual(modernRequest)
  })

  it.each([undefined, null, "not an object", 42, []])(
    "handles non-message input %p without throwing",
    (input) => {
      expect(() => downgradeLegacyEnvelope(input)).not.toThrow()
      const { downgraded } = downgradeLegacyEnvelope(input)
      expect(downgraded).toBe(false)
    }
  )

  it("ignores a protocolVersion field that isn't a recognized version string", () => {
    const request = requestWithEnvelope("not-a-real-version")
    const { body, downgraded } = downgradeLegacyEnvelope(request)

    expect(downgraded).toBe(false)
    expect(body).toEqual(request)
  })

  it("ignores params with no _meta object", () => {
    const request = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { foo: "bar" } }
    const { body, downgraded } = downgradeLegacyEnvelope(request)

    expect(downgraded).toBe(false)
    expect(body).toEqual(request)
  })
})
