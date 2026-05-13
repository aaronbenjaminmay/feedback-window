import {
  createConnectionCode,
  saveConnectionCode
} from "../../lib/connectionStore.js";

type VercelRequest = {
  method?: string;
  query: {
    code?: string | string[];
    state?: string | string[];
  };
  headers: {
    cookie?: string;
  };
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  send: (body: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
};

const figmaTokenUrl = "https://api.figma.com/v1/oauth/token";

declare const process: {
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  from: (value: string) => {
    toString: (encoding: "base64") => string;
  };
};

const getQueryValue = (value: string | string[] | undefined) => {
  return Array.isArray(value) ? value[0] || "" : value || "";
};

const getCookie = (cookieHeader: string | undefined, name: string) => {
  const cookies = cookieHeader?.split(";") || [];
  const matchingCookie = cookies.find((cookie) =>
    cookie.trim().startsWith(`${name}=`)
  );

  return matchingCookie?.trim().slice(name.length + 1) || "";
};

const getMissingOAuthEnvVars = () => {
  const requiredEnvVars = [
    "FIGMA_CLIENT_ID",
    "FIGMA_CLIENT_SECRET",
    "FIGMA_REDIRECT_URI"
  ];

  return requiredEnvVars.filter((envVarName) => !process.env[envVarName]);
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const code = getQueryValue(request.query.code);
  const state = getQueryValue(request.query.state);
  const expectedState = getCookie(request.headers.cookie, "figma_oauth_state");

  if (!state) {
    response.status(400).send(`
      <h1>Figma OAuth callback error</h1>
      <p>No OAuth state was provided. Please start the Figma connection again.</p>
    `);
    return;
  }

  if (!expectedState || state !== expectedState) {
    response.status(400).send(`
      <h1>Figma OAuth callback error</h1>
      <p>The OAuth state was not recognized. Please start the Figma connection again.</p>
    `);
    return;
  }

  if (!code) {
    response.status(400).send(`
      <h1>Figma OAuth callback reached</h1>
      <p>No authorization code was provided.</p>
    `);
    return;
  }

  const missingEnvVars = getMissingOAuthEnvVars();

  if (missingEnvVars.length > 0) {
    response.status(500).send(`
      <h1>Figma OAuth is not configured</h1>
      <p>The callback is missing required Vercel environment variables:</p>
      <ul>
        ${missingEnvVars.map((envVarName) => `<li>${envVarName}</li>`).join("")}
      </ul>
      <p>Set the missing values in Vercel, then redeploy the project.</p>
    `);
    return;
  }

  const clientId = process.env.FIGMA_CLIENT_ID as string;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET as string;
  const redirectUri = process.env.FIGMA_REDIRECT_URI as string;

  try {
    const tokenBody = new URLSearchParams({
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code"
    });
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );

    const tokenResponse = await fetch(figmaTokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenBody
    });

    if (!tokenResponse.ok) {
      response.status(502).send(`
        <h1>Figma OAuth token exchange failed</h1>
        <p>Figma did not return an access token. Check the OAuth app settings and callback URL.</p>
      `);
      return;
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!tokenData.access_token) {
      response.status(502).send(`
        <h1>Figma OAuth token exchange failed</h1>
        <p>The token response did not include an access token.</p>
      `);
      return;
    }

    const connectionCode = createConnectionCode();
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

    await saveConnectionCode(connectionCode, tokenData.access_token);
    response.setHeader(
      "Set-Cookie",
      `figma_oauth_state=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie}`
    );

    response.send(`
      <h1>Connected to Figma.</h1>
      <p>Copy this code and paste it into the plugin.</p>
      <p style="font-family: monospace; font-size: 28px; font-weight: 700;">${connectionCode}</p>
      <p>This temporary prototype code expires in about 10 minutes.</p>
    `);
  } catch {
    response.status(502).send(`
      <h1>Figma OAuth token exchange failed</h1>
      <p>The server could not complete the token exchange.</p>
    `);
  }
}
