export const HAYSTACK_ACCESS_SCOPE_FIELD = "alina_scope";
export const HAYSTACK_ACCESS_PROJECT_IDS_FIELD = "alina_project_ids";

export type HaystackAccessScope = "global" | "project";

type HaystackComparisonFilter = Readonly<{
  field: string;
  operator: "==" | "in" | "not in";
  value: string | number | readonly string[];
}>;

type HaystackLogicFilter = Readonly<{
  operator: "AND" | "OR";
  conditions: readonly HaystackFilter[];
}>;

export type HaystackFilter = HaystackComparisonFilter | HaystackLogicFilter;

export function haystackAccessMetadata(
  scope: HaystackAccessScope,
  projectIds: readonly string[] = [],
): Record<string, HaystackAccessScope | string[]> {
  const normalizedProjectIds = [...new Set(projectIds)].sort();
  return {
    [HAYSTACK_ACCESS_SCOPE_FIELD]: scope,
    [HAYSTACK_ACCESS_PROJECT_IDS_FIELD]:
      scope === "global" ? ["global"] : normalizedProjectIds,
  };
}

/**
 * Haystack metadata is shared by every environment pointing at the same workspace,
 * while `managed_files` is per-environment: files uploaded elsewhere have no local row.
 */
export function readHaystackAccessScope(
  meta: unknown,
): HaystackAccessScope | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  const scope = (meta as Record<string, unknown>)[HAYSTACK_ACCESS_SCOPE_FIELD];
  return scope === "global" || scope === "project" ? scope : null;
}

export async function fetchHaystackAccessScope({
  apiKey,
  workspace,
  fileId,
}: {
  apiKey: string;
  workspace: string;
  fileId: string;
}): Promise<HaystackAccessScope | null> {
  const response = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(workspace)}/files/${encodeURIComponent(fileId)}/meta`,
    {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  return readHaystackAccessScope(await response.json().catch(() => null));
}

export async function updateHaystackAccessMetadata({
  apiKey,
  workspace,
  fileId,
  scope,
  projectIds,
}: {
  apiKey: string;
  workspace: string;
  fileId: string;
  scope: HaystackAccessScope;
  projectIds: readonly string[];
}): Promise<void> {
  const response = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(workspace)}/files/${encodeURIComponent(fileId)}/meta`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(haystackAccessMetadata(scope, projectIds)),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Haystack metadata update failed for file ${fileId} (${response.status}).`,
    );
  }
}

export function buildHaystackDocumentFilter({
  projectId,
  authorityRank,
}: {
  projectId?: string;
  authorityRank?: number;
}): HaystackFilter {
  const accessFilter: HaystackComparisonFilter = {
    field: `meta.${HAYSTACK_ACCESS_PROJECT_IDS_FIELD}`,
    operator: "in",
    value: projectId ? ["global", projectId] : ["global"],
  };

  return authorityRank === undefined
    ? accessFilter
    : {
        operator: "AND",
        conditions: [
          accessFilter,
          {
            field: "meta.authority_rank",
            operator: "==",
            value: authorityRank,
          },
        ],
      };
}
