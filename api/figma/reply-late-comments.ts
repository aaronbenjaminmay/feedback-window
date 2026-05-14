import { getSessionToken } from "../lib/connectionStore.js";

type VercelRequest = {
  method?: string;
  body?: unknown;
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

type ReplyLateCommentsBody = {
  connectionId?: unknown;
  fileKey?: unknown;
  commentIds?: unknown;
  message?: unknown;
};

type FigmaComment = {
  id?: string;
  parent_id?: string | null;
};

type FigmaCommentsResponse = {
  comments?: FigmaComment[];
};

const readRequestBody = (body: unknown): ReplyLateCommentsBody => {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body) as ReplyLateCommentsBody;
    } catch {
      return {};
    }
  }

  if (typeof body === "object") {
    return body as ReplyLateCommentsBody;
  }

  return {};
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

const setCorsHeaders = (request: VercelRequest, response: VercelResponse) => {
  response.setHeader(
    "Access-Control-Allow-Origin",
    request.headers.origin || "https://www.figma.com"
  );
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
};

const getStringValue = (value: unknown) => {
  return typeof value === "string" ? value.trim() : "";
};

const getCommentIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((commentId): commentId is string => typeof commentId === "string")
    .map((commentId) => commentId.trim())
    .filter(Boolean);
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  setCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method && request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const requestBody = readRequestBody(request.body);
  const connectionId = getStringValue(requestBody.connectionId);
  const fileKey = getStringValue(requestBody.fileKey);
  const message = getStringValue(requestBody.message);
  const requestedCommentIds = Array.from(
    new Set(getCommentIds(requestBody.commentIds))
  );
  const token = await getSessionToken(connectionId);

  if (!token) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  if (!fileKey) {
    response.status(400).json({ error: "Missing fileKey." });
    return;
  }

  if (requestedCommentIds.length === 0) {
    response.status(400).json({ error: "No comment IDs were provided." });
    return;
  }

  if (!message) {
    response.status(400).json({ error: "Missing reply message." });
    return;
  }

  const commentsUrl = `https://api.figma.com/v1/files/${encodeURIComponent(
    fileKey
  )}/comments`;

  try {
    const commentsResponse = await fetch(commentsUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const commentsBody = await readUpstreamResponseBody(commentsResponse);

    if (!commentsResponse.ok) {
      response.status(commentsResponse.status).json({
        message: "Figma could not return comments for this file.",
        upstreamStatus: commentsResponse.status,
        upstreamBody: commentsBody
      });
      return;
    }

    const figmaComments = (commentsBody as FigmaCommentsResponse).comments || [];
    const rootCommentIds = new Set(
      figmaComments
        .filter((comment) => comment.id && !comment.parent_id)
        .map((comment) => comment.id as string)
    );
    const repliedCommentIds: string[] = [];
    const skippedCommentIds: string[] = [];
    const failedCommentIds: {
      commentId: string;
      upstreamStatus: number;
      upstreamBody: unknown;
    }[] = [];

    for (const commentId of requestedCommentIds) {
      if (!rootCommentIds.has(commentId)) {
        skippedCommentIds.push(commentId);
        continue;
      }

      const replyResponse = await fetch(commentsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          comment_id: commentId
        })
      });
      const replyBody = await readUpstreamResponseBody(replyResponse);

      if (replyResponse.ok) {
        repliedCommentIds.push(commentId);
      } else {
        failedCommentIds.push({
          commentId,
          upstreamStatus: replyResponse.status,
          upstreamBody: replyBody
        });
      }
    }

    response.status(failedCommentIds.length > 0 ? 207 : 200).json({
      repliedCommentIds,
      skippedCommentIds,
      failedCommentIds
    });
  } catch {
    response.status(502).json({
      error: "Could not post late-feedback replies to Figma."
    });
  }
}
