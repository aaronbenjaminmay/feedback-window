import { getSessionToken } from "../lib/connectionStore.js";

type VercelRequest = {
  method?: string;
  query: {
    connectionId?: string | string[];
  };
  headers: {
    origin?: string;
  };
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string | string[]) => void;
  end: () => void;
};

const getQueryValue = (value: string | string[] | undefined) => {
  return Array.isArray(value) ? value[0] || "" : value || "";
};

const setCorsHeaders = (response: VercelResponse) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const readUpstreamResponseBody = async (upstreamResponse: Response) => {
  const responseText = await upstreamResponse.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return responseText;
  }
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const token = await getSessionToken(getQueryValue(request.query.connectionId));

  if (!token) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  try {
    const meResponse = await fetch("https://api.figma.com/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const meBody = await readUpstreamResponseBody(meResponse);

    response.status(meResponse.status).json(meBody);
  } catch {
    response.status(502).json({
      error: "Could not fetch the connected Figma user."
    });
  }
}
