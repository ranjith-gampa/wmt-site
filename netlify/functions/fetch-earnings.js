/**
 * Netlify Serverless Function: fetch-earnings.js
 * 
 * Proxies requests to the Anthropic API with:
 * - API key stored securely in Netlify environment variables (never exposed to browser)
 * - Per-IP rate limiting (5 requests per hour using in-memory store)
 * - Request validation and abuse protection
 * - CORS headers for the frontend
 * - Hard spend protection via max_tokens cap
 */

const { getStore } = require('@netlify/blobs');
const { MODELS, ANTHROPIC, RATE_LIMITS, CACHE_TTL_MS, CORS_HEADERS } = require('./config');

// ─── In-memory rate limit store ───────────────────────────────────────────────
// Note: Netlify Functions are stateless — this resets on cold starts.
// For production hardening, replace with Netlify Blobs or an external KV store.
const rateLimitStore = new Map();
const RATE_LIMIT = RATE_LIMITS.WMT_EARNINGS;

// ─── Blob cache helpers ───────────────────────────────────────────────────────
const WMT_BLOB_KEY = 'wmt-earnings-latest';

function getWmtStore(context) {
  return getStore({ name: 'wmt-earnings-cache', consistency: 'strong', ...(context ? { context } : {}) });
}

async function wmtBlobGet(context) {
  try {
    const raw = await getWmtStore(context).get(WMT_BLOB_KEY, { type: 'json' });
    if (!raw) return null;
    if (Date.now() > raw.expires_at) {
      await getWmtStore(context).delete(WMT_BLOB_KEY).catch(() => {});
      return null;
    }
    return raw;
  } catch (e) {
    console.warn('[fetch-earnings] Blob read failed:', e.message);
    return null;
  }
}

async function wmtBlobSet(data, context) {
  try {
    await getWmtStore(context).setJSON(WMT_BLOB_KEY, {
      fetched_at: Date.now(),
      expires_at: Date.now() + CACHE_TTL_MS.WMT_EARNINGS,
      data,
    });
    console.log('[fetch-earnings] Blob written: wmt-earnings-latest');
  } catch (e) { console.warn('[fetch-earnings] Blob write failed:', e.message); }
}

function getRateLimitKey(ip) {
  return `rl:${ip}`;
}

function checkRateLimit(ip) {
  const key = getRateLimitKey(ip);
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // Fresh window
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1, resetAt: now + RATE_LIMIT.windowMs };
  }

  if (entry.count >= RATE_LIMIT.maxRequests) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, retryAfterSec };
  }

  entry.count++;
  rateLimitStore.set(key, entry);
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - entry.count, resetAt: entry.resetAt };
}

// ─── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event, context) => {

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // ── Rate limiting ────────────────────────────────────────────────────────────
  const ip =
    event.headers['x-forwarded-for']?.split(',')[0].trim() ||
    event.headers['client-ip'] ||
    'unknown';

  const rl = checkRateLimit(ip);

  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: {
        ...CORS_HEADERS,
        'Retry-After': String(rl.retryAfterSec),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
      },
      body: JSON.stringify({
        error: `Rate limit exceeded. You can make ${RATE_LIMIT.maxRequests} requests per hour. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`,
        rateLimited: true,
        retryAfterSec: rl.retryAfterSec,
      }),
    };
  }

  // ── Validate API key is configured ──────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is not set');
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server configuration error. API key not configured.' }),
    };
  }

  // ── Parse and validate request body ─────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  // Only allow our specific earnings query type (abuse protection)
  if (body.queryType !== 'wmt-earnings') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid query type' }),
    };
  }

  // ── Server-side Blob cache check (shared across all users, 15 min TTL) ─────
  const cachedWmt = await wmtBlobGet(context);
  if (cachedWmt) {
    console.log(`[fetch-earnings] Blob cache HIT (fetched ${Math.round((Date.now() - cachedWmt.fetched_at) / 60000)}m ago)`);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'X-Cache': 'HIT', 'X-Cache-Age': String(Math.round((Date.now() - cachedWmt.fetched_at) / 1000)) },
      body: JSON.stringify({ _fromCache: true, _fetchedAt: cachedWmt.fetched_at, ...cachedWmt.data }),
    };
  }
  console.log('[fetch-earnings] Blob cache MISS — calling Anthropic');

  // ── Call Anthropic API ───────────────────────────────────────────────────────
  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELS.WMT_EARNINGS,
        max_tokens: ANTHROPIC.MAX_TOKENS.WMT_EARNINGS,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: ANTHROPIC.MAX_SEARCH_USES.WMT_EARNINGS,
        }],
        messages: [{
          role: 'user',
          content: `Search for Walmart WMT Q4 FY2026 earnings results released today February 19 2026. Find the actual reported: EPS, revenue, US comparable sales growth percentage, operating income growth %, FY2027 guidance for net sales growth and operating income growth, and Walmart Connect advertising growth percentage. Also find the current WMT stock price and pre/post market reaction percentage. Return ONLY a JSON object with these exact fields: { "eps_actual": number, "eps_est": 0.73, "revenue_actual_b": number, "revenue_est_b": 190.4, "comp_sales_pct": number, "oi_growth_pct": number, "fy27_oi_guidance": "string like 4-6% or 7-9%", "fy27_sales_guidance": "string", "ad_growth_pct": number, "stock_current": number, "stock_change_pct": number, "data_confirmed": true }. If results are not yet available or you cannot find confirmed Q4 FY26 data, return { "data_confirmed": false }. Return ONLY the JSON object, no markdown, no other text.`,
        }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errData = await anthropicResponse.json().catch(() => ({}));
      console.error('Anthropic API error:', errData);
      return {
        statusCode: anthropicResponse.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: errData?.error?.message || `Anthropic API returned ${anthropicResponse.status}`,
        }),
      };
    }

    const data = await anthropicResponse.json();

    // Fire-and-forget: write confirmed results to Blob cache
    if (data?.content) await wmtBlobSet(data, context);

    // Return the raw Anthropic response — HTML will parse it
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'X-Cache': 'MISS',
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
      },
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error('Fetch error:', err);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to reach Anthropic API: ' + err.message }),
    };
  }
};
