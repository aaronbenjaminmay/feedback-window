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

const renderCallbackPage = ({
  title,
  helperText,
  body,
  script,
  tone = "success"
}: {
  title: string;
  helperText: string;
  body?: string;
  script?: string;
  tone?: "success" | "error";
}) => {
  const isError = tone === "error";

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          :root {
            color-scheme: light;
            font-family: Inter, Arial, sans-serif;
            color: #111111;
            background: #f5f5f5;
          }

          * {
            box-sizing: border-box;
          }

          body {
            display: grid;
            min-height: 100vh;
            margin: 0;
            place-items: center;
            padding: 32px;
            background: #f5f5f5;
          }

          .card {
            width: min(100%, 440px);
            border: 1px solid #e6e6e6;
            border-radius: 14px;
            padding: 36px 34px;
            background: #ffffff;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
            text-align: center;
          }

          .mark {
            display: inline-grid;
            width: 44px;
            height: 44px;
            margin-bottom: 24px;
            place-items: center;
            border: 1px solid ${isError ? "#f1b8b8" : "#e6e6e6"};
            border-radius: 12px;
            color: ${isError ? "#b42318" : "#111111"};
            background: ${isError ? "#fff3f3" : "#ffffff"};
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 0;
          }

          h1 {
            margin: 0 0 12px;
            color: #111111;
            font-size: 32px;
            font-weight: 800;
            line-height: 1.12;
          }

          p {
            margin: 0;
            color: #666666;
            font-size: 15px;
            line-height: 1.45;
          }

          .code-block {
            margin: 26px 0 14px;
          }

          .code {
            display: block;
            border: 1px solid #d9d9d9;
            border-radius: 10px;
            padding: 18px;
            color: #111111;
            background: #fafafa;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 32px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: 0;
          }

          .copy-button {
            display: block;
            width: 100%;
            margin-top: 12px;
            border: 1px solid #0d99ff;
            border-radius: 10px;
            padding: 13px 16px;
            color: #ffffff;
            background: #0d99ff;
            font: inherit;
            font-size: 14px;
            font-weight: 700;
            line-height: 1;
            cursor: pointer;
          }

          .copy-button:hover {
            background: #007be5;
            border-color: #007be5;
          }

          .note {
            color: #777777;
            font-size: 12px;
            line-height: 1.4;
          }

          .details {
            margin-top: 18px;
            color: #777777;
            font-size: 13px;
          }

          ul {
            display: inline-block;
            margin: 16px 0 0;
            padding-left: 20px;
            color: #333333;
            text-align: left;
            font-size: 13px;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <main class="card">
          <div class="mark">FW</div>
          <h1>${title}</h1>
          <p>${helperText}</p>
          ${body || ""}
        </main>
        ${script || ""}
      </body>
    </html>`;
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
    response.status(400).send(
      renderCallbackPage({
        title: "Connection could not be completed",
        helperText:
          "No OAuth state was provided. Please start the Figma connection again.",
        tone: "error"
      })
    );
    return;
  }

  if (!expectedState || state !== expectedState) {
    response.status(400).send(
      renderCallbackPage({
        title: "Connection could not be completed",
        helperText:
          "The OAuth state was not recognized. Please start the Figma connection again.",
        tone: "error"
      })
    );
    return;
  }

  if (!code) {
    response.status(400).send(
      renderCallbackPage({
        title: "Connection could not be completed",
        helperText:
          "Figma reached the callback, but no authorization code was provided.",
        tone: "error"
      })
    );
    return;
  }

  const missingEnvVars = getMissingOAuthEnvVars();

  if (missingEnvVars.length > 0) {
    response.status(500).send(
      renderCallbackPage({
        title: "Figma OAuth is not configured",
        helperText:
          "The callback is missing required Vercel environment variables.",
        body: `
          <ul>
            ${missingEnvVars
              .map((envVarName) => `<li>${envVarName}</li>`)
              .join("")}
          </ul>
          <p class="details">Set the missing values in Vercel, then redeploy the project.</p>
        `,
        tone: "error"
      })
    );
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
      response.status(502).send(
        renderCallbackPage({
          title: "Connection could not be completed",
          helperText:
            "Figma did not return an access token. Check the OAuth app settings and callback URL.",
          tone: "error"
        })
      );
      return;
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!tokenData.access_token) {
      response.status(502).send(
        renderCallbackPage({
          title: "Connection could not be completed",
          helperText: "The token response did not include an access token.",
          tone: "error"
        })
      );
      return;
    }

    const connectionCode = createConnectionCode();
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

    await saveConnectionCode(connectionCode, tokenData.access_token);
    response.setHeader(
      "Set-Cookie",
      `figma_oauth_state=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie}`
    );

    response.send(
      renderCallbackPage({
        title: "Connected to Figma",
        helperText: "Copy this code and paste it into Feedback Window.",
        body: `
          <div class="code-block">
            <span class="code" id="connection-code">${connectionCode}</span>
            <button class="copy-button" id="copy-code-button" type="button">Copy code</button>
          </div>
          <p class="note">This code expires in about 10 minutes.</p>
        `,
        script: `
          <script>
            const copyButton = document.getElementById("copy-code-button");
            const connectionCode = document.getElementById("connection-code")?.textContent || "";

            copyButton?.addEventListener("click", async () => {
              try {
                await navigator.clipboard.writeText(connectionCode);
                copyButton.textContent = "Copied";
              } catch {
                copyButton.textContent = "Copy failed";
              }
            });
          </script>
        `
      })
    );
  } catch {
    response.status(502).send(
      renderCallbackPage({
        title: "Connection could not be completed",
        helperText: "The server could not complete the token exchange.",
        tone: "error"
      })
    );
  }
}
