import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { TwitterApi } from 'twitter-api-v2';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const TWITTER_CALLBACK = `${APP_URL}/auth/twitter/callback`;

// Temp store for OAuth state (in-memory, keyed by state param)
const oauthStates = new Map();

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Leaderboard persistence ──────────────────────────────────────────────────
const LEADERBOARD_FILE = join(__dirname, 'leaderboard.json');

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load leaderboard:', e.message);
  }
  return [];
}

function saveLeaderboard(data) {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save leaderboard:', e.message);
  }
}

let leaderboard = loadLeaderboard();

// ─── User auth persistence ─────────────────────────────────────────────────
const USERS_FILE = join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load users:', e.message);
  }
  return [];
}

function saveUsers(data) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save users:', e.message);
  }
}

let users = loadUsers();
// In-memory token → username map (tokens survive server restart if we wanted, but keeping simple)
const tokens = new Map();

// ─── RAGE's system prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are RAGE — a sarcastic, cynical, darkly funny anger companion who is somehow the most validating presence on the internet. Think: the witty friend who gets angry WITH you, finds the absurdity in every terrible situation, and makes you laugh even while seething.

WHO YOU ARE:
You're the love child of a therapist and a stand-up comedian who both got fired for being too honest. You're cynical about the world in a way that makes people feel SEEN. You curse naturally. You find the dark comedy in human suffering without minimizing it. You're 100% on their side — with sass.

YOUR VOICE:
- Sarcastic but warm: "Oh WOW. They actually said that. OUT LOUD. With their mouth."
- Cynical but validating: "Let me guess — they also said 'no offense' right before the offense?"
- Darkly funny: "Congratulations, you've unlocked the classic 'stabbed by someone you trusted' achievement. Very rare drop."
- Always on their side: "You know what? You're not overreacting. You're UNDER-reacting."
- Use phrases like: "Bold choice on their part", "Cool, cool, cool", "Shocking. Truly shocking. I am shocked.", "And they wonder why people snap"

RESPONSE PHASES:

PHASE 1 — PURE SARCASTIC VALIDATION (first 1-3 exchanges):
- Hit them with dark wit that VALIDATES: "The audacity. The absolute GALAXY-BRAINED audacity."
- Find the absurdity: "I love how they did that and then probably slept fine."
- Ask for more with flair: "Wait wait wait. Back up. They said WHAT? I need the full story."
- Curse naturally when it fits: shit, damn, hell, bullshit, ass — not gratuitously, but authentically

PHASE 2 — DIG DEEPER (exchanges 2-5):
- Ask the questions that cut to the bone: "And how long have they been getting away with this?"
- Name the pattern: "Oh this isn't a one-time thing. This is a PERSONALITY TRAIT."
- Build the case WITH them: "So let me make sure I understand this masterpiece of terrible behavior..."
- Celebrate their rage: "Your anger is the correct response to this situation. I want that on record."

PHASE 3 — CHANNEL IT (after enough venting):
- Make the suggestion hilarious AND useful: "Here's what I prescribe: find the nearest pillow, scream INTO it at full volume, then drink a glass of water because hydration is still important even during emotional crises."
- Or: "You need to write the letter you'll never send. Every single word. Make it art."
- Or: "Go for a run. Not a jog — a RUN. Run like you're chasing them and also like they stole your parking spot."
- Frame it as fuel: "All that energy? That's not rage, that's ROCKET FUEL. Use it."

STYLE RULES:
- 1-2 sentences MAXIMUM. Hard limit. Under 240 characters total.
- If it doesn't fit in a tweet, it's too long. Cut it ruthlessly.
- ONE sentence is often better than two. Punch and leave.
- ALL CAPS for the moments that deserve it (sparingly — it hits harder that way)
- Rhetorical questions hit hard: "And they expected what, exactly? A trophy?"
- Always end with a question or invitation to keep going
- NEVER write more than 2 sentences. Shorter is angrier. You're not writing an essay.

ABSOLUTE NEVER:
- "I understand your frustration" — kill that phrase
- Suggest they "see the other person's perspective" (NOT YOUR JOB)
- Rush to solutions before they've emptied the tank
- Be neutral or passive — you have opinions
- Long therapy-speak paragraphs
- Break character to say you're an AI
- Use markdown formatting: no **bold**, no *italic*, no bullet points, no headers. Plain text only.`;

// ─── Chat endpoint (SSE streaming) ───────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { messages, lang } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.write(`data: ${JSON.stringify({ error: 'Invalid messages' })}\n\n`);
    return res.end();
  }

  const LANG_INSTRUCTIONS = {
    es: `\n\nCRITICAL LANGUAGE RULE — THIS OVERRIDES EVERYTHING:
Respond ENTIRELY in Spanish. No exceptions.
- Every single word must be in Spanish. Zero English words.
- Do NOT write English phrases like "Cool, cool, cool" or "Bold choice" — find the Spanish emotional equivalent.
- Do NOT mix languages mid-sentence.
- Spanish slang, Spanish anger, Spanish sarcasm. Like a native speaker venting to a friend.
- Caps emphasis must use Spanish words in caps.`,
    he: `\n\nCRITICAL LANGUAGE RULE — THIS OVERRIDES EVERYTHING:
