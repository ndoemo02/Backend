// api/asr.js
// Server ASR -> OpenAI Whisper (whisper-1)
// WYMAGANE: OPENAI_API_KEY (Vercel → Project → Settings → Environment Variables)

export const config = {
  api: { bodyParser: false }
};

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCORS(res);

  // ⬇️ tymczasowy ping, żeby w przeglądarce nie było 404
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, expects: 'POST audio/*' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing on server' });
    }

    // 1) surowe audio z requestu
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    if (!audioBuffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    // 2) MIME z nagłówków (fallback na webm)
    const mime = req.headers['content-type']?.includes('audio')
      ? req.headers['content-type']
      : 'audio/webm';

    // 3) multipart/form-data
    const form = new FormData();
    const filename =
      mime.includes('wav') ? 'audio.wav'
        : (mime.includes('mpeg') || mime.includes('mp3')) ? 'audio.mp3'
        : 'audio.webm';

    form.append('file', new Blob([audioBuffer], { type: mime }), filename);
    form.append('model', 'whisper-1');      // lub 'gpt-4o-mini-transcribe'
    form.append('response_format', 'json'); // { text: "..." }
    // form.append('language', 'pl');        // opcjonalnie

    // 4) wywołanie OpenAI
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return res.status(502).json({ error: 'OpenAI ASR failed', details: errText || resp.statusText });
    }

    const data = await resp.json(); // { text: "..." }
    const text = typeof data?.text === 'string' ? data.text.trim() : '';

    if (!text) {
      return res.status(200).json({ text: '', info: 'no_speech_or_low_confidence' });
    }

    return res.status(200).json({ text, model: 'whisper-1' });
  } catch (err) {
    console.error('ASR error:', err);
    return res.status(500).json({ error: 'ASR server error', details: String(err?.message || err) });
  }
}
