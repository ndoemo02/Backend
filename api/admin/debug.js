export default function handler(req, res) {
  const envToken = process.env.ADMIN_TOKEN || "none";
  const receivedAmber = req.headers["x-amber-token"] || null;
  const receivedAdmin = req.headers["x-admin-token"] || null;
  const receivedQuery = req.query?.admin_token || req.query?.token || null;
  const match = envToken === (receivedAmber || receivedAdmin || receivedQuery);
  return res.status(200).json({ envToken, received: receivedAmber, receivedAdmin, receivedQuery, match });
}


