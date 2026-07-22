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
  parent_id?: string;
  client_meta?: unknown;
  node_id?: string;
  nodeId?: string;
  resolved?: unknown;
  resolved_at?: unknown;
  resolvedAt?: unknown;
  is_resolved?: unknown;
  isResolved?: unknown;
  pageName?: string;
  commentUrl?: string;
};

type FigmaCommentsResponse = {
  comments?: FigmaComment[];
};

const getQueryValue = (value: string | string[] | undefined) => {
  return Array.isArray(value) ? value[0] || "" : value || "";
};

const readUpstreamResponseBody = async (
  upstreamResponse: Response,
  label: string,
  started: number
) => {
  const textStart = Date.now();
  const responseText = await upstreamResponse.text();
  console.log(
    `[comments] ${label} body read (text)`,
    Date.now() - started,
    { stageMs: Date.now() - textStart, bytes: responseText.length }
  );

  if (!responseText) {
    return null;
  }

  try {
    const parseStart = Date.now();
    const parsed = JSON.parse(responseText) as unknown;
    console.log(
      `[comments] ${label} body parsed (JSON.parse)`,
      Date.now() - started,
      { stageMs: Date.now() - parseStart }
    );
    return parsed;
  } catch {
    return responseText;
  }
};

const setCorsHeaders = (response: VercelResponse) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

  let nodesVisited = 0;
  let maxDepthSeen = 0;

  const mapCanvasSubtree = (node: FigmaNode, pageName: string, depth = 0) => {
    nodesVisited += 1;
    if (depth > maxDepthSeen) {
      maxDepthSeen = depth;
    }

    if (node.id) {
      nodePageMap.set(normalizeNodeIdForLookup(node.id), pageName);
    }

    node.children?.forEach((child) => mapCanvasSubtree(child, pageName, depth + 1));
  };

  if (!documentNode) {
    console.log("[comments] buildNodePageMap: no document node", { nodesVisited });
    return nodePageMap;
  }

  const traversalStart = Date.now();

  if (documentNode.type === "CANVAS") {
    mapCanvasSubtree(documentNode, documentNode.name || "Unknown page");
  } else {
    documentNode.children
      ?.filter((node) => node.type === "CANVAS")
      .forEach((canvasNode) => {
        mapCanvasSubtree(canvasNode, canvasNode.name || "Unknown page");
      });
  }

  console.log("[comments] buildNodePageMap: tree traversal done", {
    stageMs: Date.now() - traversalStart,
    nodesVisited,
    maxDepthSeen,
    mapSize: nodePageMap.size
  });

  return nodePageMap;
};

const getFilePageNames = (fileBody: FigmaFileResponse | null) => {
  const documentNode = fileBody?.document;

  if (!documentNode) {
    return [];
  }

  if (documentNode.type === "CANVAS") {
    return [documentNode.name || "Unknown page"];
  }

  return (
    documentNode.children
      ?.filter((node) => node.type === "CANVAS")
      .map((canvasNode) => canvasNode.name || "Unknown page")
      .filter((pageName) => pageName !== "Unknown page") || []
  );
};

let extractNodeIdFromValueCallCount = 0;

const extractNodeIdFromValue = (value: unknown): string => {
  extractNodeIdFromValueCallCount += 1;

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

const isResolvedValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
};

const isResolvedComment = (comment: FigmaComment) => {
  return (
    isResolvedValue(comment.resolved_at) ||
    isResolvedValue(comment.resolvedAt) ||
    isResolvedValue(comment.resolved) ||
    isResolvedValue(comment.is_resolved) ||
    isResolvedValue(comment.isResolved)
  );
};

const getActiveComments = (comments: FigmaComment[]) => {
  const resolvedRootCommentIds = new Set(
    comments
      .filter((comment) => !comment.parent_id && comment.id && isResolvedComment(comment))
      .map((comment) => comment.id)
  );

  return comments.filter((comment) => {
    if (isResolvedComment(comment)) {
      return false;
    }

    if (comment.parent_id && resolvedRootCommentIds.has(comment.parent_id)) {
      return false;
    }

    return true;
  });
};

