# Vercel OAuth Helper Setup

This project now includes a first-pass Vercel serverless version of the Figma OAuth helper under `api/`.

The plugin has not been updated to call these hosted endpoints yet. These functions are a deployment scaffold for testing OAuth outside the local Express server.

## Functions

- `GET /api/auth/figma/start`
- `GET /api/auth/figma/callback`
- `GET /api/auth/claim?code=...`
- `GET /api/auth/status`
- `GET /api/figma/comments?fileKey=...`
- `POST /api/figma/reply-late-comments`
- `GET /api/figma/me`

## Required Environment Variables

Set these in the Vercel project settings:

- `FIGMA_CLIENT_ID`
- `FIGMA_CLIENT_SECRET`
- `FIGMA_REDIRECT_URI`
- `FIGMA_OAUTH_SCOPES`
- Upstash Redis environment variables injected by the Vercel Marketplace integration

Use these scopes for reading comments and posting controlled late-feedback replies:

```txt
file_comments:read file_comments:write
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

This scaffold uses a Redis-backed connection-code approach:

- OAuth `state` is stored in a short-lived HttpOnly cookie.
- After successful OAuth, the callback displays a short `FW-123456` style code.
- The plugin sends that code to `/api/auth/claim`.
- Status and comment requests include the claimed code as `connectionId`.
- The Figma access token is stored server-side in Upstash Redis behind that code/session.
- Temporary codes use `code:<FW_CODE>` keys and expire after 10 minutes.
- Claimed sessions use `session:<connectionId>` keys and expire after 4 hours.
- The token is not logged or returned in API responses.
- The Redis SDK uses `Redis.fromEnv()`, so the Vercel integration should inject the required Redis URL/token values automatically.

## Limitations

- This is not the final production token storage design.
- Redis storage makes the code/session flow work across Vercel serverless instances, but this is still a prototype auth flow.
- There is no refresh-token handling yet.
- There is no encrypted server-side session store yet.
- Before production use, decide final session lifetime, revocation, and refresh-token handling.

## What Is Not Included Yet

- Permanent token storage
- Token refresh
- Comment posting
- Public plugin release setup
