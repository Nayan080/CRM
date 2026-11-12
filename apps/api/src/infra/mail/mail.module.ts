import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { MAILER, createMailer } from './mailer.js';

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createMailer(config.mail),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
