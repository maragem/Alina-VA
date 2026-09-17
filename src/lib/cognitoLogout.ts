import "server-only";

export function getCognitoLogoutUrl(): string | null {
  const clientId = process.env.AUTH_COGNITO_ID?.trim();
  const domain = process.env.AUTH_COGNITO_DOMAIN?.trim();
  const postLogoutUrl = process.env.AUTH_POST_LOGOUT_URL?.trim();

  if (!clientId || !domain || !postLogoutUrl) return null;

  try {
    const logoutUrl = new URL("/logout", domain);
    logoutUrl.searchParams.set("client_id", clientId);
    logoutUrl.searchParams.set("logout_uri", new URL(postLogoutUrl).toString());
    return logoutUrl.toString();
  } catch {
    return null;
  }
}

export function isAllowedCognitoLogoutUrl(value: string): boolean {
  const configuredUrl = getCognitoLogoutUrl();
  if (!configuredUrl) return false;

  try {
    return new URL(value).toString() === configuredUrl;
  } catch {
    return false;
  }
}