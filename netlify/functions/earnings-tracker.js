/**
 * Netlify Serverless Function: earnings-tracker.js
 *
 * Generic earnings tracker for any ticker symbol.
 * - Server-side Netlify Blobs cache (shared across all users, 6h TTL)
 * - Rate limiting: 10 requests per hour per IP
 * - Validates ticker (1–5 uppercase letters)
 * - Uses Claude web_search to fetch live earnings data
 * - Returns structured JSON for client-side caching
 */

const { getStore } = require('@netlify/blobs');
const { MODELS, ANTHROPIC, RATE_LIMITS, CACHE_TTL_MS, CORS_HEADERS } = require('./config');

const rateLimitStore = new Map();
const RATE_LIMIT = RATE_LIMITS.EARNINGS_TRACKER;

// ─── Blob cache helpers ───────────────────────────────────────────────────────
function getBlobStore() {
  return getStore({ name: 'earnings-tracker-cache', consistency: 'strong' });
}

async function blobGet(ticker) {
  try {
    const store = getBlobStore();
    const raw = await store.get(ticker, { type: 'json' });
    if (!raw) return null;
    if (Date.now() > raw.expires_at) {
      await store.delete(ticker).catch(() => {});
      return null;
    }
    return raw;
  } catch { return null; }
}

async function blobSet(ticker, data) {
  try {
    const store = getBlobStore();
    await store.setJSON(ticker, {
      ticker,
      fetched_at: Date.now(),
      expires_at: Date.now() + CACHE_TTL_MS.EARNINGS_TRACKER,
      data,
    });
  } catch (e) { console.warn('Blob write failed:', e.message); }
}

function checkRateLimit(ip) {
  const key = `rl:${ip}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Rate limiting
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
        error: `Rate limit exceeded. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minutes.`,
        rateLimited: true,
        retryAfterSec: rl.retryAfterSec,
      }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server configuration error.' }),
    };
  }

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

  if (body.queryType !== 'earnings-tracker') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid query type' }),
    };
  }

  // Validate and sanitize ticker
  const ticker = (body.ticker || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker || ticker.length > 5) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid ticker symbol. Must be 1–5 letters.' }),
    };
  }

  // ── Server-side Blob cache check (shared across all users) ──────────────────
  const cached = await blobGet(ticker);
  if (cached) {
    console.log(`[earnings-tracker] Blob cache hit: ${ticker} (fetched ${Math.round((Date.now() - cached.fetched_at) / 60000)}m ago)`);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'X-Cache': 'HIT', 'X-Cache-Age': String(Math.round((Date.now() - cached.fetched_at) / 1000)) },
      body: JSON.stringify({ _fromCache: true, _fetchedAt: cached.fetched_at, ...cached.data }),
    };
  }

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELS.EARNINGS_TRACKER,
        max_tokens: ANTHROPIC.MAX_TOKENS.EARNINGS_TRACKER,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: ANTHROPIC.MAX_SEARCH_USES.EARNINGS_TRACKER }],
        messages: [{
          role: 'user',
          content: `Search for "${ticker} stock earnings date 2026 EPS estimate analyst price target". Use at most 2 searches. Then output ONLY a raw JSON object — no markdown fences, no prose, no explanation, nothing before or after the JSON.

Use this exact shape, setting any unknown fields to null (never omit a field):
{"data_confirmed":true,"ticker":"${ticker}","company_name":"...","next_earnings_date":"YYYY-MM-DD","earnings_time":"BMO|AMC","quarter":"Q# FY####","eps_estimate":0.0,"eps_prior_year":0.0,"revenue_estimate_b":0.0,"revenue_prior_year_b":0.0,"current_price":0.0,"implied_move_pct":null,"analyst_consensus":"Buy|Hold|Sell","avg_price_target":null,"key_metrics":[{"name":"...","estimate":"...","context":"..."}],"bull_triggers":["...","...","..."],"bear_risks":["...","...","..."],"analyst_targets":[{"firm":"...","rating":"...","target":0.0}]}

Critical rules:
- ALWAYS return the full JSON even if some fields are null — never abandon mid-response
- key_metrics: 3–5 items, bull_triggers: 3–5 items, bear_risks: 3–5 items
- analyst_targets: up to 5 (use empty array [] if none found)
- Only if ticker is completely invalid/fictional: {"data_confirmed":false,"ticker":"${ticker}","error":"brief reason"}`,
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

    // ── Parse the earnings JSON from Anthropic's content blocks ──────────────
    // Do this server-side so we can cache the clean result in Blobs
    let earningsData = null;
    try {
      const textBlocks = (data.content || []).filter(b => b.type === 'text');
      const fullText   = textBlocks.map(b => b.text).join('\n');
      const stripped   = fullText.replace(/```(?:json)?\s*/gi, '').trim();
      const start      = stripped.indexOf('{');
      if (start !== -1) {
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = start; i < stripped.length; i++) {
          const ch = stripped[i];
          if (esc)              { esc = false; continue; }
          if (ch === '\\' && inStr) { esc = true; continue; }
          if (ch === '"')       { inStr = !inStr; continue; }
          if (inStr)            continue;
          if (ch === '{')       depth++;
          else if (ch === '}')  { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) earningsData = JSON.parse(stripped.slice(start, end + 1));
      }
    } catch (parseErr) {
      console.warn('[earnings-tracker] Could not pre-parse Anthropic response:', parseErr.message);
    }

    // ── Write clean result to Blob cache (fire-and-forget) ───────────────────
    if (earningsData && earningsData.data_confirmed) {
      blobSet(ticker, earningsData);
    }

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
