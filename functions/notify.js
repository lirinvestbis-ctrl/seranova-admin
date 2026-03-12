// ══════════════════════════════════════════
// Seranova — Notify Function (Cloudflare Pages)
// Handles: WhatsApp (Twilio) + Email (Resend)
// ══════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return res(400, { success: false, message: 'Invalid JSON' }); }

  const { type, data } = body;

  const results = { whatsapp: null, email: null };

  // ── WhatsApp via Twilio ──
  try {
    const msg = buildWhatsAppMessage(type, data);
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: 'whatsapp:+14155238886',
          To: `whatsapp:${env.ADMIN_WHATSAPP}`,
          Body: msg
        })
      }
    );
    const twilioData = await twilioRes.json();
    results.whatsapp = twilioData.sid ? 'sent' : twilioData.message;
  } catch(e) {
    results.whatsapp = 'error: ' + e.message;
  }

  // ── Email via Resend ──
  try {
    const { subject, html } = buildEmail(type, data);
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Seranova <admin@seranova.world>',
        to: [env.ADMIN_EMAIL],
        subject,
        html
      })
    });
    const emailData = await emailRes.json();
    results.email = emailData.id ? 'sent' : (emailData.message || 'error');
  } catch(e) {
    results.email = 'error: ' + e.message;
  }

  const success = results.whatsapp === 'sent' || results.email === 'sent';
  return res(200, { success, results });
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

// ══ Message builders ══
function buildWhatsAppMessage(type, data) {
  switch(type) {
    case 'test':
      return `🧪 *Seranova Test*\nSystem is working! ✅\n${new Date().toLocaleString()}`;
    case 'new_member':
      return `👤 *New Member!*\n\nName: ${data.name}\nEmail: ${data.email}\nCountry: ${data.country}\n\nseranova.world/index.html`;
    case 'vote':
      return `🗳️ *New Vote!*\n\n${data.member_name} voted for *${data.destination}*\nPoints: +${data.points}`;
    case 'approval_required':
      return `⚠️ *Approval Required*\n\nAction: ${data.action}\nAmount: $${data.amount}\nDetails: ${data.details}\n\n✅ Approve: ${data.approve_url}\n❌ Reject: ${data.reject_url}`;
    case 'winner':
      return `🎉 *WINNER SELECTED!*\n\nName: ${data.name}\nEmail: ${data.email}\nDestination: ${data.destination}\nEntry ID: ${data.entry_id}\n\n✅ Approve & Notify: ${data.approve_url}\n❌ Reject: ${data.reject_url}`;
    default:
      return `📬 Seranova notification: ${type}`;
  }
}

function buildEmail(type, data) {
  const base = (title, content) => ({
    subject: `[Seranova] ${title}`,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">
      <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <div style="background:linear-gradient(135deg,#07070e,#1a2240);padding:24px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#f0ebe0">Sera<span style="color:#c8a84b">nova</span></div>
        </div>
        <div style="padding:24px">${content}</div>
        <div style="background:#f9f9fb;padding:12px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee">
          Seranova Admin · seranova.world
        </div>
      </div>
    </body></html>`
  });

  switch(type) {
    case 'test':
      return base('System Test ✅', '<h2>System is working!</h2><p>Your notification system is fully operational.</p>');
    case 'new_member':
      return base('New Member! 👤', `<h2>New member joined!</h2>
        <p><b>Name:</b> ${data.name}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Country:</b> ${data.country}</p>
        <p><b>Time:</b> ${new Date().toLocaleString()}</p>`);
    case 'approval_required':
      return base('⚠️ Approval Required', `<h2>Action requires your approval</h2>
        <p><b>Action:</b> ${data.action}</p>
        <p><b>Amount:</b> $${data.amount}</p>
        <p><b>Details:</b> ${data.details}</p>
        <br>
        <a href="${data.approve_url}" style="background:#22c55e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-right:10px">✅ Approve</a>
        <a href="${data.reject_url}" style="background:#ef4444;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">❌ Reject</a>`);
    case 'winner':
      return base('🎉 Winner Selected!', `<h2>A winner has been selected!</h2>
        <p><b>Name:</b> ${data.name}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Destination:</b> ${data.destination}</p>
        <p><b>Entry ID:</b> ${data.entry_id}</p>
        <br>
        <a href="${data.approve_url}" style="background:#22c55e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;margin-right:10px">✅ Approve & Notify</a>
        <a href="${data.reject_url}" style="background:#ef4444;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">❌ Reject</a>`);
    default:
      return base('Notification', `<p>Type: ${type}</p><pre>${JSON.stringify(data, null, 2)}</pre>`);
  }
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
