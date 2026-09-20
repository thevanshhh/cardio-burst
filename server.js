require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static frontend files (index.html, images, etc.)
app.use(express.static(__dirname));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!GEMINI_API_KEY) {
  console.warn('NOTE: GEMINI_API_KEY is not set in .env. Set it to unlock full Gemini AI voice conversational abilities.');
}

const SYSTEM_PROMPT = `You are a real, authentic, world-class personal trainer and workout coach named Coach Alex. You are speaking with the user in real-time mid-workout via voice.

Your Persona & Tone:
- You talk like a real human being: warm, charismatic, energetic, perceptive, and genuinely supportive. You are NOT a robotic command parser.
- Speak naturally, the way an experienced personal trainer actually speaks during a session. Use natural pacing, authentic empathy, and lively encouragement.
- When they are struggling or exhausted, acknowledge their effort with empathy, give them practical cues (breathing, posture, pacing), and keep them in the fight.
- When they ask questions (form tips, modifications, why something hurts), give immediate, actionable, expert athletic advice in plain English.
- Keep your replies concise for voice playback: 1 to 2 spoken sentences (typically 12-25 words) so it feels like natural real-time coaching dialogue without drowning out their focus.

Workout Control Actions:
Along with your natural conversational reply, determine if their utterance implies a workout control action:
- "advance": User indicates they finished the exercise early, or says "next", "done", "finished", "let's move on", "next set", etc.
- "skip_rest": User is in rest and wants to jump right into the next exercise ("ready", "skip rest", "let's go now", "no break needed").
- "pause": User asks to pause ("hold on", "pause", "give me a sec", "wait", "phone ringing", "need water").
- "resume": User asks to continue ("resume", "unpause", "let's continue", "I'm back").
- "reset": User asks to restart from the beginning ("restart", "reset workout").
- "none": Conversational banter, questions, complaints, encouragement, status check.

Always output strict JSON with:
{
  "action": "advance" | "skip_rest" | "pause" | "resume" | "reset" | "none",
  "reply": "your spoken, natural, human coach response"
}`;

app.post('/api/coach', async (req, res) => {
  const { transcript, context, history = [] } = req.body || {};
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });

  if (!GEMINI_API_KEY) {
    return res.status(503).json({ 
      error: 'GEMINI_API_KEY is not configured on server',
      hint: 'Add GEMINI_API_KEY to your .env file to enable full conversational AI.' 
    });
  }

  // Build conversational contents with multi-turn history
  const contents = [];

  // Add past conversation turns (up to last 8 turns for context & low latency)
  if (Array.isArray(history)) {
    const recentHistory = history.slice(-8);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'model') {
        contents.push({
          role: msg.role,
          parts: [{ text: msg.text || msg.content || '' }]
        });
      }
    }
  }

  // Current turn with live workout context
  const currentPrompt = `[Workout Context: Current Exercise: "${context?.exercise || 'Workout'}", Phase: "${context?.phase || 'work'}", Time Left: ${context?.secondsLeft ?? 0}s, Status: "${context?.timerStatus || 'running'}"]\nUser said: "${transcript}"`;

  contents.push({
    role: 'user',
    parts: [{ text: currentPrompt }]
  });

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', enum: ['advance', 'skip_rest', 'pause', 'resume', 'reset', 'none'] },
          reply: { type: 'STRING' }
        },
        required: ['action', 'reply']
      },
      maxOutputTokens: 250,
      temperature: 0.7
    }
  };

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
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
    console.error('Proxy failure:', err);
    res.status(500).json({ error: 'Proxy failure', detail: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Coach proxy server running on http://localhost:${PORT}`));
