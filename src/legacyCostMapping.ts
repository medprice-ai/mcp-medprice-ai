import { z } from "zod"

// Adapters that serve the legacy `*_chargemaster_cost` / `list_hospital_code_costs`
// / `get_code_price_distribution` tools from ProviderCodeCostService, keeping
// each tool's input and output schema unchanged. Pure functions, no gRPC, so
// they can be unit-tested without a backend.

// Legacy methodology db strings -> provider Methodology enum names.
export const LEGACY_METHODOLOGY_TO_ENUM = {
  "case rate": "METHODOLOGY_CASE_RATE",
  "fee schedule": "METHODOLOGY_FEE_SCHEDULE",
  "other": "METHODOLOGY_OTHER",
  "percent of total billed charges": "METHODOLOGY_PERCENT_OF_TOTAL_BILLED_CHARGES",
  "per diem": "METHODOLOGY_PER_DIEM"
} as const

export type LegacyMethodology = keyof typeof LEGACY_METHODOLOGY_TO_ENUM

export const legacyMethodologyZod = z.enum(
  Object.keys(LEGACY_METHODOLOGY_TO_ENUM) as [LegacyMethodology, ...LegacyMethodology[]]
)

// Legacy order_by enum names -> provider ones. Every legacy value has a
// provider counterpart of the same suffix.
export const toProviderOrderBy = (legacy: string): string =>
  legacy.replace(/^HOSPITAL_COST_ORDER_/, "HOSPITAL_PROVIDER_CODE_COST_ORDER_")

// The legacy tools return one figure per hospital. With no methodology that is
// the all-terms pool (GROUP_BY_ALL, which takes no filter). With one, it is
// the methodology pool, filtered to it.
export const legacyGrouping = (methodology?: LegacyMethodology) =>
  methodology
    ? {
      group_by: "GROUP_BY_METHODOLOGY",
      filter: { methodology: LEGACY_METHODOLOGY_TO_ENUM[methodology] }
    }
    : { group_by: "GROUP_BY_ALL", filter: undefined }

type ProviderCodeCost = {
  terms?: { methodology?: string } | null
  n?: string
  min_charge?: string
  max_charge?: string
  avg_charge?: string
  median_charge?: string
  std_dev_charge?: string
  code_description?: string
  sample_count_sum_min?: string
  sample_count_sum_max?: string
  sample_count_exact?: boolean
}

type HospitalProviderCodeCostsResponse = {
  hospital_id?: string
  hospital_name?: string
  location?: string
  costs?: ProviderCodeCost[]
  code_type?: string
  code?: string
  all_terms?: ProviderCodeCost | null
}

// ProviderCodeCost -> CodeCostStatsMessage. Dropped (no legacy counterpart):
// n, filed_min, filed_max. min/max are now the charges' own min/max, not
// widened by the file's per-item minimum/maximum as the legacy figures were.
const toCostStats = (codeType: string | undefined, code: string | undefined, c: ProviderCodeCost) => ({
  code_type: codeType ?? "",
  code: code ?? "",
  min: c.min_charge ?? "",
  max: c.max_charge ?? "",
  avg: c.avg_charge ?? "",
  median: c.median_charge ?? "",
  std_dev: c.std_dev_charge ?? "",
  sample_count_sum_min: c.sample_count_sum_min ?? "0",
  sample_count_sum_max: c.sample_count_sum_max ?? "0",
  sample_count_exact: c.sample_count_exact ?? false
})

// methodology_note has no provider counterpart and is left empty rather than
// invented.
const toDescription = (hospitalName: string | undefined, location: string | undefined, c: ProviderCodeCost | null) => ({
  hospital_name: hospitalName ?? "",
  location: location ?? "",
  code_description: c?.code_description ?? "",
  methodology_note: ""
})

