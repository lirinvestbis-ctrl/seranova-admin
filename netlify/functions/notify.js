// ══════════════════════════════════════════
// Seranova — Notification Function
// שולח WhatsApp + Email לאישור פעולות
// ══════════════════════════════════════════

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // הוסף: +972XXXXXXXXX
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;        // הוסף: admin@seranova.world
const SITE_URL = process.env.URL || 'https://seranova.world';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { type, data } = body;

  // ── בנה את ההודעה לפי סוג הפעולה ──
  const messages = buildMessages(type, data);

  const results = { whatsapp: null, email: null };

  // ── שלח WhatsApp ──
  try {
    results.whatsapp = await sendWhatsApp(messages.whatsapp);
  } catch (e) {
    console.error('WhatsApp error:', e.message);
    results.whatsapp = { error: e.message };
  }

  // ── שלח Email ──
  try {
    results.email = await sendEmail(messages.email, ADMIN_EMAIL);
  } catch (e) {
    console.error('Email error:', e.message);
    results.email = { error: e.message };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: true, results })
  };
};

// ══ בנה הודעות לפי סוג ══
function buildMessages(type, data) {
  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

  const types = {

    // ── משתתף חדש נרשם ──
    new_member: {
      whatsapp: `🆕 *Seranova — משתתף חדש!*
👤 ${data.name}
📧 ${data.email}
📍 ${data.country || 'לא ידוע'}
🕐 ${now}`,
      email: {
        subject: `🆕 משתתף חדש — ${data.name}`,
        html: emailTemplate('משתתף חדש הצטרף', [
          { label: 'שם', value: data.name },
          { label: 'אימייל', value: data.email },
          { label: 'מדינה', value: data.country || 'לא ידוע' },
          { label: 'זמן', value: now },
        ], null)
      }
    },

    // ── הצבעה על יעד ──
    vote: {
      whatsapp: `🗳️ *Seranova — הצבעה חדשה!*
👤 ${data.name}
🌍 הצביע ל: *${data.destination}*
⭐ ניקוד: ${data.points} נקודות
🕐 ${now}`,
      email: {
        subject: `🗳️ הצבעה חדשה — ${data.name} → ${data.destination}`,
        html: emailTemplate('הצבעה חדשה התקבלה', [
          { label: 'משתתף', value: data.name },
          { label: 'יעד שנבחר', value: data.destination },
          { label: 'ניקוד', value: data.points + ' נקודות' },
          { label: 'זמן', value: now },
        ], null)
      }
    },

    // ── דורש אישורך — הוצאה כספית ──
    approval_required: {
      whatsapp: `⚠️ *Seranova — נדרש אישורך!*
💸 פעולה: ${data.action}
💰 סכום: $${data.amount}
📋 פרטים: ${data.details}
🕐 ${now}

✅ לאישור: ${SITE_URL}/approve?id=${data.id}&token=${data.token}
❌ לדחייה: ${SITE_URL}/reject?id=${data.id}&token=${data.token}`,
      email: {
        subject: `⚠️ נדרש אישורך — ${data.action} ($${data.amount})`,
        html: emailTemplate('פעולה דורשת אישורך', [
          { label: 'פעולה', value: data.action },
          { label: 'סכום', value: '$' + data.amount },
          { label: 'פרטים', value: data.details },
          { label: 'זמן', value: now },
        ], {
          approve: `${SITE_URL}/approve?id=${data.id}&token=${data.token}`,
          reject: `${SITE_URL}/reject?id=${data.id}&token=${data.token}`
        })
      }
    },

    // ── זוכה נבחר ──
    winner: {
      whatsapp: `🏆 *Seranova — זוכה נבחר!*
👤 ${data.name}
📧 ${data.email}
🌍 יעד: ${data.destination}
🎫 מזהה: #${data.entry_id}
🕐 ${now}

⚠️ נדרש אישורך לפני הודעה לזוכה!
✅ אישור: ${SITE_URL}/approve-winner?id=${data.id}&token=${data.token}`,
      email: {
        subject: `🏆 זוכה נבחר — ${data.name} → ${data.destination}`,
        html: emailTemplate('זוכה נבחר — ממתין לאישורך', [
          { label: 'שם הזוכה', value: data.name },
          { label: 'אימייל', value: data.email },
          { label: 'יעד', value: data.destination },
          { label: 'מזהה כניסה', value: '#' + data.entry_id },
          { label: 'זמן', value: now },
        ], {
          approve: `${SITE_URL}/approve-winner?id=${data.id}&token=${data.token}`,
          reject: `${SITE_URL}/reject-winner?id=${data.id}&token=${data.token}`
        })
      }
    },

    // ── טסט ──
    test: {
      whatsapp: `✅ *Seranova — מערכת התראות פעילה!*
🎉 הוואטסאפ והמייל עובדים מצוין.
🕐 ${now}`,
      email: {
        subject: '✅ Seranova — מערכת התראות פעילה!',
        html: emailTemplate('בדיקה הצליחה!', [
          { label: 'סטטוס', value: '✅ מערכת ההתראות פעילה' },
          { label: 'WhatsApp', value: '✅ פעיל' },
          { label: 'Email', value: '✅ פעיל' },
          { label: 'זמן', value: now },
        ], null)
      }
    }
  };

  return types[type] || types.test;
}

// ══ שלח WhatsApp דרך Twilio ══
async function sendWhatsApp(message) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const params = new URLSearchParams({
    From: 'whatsapp:+14155238886', // Twilio Sandbox number
    To: `whatsapp:${ADMIN_WHATSAPP}`,
    Body: message
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Twilio error');
  }
  return await res.json();
}

// ══ שלח Email דרך Resend ══
async function sendEmail(emailData, to) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Seranova Admin <admin@seranova.world>',
      to: [to],
      subject: emailData.subject,
      html: emailData.html
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Resend error');
  }
  return await res.json();
}

// ══ תבנית מייל ══
function emailTemplate(title, rows, actions) {
  const rowsHtml = rows.map(r => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0;white-space:nowrap">${r.label}</td>
      <td style="padding:8px 12px;font-size:13px;color:#1a1a2e;font-weight:500;border-bottom:1px solid #f0f0f0">${r.value}</td>
    </tr>`).join('');

  const actionsHtml = actions ? `
    <div style="text-align:center;margin-top:24px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a href="${actions.approve}" style="background:#3db87a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">✅ אשר</a>
      <a href="${actions.reject}" style="background:#e05040;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">❌ דחה</a>
    </div>` : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#0d0d1a,#1a2240);padding:28px 32px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:#f0ebe0;letter-spacing:1px">Sera<span style="color:#c8a84b">nova</span></div>
      <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,75,.6);margin-top:4px">Admin Notification</div>
    </div>
    <div style="padding:28px 32px">
      <h2 style="margin:0 0 20px;font-size:17px;color:#1a1a2e">${title}</h2>
      <table style="width:100%;border-collapse:collapse;background:#f9f9fb;border-radius:10px;overflow:hidden">
        ${rowsHtml}
      </table>
      ${actionsHtml}
    </div>
    <div style="background:#f9f9fb;padding:16px 32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee">
      Seranova · Travel, Refined by Intelligence · seranova.world
    </div>
  </div>
</body>
</html>`;
}
