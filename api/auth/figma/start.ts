type VercelRequest = {
  method?: string;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string | string[]) => void;
  redirect: (statusCode: number, url: string) => void;
};

const figmaAuthorizeUrl = "https://www.figma.com/oauth";
const defaultScopes = "file_comments:read";

declare const process: {
  env: Record<string, string | undefined>;
};

const createOAuthState = () => {
  const stateBytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(stateBytes);

  return Array.from(stateBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export default function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientId = process.env.FIGMA_CLIENT_ID;
  const redirectUri = process.env.FIGMA_REDIRECT_URI;
  const figmaScopes = process.env.FIGMA_OAUTH_SCOPES ?? defaultScopes;

  if (!clientId || !redirectUri) {
    response.status(500).json({
      error: "Figma OAuth is not configured."
    });
    return;
  }

  const state = createOAuthState();
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

  response.setHeader(
    "Set-Cookie",
    `figma_oauth_state=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600${secureCookie}`
  );

  const authorizationUrl = new URL(figmaAuthorizeUrl);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);

  if (figmaScopes) {
    authorizationUrl.searchParams.set("scope", figmaScopes);
  }

  response.redirect(302, authorizationUrl.toString());
}
