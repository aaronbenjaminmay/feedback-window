type VercelRequest = {
  method?: string;
  query: {
    fileKey?: string | string[];
  };
  headers: {
    cookie?: string;
  };
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
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
  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const token = getCookie(request.headers.cookie, "figma_access_token");
  const fileKey = getQueryValue(request.query.fileKey).trim();

  if (!token) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  if (!fileKey) {
    response.status(400).json({ error: "Missing fileKey query parameter." });
    return;
  }

  try {
    const commentsResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    const commentsBody = await readUpstreamResponseBody(commentsResponse);

    if (!commentsResponse.ok) {
      response.status(commentsResponse.status).json({
        message: "Figma could not return comments for this file.",
        upstreamStatus: commentsResponse.status,
        upstreamBody: commentsBody
      });
      return;
    }

    response.status(commentsResponse.status).json(commentsBody);
  } catch {
    response.status(502).json({
      error: "Could not fetch comments from Figma."
    });
  }
}
