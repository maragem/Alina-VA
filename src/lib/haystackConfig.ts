function readTrimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function getHaystackApiKey(): string {
  return readTrimmed(process.env.HAYSTACK_API_KEY) || readTrimmed(process.env.DEEPSET_API_KEY);
}

export function getHaystackWorkspace(): string {
  return readTrimmed(process.env.HAYSTACK_WORKSPACE);
}

export function getHaystackIndex(): string {
  return readTrimmed(process.env.HAYSTACK_INDEX);
}

export function getHaystackPipeline(): string {
  return readTrimmed(process.env.HAYSTACK_PIPELINE);
}

export function getHaystackPipelineId(): string {
  return readTrimmed(process.env.HAYSTACK_PIPELINE_ID);
}

export function getHaystackWorkspaceId(): string {
  return readTrimmed(process.env.HAYSTACK_WORKSPACE_ID);
}