const enrichCommentsWithLocation = (
  commentsBody: unknown,
  nodePageMap: Map<string, string>,
  fileKey: string,
  pageNames: string[]
) => {
  if (!commentsBody || typeof commentsBody !== "object") {
    return commentsBody;
  }

  const body = commentsBody as FigmaCommentsResponse;

  if (!Array.isArray(body.comments)) {
    return commentsBody;
  }

  const filterStart = Date.now();
  const activeComments = getActiveComments(body.comments);
  console.log("[comments] getActiveComments (resolved filter) done", {
    stageMs: Date.now() - filterStart,
    totalComments: body.comments.length,
    activeComments: activeComments.length
  });

  extractNodeIdFromValueCallCount = 0;
  const resolutionStart = Date.now();

  const resolvedComments = activeComments.map((comment) => {
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

    return {
      ...comment,
      pageName,
      commentUrl: commentUrl || undefined,
      nodeId: lookupNodeId || undefined
    };
  });

  console.log("[comments] per-comment location resolution done", {
    stageMs: Date.now() - resolutionStart,
    commentsResolved: resolvedComments.length,
    extractNodeIdFromValueCalls: extractNodeIdFromValueCallCount,
    avgExtractCallsPerComment: resolvedComments.length
      ? extractNodeIdFromValueCallCount / resolvedComments.length
      : 0
  });

  return {
    ...body,
    pages: pageNames,
    comments: resolvedComments
  };
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  const started = Date.now();
  setCorsHeaders(response);

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
  console.log("[comments] session lookup", Date.now() - started);

  const fileKey = getQueryValue(request.query.fileKey).trim();

  if (!token) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  if (!fileKey) {
    response.status(400).json({ error: "Missing fileKey query parameter." });
    return;
  }

  console.log("[comments] request start", Date.now() - started, { fileKey });

  try {
    const commentsFetchStart = Date.now();
    const commentsResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    console.log("[comments] comments API network round-trip", Date.now() - started, {
      stageMs: Date.now() - commentsFetchStart,
      status: commentsResponse.status
    });

    const commentsBody = await readUpstreamResponseBody(
      commentsResponse,
      "comments",
      started
    );
    console.log("[comments] comments fetched", Date.now() - started, {
      count: Array.isArray((commentsBody as FigmaCommentsResponse | null)?.comments)
        ? (commentsBody as FigmaCommentsResponse).comments!.length
        : null
    });

    if (!commentsResponse.ok) {
      response.status(commentsResponse.status).json({
        message: "Figma could not return comments for this file.",
        upstreamStatus: commentsResponse.status,
        upstreamBody: commentsBody
      });
      return;
    }

    let nodePageMap = new Map<string, string>();
    let pageNames: string[] = [];

    try {
      const commentsList = Array.isArray(
        (commentsBody as FigmaCommentsResponse | null)?.comments
      )
        ? (commentsBody as FigmaCommentsResponse).comments!
        : [];

      // Only active (unresolved) comments end up in the response, so only their
      // node ids need to be resolvable — scoping the file request to exactly
      // those ids keeps the payload proportional to comment count, not file size.
      const activeCommentsForIdExtraction = getActiveComments(commentsList);
      const uniqueNodeIds = Array.from(
        new Set(
          activeCommentsForIdExtraction
            .map((comment) => extractNodeId(comment))
            .filter((nodeId) => Boolean(nodeId))
        )
      );

      const idsQueryParam = uniqueNodeIds
        .map((nodeId) => encodeURIComponent(nodeId))
        .join(",");

      console.log("[comments] scoped file request", {
        totalComments: commentsList.length,
        uniqueNodeIds: uniqueNodeIds.length,
        idsQueryLength: idsQueryParam.length
      });

      // Vector/Region client_meta carries no node_id at all (free-floating canvas
      // pins) — if none of the active comments resolved to a node id, there's
      // nothing to scope the request to. Fall back to a cheap depth=1 (pages-only)
      // fetch so the page filter list still reflects the whole file.
      const fileFetchStart = Date.now();
      const fileResponse = await fetch(
        uniqueNodeIds.length > 0
          ? `https://api.figma.com/v1/files/${encodeURIComponent(
              fileKey
            )}?ids=${idsQueryParam}`
          : `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
      console.log("[comments] file API network round-trip", Date.now() - started, {
        stageMs: Date.now() - fileFetchStart,
        status: fileResponse.status,
        scoped: uniqueNodeIds.length > 0
      });

      const fileBody = (await readUpstreamResponseBody(
        fileResponse,
        "file",
        started
      )) as FigmaFileResponse | null;
      console.log("[comments] file fetched", Date.now() - started);

      if (fileResponse.ok) {
        const nodeIndexStart = Date.now();
        nodePageMap = buildNodePageMap(fileBody);
        console.log("[comments] node index built", Date.now() - started, {
          stageMs: Date.now() - nodeIndexStart,
          mapSize: nodePageMap.size
        });

        const pageNamesStart = Date.now();
        pageNames = getFilePageNames(fileBody);
        console.log("[comments] page names extracted", Date.now() - started, {
          stageMs: Date.now() - pageNamesStart,
          pageCount: pageNames.length
        });
      }
    } catch (fileStageError) {
      console.log("[comments] file fetch/index failed", Date.now() - started, fileStageError);
      nodePageMap = new Map<string, string>();
    }

    const enrichStart = Date.now();
    const enriched = enrichCommentsWithLocation(
      commentsBody,
      nodePageMap,
      fileKey,
      pageNames
    );
    console.log("[comments] comment resolution complete", Date.now() - started, {
      stageMs: Date.now() - enrichStart
    });

    const serializeStart = Date.now();
    let serializedLength = 0;
    try {
      serializedLength = JSON.stringify(enriched).length;
    } catch {
      // ignore — only used for timing diagnostics
    }
    console.log("[comments] response serialized", Date.now() - started, {
      stageMs: Date.now() - serializeStart,
      bytes: serializedLength
    });

    response.status(commentsResponse.status).json(enriched);
    console.log("[comments] response sent", Date.now() - started);
  } catch (handlerError) {
    console.log("[comments] handler error", Date.now() - started, handlerError);
    response.status(502).json({
      error: "Could not fetch comments from Figma."
    });
  }
}
