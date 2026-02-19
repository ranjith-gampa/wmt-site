/**
 * scripts/seed-blobs.js
 *
 * One-off script to pre-populate Netlify Blobs with already-fetched
 * earnings tracker data. Run with:
 *   node scripts/seed-blobs.js
 *
 * Requires NETLIFY_TOKEN + NETLIFY_SITE_ID env vars (or .env file).
 * These are only needed when running outside of a Netlify function context.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getStore } = require('@netlify/blobs');
const { CACHE_TTL_MS } = require('../netlify/functions/config');

const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN   = process.env.NETLIFY_TOKEN;

if (!SITE_ID || !TOKEN) {
  console.error('❌  Missing NETLIFY_SITE_ID or NETLIFY_TOKEN in .env');
  process.exit(1);
}

// ── Data to seed ──────────────────────────────────────────────────────────────
// Paste browser localStorage values here (et_v2_<TICKER> keys).
// TTL is pulled from config.js — change CACHE_TTL_EARNINGS_TRACKER_DAYS in .env to override.

const NOW    = Date.now();
const TTL_MS = CACHE_TTL_MS.EARNINGS_TRACKER;

const entries = [
  {
    ticker: 'AU',
    data: {"data_confirmed":true,"ticker":"AU","company_name":"AngloGold Ashanti PLC","next_earnings_date":"2026-02-20","earnings_time":"BMO","quarter":"Q4 FY2025","eps_estimate":1.9,"eps_prior_year":0.89,"revenue_estimate_b":2.99,"revenue_prior_year_b":2.37,"current_price":108,"implied_move_pct":null,"analyst_consensus":"Buy","avg_price_target":91.67,"key_metrics":[{"name":"Gold Production 2025-2026","estimate":"2.9-3.225M oz 2025, flat 2026","context":"Growth of 9-21% YoY in 2025; 2026 expects similar levels"},{"name":"Free Cash Flow","estimate":"~$1B Q3 2025","context":"Surged 141% YoY; liquidity of $3.4B"},{"name":"Adjusted Net Debt","estimate":"$92M Q2 2025","context":"Down 92% YoY; debt-to-EBITDA improved to 0.02x"},{"name":"FY2025 Revenue Forecast","estimate":"$9.74B","context":"Growth from operations boost"},{"name":"FY2026 Revenue Forecast","estimate":"$11.58B","context":"2.8% growth YoY expected"}],"bull_triggers":["Long-term gold price forecast raised to $2,750","2026 revenue estimates raised significantly to $2,863B","Strong leverage to gold prices with new dividend policy","Record Q3 free cash flow and improved balance sheet","Strategic expansions at Geita mine targeting 600,000 ounces"],"bear_risks":["Production expected to remain flat in 2026","Analyst earnings estimates trending lower recently","Rising operational costs and AISC pressure","Inability to advance critical growth projects","Potential regulatory headwinds and inflationary pressures"],"analyst_targets":[{"firm":"Scotiabank","rating":"Outperform","target":131},{"firm":"Citigroup","rating":"Buy","target":120},{"firm":"Roth Capital","rating":"Buy","target":92},{"firm":"Wall Street Zen","rating":"Buy","target":null}]},
  },
  {
    ticker: 'NEM',
    data: {"data_confirmed":true,"ticker":"NEM","company_name":"Newmont Corporation","next_earnings_date":"2026-02-19","earnings_time":"BMO","quarter":"Q4 FY2025","eps_estimate":1.94,"eps_prior_year":0.81,"revenue_estimate_b":5.76,"revenue_prior_year_b":5.52,"current_price":127.15,"implied_move_pct":5.96,"analyst_consensus":"Buy","avg_price_target":136.37,"key_metrics":[{"name":"All-In Sustaining Cost (AISC) - Total Gold","estimate":"$1,602/oz","context":"Production cost metric; up from $1,463/oz YoY reflecting inflationary pressures"},{"name":"Attributable Gold Production","estimate":"1,403k oz","context":"Down from 1,899k oz YoY due to planned mine sequencing at Boddington and Tanami"},{"name":"Free Cash Flow (TTM)","estimate":"$4.5B","context":"Record Q3 contribution of $1.6B; strong liquidity position"},{"name":"Nevada Gold Mines Revenue","estimate":"$869M","context":"Geographic segment forecast showing +19.9% YoY growth"},{"name":"EPS Growth YoY","estimate":"+29.3%","context":"Consensus expects Q4 2025 EPS of $1.94 vs $0.81 in Q4 2024"}],"bull_triggers":["Gold prices near record highs ($4,500+/oz) supporting strong margins and cash generation","Record Q3 2025 cash flow of $1.6B and completion of $5B asset divestment program strengthening balance sheet","New Ahafo North mine declared commercial production, expanding production profile in Ghana","EPS estimates revised upward 13% in past 30 days signaling positive analyst sentiment","Tier 1 asset portfolio of 11 managed mines provides 20+ year reserve life and operational stability"],"bear_risks":["Gold price reversion risk if macroeconomic conditions stabilize or rates remain elevated (downside scenario projects $41/share at $2,500/oz gold)","Production headwinds with lower attributable gold output expected in 2026 due to planned mine sequencing","Cost inflation pressures with AISC forecasted at $1,602/oz vs $1,463/oz YoY, limiting margin expansion","Geopolitical and regulatory risks in key mining jurisdictions (Africa, South America) and resource nationalism pressures","Integration execution risks post-Newcrest acquisition with aging Lihir mine (PNG) technical health concerns"],"analyst_targets":[{"firm":"Stifel","rating":"Buy","target":175},{"firm":"UBS","rating":"Buy","target":160},{"firm":"Scotiabank","rating":"Buy","target":152},{"firm":"Goldman Sachs","rating":"Buy","target":140},{"firm":"Raymond James","rating":"Outperform","target":135}]},
  },
  {
    ticker: 'SO',
    data: {"data_confirmed":true,"ticker":"SO","company_name":"The Southern Company","next_earnings_date":"2026-02-19","earnings_time":"BMO","quarter":"Q4 FY2025","eps_estimate":0.58,"eps_prior_year":null,"revenue_estimate_b":6.4127,"revenue_prior_year_b":null,"current_price":90.5,"implied_move_pct":null,"analyst_consensus":"Hold","avg_price_target":94.03,"key_metrics":[{"name":"Q3 2025 Adjusted EPS","estimate":"$1.60","context":"Beat estimate by $0.10, up $0.17 YoY"},{"name":"Data Center Demand","estimate":"Over 2 GW","context":"Contracted with large load customers"},{"name":"Weather-Normal Retail Electricity Sales","estimate":"1.8% growth YTD","context":"Driven by data centers and economic growth"},{"name":"Full-Year 2025 Guidance","estimate":"$4.30 EPS","context":"Projected at top of guidance range"},{"name":"Dividend Yield","estimate":"3.5%","context":"74 cents per share quarterly, 78 consecutive years"}],"bull_triggers":["Strong data center demand with 2 GW+ of contracted capacity growth","Analyst upgrades with $96-$105 price targets offering 12% upside","Consistent dividend growth and strong cash flow generation"],"bear_risks":["RBC analyst at Sector Perform rating; Morgan Stanley downgrade to Underweight at $85","Regulatory risks from Georgia PSC proceedings on rate changes","High valuation relative to sector peers and limited earnings growth visibility"],"analyst_targets":[{"firm":"RBC Capital","rating":"Sector Perform","target":105},{"firm":"Morgan Stanley","rating":"Underweight","target":85},{"firm":"StockAnalysis","rating":"Buy","target":96}]},
  },
];

// ── Push to Netlify Blobs ─────────────────────────────────────────────────────
async function seed() {
  const store = getStore({
    name:        'earnings-tracker-cache',
    consistency: 'strong',
    siteID:      SITE_ID,
    token:       TOKEN,
  });

  for (const { ticker, data } of entries) {
    const payload = {
      ticker,
      fetched_at: NOW,
      expires_at: NOW + TTL_MS,
      data,
    };
    await store.setJSON(ticker, payload);
    console.log(`✅  ${ticker} → Blob written (TTL: ${Math.round(TTL_MS / 86400000)}d, expires ${new Date(NOW + TTL_MS).toISOString()})`);
  }

  console.log('\n🎉  All blobs seeded successfully.');
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
