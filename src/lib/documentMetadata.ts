export const AUTHORITY_CATEGORIES = [
  { value: "treaties_and_charter", label: "Treaties and Charter", rank: 1 },
  { value: "cjeu_caselaw", label: "CJEU Caselaw", rank: 2 },
  { value: "council_directives", label: "Council Directives", rank: 2 },
  { value: "ec_decisions", label: "EC Decisions", rank: 2 },
  { value: "ec_directives", label: "EC Directives", rank: 2 },
  { value: "eu_regulations", label: "EU Regulations", rank: 2 },
  { value: "international_agreements", label: "International Agreements", rank: 2 },
  { value: "national_law", label: "National Law", rank: 2 },
  { value: "budg_vademecum", label: "BUDG Vademecum", rank: 3 },
  { value: "ec_communications", label: "EC Communications", rank: 3 },
  { value: "ec_recommendations", label: "EC Recommendations", rank: 3 },
  { value: "contractual_documents", label: "Contractual documents", rank: 3 },
  { value: "general_guidance", label: "General Guidance", rank: 3 },
  { value: "internal_guidance", label: "Internal Guidance", rank: 4 },
  { value: "questions_and_answers", label: "Q&A", rank: 4 },
  { value: "procurement_documents", label: "Procurement documents", rank: null },
  { value: "templates", label: "Templates", rank: null },
] as const;

export type AuthorityCategory = (typeof AUTHORITY_CATEGORIES)[number]["value"];
export type AuthorityRank = 1 | 2 | 3 | 4;

export function isAuthorityRank(value: unknown): value is AuthorityRank {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4;
}

export function isAuthorityCategory(value: unknown): value is AuthorityCategory {
  return typeof value === "string" && AUTHORITY_CATEGORIES.some((category) => category.value === value);
}

export function authorityCategoryRank(value: AuthorityCategory): AuthorityRank | null {
  return AUTHORITY_CATEGORIES.find((category) => category.value === value)?.rank ?? null;
}

export function authorityCategoryLabel(value: string | null | undefined): string {
  return AUTHORITY_CATEGORIES.find((category) => category.value === value)?.label ?? "Unranked";
}