/**
 * Netlify Serverless Function: auth-verify.js
 *
 * Verifies Google and Apple ID tokens server-side and returns
 * normalised user info.  Clients should call this after receiving
 * an ID token from the respective SDK and store the returned user
 * object — never the raw token.
 *
 * POST body: { provider: "google" | "apple", token: "<id_token>" }
 *
 * Verification approach:
 *   Google — Google's tokeninfo endpoint validates signature,
 *             audience, and expiry in one round-trip.
 *   Apple  — Fetch Apple's JWKS, pick the matching key by `kid`,
 *             verify RS256 signature + claims using Node.js `crypto`.
 */

const { createPublicKey, createVerify } = require('crypto');
const { CORS_HEADERS } = require('./config');

// ─── Google ────────────────────────────────────────────────────────────────────
async function verifyGoogleToken(token) {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;

  const data = await resp.json();
  if (data.error_description) {
    console.warn('[auth-verify] Google tokeninfo error:', data.error_description);
    return null;
  }

  // Validate audience when a client ID is configured
  const expectedAud = process.env.GOOGLE_CLIENT_ID;
  if (expectedAud && data.aud !== expectedAud) {
    console.warn('[auth-verify] Google token audience mismatch');
    return null;
  }

  if (data.exp && Date.now() / 1000 >= parseInt(data.exp, 10)) {
    console.warn('[auth-verify] Google token expired');
    return null;
  }

  return {
    provider:      'google',
    id:            data.sub,
    email:         data.email || null,
    name:          data.name  || null,
    picture:       data.picture || null,
    emailVerified: data.email_verified === true || data.email_verified === 'true',
  };
}

// ─── Apple ─────────────────────────────────────────────────────────────────────
async function fetchAppleKeys() {
  const resp = await fetch('https://appleid.apple.com/auth/keys');
  if (!resp.ok) throw new Error('Failed to fetch Apple JWKS');
  const { keys } = await resp.json();
  return keys;
}

function base64urlDecode(str) {
  // Normalise base64url to standard base64 then decode
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

async function verifyAppleToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header  = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    console.warn('[auth-verify] Apple token decode error');
    return null;
  }

  // Expiry check
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    console.warn('[auth-verify] Apple token expired');
    return null;
  }

  // Issuer check
  if (payload.iss !== 'https://appleid.apple.com') {
    console.warn('[auth-verify] Apple token issuer mismatch');
    return null;
  }

  // Audience check when a client ID is configured
  const expectedAud = process.env.APPLE_CLIENT_ID;
  if (expectedAud && payload.aud !== expectedAud) {
    console.warn('[auth-verify] Apple token audience mismatch');
    return null;
  }

  // Fetch Apple's public keys and find the one matching `kid`
  let keys;
  try {
    keys = await fetchAppleKeys();
  } catch (e) {
    console.error('[auth-verify] Could not fetch Apple JWKS:', e.message);
    return null;
  }

  const jwk = keys.find(k => k.kid === header.kid && k.alg === 'RS256');
  if (!jwk) {
    console.warn('[auth-verify] Apple signing key not found for kid:', header.kid);
    return null;
  }

  // Verify RS256 signature using Node.js built-in crypto
  try {
    const publicKey  = createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature    = base64urlDecode(sigB64);

    const verifier = createVerify('SHA256');
    verifier.update(signingInput);
    const valid = verifier.verify(publicKey, signature);
    if (!valid) {
      console.warn('[auth-verify] Apple token signature invalid');
      return null;
    }
  } catch (e) {
    console.error('[auth-verify] Apple signature check error:', e.message);
    return null;
  }

  return {
    provider:      'apple',
    id:            payload.sub,
    email:         payload.email         || null,
    name:          null, // Apple only sends name on the very first sign-in (handled client-side)
    picture:       null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}

// ─── Handler ───────────────────────────────────────────────────────────────────
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

  const { provider, token } = body;

  if (!provider || typeof provider !== 'string') {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing provider' }) };
  }
  if (!token || typeof token !== 'string' || token.length > 4096) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing or invalid token' }) };
  }

  try {
    let user = null;

    if (provider === 'google') {
      user = await verifyGoogleToken(token);
    } else if (provider === 'apple') {
      user = await verifyAppleToken(token);
    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unsupported provider. Use "google" or "apple".' }),
      };
    }

    if (!user) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Token verification failed' }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ user }),
    };

  } catch (err) {
    console.error('[auth-verify] Unexpected error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal verification error' }),
    };
  }
};
