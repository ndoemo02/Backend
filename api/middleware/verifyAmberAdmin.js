// api/middleware/verifyAmberAdmin.js
export function verifyAmberAdmin(req, res, next) {
  try {
    const headerToken =
      req.headers['x-amber-token'] ||
      req.headers['x-admin-token'] ||
      req.query.admin_token ||
      req.query.token; // fallback for older clients

    const validToken = process.env.ADMIN_TOKEN;

    if (!headerToken || headerToken !== validToken) {
      return res.status(403).json({
        ok: false,
        error: 'Unauthorized access — invalid admin token.',
      });
    }

    next();
  } catch (err) {
    console.error('verifyAmberAdmin error:', err);
    return res.status(500).json({ ok: false, error: 'Auth middleware failed.' });
  }
}


