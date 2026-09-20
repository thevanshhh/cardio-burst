require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static frontend files (index.html, images, etc.)
app.use(express.static(__dirname));

// Lock this down to your actual GitHub Pages origin before going live.
// Leaving it as '*' means ANY website can call your proxy and spend your quota.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set. Every request will fail until you set it.');
}

const SYSTEM_PROMPT = `You are a terse workout coach voice assistant. The user is mid-set and speaking to you via speech-to-text, so the transcript may be rough or informal. Given their transcript and the current workout context, decide:
- action: "advance" if they indicate they finished the current work set (e.g. "done", "finished", "that's it", "next", "let's go"), "skip_rest" if they want to skip a rest period early, or "none" if they're just talking, asking a question, or need encouragement.
- reply: a short spoken response, one sentence, under 15 words. Confirm the action or answer briefly. Blunt and motivating, not chatty.
Respond ONLY as JSON matching the schema — no other text.`;

app.post('/api/coach', async (req, res) => {
  const { transcript, context } = req.body || {};
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });

  const userContent = `Transcript: "${transcript}"\nContext: ${JSON.stringify(context || {})}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', enum: ['advance', 'skip_rest', 'none'] },
          reply: { type: 'STRING' }
        },
        required: ['action', 'reply']
      },
      maxOutputTokens: 200
    }
  };

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error('Gemini API error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini API error', detail: data });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(502).json({ error: 'Empty response from Gemini' });

    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Proxy failure', detail: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Coach proxy listening on :${PORT}`));
