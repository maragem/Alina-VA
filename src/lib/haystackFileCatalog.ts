type HaystackFilePage = {
  data: Array<{ file_id?: unknown; created_at?: unknown }>;
  has_more: boolean;
};

const PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function listHaystackFileIds({
  apiKey,
  workspace,
}: {
  apiKey: string;
  workspace: string;
}): Promise<string[]> {
  const fileIds: string[] = [];
  let afterValue = "";
  let afterFileId = "";

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      field: "created_at",
      order: "ASC",
    });
    if (afterValue && afterFileId) {
      params.set("after_value", afterValue);
      params.set("after_file_id", afterFileId);
    }

    const response = await fetch(
      `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(workspace)}/files?${params}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Haystack file listing failed.");

    const value: unknown = await response.json().catch(() => null);
    if (
      !isRecord(value) ||
      !Array.isArray(value.data) ||
      typeof value.has_more !== "boolean"
    ) {
      throw new Error("Haystack returned an invalid file listing.");
    }
    const page = value as HaystackFilePage;
    const records = page.data.filter(isRecord);
    for (const file of records) {
      if (typeof file.file_id === "string" && file.file_id)
        fileIds.push(file.file_id);
    }

    if (!page.has_more) return fileIds;
    const lastFile = records.at(-1);
    if (
      !lastFile ||
      typeof lastFile.file_id !== "string" ||
      typeof lastFile.created_at !== "string" ||
      !lastFile.file_id ||
      !lastFile.created_at
    ) {
      throw new Error("Haystack returned an invalid file cursor.");
    }
    afterFileId = lastFile.file_id;
    afterValue = lastFile.created_at;
  }
}
