# 🎯 Feedback Window

<p align="center">
  <img src="./docs/preview-image.jpg" alt="Feedback Window Preview" width="800"/>
</p>

<p align="center">
  Turn Figma comments into structured, actionable tasks.
</p>

---

## 🧠 Overview

**Feedback Window** is a Figma plugin designed to help teams manage design feedback intentionally.

Instead of sorting through scattered comments across large files, Feedback Window creates a clear workflow from:

> **Comment → Context → Task → Execution**

It enables teams to focus on the *right feedback*, preserve discussion context, and translate comments into actionable work without losing alignment.

---

## 🚨 The Problem

Figma files often accumulate:
- Comments across multiple pages
- Feedback from different stakeholders
- Notes from different timeframes

This makes it difficult to:
- Focus on the current review window
- Identify late or out-of-scope feedback
- Preserve context from threaded discussions
- Turn comments into structured tasks
- Maintain consistency across teams

---

## ✨ What Feedback Window Does

### 🔍 Focused Comment Intake
- Pull only **active (unresolved)** comments
- Filter by **feedback window (start date → present)**
- Filter by **page**
- Automatically exclude outdated feedback

### 🏷 Feedback Classification
- Identify **On Time vs Late** feedback
- Detect **Client vs Internal** comments
- Apply consistent tags for triage

### 💬 Threaded Context
- Preserve full comment threads
- Expand/collapse replies
- Carry context into task creation

### ✅ Task Creation & Enrichment
- Convert comments into structured tasks
- Add:
  - **Owner**
  - **Notes**
- Maintain deep links back to Figma

### ⚡ Feedback Enforcement
- Reply to late feedback (bulk or per comment)
- Reinforce defined review windows

### 📦 Structured Export
- Export tasks to CSV for Airtable workflows
- Includes:
  - Page location
  - Comment source
  - Timing classification
  - Owner and notes
- Preserves Figma comment links

---

## 🔁 Workflow

1. Define feedback window + team
2. Load scoped, active comments
3. Filter by page or timing
4. Convert comments into tasks
5. Add ownership and notes
6. Export to Airtable for execution

---

## 🎨 Product Experience

- Figma-native UI
- Automatic dark mode support
- Clean visual hierarchy for fast scanning
- Icon-based navigation
- Lightweight, focused interaction model

---

## 🛠 Tech Stack

- Figma Plugin API
- React + TypeScript
- Vite
- Vercel (OAuth + API layer)
- Redis / KV (session handling)

---

## 🌐 Multi-Environment Support

Feedback Window supports multiple Figma organizations from a single codebase. The same `src/` and `api/` code powers two independent, isolated deployments:

- **Verizon** — Verizon's Figma organization, its own Vercel deployment, its own Figma OAuth app
- **Agency (AKQA)** — AKQA's Figma organization, its own Vercel deployment, its own Figma OAuth app

Each environment gets its own generated plugin package (see below); nothing is shared at runtime, and switching environments is a matter of importing a different manifest, not reconfiguring anything.

---

## 🚀 Getting Started (Local Development)

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/feedback-window.git
cd feedback-window
```

2. Install dependencies:
```bash
npm install
```

3. Build the plugin for the environment you need:
```bash
npm run build:verizon   # -> builds/verizon/ (Verizon Figma org)
npm run build:agency    # -> builds/agency/  (agency Figma org)
```
Each command builds the frontend against that environment's backend (`.env.verizon` / `.env.agency`) and packages a self-contained, importable folder — `manifest.json`, `main.js`, `index.html`, and the icon — via `scripts/package-plugin.js`. The two are independent; running one never touches the other's output. `npm run build` (no target) still exists and writes to the legacy `dist/` + root `manifest.json` pairing.

4. In Figma:
Go to Plugins → Development → Import plugin from manifest
Select `builds/verizon/manifest.json` or `builds/agency/manifest.json` (whichever org you're working in)
Run the plugin from Figma

### 🧯 OAuth Troubleshooting

- Complete the OAuth flow in the **same browser session** that started it. The "Connect to Figma" button opens a new tab; finish signing in and approving access there before returning to the plugin.
- If you use multiple Figma accounts or browser profiles, make sure the tab that completes OAuth is signed into the account for the environment you're connecting (Verizon vs. Agency) — signing in with the wrong account, or switching profiles mid-flow, is the most common cause of an OAuth state mismatch or connection failure.

---

## 📦 Build Artifacts & Version Control

`builds/verizon/`, `builds/agency/`, and `dist/` are **committed**, not gitignored. This is a deliberate choice, not an oversight:

- Figma imports a plugin by reading `manifest.json` plus the `main`/`ui` files it points to **directly off disk** — there's no server involved for the plugin UI itself. Anyone testing the plugin (including non-developers on the Verizon or agency side) needs those files to exist the moment they clone/pull the repo; they are not expected to have Node/npm set up or to run a build themselves.
- This has already been relied on in practice: production fixes were shipped by pushing the built output straight to `main` so testers could pull and re-import without a local build step.
- The build is now fully reproducible (`npm run build:verizon` / `build:agency`), so the historical risk of committed output silently drifting from source is easy to catch — run the command again and `git diff` should show nothing if a commit is in sync.
- Never hand-edit files inside `builds/*` or `dist/` — always regenerate via the npm scripts above, so the two environments can't accidentally cross-contaminate (e.g. an agency URL leaking into the Verizon manifest).

---

## 🔐 Environment Setup

- FIGMA_CLIENT_ID
- FIGMA_CLIENT_SECRET
- FIGMA_REDIRECT_URI
- FIGMA_OAUTH_SCOPES
- KV_REST_API_URL
- KV_REST_API_TOKEN

These are used for:
- Figma OAuth authentication
- Comment retrieval
- Session storage

---

## 🧪 Development Notes

- Plugin UI runs locally via dist/
- API routes are hosted on Vercel
- OAuth requires valid redirect URI matching your environment
- Preview vs Production environments can use separate Figma apps

---

## 📦 Version

**v1.1.0**
Adds Verizon + Agency (AKQA) multi-environment support: separate builds, separate Vercel backends, separate Figma OAuth apps, one shared codebase.

v1.0.0
Initial release supporting a full feedback workflow from intake to task export.
