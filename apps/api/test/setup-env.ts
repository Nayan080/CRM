import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Integration tests read TEST_DATABASE_URL from the root .env locally; CI sets it directly.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
