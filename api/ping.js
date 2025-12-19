export default async function handler(req, res) {
  const now = new Date().toISOString();
  console.log(`[PING] keep-alive pong at ${now}`);
  return res.status(200).json({ ok: true, message: 'keep-alive pong 🧠', timestamp: now });
}


