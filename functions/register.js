// ══════════════════════════════════════════
// Seranova — Register Function (Cloudflare Pages)
// Saves new member to Supabase + sends notifications
// ══════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return res(400, { success: false, message: 'Invalid JSON' }); }

  const { name, email, phone, country, referred_by, marketing_consent, language } = body;

  // ── Basic validation ──
  if (!name || !email || !email.includes('@')) {
    return res(400, { success: false, message: 'Name and email are required' });
  }

  // ── Check if email already exists ──
  const existing = await supabaseGet(env, `members?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing && existing.length > 0) {
    return res(200, { success: false, error: 'duplicate', message: 'Email already registered' });
  }

  // ── Generate unique referral code ──
  const referralCode = 'SRN-' + Math.random().toString(36).substring(2,8).toUpperCase();

  // ── Starting points (referral bonus) ──
  let startPoints = 0;
  if (referred_by) {
    const referrer = await supabaseGet(env, `members?referral_code=eq.${referred_by}&select=id,points`);
    if (referrer && referrer.length > 0) {
      startPoints = 50;
      await supabasePatch(env, `members?id=eq.${referrer[0].id}`, {
        points: (referrer[0].points || 0) + 75
      });
    }
  }

  // ── Save new member ──
  const newMember = {
    name,
    email,
    phone: phone || '',
    country: country || 'OTHER',
    points: startPoints,
    tier: 'Explorer',
    streak: 0,
    referral_code: referralCode,
    referred_by: referred_by || null,
    is_active: true
  };

  const saved = await supabasePost(env, 'members', newMember);
  if (!saved || saved.error) {
    console.error('Supabase error:', JSON.stringify(saved));
    return res(500, { success: false, message: 'Database error' });
  }

  // ── Send admin notification ──
  try {
    const notifyUrl = new URL(request.url);
    notifyUrl.pathname = '/functions/notify';
    await fetch(notifyUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_member',
        data: { name, email, country: country || 'OTHER' }
      })
    });
  } catch(e) {
    console.error('Notify error:', e.message);
  }

  // ── Send welcome email ──
  try {
    await sendWelcomeEmail(env, email, name, referralCode, startPoints);
  } catch(e) {
    console.error('Welcome email error:', e.message);
  }

  return res(200, {
    success: true,
    referral_code: referralCode,
    points: startPoints,
    message: 'Registration successful!'
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

// ══ Supabase helpers ══
async function supabaseGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`
    }
  });
  return r.json();
}

async function supabasePost(env, table, data) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  return r.json();
}

async function supabasePatch(env, path, data) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  return r.json();
}

// ══ Welcome email ══
async function sendWelcomeEmail(env, email, name, refCode, points) {
  const firstName = name.split(' ')[0];
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Seranova <admin@seranova.world>',
      to: [email],
      subject: `🎉 Welcome to Seranova, ${firstName}!`,
      html: welcomeEmailHtml(name, refCode, points)
    })
  });
}

function welcomeEmailHtml(name, refCode, points) {
  const firstName = name.split(' ')[0];
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#07070e,#1a2240);padding:36px 32px;text-align:center">
      <div style="font-size:24px;font-weight:700;color:#f0ebe0">Sera<span style="color:#c8a84b">nova</span></div>
      <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,75,.6);margin-top:6px">Travel, Refined by Intelligence</div>
    </div>
    <div style="padding:32px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">🎉</div>
      <h2 style="font-size:22px;color:#1a1a2e;margin:0 0 10px">Welcome, ${firstName}!</h2>
      <p style="font-size:14px;color:#666;line-height:1.7;margin:0 0 24px">You have officially joined the Seranova community.<br>Every week a new destination — and you help decide where!</p>

      ${points > 0 ? `<div style="background:#fff8e6;border:1px solid rgba(200,168,75,.3);border-radius:10px;padding:14px;margin-bottom:20px">
        <div style="font-size:13px;color:#888">Referral Bonus</div>
        <div style="font-size:28px;font-weight:700;color:#c8a84b">${points} points</div>
      </div>` : ''}

      <div style="background:#f9f9fb;border-radius:10px;padding:16px;margin-bottom:24px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">Your Referral Code</div>
        <div style="font-family:monospace;font-size:22px;font-weight:700;color:#c8a84b;letter-spacing:3px">${refCode}</div>
        <div style="font-size:12px;color:#888;margin-top:8px">Each referral = +75 pts for you, +50 for them</div>
      </div>

      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:24px">
        <div style="background:#f0f4ff;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Tier</div>
          <div style="font-size:15px;font-weight:600;color:#3a6fd8;margin-top:4px">Explorer ✦</div>
        </div>
        <div style="background:#f0fff6;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Points</div>
          <div style="font-size:15px;font-weight:600;color:#3db87a;margin-top:4px">${points} ⭐</div>
        </div>
      </div>

      <a href="https://seranova.world/member.html?code=${refCode}" style="display:inline-block;background:linear-gradient(135deg,#c8a84b,#b8923c);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:14px">View My Profile →</a>
      <p style="font-size:11px;color:#aaa;margin-top:12px">If this email landed in spam, please mark it as "Not Spam" to keep receiving updates.</p>
    </div>
    <div style="background:#f9f9fb;padding:16px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee">
      Seranova · seranova.world · <a href="#" style="color:#aaa">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function res(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
