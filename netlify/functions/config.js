/**
 * config.js — Shared configuration for all Netlify functions
 *
 * Model changes, rate limits, and feature flags live here.
 * No need to touch individual function files for routine tuning.
 */

// ─── Anthropic Models ─────────────────────────────────────────────────────────
const MODELS = {
  // Used by fetch-earnings.js (WMT live results — higher accuracy needed)
  WMT_EARNINGS: 'claude-haiku-4-5-20251001',

  // Used by earnings-tracker.js (generic ticker lookup)
  EARNINGS_TRACKER: 'claude-haiku-4-5-20251001',
};

// ─── Anthropic API Settings ───────────────────────────────────────────────────
const ANTHROPIC = {
  BASE_URL: 'https://api.anthropic.com/v1/messages',
  VERSION:  '2023-06-01',

  // Per-function token caps (output only — input/search billed separately)
  MAX_TOKENS: {
    WMT_EARNINGS:     4096,
    EARNINGS_TRACKER: 4096,
  },

  // Max web search calls per request (each search ~$0.01)
  MAX_SEARCH_USES: {
    WMT_EARNINGS:     2,
    EARNINGS_TRACKER: 2,
  },
};

// ─── Rate Limits ──────────────────────────────────────────────────────────────
const RATE_LIMITS = {
  // fetch-earnings.js  — WMT only, low traffic expected
  WMT_EARNINGS: {
    maxRequests: 5,
    windowMs:    60 * 60 * 1000, // 1 hour
  },

  // earnings-tracker.js — generic ticker, slightly more generous
  EARNINGS_TRACKER: {
    maxRequests: 10,
    windowMs:    60 * 60 * 1000, // 1 hour
  },
};

// ─── Server-side Blob Cache TTLs ─────────────────────────────────────────────
// Centralised here so seed-blobs.js, earnings-tracker.js and fetch-earnings.js
// all stay in sync. Override at runtime via env vars without redeploying:
//   CACHE_TTL_EARNINGS_TRACKER_DAYS=3   (default: 7)
//   CACHE_TTL_WMT_EARNINGS_MINS=30      (default: 15)
const CACHE_TTL_MS = {
  // WMT earnings: short TTL on earnings day so live results refresh quickly
  WMT_EARNINGS: (parseInt(process.env.CACHE_TTL_WMT_EARNINGS_MINS  ?? '15',  10)) * 60 * 1000,

  // Generic tickers: earnings dates are stable — long TTL to minimise API calls
  EARNINGS_TRACKER: (parseInt(process.env.CACHE_TTL_EARNINGS_TRACKER_DAYS ?? '7', 10)) * 24 * 60 * 60 * 1000,
};

// ─── Feature Flags ────────────────────────────────────────────────────────────
const FEATURES = {
  // Set to true to enable the scheduled auto-refresh of WMT earnings on earnings day.
  // Flip to false to disable the cron without deleting the function or redeploying.
  // Can also be overridden at runtime via env var: ENABLE_WMT_CRON=true|false
  WMT_CRON_ENABLED: (process.env.ENABLE_WMT_CRON ?? 'false') === 'true',
};

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

module.exports = { MODELS, ANTHROPIC, RATE_LIMITS, CACHE_TTL_MS, FEATURES, CORS_HEADERS };
