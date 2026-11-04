import { describe, expect, it } from "vitest"

import {
  batchGrouping,
  legacyGrouping,
  toBatchHospitalCostResults,
  toCodePriceDistributionResponse,
  toHospitalCostResult,
  toListHospitalCodeCostsResponse,
  toProviderOrderBy
} from "./legacyCostMapping"

// Fixtures shaped like ProviderCodeCostService responses as @grpc/proto-loader
// decodes them (keepCase, longs/enums as strings, defaults filled in).
const cost = (over: Record<string, unknown> = {}) => ({
  terms: null,
  n: "12",
  min_charge: "100.00",
  max_charge: "900.00",
  avg_charge: "400.00",
  median_charge: "350.00",
  std_dev_charge: "50.00",
  code_description: "HC OFFICE VISIT",
  sample_count_sum_min: "3",
  sample_count_sum_max: "30",
  filed_min: "90.00",
  filed_max: "950.00",
  sample_count_exact: false,
  ...over
})

const hospitalResponse = (over: Record<string, unknown> = {}) => ({
  hospital_id: "h1",
  hospital_name: "General Hospital",
  location: "Austin, TX",
  costs: [],
  snapshot_id: "snap",
  code_type: "CPT",
  code: "99213",
  all_terms: cost(),
  revision_id: "",
  group_by: "GROUP_BY_ALL",
  ...over
})

describe("toHospitalCostResult", () => {
  it("maps the all-terms figure to one aggregate entry with an empty methodology", () => {
    const out = toHospitalCostResult(hospitalResponse())

    expect(out).toEqual({
      hospital: "General Hospital",
      found: true,
      hospital_id: "h1",
      results: [{
        methodology: "",
        found: true,
        cost: {
          code_type: "CPT",
          code: "99213",
          min: "100.00",
          max: "900.00",
          avg: "400.00",
          median: "350.00",
          std_dev: "50.00",
          sample_count_sum_min: "3",
          sample_count_sum_max: "30",
          sample_count_exact: false
        },
        description: {
          hospital_name: "General Hospital",
          location: "Austin, TX",
          code_description: "HC OFFICE VISIT",
          methodology_note: ""
        }
      }]
    })
  })

  it("reports found=false with null cost when the hospital doesn't charge the code", () => {
    const out = toHospitalCostResult(hospitalResponse({ all_terms: null, costs: [] }))

    expect(out.found).toBe(false)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].found).toBe(false)
    expect(out.results[0].cost).toBeNull()
  })

  it("returns one entry per requested methodology in request order, found=false for a missing one", () => {
    const resp = hospitalResponse({
      group_by: "GROUP_BY_METHODOLOGY",
      costs: [
        cost({ terms: { methodology: "METHODOLOGY_CASE_RATE" }, avg_charge: "150.00" }),
        cost({ terms: { methodology: "METHODOLOGY_FEE_SCHEDULE" }, avg_charge: "80.00" })
      ]
    })

    const out = toHospitalCostResult(resp, ["fee schedule", "per diem", "case rate"])

    expect(out.found).toBe(true)
    expect(out.results.map((r) => [r.methodology, r.found, r.cost?.avg])).toEqual([
      ["fee schedule", true, "80.00"],
      ["per diem", false, undefined],
      ["case rate", true, "150.00"]
    ])
  })
})

