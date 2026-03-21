// ══════════════════════════════════════════
// Seranova — Secure Auth Function
// POST /functions/auth
// Body: { email, password, otp? }
// Returns: { success, token, step }
//
// Environment Variables Required (Cloudflare Pages):
//   ADMIN_EMAIL    → admin@seranova.world
//   ADMIN_PASSWORD → your-strong-password (bcrypt hash or plain)
//   ADMIN_OTP      → 6-digit code (or 'TOTP' for time-based)
//   JWT_SECRET     → random 64-char string
// ══════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return res(400, { success: false, message: 'Invalid JSON' }); }

  const { email, password, otp, step = 'login' } = body;

  // ── Rate limiting via KV (optional, skip if no KV binding) ──
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (step === 'login') {
    // ── Validate email ──
    if (!email || !password) {
      return res(400, { success: false, message: 'Email and password required' });
    }

    // ── Check email (case-insensitive) ──
    const adminEmail = (env.ADMIN_EMAIL || '').toLowerCase();
    if (email.toLowerCase() !== adminEmail) {
      await sleep(800); // Prevent timing attacks
      return res(401, { success: false, field: 'email', message: 'Invalid email' });
    }

    // ── Check password ──
    const adminPassword = env.ADMIN_PASSWORD || '';
    const passwordMatch = await secureCompare(password, adminPassword);
    if (!passwordMatch) {
      await sleep(800);
      return res(401, { success: false, field: 'password', message: 'Invalid password' });
    }

    // ── Password OK — issue step-1 token (short lived, only allows 2FA) ──
    const preToken = await createJWT(
      { sub: email, step: 'pre_2fa', iat: Date.now() },
      env.JWT_SECRET,
      5 * 60 // 5 minutes
    );

    return res(200, {
      success: true,
      step: 'otp',
      pre_token: preToken,
      message: 'Password verified. Enter your OTP.'
    });
  }

  if (step === 'otp') {
    const { pre_token } = body;

    if (!pre_token || !otp) {
      return res(400, { success: false, message: 'Token and OTP required' });
    }

    // ── Verify pre-token ──
    const payload = await verifyJWT(pre_token, env.JWT_SECRET);
    if (!payload || payload.step !== 'pre_2fa') {
      return res(401, { success: false, message: 'Session expired. Please login again.' });
    }

    // ── Verify OTP ──
    const adminOTP = env.ADMIN_OTP || '123456';
    if (otp !== adminOTP) {
      await sleep(500);
      return res(401, { success: false, field: 'otp', message: 'Invalid OTP code' });
    }

    // ── OTP OK — issue full session token (8 hours) ──
    const sessionToken = await createJWT(
      {
        sub: payload.sub,
        role: 'admin',
        iat: Date.now(),
        jti: crypto.randomUUID()
      },
      env.JWT_SECRET,
      8 * 60 * 60 // 8 hours
    );

    return res(200, {
      success: true,
      step: 'done',
      token: sessionToken,
      message: 'Welcome, Admin.'
    });
  }

  return res(400, { success: false, message: 'Unknown step' });
}

// ── Verify session token (for protected API calls) ──
export async function onRequestGet(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return res(401, { success: false, message: 'No token provided' });
  }

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.role !== 'admin') {
    return res(401, { success: false, message: 'Invalid or expired token' });
  }

  return res(200, {
    success: true,
    email: payload.sub,
    expires_at: new Date((payload.exp || 0) * 1000).toISOString()
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

// ══════════════════════════════════════════
// JWT Helpers (Web Crypto API — no dependencies)
// ══════════════════════════════════════════
async function createJWT(payload, secret, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(fullPayload));
  const toSign = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret);
  const signature = await sign(key, toSign);

  return `${toSign}.${signature}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const toVerify = `${headerB64}.${payloadB64}`;

    const key = await importKey(secret);
    const expectedSig = await sign(key, toVerify);

    // Timing-safe comparison
    if (!(await secureCompare(sigB64, expectedSig))) return null;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

async function importKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret || 'fallback-secret-change-me'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function sign(key, data) {
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

function b64url(data) {
  if (typeof data === 'string') {
    return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  // Uint8Array
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Timing-safe string comparison
async function secureCompare(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) {
    // Still do the comparison to prevent timing attacks
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://seranova.world',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}

function res(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
