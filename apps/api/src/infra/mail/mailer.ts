import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/app-config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** DI token. Swap the implementation per environment (Zoho ZeptoMail adapter: later stage, DEC-02). */
export const MAILER = Symbol('MAILER');

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** SMTP — Mailpit locally (http://localhost:8025), a real SMTP relay elsewhere. */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  constructor(private readonly config: AppConfig['mail']) {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: false,
    });
  }
  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.config.from, ...message });
  }
}

/** Tests: keeps messages in memory so tests can read the links. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    return Promise.resolve();
  }
  /** Most recent message to an address. */
  lastTo(to: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}

/** Development fallback: prints the email to the console. Forbidden in production by config. */
export class LogMailer implements Mailer {
  private readonly logger = new Logger('LogMailer');
  send(message: MailMessage): Promise<void> {
    this.logger.warn(`DEV EMAIL to=${message.to} subject="${message.subject}"\n${message.text}`);
    return Promise.resolve();
  }
}

export function createMailer(config: AppConfig['mail']): Mailer {
  if (config.transport === 'smtp') return new SmtpMailer(config);
  if (config.transport === 'memory') return new MemoryMailer();
  return new LogMailer();
}
