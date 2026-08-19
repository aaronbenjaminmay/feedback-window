import { getSessionToken } from "../lib/connectionStore.js";
import {
  getCachedFileStructure,
  setCachedFileStructure
} from "../lib/fileStructureCache.js";

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

// client_meta only ever comes from Figma's own documented comment shapes
// (point: {x,y}; single-node: {node_id, node_offset}; multi-node/region:
// {node_id: string[], node_offset}), so a handful of levels of nesting is
// always enough — these caps are a backstop against unexpected/malformed
// client_meta shapes, not a limit we expect to hit in normal operation.
const MAX_NODE_ID_EXTRACTION_DEPTH = 8;
const MAX_NODE_ID_EXTRACTION_CALLS = 500;

const summarizeValueShape = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }

  if (value && typeof value === "object") {
    return { type: "object", keys: Object.keys(value as Record<string, unknown>) };
  }

  return { type: typeof value };
};

const extractNodeIdFromValue = (
  value: unknown,
  depth: number,
  budget: { remaining: number }
): string => {
  extractNodeIdFromValueCallCount += 1;

  if (depth > MAX_NODE_ID_EXTRACTION_DEPTH || budget.remaining <= 0) {
    return "";
  }

  budget.remaining -= 1;

  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return isLikelyNodeId(value) ? normalizeNodeIdForLookup(value) : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedNodeId = extractNodeIdFromValue(item, depth + 1, budget);

      if (nestedNodeId) {
        return nestedNodeId;
      }

      if (budget.remaining <= 0) {
        break;
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
    const nestedNodeId = extractNodeIdFromValue(directNodeId, depth + 1, budget);

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
    const nestedNodeId = extractNodeIdFromValue(field, depth + 1, budget);

    if (nestedNodeId) {
      return nestedNodeId;
    }

    if (budget.remaining <= 0) {
      break;
    }
  }

  if (budget.remaining > 0) {
    for (const field of Object.values(metadata)) {
      const nestedNodeId = extractNodeIdFromValue(field, depth + 1, budget);

      if (nestedNodeId) {
        return nestedNodeId;
      }

      if (budget.remaining <= 0) {
        break;
      }
    }
  }

  return "";
};

