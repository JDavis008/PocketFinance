// Google Gemini (Generative Language API). Key from https://aistudio.google.com/apikey, stored encrypted.
const { getSetting, setSetting } = require('../db');
const { encrypt, decrypt } = require('../security');

const BASE = process.env.PP_GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';

function cfg() {
  const c = getSetting('gemini', {}) || {};
  let key = null; try { key = c.key_enc ? decrypt(c.key_enc).key : null; } catch {}
  return { key, model: c.model || DEFAULT_MODEL };
}
const configured = () => !!cfg().key;
function save({ key, model }) {
  const cur = getSetting('gemini', {}) || {};
  const next = { ...cur };
  if (key) next.key_enc = encrypt({ key: key.trim() });
  if (key === '') delete next.key_enc;
  if (model) next.model = model.replace(/^models\//, '');
  setSetting('gemini', next);
}

async function call(path, body, key) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `Gemini error ${res.status}`;
    throw Object.assign(new Error(res.status === 400 && /API key/i.test(msg) ? 'Gemini rejected the API key. Check it in Settings → AI Advisor.' : msg), { status: res.status === 429 ? 429 : 400 });
  }
  return json;
}

async function listModels(keyOverride) {
  const key = keyOverride || cfg().key;
  if (!key) throw new Error('Add your Gemini API key first.');
  const r = await call('/models?pageSize=200', null, key);
  return (r.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live/i.test(m.name))
    .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** messages: [{role:'user'|'model', text}] */
async function chat(system, messages, { temperature = 0.6 } = {}) {
  const { key, model } = cfg();
  if (!key) throw new Error('Add your Gemini API key in Settings → AI Advisor.');
  const r = await call(`/models/${encodeURIComponent(model)}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })),
    generationConfig: { temperature, maxOutputTokens: 8192 },
  }, key);
  const cand = (r.candidates || [])[0];
  const text = cand && cand.content && (cand.content.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) {
    const why = (r.promptFeedback && r.promptFeedback.blockReason) || (cand && cand.finishReason) || 'empty reply';
    throw new Error(`Gemini didn't return an answer (${why}). Try rephrasing.`);
  }
  return { text, model };
}

module.exports = { configured, cfg, save, listModels, chat, DEFAULT_MODEL };
