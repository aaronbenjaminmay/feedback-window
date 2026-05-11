# Vercel OAuth Helper Setup

This project now includes a first-pass Vercel serverless version of the Figma OAuth helper under `api/`.

The plugin has not been updated to call these hosted endpoints yet. These functions are a deployment scaffold for testing OAuth outside the local Express server.

## Functions

- `GET /api/auth/figma/start`
- `GET /api/auth/figma/callback`
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
6. After callback success, check `/api/auth/status`.
7. Test API access with `/api/figma/me`.
8. Test comment access with `/api/figma/comments?fileKey=YOUR_FILE_KEY`.

## Current Token/Session Approach

This scaffold uses the simplest working serverless session approach:

- OAuth `state` is stored in a short-lived HttpOnly cookie.
- The Figma access token is stored in an HttpOnly cookie after callback.
- The token is not logged or returned in API responses.
- The token is not stored in a database.

## Limitations

- This is not the final production token storage design.
- There is no refresh-token handling yet.
- There is no encrypted server-side session store yet.
- Clearing browser cookies disconnects the session.
- If the browser blocks third-party or cross-site cookies, the plugin may not be able to use this cookie-based session directly.
- Before production use, decide whether to use a server-side session store, Vercel KV, encrypted cookies, or another managed secret/session approach.

## What Is Not Included Yet

- Plugin integration with the deployed Vercel URLs
- Permanent token storage
- Token refresh
- Comment posting
- Public plugin release setup
