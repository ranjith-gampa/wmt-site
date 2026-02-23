/**
 * Netlify Serverless Function: auth-config.js
 *
 * Returns public OAuth client IDs so the frontend can initialise
 * Google Sign-In and Apple Sign-In without exposing secrets.
 * The actual verification of ID tokens is done in auth-verify.js.
 */

const { CORS_HEADERS } = require('./config');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify({
      googleClientId:   process.env.GOOGLE_CLIENT_ID   || null,
      appleClientId:    process.env.APPLE_CLIENT_ID    || null,
      appleRedirectUri: process.env.APPLE_REDIRECT_URI || null,
    }),
  };
};
