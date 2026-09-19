export interface ActivationEmailData {
  staffName: string;
  staffId: string | null;
  role: string;
  hospitalName: string;
  loginEmail: string;
  activationLink: string;
  supportContact: string;
}

export const ACTIVATION_EMAIL_SUBJECT = 'Your Hospital Management System Account Has Been Created';

export function activationEmailBody(data: ActivationEmailData): { html: string; text: string } {
  const text = [
    `Hello ${data.staffName},`,
    '',
    `An account has been created for you at ${data.hospitalName}.`,
    '',
    `Staff ID: ${data.staffId ?? 'N/A'}`,
    `Role: ${data.role}`,
    `Login email: ${data.loginEmail}`,
    '',
    'To activate your account and choose your own password, open this link:',
    data.activationLink,
    '',
    'This link expires in 24 hours and can only be used once.',
    '',
    `Support: ${data.supportContact}`,
    '',
    'Security warning: do not share this link with anyone. If you did not expect this email, contact your administrator immediately.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
      <h2>Your Hospital Management System Account Has Been Created</h2>
      <p>Hello <strong>${escapeHtml(data.staffName)}</strong>,</p>
      <p>An account has been created for you at <strong>${escapeHtml(data.hospitalName)}</strong>.</p>
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 4px 12px 4px 0; color: #555;">Staff ID</td><td><strong>${escapeHtml(data.staffId ?? 'N/A')}</strong></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #555;">Role</td><td><strong>${escapeHtml(data.role)}</strong></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #555;">Login email</td><td><strong>${escapeHtml(data.loginEmail)}</strong></td></tr>
      </table>
      <p>
        <a href="${data.activationLink}" style="display:inline-block;padding:10px 20px;background:#0B2545;color:#fff;text-decoration:none;border-radius:6px;">
          Activate My Account
        </a>
      </p>
      <p style="color: #b45309;"><strong>This link expires in 24 hours and can only be used once.</strong></p>
      <p style="font-size: 12px; color: #888;">Support: ${escapeHtml(data.supportContact)}</p>
      <p style="font-size: 12px; color: #c0392b;">
        Security warning: do not share this link with anyone. If you did not expect this email, contact your administrator immediately.
      </p>
    </div>
  `;

  return { html, text };
}

export interface TempPasswordEmailData {
  staffName: string;
  loginEmail: string;
  temporaryPassword: string;
}

export const TEMP_PASSWORD_EMAIL_SUBJECT = 'Your Temporary Hospital Management System Password';

export function tempPasswordEmailBody(data: TempPasswordEmailData): { html: string; text: string } {
  const text = [
    `Hello ${data.staffName},`,
    '',
    `Your temporary password for ${data.loginEmail} is: ${data.temporaryPassword}`,
    '',
    'You must change this password immediately after logging in. It will stop working after 24 hours if unused.',
    '',
    'Do not share this password with anyone.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
      <h2>Your Temporary Password</h2>
      <p>Hello <strong>${escapeHtml(data.staffName)}</strong>,</p>
      <p>Your temporary password for <strong>${escapeHtml(data.loginEmail)}</strong> is:</p>
      <p style="font-family: monospace; font-size: 18px; background: #f3f4f6; padding: 10px 14px; border-radius: 6px; display: inline-block;">
        ${escapeHtml(data.temporaryPassword)}
      </p>
      <p style="color: #b45309;"><strong>You must change this password immediately after logging in.</strong> It expires in 24 hours if unused.</p>
      <p style="font-size: 12px; color: #c0392b;">Do not share this password with anyone.</p>
    </div>
  `;

  return { html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
