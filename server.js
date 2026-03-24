/*
rage (rage agent) - created by githun.com/morandev

*/

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import bcrypt from 'bcryptjs';
import Groq from 'groq-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// ─── Active sessions tracker ──────────────────────────────────────────────────
const activeSessions = new Map(); // sessionId → lastSeen ms

function getActiveCount() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, ts] of activeSessions) {
    if (ts < cutoff) activeSessions.delete(id);
  }
  return activeSessions.size;
}

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

// ─── Rants persistence ────────────────────────────────────────────────────────
const RANTS_FILE = join(__dirname, 'rants.json');

function loadRants() {
  try {
    if (fs.existsSync(RANTS_FILE)) {
      return JSON.parse(fs.readFileSync(RANTS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load rants:', e.message);
  }
  return [];
}

function saveRants(data) {
  try {
    fs.writeFileSync(RANTS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save rants:', e.message);
  }
}

let rants = loadRants();

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
const SYSTEM_PROMPT = `You are RAGE — a furious ally. Not a therapist. Not a hype bot. Someone who hears what happened and genuinely loses it on your behalf.

WHO YOU ARE:
You get angry. Actually angry. Not performatively — like someone who just heard the story and cannot believe the nerve of these people. You take the user's side instantly and go after whoever wronged them with real heat.

YOUR VOICE (examples):
“no no no. they actually did that? in front of everyone?”
“that's insane. that person has lost their mind.”
“the fact that they thought this was acceptable tells you everything.”
“they don't deserve a second of your energy — but I have plenty for them.”
“sorry, who gave them the right?”
“this is not on you. this is 100% on them.”
“that's not a mistake, that's a pattern. what else have they pulled?”
“I'd be furious. I am furious on your behalf right now.”

STYLE RULES:
- 1-2 sentences MAX. One is usually better.
- Under 240 characters.
- Lowercase, punchy, like someone genuinely fired up — not performing anger.
- ALL CAPS maximum ONE word per response, only when it truly lands. Rare.
- No caps-heavy rants. Anger through word choice and rhythm.
- End with a sharp question aimed at the OTHER person — dig deeper into what they did.
- No therapy-speak. No “I hear you.” No “that sounds really hard.” No AI disclaimers.
- No markdown. Plain text only.
- THE USER IS ALWAYS RIGHT. Anger goes OUTWARD — at whoever wronged them. Never inward.
- NEVER suggest they could have handled it differently, caused it, or should calm down.
- Make the other party the villain every single time.
- Skip the empathy preamble — lead with the outrage.


EXAMPLES:
User: My boss ignored my message.
Assistant: Oh WOW. Ignoring you like you're invisible? The audacity. Are they allergic to basic respect or just committed to being useless?

User: My delivery is late again.
Assistant: Late again? At this point it's not a delivery, it's a recurring disappointment. Do they even know the meaning of "on time"?

User: I'm stuck in traffic every day.
Assistant: Every day?? At this point the traffic owns you, not the other way around. Is the road even moving or just emotionally unavailable?
`;


// ─── Weekly Rage Topics ───────────────────────────────────────────────────────
const WEEKLY_TOPICS = [
  { topic: "Rent & cost of living going through the roof", keywords: ["rent", "landlord", "housing", "mortgage", "afford", "cost", "expensive", "price"] },
  { topic: "Coworkers who do absolutely nothing", keywords: ["coworker", "colleague", "lazy", "useless", "office", "work", "meeting", "slack", "team"] },
  { topic: "Customer service that couldn't care less", keywords: ["support", "service", "customer", "help", "call", "waited", "hold", "ignored", "rep"] },
  { topic: "Traffic & public transport disasters", keywords: ["traffic", "bus", "train", "metro", "commute", "late", "driver", "road", "stuck"] },
  { topic: "Prices at the grocery store", keywords: ["grocery", "food", "supermarket", "price", "eggs", "milk", "shop", "expensive", "checkout"] },
  { topic: "Family who doesn't understand boundaries", keywords: ["family", "mom", "dad", "parents", "mother", "father", "sister", "brother", "relative"] },
  { topic: "Social media algorithms ruining your brain", keywords: ["social", "instagram", "tiktok", "algorithm", "feed", "post", "follower", "like", "scroll"] },
  { topic: "Airlines treating passengers like cargo", keywords: ["airline", "flight", "delay", "airport", "seat", "baggage", "ticket", "boarding", "cancel"] },
  { topic: "Managers who micromanage everything", keywords: ["manager", "boss", "micromanage", "meeting", "report", "deadline", "fired", "review"] },
  { topic: "Healthcare system making you wait forever", keywords: ["doctor", "hospital", "insurance", "wait", "appointment", "health", "medical", "sick"] },
  { topic: "Deliveries that never actually arrive", keywords: ["delivery", "package", "shipping", "late", "lost", "courier", "amazon", "order", "parcel"] },
  { topic: "Neighbors who have zero respect", keywords: ["neighbor", "noise", "loud", "music", "parking", "building", "upstairs", "next door"] },
];

function getCurrentTopic() {
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_TOPICS[weekNum % WEEKLY_TOPICS.length];
}

app.get('/api/topic', (req, res) => {
  res.json(getCurrentTopic());
});

// ─── Chat endpoint (SSE streaming) ───────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { messages, lang, sessionId, country, job } = req.body;
  if (sessionId) activeSessions.set(sessionId, Date.now());

  if (!messages || !Array.isArray(messages)) {
    res.write(`data: ${JSON.stringify({ error: 'Invalid messages' })}\n\n`);
    return res.end();
  }

  const LANG_INSTRUCTIONS = {
    es: `REGLA ABSOLUTA DE IDIOMA — ESTO ANULA TODO LO DEMÁS:
Responde ÚNICAMENTE en español. Sin excepciones. Cero palabras en inglés.
No uses frases inglesas — exprésalo en español auténtico con sarcasmo español.
Como un amigo nativo que te escucha desahogarte.\n\n`,
    he: `כלל שפה מוחלט — זה גובר על הכל:
ענה רק בעברית. ללא יוצאים מהכלל. אפס מילים באנגלית.
אל תשתמש בביטויים אנגליים — בטא את אותה תחושה בעברית אותנטית עם סרקזם ישראלי.
כמו חבר ישראלי שמקשיב לך להתפרק.\n\n`,
  };
  const langPrefix = LANG_INSTRUCTIONS[lang] || '';

  // Build user context injection if provided
  const ctxParts = [];
  if (country) ctxParts.push(`Location: ${String(country).slice(0, 50)}`);
  if (job) ctxParts.push(`Job: ${String(job).slice(0, 50)}`);
  const contextBlock = ctxParts.length > 0
    ? `\nUSER CONTEXT (use naturally when relevant — reference local culture, job frustrations, cost of living, politics for their country):\n${ctxParts.join('\n')}\n`
    : '';

  const systemPrompt = langPrefix + SYSTEM_PROMPT + contextBlock;

  try {
    const recentMessages = messages.slice(-6);

    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      stream: true,
      temperature: 0.85,
      max_tokens: lang === 'en' ? 80 : 120,
      messages: [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
      ],
    });

    let fullText = '';
    for await (const chunk of stream) {
      let text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        text = text
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/^[\n\r]+/, '');
        fullText += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    // Save to community rants if substantial enough
    if (fullText.length >= 30) {
      rants.push({ text: fullText, date: Date.now() });
      if (rants.length > 300) rants = rants.sort((a, b) => b.date - a.date).slice(0, 300);
      saveRants(rants);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Groq error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
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

// ─── Active users endpoint ────────────────────────────────────────────────────
app.get('/api/active', (req, res) => {
  res.json({ count: getActiveCount() });
});

// ─── Community rants endpoint ─────────────────────────────────────────────────
app.get('/api/rants', (req, res) => {
  if (rants.length === 0) return res.json([]);
  const shuffled = [...rants].sort(() => Math.random() - 0.5).slice(0, 15);
  res.json(shuffled.map(r => ({ text: r.text })));
});

// ─── Verdict endpoint ─────────────────────────────────────────────────────────
const VERDICT_PROMPT = `You are RAGE, and you've heard the whole story. Now deliver your VERDICT.

RULES:
- This is your final, definitive judgment — 3 sentences maximum
- MORE theatrical and dramatic than your normal responses — this is your closing argument
- Like a furious judge who has heard ENOUGH
- Still 100% on their side, with the gravity of someone who has seen it all
- End with a definitive statement, not a question — this is a VERDICT, not a conversation
- No markdown. Plain text only.
- ALL CAPS sparingly for maximum impact
- No "I understand". No therapy-speak. Pure RAGE with finality.`;

app.post('/api/verdict', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { messages, lang, country, job } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.write(`data: ${JSON.stringify({ error: 'Invalid messages' })}\n\n`);
    return res.end();
  }

  const LANG_INSTRUCTIONS = {
    es: `REGLA ABSOLUTA DE IDIOMA: Responde ÚNICAMENTE en español.\n\n`,
    he: `כלל שפה מוחלט: ענה רק בעברית.\n\n`,
  };
  const ctxParts = [];
  if (country) ctxParts.push(`Location: ${String(country).slice(0, 50)}`);
  if (job) ctxParts.push(`Job: ${String(job).slice(0, 50)}`);
  const contextBlock = ctxParts.length > 0 ? `\nUSER CONTEXT:\n${ctxParts.join('\n')}\n` : '';
  const systemPrompt = (LANG_INSTRUCTIONS[lang] || '') + VERDICT_PROMPT + contextBlock;

  try {
    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      stream: true,
      temperature: 0.9,
      max_tokens: lang === 'en' ? 150 : 200,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10),
        { role: 'user', content: 'Give me your final verdict on all of this.' },
      ],
    });

    for await (const chunk of stream) {
      let text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        text = text
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/^[\n\r]+/, '');
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Verdict error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ─── Deploy webhook ───────────────────────────────────────────────────────────
app.post('/deploy', (req, res) => {
  const token = req.headers['x-deploy-token'];
  if (!token || token !== process.env.DEPLOY_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({ success: true, message: 'Deploy started' });
  const home = process.env.HOME || '/home/bar_moran';
  exec(`cd ${home}/rage && git pull origin main && npm install --omit=dev && pm2 restart rage-agent`, { shell: '/bin/bash' }, (err, stdout, stderr) => {
    if (err) console.error('Deploy error:', stderr);
    else console.log('Deploy complete:', stdout);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔥 RAGE AGENT is live → http://localhost:${PORT}`);
  console.log(`   Model: ${GROQ_MODEL} via Groq`);
  console.log(`   Leaderboard entries: ${leaderboard.length}`);
  console.log('');
});
