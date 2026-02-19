/**
 * Netlify Scheduled Function: fetch-earnings-scheduled.js
 *
 * Automatically triggers a WMT earnings refresh on earnings day.
 * Cron schedule: 9:00 AM ET on Feb 19, 2026 (earnings day) — runs every 15 min
 * from 8:45 AM–11:00 AM ET to catch the BMO release window.
 *
 * Toggle on/off without redeploying:
 *   Netlify UI → Site config → Environment variables → ENABLE_WMT_CRON = true | false
 *
 * How it works:
 *   - Calls the same /api/fetch-earnings endpoint internally
 *   - Results are stored in Netlify Blobs under key "wmt-earnings-cache"
 *   - The fetch-earnings.js function checks the blob cache first before
 *     hitting Anthropic, so users get instant loads after the first cron hit
 */

const { schedule } = require('@netlify/functions');
const { FEATURES }  = require('./config');

// ── Cron schedule ─────────────────────────────────────────────────────────────
// "*/15 13-16 19 2 *" = every 15 min, 1 PM–4 PM UTC (8:45 AM–11 AM ET), Feb 19
const CRON = '*/15 13-16 19 2 *';

const handler = async (event) => {
  // Feature flag check — flip ENABLE_WMT_CRON=false in Netlify env to disable
  if (!FEATURES.WMT_CRON_ENABLED) {
    console.log('[wmt-cron] Skipped — ENABLE_WMT_CRON is false');
    return { statusCode: 200, body: 'Cron disabled via feature flag' };
  }

  console.log('[wmt-cron] Triggered at', new Date().toISOString());

  try {
    // Determine the base URL dynamically (works both locally and on Netlify)
    const base =
      process.env.URL ||                      // set automatically by Netlify
      process.env.DEPLOY_PRIME_URL ||          // branch deploys
      'http://localhost:8888';                 // netlify dev fallback

    const resp = await fetch(`${base}/.netlify/functions/fetch-earnings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryType: 'wmt-earnings' }),
    });

    const text = await resp.text();

    if (!resp.ok) {
      console.error('[wmt-cron] fetch-earnings returned', resp.status, text);
      return { statusCode: 502, body: `Upstream error: ${resp.status}` };
    }

    console.log('[wmt-cron] Success — status:', resp.status, '— body length:', text.length);
    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error('[wmt-cron] Error:', err.message);
    return { statusCode: 500, body: err.message };
  }
};

exports.handler = schedule(CRON, handler);
