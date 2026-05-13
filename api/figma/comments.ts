import { getSessionToken } from "../lib/connectionStore.js";

type VercelRequest = {
  method?: string;
  query: {
    connectionId?: string | string[];
    fileKey?: string | string[];
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
  node_id?: string;
  nodeId?: string;
  pageName?: string;
  commentUrl?: string;
  debugClientMeta?: unknown;
  debugExtractedNodeId?: string;
  debugLookupNodeId?: string;
  debugPageMapHasNode?: boolean;
  debugPageMapSampleKeys?: string[];
  debugFileTreeStatus?: number | string;
  debugFileTreeError?: unknown;
};

type FigmaCommentsResponse = {
  comments?: FigmaComment[];
};

type FileTreeDebug = {
  status?: number | string;
  error?: unknown;
};

const getQueryValue = (value: string | string[] | undefined) => {
  return Array.isArray(value) ? value[0] || "" : value || "";
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
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
};

const normalizeNodeIdForLookup = (nodeId: string) => {
  return nodeId.trim().replace(/-/g, ":");
};

const formatNodeIdForUrl = (nodeId: string) => {
  return normalizeNodeIdForLookup(nodeId).replace(/:/g, "-");
};

const isLikelyNodeId = (value: string) => {
  return /^\d+[:|-]\d+/.test(value.trim());
};

const buildNodePageMap = (fileBody: FigmaFileResponse | null) => {
  const nodePageMap = new Map<string, string>();
  const documentNode = fileBody?.document;

  const mapCanvasSubtree = (node: FigmaNode, pageName: string) => {
    if (node.id) {
      nodePageMap.set(normalizeNodeIdForLookup(node.id), pageName);
    }

    node.children?.forEach((child) => mapCanvasSubtree(child, pageName));
  };

  if (!documentNode) {
    return nodePageMap;
  }

  if (documentNode.type === "CANVAS") {
    mapCanvasSubtree(documentNode, documentNode.name || "Unknown page");
    return nodePageMap;
  }

  documentNode.children
    ?.filter((node) => node.type === "CANVAS")
    .forEach((canvasNode) => {
      mapCanvasSubtree(canvasNode, canvasNode.name || "Unknown page");
    });

  return nodePageMap;
};

const extractNodeIdFromValue = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return isLikelyNodeId(value) ? normalizeNodeIdForLookup(value) : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedNodeId = extractNodeIdFromValue(item);

      if (nestedNodeId) {
        return nestedNodeId;
      }
    }

    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const metadata = value as Record<string, unknown>;
  const directNodeId =
    metadata.node_id ||
    metadata.nodeId ||
    metadata.node ||
    metadata.id ||
    metadata.guid;

  if (typeof directNodeId === "string" && isLikelyNodeId(directNodeId)) {
    return normalizeNodeIdForLookup(directNodeId);
  }

  if (directNodeId && typeof directNodeId === "object") {
    const nestedNodeId = extractNodeIdFromValue(directNodeId);

    if (nestedNodeId) {
      return nestedNodeId;
    }
  }

  const priorityFields = [
    metadata.selection,
    metadata.selected,
    metadata.selections,
    metadata.nodes,
    metadata.nodeIds,
    metadata.region
  ];

  for (const field of priorityFields) {
    const nestedNodeId = extractNodeIdFromValue(field);

    if (nestedNodeId) {
      return nestedNodeId;
    }
  }

  for (const field of Object.values(metadata)) {
    const nestedNodeId = extractNodeIdFromValue(field);

    if (nestedNodeId) {
      return nestedNodeId;
    }
  }

  return "";
};

const extractNodeId = (comment: FigmaComment) => {
  return (
    extractNodeIdFromValue(comment.client_meta) ||
    extractNodeIdFromValue(comment.node_id) ||
    extractNodeIdFromValue(comment.nodeId)
  );
};

const buildCommentUrl = (fileKey: string, nodeId: string, commentId: string) => {
  if (!commentId) {
    return "";
  }

  if (!nodeId) {
    return `https://www.figma.com/design/${encodeURIComponent(
      fileKey
    )}#${encodeURIComponent(commentId)}`;
  }

  return `https://www.figma.com/design/${encodeURIComponent(
    fileKey
  )}?node-id=${encodeURIComponent(
    formatNodeIdForUrl(nodeId)
  )}#${encodeURIComponent(commentId)}`;
};

const enrichCommentsWithLocation = (
  commentsBody: unknown,
  nodePageMap: Map<string, string>,
  fileKey: string,
  fileTreeDebug: FileTreeDebug
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
    comments: body.comments.map((comment, index) => {
      const extractedNodeId = extractNodeId(comment);
      const lookupNodeId = extractedNodeId
        ? normalizeNodeIdForLookup(extractedNodeId)
        : "";
      const pageName = lookupNodeId
        ? nodePageMap.get(lookupNodeId) || "Unknown page"
        : "Unknown page";
      const commentUrl = buildCommentUrl(
        fileKey,
        lookupNodeId,
        comment.id || ""
      );
      const debugFields =
        index < 5
          ? {
              debugClientMeta: comment.client_meta ?? null,
              debugExtractedNodeId: extractedNodeId || "",
              debugLookupNodeId: lookupNodeId || "",
              debugPageMapHasNode: lookupNodeId
                ? nodePageMap.has(lookupNodeId)
                : false,
              debugPageMapSampleKeys: Array.from(nodePageMap.keys()).slice(
                0,
                10
              ),
              debugFileTreeStatus: fileTreeDebug.status,
              debugFileTreeError: fileTreeDebug.error
            }
          : {};

      return {
        ...comment,
        pageName,
        commentUrl: commentUrl || undefined,
        nodeId: lookupNodeId || undefined,
        ...debugFields
      };
    })
  };
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

  if (request.method && request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const connectionId = getQueryValue(request.query.connectionId);
  const token = await getSessionToken(connectionId);
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
    const fileTreeDebug: FileTreeDebug = {};

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

      fileTreeDebug.status = fileResponse.status;

      if (fileResponse.ok) {
        nodePageMap = buildNodePageMap(fileBody);
      } else {
        fileTreeDebug.error = fileBody;
      }
    } catch (error) {
      nodePageMap = new Map<string, string>();
      fileTreeDebug.status = "fetch-error";
      fileTreeDebug.error =
        error instanceof Error ? error.message : "Unknown file tree fetch error.";
    }

    response
      .status(commentsResponse.status)
      .json(
        enrichCommentsWithLocation(
          commentsBody,
          nodePageMap,
          fileKey,
          fileTreeDebug
        )
      );
  } catch {
    response.status(502).json({
      error: "Could not fetch comments from Figma."
    });
  }
}
