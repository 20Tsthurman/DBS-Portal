import { escapeHtml } from "@/lib/escapeHtml";

interface MessageEmailParams {
  recipientName: string;
  senderName: string;
  portalUrl: string;
}

export function buildShell(opts: {
  headline: string;
  bodyParagraph: string;
  portalUrl: string;
  recipientName: string;
  titleTag: string;
  showEyebrow?: boolean;
  showGreeting?: boolean;
  showButton?: boolean;
  extraBodyHtml?: string;
}): string {
  const safeRecipient = escapeHtml(opts.recipientName);
  const safeHeadline = escapeHtml(opts.headline);
  const safeBody = opts.bodyParagraph;
  const safeUrl = escapeHtml(opts.portalUrl);
  const safeTitle = escapeHtml(opts.titleTag);
  const showEyebrow = opts.showEyebrow ?? true;
  const showGreeting = opts.showGreeting ?? true;
  const showButton = opts.showButton ?? true;

  const eyebrowHtml = showEyebrow
    ? `<p style="margin:0 0 6px;color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;">Client Portal</p>`
    : "";
  const greetingHtml = showGreeting
    ? `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:#7A8B7C;font-family:'DM Sans',Arial,sans-serif;">Hi ${safeRecipient},</p>`
    : "";
  // When the greeting is suppressed, the body paragraph becomes the
  // first element after the headline — drop its top margin so it
  // doesn't gap awkwardly against the h2.
  const bodyTopMargin = showGreeting ? "16px" : "0";
  const bodyBottomMargin = showButton ? "24px" : "0";
  const buttonHtml = showButton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;">
                  <tr>
                    <td align="center" style="background-color:#A8788A;">
                      <a href="${safeUrl}" style="display:inline-block;background-color:#A8788A;color:#FFFFFF;text-decoration:none;padding:14px 28px;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;">Open Portal</a>
                    </td>
                  </tr>
                </table>`
    : "";
  const extraBodyHtml = opts.extraBodyHtml ?? "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle} — Digital Bloom Socials</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background-color:#E8E4D8;font-family:'DM Sans',Arial,sans-serif;color:#1A2B1C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E8E4D8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border:1px solid #D8D4C8;">
            <tr>
              <td style="background-color:#1B3827;padding:28px 40px;">
                ${eyebrowHtml}
                <h1 style="margin:0;font-family:'Playfair Display',Georgia,'Times New Roman',serif;color:#FFFFFF;font-size:22px;font-weight:500;line-height:1.2;">Digital Bloom Socials</h1>
              </td>
            </tr>
            <tr>
              <td style="background-color:#F2EDE4;padding:40px;">
                <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;color:#1B3827;font-size:24px;font-weight:500;line-height:1.3;">${safeHeadline}</h2>
                ${greetingHtml}
                <p style="margin:${bodyTopMargin} 0 ${bodyBottomMargin};font-size:15px;line-height:1.6;color:#4B5C4E;font-family:'DM Sans',Arial,sans-serif;">${safeBody}</p>
                ${extraBodyHtml}
                ${buttonHtml}
              </td>
            </tr>
            <tr>
              <td style="background-color:#132A1C;padding:24px 40px;">
                <p style="margin:0 0 8px;color:#FFFFFF;font-size:14px;font-weight:500;font-family:'Playfair Display',Georgia,'Times New Roman',serif;">Digital Bloom Socials</p>
                <p style="margin:0;color:rgba(255,255,255,0.55);font-size:11px;line-height:1.5;font-family:'DM Sans',Arial,sans-serif;">Franklin, TN · <a href="mailto:digitalbloomsocials@gmail.com" style="color:rgba(255,255,255,0.75);text-decoration:underline;">digitalbloomsocials@gmail.com</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildNewMessageEmailHtml(params: MessageEmailParams): string {
  const safeSender = escapeHtml(params.senderName);
  return buildShell({
    titleTag: "You have a new message",
    headline: "You have a new message",
    bodyParagraph: `${safeSender} sent you a new message in your portal. Open the portal to read and reply.`,
    portalUrl: params.portalUrl,
    recipientName: params.recipientName,
  });
}

export function buildUnreadReminderEmailHtml(
  params: MessageEmailParams
): string {
  const safeSender = escapeHtml(params.senderName);
  return buildShell({
    titleTag: "You have unread messages",
    headline: "You have unread messages",
    bodyParagraph: `You still have unread messages from ${safeSender} in your portal.`,
    portalUrl: params.portalUrl,
    recipientName: params.recipientName,
  });
}
