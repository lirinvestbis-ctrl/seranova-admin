// ══════════════════════════════════════════
// Seranova — Register Function
// שומר חבר חדש ב-Supabase + שולח התראה
// ══════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const NOTIFY_URL = process.env.URL + '/.netlify/functions/notify';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { name, email, phone, country, referred_by, marketing_consent } = body;

  // ── ולידציה בסיסית ──
  if (!name || !email || !email.includes('@')) {
    return res(400, { success: false, message: 'שם ואימייל נדרשים' });
  }

  // ── בדוק אם האימייל כבר קיים ──
  const existing = await supabaseGet(`members?email=eq.${encodeURIComponent(email)}&select=id`);
  if (existing && existing.length > 0) {
    return res(200, { success: false, error: 'duplicate', message: 'האימייל כבר רשום' });
  }

  // ── צור קוד הפניה ייחודי ──
  const referralCode = 'SRN-' + Math.random().toString(36).substring(2,8).toUpperCase();

  // ── נקודות פתיחה (בונוס הפניה) ──
  let startPoints = 0;
  if (referred_by) {
    // בדוק שהקוד קיים
    const referrer = await supabaseGet(`members?referral_code=eq.${referred_by}&select=id,points`);
    if (referrer && referrer.length > 0) {
      startPoints = 50; // בונוס למצטרף
      // עדכן נקודות למפנה (+75)
      await supabasePatch(`members?id=eq.${referrer[0].id}`, {
        points: (referrer[0].points || 0) + 75
      });
    }
  }

  // ── שמור חבר חדש ──
  const newMember = {
    name,
    email,
    phone: phone || '',
    country: country || 'IL',
    points: startPoints,
    tier: 'Explorer',
    streak: 0,
    referral_code: referralCode,
    referred_by: referred_by || null,
    is_active: true
  };

  const saved = await supabasePost('members', newMember);
  if (!saved || saved.error) {
    console.error('Supabase error:', saved);
    return res(500, { success: false, message: 'שגיאת מסד נתונים' });
  }

  // ── שלח התראה למנהל ──
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_member',
        data: { name, email, country: country || 'IL' }
      })
    });
  } catch(e) {
    console.error('Notify error:', e.message);
    // לא נכשיל את הרישום בגלל התראה
  }

  // ── שלח מייל ברוכים הבאים למשתתף ──
  try {
    await sendWelcomeEmail(email, name, referralCode, startPoints);
  } catch(e) {
    console.error('Welcome email error:', e.message);
  }

  return res(200, {
    success: true,
    referral_code: referralCode,
    points: startPoints,
    message: 'נרשמת בהצלחה!'
  });
};

// ══ Supabase helpers ══
async function supabaseGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  return r.json();
}

async function supabasePost(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  return r.json();
}

async function supabasePatch(path, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  return r.json();
}

// ══ מייל ברוכים הבאים ══
async function sendWelcomeEmail(email, name, refCode, points) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Seranova <admin@seranova.world>',
      to: [email],
      subject: `🎉 ברוך הבא ל-Seranova, ${name.split(' ')[0]}!`,
      html: welcomeEmailHtml(name, refCode, points)
    })
  });
}

function welcomeEmailHtml(name, refCode, points) {
  const firstName = name.split(' ')[0];
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#07070e,#1a2240);padding:36px 32px;text-align:center">
      <div style="font-size:24px;font-weight:700;color:#f0ebe0">Sera<span style="color:#c8a84b">nova</span></div>
      <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,75,.6);margin-top:6px">Travel, Refined by Intelligence</div>
    </div>
    <div style="padding:32px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">🎉</div>
      <h2 style="font-size:22px;color:#1a1a2e;margin:0 0 10px">ברוך הבא, ${firstName}!</h2>
      <p style="font-size:14px;color:#666;line-height:1.7;margin:0 0 24px">הצטרפת רשמית לקהילת Seranova.<br>כל שבוע יעד חדש — ואתה קובע לאן!</p>
      
      ${points > 0 ? `<div style="background:#fff8e6;border:1px solid rgba(200,168,75,.3);border-radius:10px;padding:14px;margin-bottom:20px">
        <div style="font-size:13px;color:#888">בונוס הפניה</div>
        <div style="font-size:28px;font-weight:700;color:#c8a84b">${points} נקודות</div>
      </div>` : ''}
      
      <div style="background:#f9f9fb;border-radius:10px;padding:16px;margin-bottom:24px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">קוד ההפניה שלך</div>
        <div style="font-family:monospace;font-size:22px;font-weight:700;color:#c8a84b;letter-spacing:3px">${refCode}</div>
        <div style="font-size:12px;color:#888;margin-top:8px">כל הפניה = +75 נקודות לך, +50 לחבר</div>
      </div>
      
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:24px">
        <div style="background:#f0f4ff;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">דרגה</div>
          <div style="font-size:15px;font-weight:600;color:#3a6fd8;margin-top:4px">Explorer ✦</div>
        </div>
        <div style="background:#f0fff6;border-radius:8px;padding:12px 16px;text-align:center;min-width:100px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">נקודות</div>
          <div style="font-size:15px;font-weight:600;color:#3db87a;margin-top:4px">${points} ⭐</div>
        </div>
      </div>
      
      <a href="https://seranova.world" style="display:inline-block;background:linear-gradient(135deg,#c8a84b,#b8923c);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:14px">כנס לקהילה →</a>
    </div>
    <div style="background:#f9f9fb;padding:16px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee">
      Seranova · seranova.world · <a href="#" style="color:#aaa">הסר מרשימת תפוצה</a>
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
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body)
  };
}
