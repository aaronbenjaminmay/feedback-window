import dotenv from "dotenv";
import express from "express";
import { randomBytes } from "node:crypto";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const figmaAuthorizeUrl = "https://www.figma.com/oauth";
const figmaTokenUrl = "https://api.figma.com/v1/oauth/token";
const figmaScope = process.env.FIGMA_OAUTH_SCOPES ?? "file_comments:read";
const pendingOAuthStates = new Set<string>();
let figmaAccessToken: string | null = null;

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

console.log(
  `Figma OAuth scopes present: ${process.env.FIGMA_OAUTH_SCOPES !== undefined}`
);
console.log(`Figma OAuth resolved scope: ${figmaScope || "(none)"}`);

app.use((_request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

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

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/auth/status", (_request, response) => {
  response.json({ connected: Boolean(figmaAccessToken) });
});

app.get("/auth/figma/start", (_request, response) => {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const redirectUri = process.env.FIGMA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    response.status(500).send(`
      <h1>Figma OAuth is not configured</h1>
      <p>Set FIGMA_CLIENT_ID and FIGMA_REDIRECT_URI in your local environment.</p>
    `);
    return;
  }

  const state = randomBytes(24).toString("hex");
  pendingOAuthStates.add(state);

  const authorizationUrl = new URL(figmaAuthorizeUrl);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);

  if (figmaScope) {
    authorizationUrl.searchParams.set("scope", figmaScope);
  }

  response.redirect(authorizationUrl.toString());
});

app.get("/auth/figma/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state =
    typeof request.query.state === "string" ? request.query.state : "";

  if (!state) {
    response.status(400).send(`
      <h1>Figma OAuth callback error</h1>
      <p>No OAuth state was provided. Please start the Figma connection again.</p>
    `);
    return;
  }

  if (!pendingOAuthStates.has(state)) {
    response.status(400).send(`
      <h1>Figma OAuth callback error</h1>
      <p>The OAuth state was not recognized. Please start the Figma connection again.</p>
    `);
    return;
  }

  pendingOAuthStates.delete(state);

  if (!code) {
    response.status(400).send(`
      <h1>Figma OAuth callback reached</h1>
      <p>No authorization code was provided.</p>
    `);
    return;
  }

  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  const redirectUri = process.env.FIGMA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    response.status(500).send(`
      <h1>Figma OAuth is not configured</h1>
      <p>Set FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET, and FIGMA_REDIRECT_URI in your local environment.</p>
    `);
    return;
  }

  try {
    const tokenBody = new URLSearchParams({
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code"
    });
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );

    const tokenResponse = await fetch(figmaTokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenBody
    });

    if (!tokenResponse.ok) {
      response.status(502).send(`
        <h1>Figma OAuth token exchange failed</h1>
        <p>Figma did not return an access token. Check the OAuth app settings and callback URL.</p>
      `);
      return;
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!tokenData.access_token) {
      response.status(502).send(`
        <h1>Figma OAuth token exchange failed</h1>
        <p>The token response did not include an access token.</p>
      `);
      return;
    }

    figmaAccessToken = tokenData.access_token;

    response.send(`
      <h1>Connected to Figma.</h1>
      <p>You can return to the plugin.</p>
    `);
  } catch {
    response.status(502).send(`
      <h1>Figma OAuth token exchange failed</h1>
      <p>The server could not complete the token exchange.</p>
    `);
  }
});

app.get("/api/figma/comments", async (request, response) => {
  const fileKey =
    typeof request.query.fileKey === "string" ? request.query.fileKey.trim() : "";

  if (!figmaAccessToken) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  if (!fileKey) {
    response.status(400).json({ error: "Missing fileKey query parameter." });
    return;
  }

  console.log(`Fetching Figma comments for fileKey: ${fileKey}`);

  try {
    const commentsResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,
      {
        headers: {
          Authorization: `Bearer ${figmaAccessToken}`
        }
      }
    );

    console.log(`Figma comments upstream status: ${commentsResponse.status}`);

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
            Authorization: `Bearer ${figmaAccessToken}`
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
});

app.get("/api/figma/me", async (_request, response) => {
  if (!figmaAccessToken) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  try {
    const meResponse = await fetch("https://api.figma.com/v1/me", {
      headers: {
        Authorization: `Bearer ${figmaAccessToken}`
      }
    });

    const meBody = await readUpstreamResponseBody(meResponse);
    response.status(meResponse.status).json(meBody);
  } catch {
    response.status(502).json({
      error: "Could not fetch the connected Figma user."
    });
  }
});

app.get("/api/figma/file", async (request, response) => {
  const fileKey =
    typeof request.query.fileKey === "string" ? request.query.fileKey.trim() : "";

  if (!figmaAccessToken) {
    response.status(401).json({ error: "Not connected to Figma." });
    return;
  }

  if (!fileKey) {
    response.status(400).json({ error: "Missing fileKey query parameter." });
    return;
  }

  try {
    const fileResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`,
      {
        headers: {
          Authorization: `Bearer ${figmaAccessToken}`
        }
      }
    );

    const fileBody = await readUpstreamResponseBody(fileResponse);

    if (!fileResponse.ok) {
      response.status(fileResponse.status).json({
        message: "Figma could not return this file.",
        upstreamStatus: fileResponse.status,
        upstreamBody: fileBody
      });
      return;
    }

    response.status(fileResponse.status).json(fileBody);
  } catch {
    response.status(502).json({
      error: "Could not fetch the Figma file."
    });
  }
});

app.listen(port, () => {
  console.log(`Feedback Window OAuth server running on http://localhost:${port}`);
});
