# Vercel OAuth Helper Setup

This project now includes a first-pass Vercel serverless version of the Figma OAuth helper under `api/`.

The plugin has not been updated to call these hosted endpoints yet. These functions are a deployment scaffold for testing OAuth outside the local Express server.

## Functions

- `GET /api/auth/figma/start`
- `GET /api/auth/figma/callback`
- `GET /api/auth/claim?code=...`
- `GET /api/auth/status`
- `GET /api/figma/comments?fileKey=...`
- `GET /api/figma/me`

## Required Environment Variables

Set these in the Vercel project settings:

- `FIGMA_CLIENT_ID`
- `FIGMA_CLIENT_SECRET`
- `FIGMA_REDIRECT_URI`
- `FIGMA_OAUTH_SCOPES`

Use this scope for comment reading:

```txt
file_comments:read
```

The callback URL should point to the deployed callback function, for example:

```txt
https://your-vercel-project.vercel.app/api/auth/figma/callback
```

The same callback URL must be configured in the Figma OAuth app settings.

## Deploy

1. Push the project to the Git provider connected to Vercel.
2. Create or open the Vercel project.
3. Add the environment variables above.
4. Deploy.
5. Open `/api/auth/figma/start` on the deployed domain to test the OAuth redirect.
6. After callback success, copy the displayed `FW-123456` style connection code.
7. Claim it with `/api/auth/claim?code=FW-123456`.
8. Check `/api/auth/status?connectionId=FW-123456`.
9. Test API access with `/api/figma/me?connectionId=FW-123456`.
10. Test comment access with `/api/figma/comments?fileKey=YOUR_FILE_KEY&connectionId=FW-123456`.

## Current Token/Session Approach

This scaffold uses a temporary connection-code approach:

- OAuth `state` is stored in a short-lived HttpOnly cookie.
- After successful OAuth, the callback displays a short `FW-123456` style code.
- The plugin sends that code to `/api/auth/claim`.
- Status and comment requests include the claimed code as `connectionId`.
- The Figma access token is stored server-side behind that code.
- The token is not logged or returned in API responses.
- The token is not stored in a database.

## Limitations

- This is not the final production token storage design.
- The current connection-code store is in memory behind a small abstraction in `api/lib/connectionStore.ts`.
- Vercel serverless memory is not durable and may not be shared across function instances, so a code can disappear after a cold start or fail if callback and claim run on different instances.
- Swap the store for Vercel KV, Redis, a database, or another durable secret store before relying on this flow.
- There is no refresh-token handling yet.
- There is no encrypted server-side session store yet.
- Before production use, decide whether to use a server-side session store, Vercel KV, encrypted cookies, or another managed secret/session approach.

## What Is Not Included Yet

- Permanent token storage
- Token refresh
- Comment posting
- Public plugin release setup
