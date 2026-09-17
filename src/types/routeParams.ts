export type RouteParams<T extends string> = {
  params: Promise<Record<T, string>>;
};