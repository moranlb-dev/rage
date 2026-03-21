# 🔥 RAGE AGENT

> *"Your anger is the correct response to this situation. I want that on record."*

**RAGE AGENT** is an AI-powered venting companion. Talk to RAGE — a darkly funny, sarcastic AI who gets mad *with* you, takes your side completely, and ranks your fury against ragers worldwide.

🌐 **[rageagent.lol](https://rageagent.lol)** · 🐦 **[@therageagent](https://twitter.com/therageagent)** · ⭐ **[Open Source](https://github.com/moranlb-dev/rage)**

![RAGE AGENT screenshot](./Screenshot1.png)

---

## Features

| | |
|---|---|
| 🤖 **AI venting** | Streaming responses via [Groq](https://groq.com) (`llama-3.3-70b-versatile`) — Twitter-length, punch-and-leave style |
| 🌍 **Multilingual** | English, Spanish, Hebrew — full UI translation, RTL layout, native-language AI |
| 🔥 **Live rage counter** | See how many people are actively raging right now |
| 🏆 **Hall of Rage** | Global leaderboard — login required to view and submit |
| 📊 **Rage scoring** | Points for CAPS, profanity, intensity words, topic, and voice input |
| 🎤 **Voice input** | Shout into the mic via Web Speech API (+20% score multiplier) |
| 🔊 **Text-to-speech** | RAGE talks back |
| 🔄 **New session** | Reset chat, score, and rage meter in one click |
| 🔐 **Anonymous auth** | Username + password only, no email required |
| 🐦 **Twitter login** | OAuth 2.0 |
| 📣 **Tweet your rage** | Share RAGE's best lines or your final score |
| ⚡ **Quick-start topics** | Boss · Relationship · Family · Internet · Money · Everything |
| 💬 **Quote carousel** | Rotating rants from ragers around the world |
| 🚀 **Auto-deploy** | Push to `main` → live in seconds via webhook CI/CD |

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express (ES modules) |
| AI | [Groq API](https://groq.com) — `llama-3.3-70b-versatile` |
| Streaming | Server-Sent Events (SSE) |
| Auth | bcryptjs + crypto random tokens |
| Twitter | OAuth 2.0 via `twitter-api-v2` |
| Frontend | Vanilla HTML/CSS/JS (single file) |
| Fonts | Space Grotesk · Space Mono · Heebo |
| i18n | Vanilla JS with RTL support |
| Storage | Flat JSON files (`users.json`, `leaderboard.json`) |
| Process manager | PM2 |
| Reverse proxy | nginx |
| Hosting | Google Cloud e2-micro (free tier) |
| CI/CD | GitHub Actions → webhook deploy |

---

## Quick Start

```bash
git clone https://github.com/moranlb-dev/rage.git
cd rage
npm install
```

Create a `.env` file:

```env
# Required
GROQ_API_KEY=your_groq_api_key        # free at console.groq.com

# Optional
GROQ_MODEL=llama-3.3-70b-versatile    # default model
DEPLOY_TOKEN=your_random_secret        # for webhook auto-deploy
TWITTER_CLIENT_ID=...                  # for Twitter OAuth
TWITTER_CLIENT_SECRET=...
APP_URL=http://localhost:3000
PORT=3000
```

```bash
npm run dev     # dev mode (auto-restart)
npm start       # production mode
```

Open [http://localhost:3000](http://localhost:3000) and start raging.

Get a free Groq API key at [console.groq.com](https://console.groq.com).

---

## Scoring

```
pts = (words×3 + CAPS×15 + !×5 + ?×3 + intensity_words×10)
      × curseMult × topicMult × micMult
```

| Multiplier | Trigger | Boost |
|---|---|---|
| `curseMult` | Profanity | ×1.5 |
| `topicMult` | Family / parents | +30% |
| `topicMult` | Marriage / spouse | +25% |
| `topicMult` | Dating / relationship | +20% |
| `topicMult` | Money / debt | +15% |
| `topicMult` | Exhaustion / sleep | +15% |
| `topicMult` | Boss / work | +10% |
| `micMult` | Voice input | ×1.2 |

### Rage Tiers

| Score | Tier |
|---|---|
| 0 – 99 | 😒 Mild Annoyance |
| 100 – 299 | 😠 Genuinely Pissed |
| 300 – 699 | 😤 Righteous Fury |
| 700 – 1,499 | 🌋 Volcanic |
| 1,500 – 2,999 | ☢️ Nuclear |
| 3,000+ | 👑 Transcendent Rage |

---

## API

### Chat

```
POST /api/chat
```

```json
{
  "messages": [{ "role": "user", "content": "My boss is impossible" }],
  "lang": "en",
  "sessionId": "uuid"
}
```

`lang`: `"en"` · `"es"` · `"he"` — context limited to last 10 messages.

**Response:** `text/event-stream`
```
data: {"text": "Oh WOW. "}
data: [DONE]
```

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/register` | Create anonymous account |
| `POST` | `/api/login` | Log in |
| `GET` | `/api/me` | Get current user (Bearer token) |
| `GET` | `/auth/twitter` | Start Twitter OAuth |
| `GET` | `/auth/twitter/callback` | Twitter OAuth callback |

### Leaderboard

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/leaderboard` | Top 20 scores |
| `POST` | `/api/leaderboard` | Submit score (login required) |

### Active users

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/active` | Sessions active in the last 5 min |

### Deploy webhook

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/deploy` | Pull + restart (requires `x-deploy-token` header) |

---

## Deployment

### GitHub Actions (auto-deploy)

Every push to `main` triggers the deploy workflow → calls `/deploy` on the server → `git pull` + `npm install` + `pm2 restart`.

Required GitHub secret:

| Secret | Value |
|---|---|
| `DEPLOY_TOKEN` | Random string matching `DEPLOY_TOKEN` in server `.env` |

### Server setup (Google Cloud / any Ubuntu VPS)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx
sudo npm install -g pm2

# Clone and start
git clone https://github.com/moranlb-dev/rage.git && cd rage
npm install
echo "GROQ_API_KEY=..." > .env
echo "DEPLOY_TOKEN=..." >> .env
pm2 start server.js --name rage-agent && pm2 startup && pm2 save

# SSL
sudo certbot --nginx -d rageagent.lol -d www.rageagent.lol
```

### nginx config

```nginx
server {
    listen 80;
    server_name rageagent.lol www.rageagent.lol;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_buffering off;
    }
}
```

### Notes

- No GPU required — Groq handles inference in the cloud
- `users.json` and `leaderboard.json` are auto-created on first run
- Auth tokens are in-memory — users re-login after server restart (by design)
- For high traffic, swap flat-file storage for SQLite or Postgres

---

## Project Structure

```
rage/
├── server.js              # Express server, Groq streaming, all API routes
├── public/
│   └── index.html         # Entire frontend (single file, no build step)
├── .github/
│   └── workflows/
│       ├── deploy-production.yml
│       └── deploy-staging.yml
├── package.json
├── .env.example
└── README.md

# Runtime-generated (gitignored):
├── users.json             # Registered users (bcrypt-hashed passwords)
└── leaderboard.json       # Persisted leaderboard entries
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

**Short version:**
1. Fork → branch off `staging`
2. PR against `staging`
3. Maintainer reviews → merges → auto-deploys to staging
4. Maintainer promotes `staging` → `main` → live on rageagent.lol

---

## License

MIT
