import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { ConfigValidationError, parseConfig } from './config/app-config.js';

/** Local dev convenience: load the root .env. Real environment variables always win. */
function loadLocalEnvFile(): void {
  if (process.env.NODE_ENV === 'production') return;
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url)); // dist/main.js -> repo root
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

async function bootstrap(): Promise<void> {
  loadLocalEnvFile();

  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      // The logger is not available yet; write directly and stop.
      process.stderr.write(`\n${error.message}\n\nThe API will not start. Check your .env file.\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app, config);

  await app.listen(config.port);
  app.get(Logger).log(`API listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
