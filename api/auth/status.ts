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

export default function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  response.json({
    connected: Boolean(getCookie(request.headers.cookie, "figma_access_token"))
  });
}
