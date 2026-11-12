import type { MailMessage } from './mailer.js';

/**
 * Plain-text emails. Links put the token in the URL fragment (#token=...), which browsers never
 * send to servers, so tokens don't end up in web server logs or Referer headers.
 */

export function verifyEmailMessage(to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: 'Verify your email address',
    text: `Hi ${name},\n\nPlease confirm your email address to finish creating your account:\n\n${link}\n\nThis link expires in 24 hours. If you didn't sign up, you can ignore this email.`,
  };
}

export function accountExistsMessage(
  to: string,
  loginLink: string,
  resetLink: string,
): MailMessage {
  return {
    to,
    subject: 'Sign-up attempt for your account',
    text: `Someone tried to create an account with this email address, but you already have one.\n\nSign in: ${loginLink}\nForgot your password? ${resetLink}\n\nIf this wasn't you, no action is needed.`,
  };
}

export function passwordResetMessage(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Reset your password',
    text: `We received a request to reset your password:\n\n${link}\n\nThis link expires in 30 minutes and works once. Resetting signs you out everywhere. If you didn't ask for this, ignore this email.`,
  };
}

export function invitationMessage(
  to: string,
  tenantName: string,
  inviterName: string,
  kind: 'STAFF' | 'EXTERNAL',
  link: string,
): MailMessage {
  const access =
    kind === 'EXTERNAL'
      ? 'as an external collaborator. You will only see items the agency explicitly shares with you.'
      : 'as a team member.';
  return {
    to,
    subject: `${inviterName} invited you to ${tenantName}`,
    text: `${inviterName} invited you to join ${tenantName} on Migration CRM ${access}\n\nAccept the invitation:\n\n${link}\n\nThis invitation expires in 7 days.`,
  };
}

export function deadlineReminderMessage(
  to: string,
  name: string,
  d: {
    tenantName: string;
    matterRef: string;
    matterTitle: string;
    deadline: string;
    dueAt: string;
    link: string;
  },
): MailMessage {
  return {
    to,
    subject: `Reminder: ${d.deadline} (${d.matterRef})`,
    text: `Hi ${name},\n\nA deadline on a matter you are assigned to in ${d.tenantName} is coming up:\n\n${d.matterRef} · ${d.matterTitle}\n${d.deadline}\nDue: ${d.dueAt}\n\nOpen the matter: ${d.link}\n`,
  };
}

export function deadlineRuleReminderMessage(
  to: string,
  name: string,
  d: {
    tenantName: string;
    matterRef: string;
    matterTitle: string;
    deadline: string;
    dueAt: string;
    daysLeft: number;
    link: string;
  },
): MailMessage {
  const when = d.daysLeft <= 1 ? 'within a day' : `in ${d.daysLeft} days`;
  return {
    to,
    subject: `Due ${when}: ${d.deadline} (${d.matterRef})`,
    text: `Hi ${name},\n\nA deadline on a matter you are assigned to in ${d.tenantName} is due ${when}:\n\n${d.matterRef} · ${d.matterTitle}\n${d.deadline}\nDue: ${d.dueAt}\n\nOpen the matter: ${d.link}\n\nYour agency set up this automatic reminder.\n`,
  };
}

export function leadFollowUpMessage(
  to: string,
  name: string,
  d: { tenantName: string; leadName: string; days: number; link: string },
): MailMessage {
  return {
    to,
    subject: `Follow up: ${d.leadName}`,
    text: `Hi ${name},\n\nThe lead ${d.leadName} in ${d.tenantName} has had no recorded activity for ${d.days} days.\n\nOpen the lead: ${d.link}\n\nYour agency set up this automatic reminder.\n`,
  };
}