const extractNodeId = (comment: FigmaComment) => {
  const budget = { remaining: MAX_NODE_ID_EXTRACTION_CALLS };

  const result =
    extractNodeIdFromValue(comment.client_meta, 0, budget) ||
    extractNodeIdFromValue(comment.node_id, 0, budget) ||
    extractNodeIdFromValue(comment.nodeId, 0, budget);

  if (budget.remaining <= 0) {
    console.warn("[comments] extractNodeId budget exceeded", {
      commentId: comment.id,
      clientMetaShape: summarizeValueShape(comment.client_meta)
    });
  }

  return result;
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
  pageNames: string[],
  nodeIdByComment: Map<FigmaComment, string>
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
    const extractedNodeId = nodeIdByComment.get(comment) ?? extractNodeId(comment);
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

  // Pages/top-level frames only. The comments fetch and this file-structure
  // fetch are independent, so they run in parallel — this used to be a
  // fetch scoped to `ids=<commented node ids>`, which had to wait for the
  // comments response first, but Figma's `ids` param returns each requested
  // node's FULL DESCENDANT SUBTREE (not just its ancestry). A single comment
  // on a node inside a large frame/component library was enough to balloon
  // that response to hundreds of MB and ~50s (confirmed via production
  // logs: 58 ids -> 222MB / 165k nodes). A fixed shallow depth from the
  // document root bounds payload size regardless of file content, at the
  // cost of comments nested deeper than this falling back to "Unknown page"
  // — same graceful fallback already used elsewhere in this file.
  const FILE_STRUCTURE_DEPTH = 2;

  type FileStructureResult = {
    nodePageMap: Map<string, string>;
    pageNames: string[];
  };

  try {
    console.log("[comments] fetches starting", Date.now() - started);
    const commentsFetchStart = Date.now();

    const commentsFetchPromise = fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    ).then(async (upstreamResponse) => {
      console.log("[comments] comments API network round-trip", Date.now() - started, {
        stageMs: Date.now() - commentsFetchStart,
        status: upstreamResponse.status,
        contentLength: upstreamResponse.headers.get("content-length")
      });

      const body = await readUpstreamResponseBody(upstreamResponse, "comments", started);
      console.log("[comments] comments fetched", Date.now() - started, {
        count: Array.isArray((body as FigmaCommentsResponse | null)?.comments)
          ? (body as FigmaCommentsResponse).comments!.length
          : null,
        // the Get comments endpoint has no documented cursor/pagination param;
        // logging every top-level key lets us confirm Figma isn't silently
        // truncating/paginating a response this size.
        topLevelKeys:
          body && typeof body === "object" ? Object.keys(body as object) : typeof body
      });

      return { response: upstreamResponse, body };
    });

    // Page structure changes far less often than comments, and the same file
    // gets reopened repeatedly during a review cycle — check the cache before
    // paying Figma's file-endpoint latency again (can be many seconds on
    // large/complex files even for a small, depth-limited response).
    const cacheLookupStart = Date.now();
    const cachedFileStructure = await getCachedFileStructure(fileKey).catch(
      (cacheError) => {
        console.log("[comments] file structure cache lookup failed", Date.now() - started, cacheError);
        return null;
      }
    );
    console.log("[comments] file structure cache lookup", Date.now() - started, {
      stageMs: Date.now() - cacheLookupStart,
      hit: Boolean(cachedFileStructure)
    });

    let fileStructurePromise: Promise<FileStructureResult | null>;

    if (cachedFileStructure) {
      fileStructurePromise = Promise.resolve(cachedFileStructure);
    } else {
      const fileFetchStart = Date.now();
      fileStructurePromise = fetch(
        `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=${FILE_STRUCTURE_DEPTH}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )
        .then(async (upstreamResponse) => {
          console.log("[comments] file API network round-trip", Date.now() - started, {
            stageMs: Date.now() - fileFetchStart,
            status: upstreamResponse.status
          });

          const body = (await readUpstreamResponseBody(
            upstreamResponse,
            "file",
            started
          )) as FigmaFileResponse | null;
          console.log("[comments] file fetched", Date.now() - started);

          if (!upstreamResponse.ok) {
            return null;
          }

          const nodeIndexStart = Date.now();
          const nodePageMap = buildNodePageMap(body);
          console.log("[comments] node index built", Date.now() - started, {
            stageMs: Date.now() - nodeIndexStart,
            mapSize: nodePageMap.size
          });

          const pageNamesStart = Date.now();
          const pageNames = getFilePageNames(body);
          console.log("[comments] page names extracted", Date.now() - started, {
            stageMs: Date.now() - pageNamesStart,
            pageCount: pageNames.length
          });

          try {
            await setCachedFileStructure(fileKey, nodePageMap, pageNames);
          } catch (cacheWriteError) {
            console.log("[comments] file structure cache write failed", Date.now() - started, cacheWriteError);
          }

          return { nodePageMap, pageNames };
        })
        .catch((fileFetchError) => {
          console.log("[comments] file fetch failed", Date.now() - started, fileFetchError);
          return null;
        });
    }

    const [commentsResult, fileStructureResult] = await Promise.all([
      commentsFetchPromise,
      fileStructurePromise
    ]);

    const { response: commentsResponse, body: commentsBody } = commentsResult;

    if (!commentsResponse.ok) {
      response.status(commentsResponse.status).json({
        message: "Figma could not return comments for this file.",
        upstreamStatus: commentsResponse.status,
        upstreamBody: commentsBody
      });
      return;
    }

    const nodePageMap = fileStructureResult?.nodePageMap ?? new Map<string, string>();
    const pageNames = fileStructureResult?.pageNames ?? [];

    const commentsList = Array.isArray(
      (commentsBody as FigmaCommentsResponse | null)?.comments
    )
      ? (commentsBody as FigmaCommentsResponse).comments!
      : [];

    const activeFilterStart = Date.now();
    const activeComments = getActiveComments(commentsList);
    console.log("[comments] active comment filter", Date.now() - started, {
      stageMs: Date.now() - activeFilterStart,
      totalComments: commentsList.length,
      activeComments: activeComments.length
    });

    extractNodeIdFromValueCallCount = 0;
    const idExtractionStart = Date.now();
    let slowestCommentMs = -1;
    let slowestCommentId: string | undefined;
    const nodeIdByComment = new Map<FigmaComment, string>();

    activeComments.forEach((comment) => {
      const commentStart = Date.now();
      const nodeId = extractNodeId(comment);
      const commentMs = Date.now() - commentStart;

      if (commentMs > slowestCommentMs) {
        slowestCommentMs = commentMs;
        slowestCommentId = comment.id;
      }

      nodeIdByComment.set(comment, nodeId);
    });

    console.log("[comments] node id extraction", Date.now() - started, {
      stageMs: Date.now() - idExtractionStart,
      extractNodeIdFromValueCalls: extractNodeIdFromValueCallCount,
      avgExtractCallsPerComment: activeComments.length
        ? extractNodeIdFromValueCallCount / activeComments.length
        : 0,
      slowestCommentMs,
      slowestCommentId
    });

    const enrichStart = Date.now();
    const enriched = enrichCommentsWithLocation(
      commentsBody,
      nodePageMap,
      fileKey,
      pageNames,
      nodeIdByComment
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
