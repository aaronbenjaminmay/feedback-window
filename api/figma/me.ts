type VercelRequest = {
  method?: string;
  headers: {
    cookie?: string;
  };
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
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
