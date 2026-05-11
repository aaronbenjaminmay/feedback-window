# OAuth Plan

## 1. Goal

Feedback Window should let agency users connect to Figma through OAuth instead of pasting a temporary Personal Access Token into the plugin UI.

The goal is to move from the current internal spike flow to a more realistic connection flow where an agency user can authenticate with Figma, grant the required access, and then load comments from the selected Figma file.

## 2. Why OAuth

- Personal Access Tokens are only for the current spike and should not be the long-term authentication model.
- Figma plugins cannot use the user's logged-in Figma session directly for REST API calls.
- OAuth should support the normal Figma login and SSO flow, which is important for agency and client enterprise environments.
- OAuth is a better fit for enterprise usage because access can be granted, reviewed, revoked, and managed through a standard authorization flow instead of asking users to manually create and paste tokens.

## 3. Required Scope

- `file_comments:read`

## 4. Proposed Architecture

- **Figma plugin UI**
  - Collects the Figma file key.
  - Shows connection state.
  - Lets the user start the Figma OAuth flow.
  - Requests comments after the user is connected.

- **Small local/backend auth server**
  - Starts the OAuth flow.
  - Receives the OAuth callback.
  - Exchanges the authorization code for an access token.
  - Calls the Figma REST API on behalf of the plugin.

- **Figma OAuth app**
  - Defines the OAuth client ID, client secret, allowed callback URL, and requested scopes.
  - Requests `file_comments:read` permission.

- **Callback URL**
  - Points to the local/backend auth server.
  - Receives the authorization code from Figma after the user approves access.

- **Token exchange**
  - The backend exchanges the authorization code for an access token.
  - The plugin should not handle the client secret directly.

- **Comments request path**
  - The plugin asks the backend/server to fetch comments for a file key.
  - The backend/server calls `GET https://api.figma.com/v1/files/{fileKey}/comments`.
  - The backend/server returns normalized comments to the plugin UI.

## 5. Plugin UX

Future UI should change from:

- File Key
- Figma Personal Access Token

To:

- File Key
- Connect to Figma
- Connected state
- Fetch Comments

## 6. What Not To Build Yet

- No production deployment
- No public plugin release
- No comment posting
- No multi-file dashboard
- No permanent token storage until we decide the safest approach

## 7. Immediate Next Step

After this doc, scaffold a local auth server for OAuth testing.
