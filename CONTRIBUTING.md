# Contributing to RAGE AGENT

Thanks for wanting to make this angrier. Here's how it works.

---

## Branch structure

| Branch | Purpose |
|---|---|
| `main` | Production — what runs on rageagent.lol |
| `staging` | Integration — reviewed before going live |

**`main` is protected.** You cannot push directly to it. All changes go through `staging` first.

---

## How to contribute

### 1. Fork the repo

Click **Fork** on [github.com/moranlb-dev/rage](https://github.com/moranlb-dev/rage).

### 2. Create a feature branch off `staging`

```bash
git clone https://github.com/YOUR_USERNAME/rage.git
cd rage
git checkout staging
git checkout -b feature/your-feature-name
```

### 3. Make your changes

Keep it focused. One feature or fix per PR.

### 4. Open a pull request → `staging`

Make sure the base branch is **`staging`**, not `main`.

Describe what you changed and why.

### 5. Wait for review

The maintainer will review, test on staging, and either:
- ✅ Merge into `staging` (triggers staging deploy)
- 💬 Request changes

### 6. Promotion to production

When staging looks good, the maintainer merges `staging` → `main`, which triggers an automatic deploy to rageagent.lol.

---

## Setting up locally

```bash
git clone https://github.com/moranlb-dev/rage.git
cd rage
npm install
```

Create a `.env` file:

```env
GROQ_API_KEY=your_groq_api_key   # free at console.groq.com
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## What to work on

Good first issues:
- New rage quotes for the carousel (diverse cities/situations)
- New quick-start topic buttons
- Additional language support
- Mobile UX improvements
- Leaderboard UI polish

Out of scope:
- Changing the AI persona or system prompt tone significantly
- Adding telemetry, analytics, or user tracking
- Storing conversation content anywhere

---

## Code style

- Vanilla JS/HTML/CSS — no frameworks, no build step
- Server-side: ES modules (`import`/`export`)
- Keep the single-file frontend (`public/index.html`) approach
- Match the existing naming conventions

---

## Secrets required for deploy (maintainer only)

GitHub → Settings → Secrets → Actions:

| Secret | Description |
|---|---|
| `DEPLOY_TOKEN` | Random secret matching `DEPLOY_TOKEN` in server `.env` |

Deploys are triggered via webhook (`POST /deploy`) — no SSH keys needed.
