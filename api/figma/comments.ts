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

type FigmaNode = {
  id?: string;
  name?: string;
  type?: string;
  children?: FigmaNode[];
};

type FigmaFileResponse = {
  document?: FigmaNode;
};

type FigmaComment = {
  id?: string;
  client_meta?: unknown;
  pageName?: string;
  commentUrl?: string;
  nodeId?: string;
};

type FigmaCommentsResponse = {
  comments?: FigmaComment[];
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

const buildNodePageMap = (documentNode: FigmaNode | undefined) => {
  const nodePageMap = new Map<string, string>();

  const mapCanvasSubtree = (node: FigmaNode, pageName: string) => {
    if (node.id) {
      nodePageMap.set(node.id, pageName);
    }

    node.children?.forEach((child) => mapCanvasSubtree(child, pageName));
  };

  const visit = (node: FigmaNode | undefined) => {
    if (!node) {
      return;
    }

    if (node.type === "CANVAS") {
      mapCanvasSubtree(node, node.name || "Unknown page");
      return;
    }

    node.children?.forEach(visit);
  };

  visit(documentNode);

  return nodePageMap;
};

const extractNodeId = (clientMeta: unknown) => {
  if (!clientMeta || typeof clientMeta !== "object") {
    return "";
  }

  const metadata = clientMeta as Record<string, unknown>;
  const nodeId = metadata.node_id || metadata.nodeId;

  return typeof nodeId === "string" ? nodeId : "";
};

const buildCommentUrl = (fileKey: string, nodeId: string, commentId: string) => {
  if (!nodeId || !commentId) {
    return "";
  }

  return `https://www.figma.com/file/${encodeURIComponent(
    fileKey
  )}?node-id=${encodeURIComponent(nodeId)}&comment-id=${encodeURIComponent(
    commentId
  )}`;
};

const enrichCommentsWithLocation = (
  commentsBody: unknown,
  nodePageMap: Map<string, string>,
  fileKey: string
) => {
  if (!commentsBody || typeof commentsBody !== "object") {
    return commentsBody;
  }

  const body = commentsBody as FigmaCommentsResponse;

  if (!Array.isArray(body.comments)) {
    return commentsBody;
  }

  return {
    ...body,
    comments: body.comments.map((comment) => {
      const nodeId = extractNodeId(comment.client_meta);
      const pageName = nodeId
        ? nodePageMap.get(nodeId) || "Unknown page"
        : "Unknown page";
      const commentUrl = buildCommentUrl(fileKey, nodeId, comment.id || "");

      return {
        ...comment,
        pageName,
        commentUrl: commentUrl || undefined,
        nodeId: nodeId || undefined
      };
    })
  };
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

    let nodePageMap = new Map<string, string>();

    try {
      const fileResponse = await fetch(
        `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
      const fileBody = (await readUpstreamResponseBody(
        fileResponse
      )) as FigmaFileResponse | null;

      if (fileResponse.ok) {
        nodePageMap = buildNodePageMap(fileBody?.document);
      }
    } catch {
      nodePageMap = new Map<string, string>();
    }

    response
      .status(commentsResponse.status)
      .json(enrichCommentsWithLocation(commentsBody, nodePageMap, fileKey));
  } catch {
    response.status(502).json({
      error: "Could not fetch comments from Figma."
    });
  }
}
