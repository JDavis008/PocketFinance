// AI advisor test against a fake Gemini API: node test/ai.js
// Also usable as a manual mock: node test/ai.js --serve 48199 (then run the app with PP_GEMINI_BASE=http://127.0.0.1:48199/v1beta)
const http = require('http'), os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');

function mockGemini(port = 0) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      const key = req.headers['x-goog-api-key'];
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (key !== 'test-key') return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
      if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) return send(200, { models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }] });
      const m = req.url.match(/^\/v1beta\/models\/([^:]+):generateContent/);
      if (m) {
        const j = JSON.parse(body); seen.push({ model: decodeURIComponent(m[1]), body: j });
        const sys = j.systemInstruction.parts[0].text;
        const last = j.contents[j.contents.length - 1].parts[0].text;
        const nw = (sys.match(/Net worth (\$[\d,]+)/) || [])[1] || 'unknown';
        const text = /exactly 3 short/.test(last)
          ? `- 💳 **Kill the card interest** — Your Rewards Visa carries a 24.99% APR. Pay it off this week.\n- 🔄 **Trim subscriptions** — Netflix went up. Consider pausing it.\n- 🛟 **Top up emergency fund** — You're at 62% of the goal.`
          : `Your net worth is **${nw}**. Here's a plan:\n\n1. Pay down the card first\n2. Cut one subscription\n\nYou asked: ${last}`;
        return send(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text }] }, finishReason: 'STOP' }] });
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })));
}

if (process.argv[2] === '--serve') { mockGemini(Number(process.argv[3]) || 48199).then(m => console.log(`mock Gemini on http://127.0.0.1:${m.port}/v1beta (key: test-key)`)); return; }

(async () => {
  const mock = await mockGemini();
  process.env.PP_GEMINI_BASE = `http://127.0.0.1:${mock.port}/v1beta`;
  process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ai-'));
  const app = require('../server/index.js');
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  let ok = 0; const check = (n, c, x) => { assert.ok(c, n + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); ok++; console.log('  ✓', n); };

  await call('POST', '/api/auth/setup', { password: 'correct horse' });
  await call('POST', '/api/demo/load');
  check('not configured yet', (await call('GET', '/api/ai/status')).body.configured === false);
  check('ask without key explains', /API key/.test((await call('POST', '/api/ai/ask', { question: 'hi' })).body.error));
  check('bad key rejected on model list', (await call('POST', '/api/ai/models', { key: 'nope' })).status === 400);
  const models = (await call('POST', '/api/ai/models', { key: 'test-key' })).body;
  check('model list filtered', models.length === 2 && models.every(m => m.id.startsWith('gemini')), models);
  check('save key + model + profile', (await call('PUT', '/api/ai/settings', { key: 'test-key', model: 'gemini-2.5-pro', profile: 'Saving for a house' })).status === 200);
  const st = (await call('GET', '/api/ai/status')).body;
  check('configured, model saved', st.configured && st.model === 'gemini-2.5-pro', st);
  check('key not exposed in status', !JSON.stringify(st).includes('test-key'));
  const a = (await call('POST', '/api/ai/ask', { question: 'How do I save more?' })).body;
  check('answer returned', /net worth is \*\*\$[\d,]+\*\*/.test(a.answer) && !a.answer.includes('thinking'), a);
  const sent = mock.seen[mock.seen.length - 1];
  check('used chosen model', sent.model === 'gemini-2.5-pro');
  const sys = sent.body.systemInstruction.parts[0].text;
  check('snapshot sent with real numbers', /Net worth \$/.test(sys) && /Rewards Visa/.test(sys) && /Saving for a house/.test(sys));
  check('no account numbers / masks in snapshot', !/7713|4821|1190/.test(sys));
  await call('POST', '/api/ai/ask', { question: 'And what about debt?' });
  check('history sent on follow-up', mock.seen[mock.seen.length - 1].body.contents.length === 3);
  check('history stored', (await call('GET', '/api/ai/history')).body.length === 4);
  check('new chat clears', (await call('DELETE', '/api/ai/history')).status === 200 && (await call('GET', '/api/ai/history')).body.length === 0);
  const ins = (await call('POST', '/api/ai/insights', {})).body;
  check('daily insights', /Kill the card interest/.test(ins.text));
  const n = mock.seen.length;
  await call('POST', '/api/ai/insights', {});
  check('insights cached for the day', mock.seen.length === n);
  await call('POST', '/api/ai/insights', { refresh: true });
  check('refresh regenerates', mock.seen.length === n + 1);
  console.log(`\n${ok} AI checks passed`);
  srv.close(); mock.srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