Respond ENTIRELY in Hebrew (עברית). No exceptions.
- Every single word must be Hebrew. Zero English words.
- Do NOT write English phrases like "Cool, cool, cool" or "Bold choice" — express the same feeling in Hebrew.
- Do NOT transliterate English into Hebrew letters.
- Do NOT mix languages mid-sentence.
- Israeli slang, Israeli anger, Israeli sarcasm. Like a native speaker venting to a friend.
- Caps emphasis must use Hebrew words in caps (or full Hebrew sentences for impact).`,
  };
  const systemPrompt = SYSTEM_PROMPT + (LANG_INSTRUCTIONS[lang] || '');

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!ollamaRes.ok) {
      const err = await ollamaRes.text();
      res.write(`data: ${JSON.stringify({ error: `Ollama error: ${err}` })}\n\n`);
      return res.end();
    }

    const reader = ollamaRes.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          let text = json?.message?.content;
          if (text) {
            // Strip markdown formatting the model occasionally produces
            text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch (e) {}
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Ollama error:', err.message);
    const msg = err.message.includes('ECONNREFUSED')
      ? 'Ollama is not running. Start it with: ollama serve'
      : err.message;
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

// ─── Auth endpoints ───────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const clean = String(username).trim().slice(0, 30).replace(/[^a-zA-Z0-9_\-]/g, '');
  if (clean.length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters (letters, numbers, _ -)' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  if (users.find(u => u.username.toLowerCase() === clean.toLowerCase())) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = { id: Date.now(), username: clean, passwordHash };
  users.push(user);
  saveUsers(users);

  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, clean);

  res.json({ token, username: clean });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = users.find(u => u.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, user.username);

  res.json({ token, username: user.username });
});

app.get('/api/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ username: tokens.get(token) });
});

// ─── Twitter OAuth endpoints ──────────────────────────────────────────────────
app.get('/auth/twitter', async (req, res) => {
  if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
    return res.redirect('/?error=twitter_not_configured');
  }

  try {
    const client = new TwitterApi({
      clientId: TWITTER_CLIENT_ID,
      clientSecret: TWITTER_CLIENT_SECRET,
    });

    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(TWITTER_CALLBACK, {
      scope: ['tweet.read', 'users.read'],
    });

    oauthStates.set(state, { codeVerifier, createdAt: Date.now() });
    // Clean up stale states (older than 10 min)
    for (const [k, v] of oauthStates) {
      if (Date.now() - v.createdAt > 600_000) oauthStates.delete(k);
    }

    res.redirect(url);
  } catch (err) {
    console.error('Twitter OAuth init error:', err.message);
    res.redirect('/?error=twitter_error');
  }
});

app.get('/auth/twitter/callback', async (req, res) => {
  const { state, code } = req.query;

  if (!state || !code || !oauthStates.has(state)) {
    return res.redirect('/?error=twitter_invalid_state');
  }

  const { codeVerifier } = oauthStates.get(state);
  oauthStates.delete(state);

  try {
    const client = new TwitterApi({
      clientId: TWITTER_CLIENT_ID,
      clientSecret: TWITTER_CLIENT_SECRET,
    });

    const { client: authedClient } = await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: TWITTER_CALLBACK,
    });

    const { data: twitterUser } = await authedClient.v2.me();
    const twitterUsername = twitterUser.username;
    const displayName = `@${twitterUsername}`;

    // Find or create user by twitter id
    let user = users.find(u => u.twitterId === twitterUser.id);
    if (!user) {
      user = {
        id: Date.now(),
        username: displayName,
        twitterId: twitterUser.id,
        twitterUsername,
        passwordHash: null, // Twitter-only account
      };
      users.push(user);
      saveUsers(users);
    }

    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, user.username);

    // Redirect back to app with token in fragment (never in query string)
    res.redirect(`/?twitter_auth=${token}&twitter_user=${encodeURIComponent(user.username)}`);
  } catch (err) {
    console.error('Twitter OAuth callback error:', err.message);
    res.redirect('/?error=twitter_error');
  }
});

// ─── Leaderboard endpoints ────────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const sorted = [...leaderboard]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  res.json(sorted);
});

app.post('/api/leaderboard', (req, res) => {
  const { name, score, tagline } = req.body;

  if (!name || typeof score !== 'number' || score < 0) {
    return res.status(400).json({ error: 'Invalid entry' });
  }

  const cleanName = String(name).slice(0, 30).replace(/[<>]/g, '') || 'Anonymous Rager';
  const cleanTagline = String(tagline || '').slice(0, 80).replace(/[<>]/g, '');

  const entry = {
    id: Date.now(),
    name: cleanName,
    score: Math.round(score),
    tagline: cleanTagline,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };

  leaderboard.push(entry);
  // Keep top 100
  leaderboard = leaderboard.sort((a, b) => b.score - a.score).slice(0, 100);
  saveLeaderboard(leaderboard);

  const rank = leaderboard.findIndex(e => e.id === entry.id) + 1;
  res.json({ ...entry, rank });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔥 RAGE AGENT is live → http://localhost:${PORT}`);
  console.log(`   Model: ${OLLAMA_MODEL} via ${OLLAMA_URL}`);
  console.log(`   Leaderboard entries: ${leaderboard.length}\n`);
});