const toMethodologyResult = (
  methodology: string,
  hospitalName: string | undefined,
  location: string | undefined,
  codeType: string | undefined,
  code: string | undefined,
  cost: ProviderCodeCost | null | undefined
) => ({
  methodology,
  found: !!cost,
  cost: cost ? toCostStats(codeType, code, cost) : null,
  description: toDescription(hospitalName, location, cost ?? null)
})

// One HospitalProviderCodeCostsResponse -> legacy HospitalCostResult.
//
// With no `methodologies` the response must have been requested with
// GROUP_BY_ALL (or any grouping: all_terms is the all-terms pool whatever the
// grouping) and gives exactly one aggregate entry. With `methodologies` it must
// have been requested with GROUP_BY_METHODOLOGY (no filter), and gives one entry
// per requested methodology in request order, found=false when the hospital
// doesn't file that methodology.
export const toHospitalCostResult = (
  resp: HospitalProviderCodeCostsResponse,
  methodologies: readonly LegacyMethodology[] = []
) => {
  const entry = (methodology: string, cost: ProviderCodeCost | null | undefined) =>
    toMethodologyResult(methodology, resp.hospital_name, resp.location, resp.code_type, resp.code, cost)

  const results = methodologies.length === 0
    ? [entry("", resp.all_terms ?? resp.costs?.[0])]
    : methodologies.map((m) =>
      entry(m, resp.costs?.find((c) => c.terms?.methodology === LEGACY_METHODOLOGY_TO_ENUM[m]))
    )

  return {
    hospital: resp.hospital_name ?? "",
    found: results.some((r) => r.found),
    hospital_id: resp.hospital_id ?? "",
    results
  }
}

// Batch: methodology-less codes need the aggregate, codes naming methodologies
// need the per-methodology rows. GROUP_BY_METHODOLOGY responses carry both
// (rows in `costs`, aggregate in `all_terms`), so one RPC serves any mix; the
// cheaper GROUP_BY_ALL is used when no code names a methodology.
export const batchGrouping = (codes: ReadonlyArray<{ methodologies?: readonly LegacyMethodology[] }>) =>
  codes.some((c) => c.methodologies?.length)
    ? "GROUP_BY_METHODOLOGY"
    : "GROUP_BY_ALL"

export const toBatchHospitalCostResults = (
  resp: { results?: HospitalProviderCodeCostsResponse[] },
  codes: ReadonlyArray<{ methodologies?: readonly LegacyMethodology[] }>
) => {
  const results = resp.results ?? []
  if (results.length !== codes.length) {
    throw new Error(`provider batch returned ${results.length} results for ${codes.length} requested codes`)
  }
  return { results: results.map((r, i) => toHospitalCostResult(r, codes[i].methodologies ?? [])) }
}

// ListCodeProviderHospitalsResponse -> legacy ListHospitalCodeCostsResponse.
// Under GROUP_BY_ALL, or GROUP_BY_METHODOLOGY with a methodology filter, there
// is one row per hospital, so each row is one legacy HospitalCostResult with a
// single entry. Dropped (no legacy counterpart): ein, hospital_count,
// ai_description(+provenance), snapshot_id, code_type, code, group_by.
export const toListHospitalCodeCostsResponse = (
  resp: {
    hospitals?: Array<{ hospital_id?: string, hospital_name?: string, location?: string, cost?: ProviderCodeCost | null }>
    next_page_token?: string
    total_count?: number
    code_type?: string
    code?: string
  },
  methodology?: LegacyMethodology
) => ({
  results: (resp.hospitals ?? []).map((h) => ({
    hospital: h.hospital_name ?? "",
    found: !!h.cost,
    hospital_id: h.hospital_id ?? "",
    results: [toMethodologyResult(methodology ?? "", h.hospital_name, h.location, resp.code_type, resp.code, h.cost)]
  })),
  next_page_token: resp.next_page_token ?? "",
  total_count: resp.total_count ?? 0
})

// CodeProviderPriceDistributionResponse wraps the legacy response unchanged.
export const toCodePriceDistributionResponse = (resp: { distribution?: unknown, [k: string]: unknown }) => resp.distribution ?? {}