describe("batch", () => {
  it("uses GROUP_BY_ALL unless some code names a methodology", () => {
    expect(batchGrouping([{}, { methodologies: [] }])).toBe("GROUP_BY_ALL")
    expect(batchGrouping([{}, { methodologies: ["per diem"] }])).toBe("GROUP_BY_METHODOLOGY")
  })

  it("maps results by position, mixing aggregate and per-methodology codes from one response", () => {
    const resp = {
      results: [
        hospitalResponse({ code: "99213", costs: [cost({ terms: { methodology: "METHODOLOGY_PER_DIEM" } })] }),
        hospitalResponse({ code: "99214", costs: [cost({ terms: { methodology: "METHODOLOGY_PER_DIEM" }, avg_charge: "77.00" })], all_terms: cost({ avg_charge: "55.00" }) }),
        hospitalResponse({ code: "00000", costs: [], all_terms: null })
      ]
    }

    const out = toBatchHospitalCostResults(resp, [{}, { methodologies: ["per diem"] }, {}])

    expect(out.results.map((r) => [r.results[0].cost?.code, r.results[0].methodology, r.found])).toEqual([
      ["99213", "", true],
      ["99214", "per diem", true],
      [undefined, "", false]
    ])
    expect(out.results[1].results[0].cost?.avg).toBe("77.00")
  })

  it("rejects a response whose length doesn't match the request", () => {
    expect(() => toBatchHospitalCostResults({ results: [] }, [{}])).toThrow(/0 results for 1/)
  })
})

describe("legacyGrouping", () => {
  it("is GROUP_BY_ALL with no filter when no methodology is named", () => {
    expect(legacyGrouping()).toEqual({ group_by: "GROUP_BY_ALL", filter: undefined })
  })

  it("is GROUP_BY_METHODOLOGY filtered to the methodology when one is named", () => {
    expect(legacyGrouping("percent of total billed charges")).toEqual({
      group_by: "GROUP_BY_METHODOLOGY",
      filter: { methodology: "METHODOLOGY_PERCENT_OF_TOTAL_BILLED_CHARGES" }
    })
  })
})

describe("toProviderOrderBy", () => {
  it("renames every legacy order to the provider enum", () => {
    expect(toProviderOrderBy("HOSPITAL_COST_ORDER_UNSPECIFIED")).toBe("HOSPITAL_PROVIDER_CODE_COST_ORDER_UNSPECIFIED")
    expect(toProviderOrderBy("HOSPITAL_COST_ORDER_COEFFICIENT_OF_VARIATION_DESC")).toBe("HOSPITAL_PROVIDER_CODE_COST_ORDER_COEFFICIENT_OF_VARIATION_DESC")
  })
})

describe("toListHospitalCodeCostsResponse", () => {
  const resp = {
    hospitals: [
      { hospital_id: "h1", hospital_name: "A", location: "x", ein: "1", cost: cost() },
      { hospital_id: "h2", hospital_name: "B", location: "y", ein: "2", cost: cost({ avg_charge: "10.00" }) }
    ],
    next_page_token: "tok",
    total_count: 7,
    hospital_count: 7,
    code_type: "CPT",
    code: "99213",
    snapshot_id: "snap",
    group_by: "GROUP_BY_ALL"
  }

  it("maps each row to a legacy HospitalCostResult and keeps only the legacy top-level fields", () => {
    const out = toListHospitalCodeCostsResponse(resp)

    expect(Object.keys(out).sort()).toEqual(["next_page_token", "results", "total_count"])
    expect(out.next_page_token).toBe("tok")
    expect(out.total_count).toBe(7)
    expect(out.results.map((r) => [r.hospital_id, r.hospital, r.found, r.results[0].methodology, r.results[0].cost?.avg]))
      .toEqual([["h1", "A", true, "", "400.00"], ["h2", "B", true, "", "10.00"]])
  })

  it("labels each entry with the requested methodology", () => {
    expect(toListHospitalCodeCostsResponse(resp, "case rate").results[0].results[0].methodology).toBe("case rate")
  })

  it("handles an empty page", () => {
    expect(toListHospitalCodeCostsResponse({})).toEqual({ results: [], next_page_token: "", total_count: 0 })
  })
})

describe("toCodePriceDistributionResponse", () => {
  it("unwraps the distribution", () => {
    const distribution = { hospital_count: 3, median: 5 }
    expect(toCodePriceDistributionResponse({ distribution, snapshot_id: "s", code: "1" })).toBe(distribution)
  })
})
