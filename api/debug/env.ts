type VercelRequest = {
  method?: string;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
};

declare const process: {
  env: Record<string, string | undefined>;
};

export default function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientId = process.env.FIGMA_CLIENT_ID || "";

  response.status(200).json({
    hasClientId: Boolean(clientId),
    clientIdPrefix: clientId.slice(0, 6),
    clientIdLength: clientId.length,
    hasClientSecret: Boolean(process.env.FIGMA_CLIENT_SECRET),
    redirectUri: process.env.FIGMA_REDIRECT_URI || "",
    scopes: process.env.FIGMA_OAUTH_SCOPES || "",
    nodeEnv: process.env.NODE_ENV || ""
  });
}
