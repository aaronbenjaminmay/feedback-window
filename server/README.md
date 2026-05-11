# Feedback Window OAuth Server

Minimal local Express server for testing the future Figma OAuth flow.

This server is separate from the Figma plugin UI. It is only for local OAuth testing and does not implement token exchange yet.

## Install

From this folder:

```sh
npm install
```

## Configure

Copy `.env.example` to `.env`:

```sh
cp .env.example .env
```

Fill in the values from a Figma OAuth app:

- `FIGMA_CLIENT_ID`: OAuth client ID from the Figma app settings.
- `FIGMA_CLIENT_SECRET`: OAuth client secret from the Figma app settings. This is included for the future token exchange step and is not used yet.
- `FIGMA_REDIRECT_URI`: Callback URL registered with the Figma OAuth app.
- `PORT`: Local server port.

For local testing, the default callback URL is:

```txt
http://localhost:8787/auth/figma/callback
```

## Run Locally

```sh
npm run dev
```

Then open:

```txt
http://localhost:8787/health
```

To start the Figma OAuth flow, open:

```txt
http://localhost:8787/auth/figma/start
```

## Current Status

Implemented:

- `GET /health`
- `GET /auth/figma/start`
- `GET /auth/figma/callback`

Not implemented yet:

- Token exchange
- Token storage
- Comment fetching through this server
- Plugin integration

The callback route confirms that Figma redirected back with a code, but it does not exchange that code for an access token yet.
