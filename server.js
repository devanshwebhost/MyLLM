const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors({ origin: 'https://devansh-llm.vercel.app', credentials: true }));
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192'; // update to your preferred available Groq model
const USE_GROQ_DEFAULT = (process.env.USE_GROQ || 'false').toLowerCase() === 'true';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

fs.ensureDirSync(DATA_DIR);

// In-memory store of sessions (also mirrored to disk)
const sessions = {}; // { [sessionId]: { id, title, createdAt, updatedAt, provider, messages: [{role, content}] } }

function sessionFile(sessionId){
  return path.join(DATA_DIR, `${sessionId}.jsonl`);
}

function indexFile(){
  return path.join(DATA_DIR, `index.json`);
}

async function saveIndex(){
  await fs.writeJson(indexFile(), { sessions: Object.values(sessions) }, { spaces: 2 });
}

async function appendToFile(sessionId, record){
  await fs.appendFile(sessionFile(sessionId), JSON.stringify(record) + "\n", 'utf8');
}

// Create a new chat session
app.post('/api/session', async (req, res) => {
  const { title = 'New Chat', provider } = req.body || {};
  const id = uuidv4();
  sessions[id] = {
    id,
    title,
    provider: provider || (USE_GROQ_DEFAULT ? 'groq' : 'ollama'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  await saveIndex();
  return res.json(sessions[id]);
});

// List sessions
app.get('/api/sessions', async (req, res) => {
  return res.json({ sessions: Object.values(sessions).sort((a,b)=>b.updatedAt-a.updatedAt) });
});

// Get messages for a session
app.get('/api/messages/:id', async (req, res) => {
  const { id } = req.params;
  const sess = sessions[id];
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  return res.json({ messages: sess.messages });
});

// Rename session
app.put('/api/session/:id', async (req, res) => {
  const { id } = req.params; const { title, provider } = req.body || {};
  const sess = sessions[id];
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  if (title) sess.title = title;
  if (provider) sess.provider = provider;
  sess.updatedAt = Date.now();
  await saveIndex();
  return res.json(sess);
});

// Delete session
app.delete('/api/session/:id', async (req, res) => {
  const { id } = req.params;
  if (!sessions[id]) return res.status(404).json({ error: 'Session not found' });
  delete sessions[id];
  await saveIndex();
  try { await fs.remove(sessionFile(id)); } catch {}
  return res.json({ ok: true });
});

// Core chat endpoint
app.post('/api/chat', async (req, res) => {
  const { sessionId, message, provider } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (!message) return res.status(400).json({ error: 'message required' });
  const sess = sessions[sessionId];
  if (!sess) return res.status(404).json({ error: 'Session not found' });

  if (provider) sess.provider = provider; // allow frontend toggle per chat

  // Add user message to memory and file
  sess.messages.push({ role: 'user', content: message });
  sess.updatedAt = Date.now();
  await appendToFile(sessionId, { ts: Date.now(), role: 'user', content: message });
  await saveIndex();

  try {
    const answer = await getAIResponse(sess);
    sess.messages.push({ role: 'assistant', content: answer });
    sess.updatedAt = Date.now();
    await appendToFile(sessionId, { ts: Date.now(), role: 'assistant', content: answer });
    await saveIndex();
    return res.json({ answer });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'AI error' });
  }
});

async function getAIResponse(sess){
  const provider = sess.provider || (USE_GROQ_DEFAULT ? 'groq' : 'ollama');
  if (provider === 'groq') {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY missing in server env');
    return await askGroq(sess.messages);
  }
  return await askOllama(sess.messages);
}

async function askOllama(messages){
  // Use Ollama chat API to preserve context per session
  const url = 'http://localhost:11434/api/chat';
  const payload = {
    model: OLLAMA_MODEL,
    messages,
    stream: false
  };
  const { data } = await axios.post(url, payload, { timeout: 120000 });
  return data.message?.content || data.response || '';
}

async function askGroq(messages){
  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages,
      temperature: 0.6
    },
    {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 120000
    }
  );
  return data.choices?.[0]?.message?.content?.trim() || '';
}

app.listen(PORT, () => {
  console.log(`✅ Backend listening on http://localhost:${PORT}`);
});