import {
  getHaystackApiKey,
  getHaystackPipelineId,
  getHaystackWorkspace,
} from "@/lib/haystackConfig";

const API_KEY = getHaystackApiKey();
const WORKSPACE = getHaystackWorkspace();
const PIPELINE_ID = getHaystackPipelineId();

function configuration(): {
  apiKey: string;
  workspace: string;
  pipelineId: string;
} {
  if (!API_KEY || !WORKSPACE || !PIPELINE_ID) {
    throw new Error("Haystack search session configuration is incomplete.");
  }
  return { apiKey: API_KEY, workspace: WORKSPACE, pipelineId: PIPELINE_ID };
}

export function configuredHaystackPipelineId(): string {
  return configuration().pipelineId;
}

export async function createHaystackSearchSession(): Promise<string> {
  const { apiKey, workspace, pipelineId } = configuration();
  const response = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(workspace)}/search_sessions`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pipeline_id: pipelineId }),
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    search_session_id?: unknown;
  };
  if (!response.ok || typeof payload.search_session_id !== "string") {
    throw new Error("Could not create a Haystack chat session.");
  }
  return payload.search_session_id;
}

export async function deleteHaystackSearchSession(
  searchSessionId: string,
): Promise<void> {
  const { apiKey, workspace } = configuration();
  const response = await fetch(
    `https://api.cloud.deepset.ai/api/v1/workspaces/${encodeURIComponent(workspace)}/search_sessions/${encodeURIComponent(searchSessionId)}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("Could not delete the Haystack chat session.");
  }
}