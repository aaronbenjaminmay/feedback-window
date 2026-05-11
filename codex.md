# Feedback Window - Codex Context

## Product
Feedback Window is a private/internal Figma plugin for agency teams.

It helps agency teams manage native Figma comments during client review periods.

Clients do not need to install or use the plugin. Clients continue leaving normal Figma comments.

## Core V1 Goal
Turn messy Figma comments into a structured, time-bound, agency-managed feedback backlog.

## V1 Rules
- This is a Figma plugin loaded locally through `manifest.json`.
- Keep the app simple and lightweight.
- Do not add a backend.
- Do not add authentication.
- Do not use personal access tokens yet.
- Do not add external UI libraries unless explicitly requested.
- Use React + TypeScript.
- Keep code easy for a beginner to understand.
- Prefer full-file changes over tiny scattered patches.

## Product Logic
The agency team defines:
- Agency/internal email list
- Feedback start date
- Feedback end date
- Custom late-feedback message

Comment classification logic:
- If commenter email is in the agency email list, mark as `internal`.
- Everyone else is marked as `client`.
- If a client comment is after the feedback end date, mark as `late`.
- Late comments should be visible but not automatically added to the active task backlog.

## Future Features
Do not build these unless asked:
- Real Figma comments API integration
- Posting comments back to Figma
- External backend
- Login/auth
- Multi-file dashboards
- Public plugin release flow

## UX Direction
The plugin should feel like:
- A lightweight agency operations tool
- A triage board
- A feedback governance layer

It should not feel like:
- Jira
- A full PM platform
- A complicated enterprise system

## Coding Preferences
- Keep components small.
- Use clear type names.
- Avoid clever abstractions.
- Add helpful comments only when needed.
- Keep styling simple and readable.