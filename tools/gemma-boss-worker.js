// Cloudflare Worker: turns game events into live "GRIMCO HQ" radio lines using
// Gemma through the Google AI (Gemini) API. Keeps the API key off the public site.
//
// Deploy:  npx wrangler deploy tools/gemma-boss-worker.js --name grimco-boss
//          npx wrangler secret put GEMINI_API_KEY      (key from aistudio.google.com)
// Then put the worker URL in BOSS_AI_URL in src/config.js.
// Optional var MODEL to pick a different Gemma model (check AI Studio for current names).

const ALLOWED = ['kind', 'floor', 'quota', 'item', 'value', 'name', 'cash', 'broken'];

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });

    const body = await request.json().catch(() => ({}));
    // Only pass through known short fields, so the endpoint can't be used as a free chatbot.
    const facts = Object.fromEntries(
      ALLOWED.filter((k) => body[k] !== undefined).map((k) => [k, String(body[k]).slice(0, 40)]),
    );
    const prompt =
      'You are the sarcastic, penny-pinching boss of GRIMCO Acquisitions, talking over a crackly radio ' +
      'to underpaid interns who are looting cursed valuables from haunted catacombs on Halloween night. ' +
      `Game event: ${JSON.stringify(facts)}. ` +
      'Reply with ONE short in-character radio line (max 22 words). Darkly funny, no emojis, no quotation marks.';

    const model = env.MODEL || 'gemma-3-27b-it';
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 60, temperature: 1.0 },
          }),
        },
      );
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const line = text.trim().split('\n')[0].replace(/^["']|["']$/g, '');
      return Response.json({ line: line || null }, { headers: cors });
    } catch {
      return Response.json({ line: null }, { headers: cors });
    }
  },
};
