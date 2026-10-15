import "server-only";

/** Send through Resend. Without RESEND_API_KEY (local development) the message is printed to the server log instead. */
export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || key.includes("...")) {
    if (process.env.NODE_ENV !== "production") console.log(`[admin mail] to ${msg.to}: ${msg.subject}\n${msg.text}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) console.error("[admin mail] Resend rejected the message:", res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error("[admin mail] failed:", (e as Error).message);
    return false;
  }
}
