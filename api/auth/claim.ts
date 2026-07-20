import {
  claimConnectionCode,
  normalizeConnectionCode
} from "../lib/connectionStore.js";

type VercelRequest = {
  method?: string;
  query: {
    code?: string | string[];
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

  const connectionCode = normalizeConnectionCode(getQueryValue(request.query.code));

  if (!connectionCode) {
    response.status(400).json({
      connected: false,
      error: "Missing connection code."
    });
    return;
  }

  const connectionId = await claimConnectionCode(connectionCode);

  if (!connectionId) {
    response.status(404).json({
      connected: false,
      error: "Connection code was not found or has expired."
    });
    return;
  }

  response.status(200).json({
    connected: true,
    connectionId
  });
}
