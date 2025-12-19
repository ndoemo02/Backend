// api/utils/trendsCron.js
// Optional background cron to analyze trends every 6h in production
// Prefer Vercel Cron hitting /api/admin/trends/analyze

(async () => {
  try {
    if (process.env.NODE_ENV !== 'production') return;
    if (globalThis.__amber_trends_timer) return;
    const fetch = (await import('node-fetch')).default;
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.PUBLIC_BASE_URL || 'https://freeflow-backend.vercel.app');
    const url = `${base}/api/admin/trends/analyze?admin_token=${encodeURIComponent(process.env.ADMIN_TOKEN || '')}`;
    const run = async () => {
      try { await fetch(url, { method: 'POST' }); } catch {}
    };
    globalThis.__amber_trends_timer = setInterval(run, 6 * 60 * 60 * 1000);
    // kick once on boot
    run();
  } catch {}
})();


