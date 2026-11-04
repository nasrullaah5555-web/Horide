import 'reflect-metadata';
import { createApp } from './bootstrap';
import { ConfigError, loadConfig } from './config/env';

async function main(): Promise<void> {
  // Validate configuration before anything else starts.
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT, '0.0.0.0');
}

main().catch((err: unknown) => {
  // Configuration errors are expected operator mistakes: print them plainly.
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error('Failed to start Horide API:', err);
  }
  process.exit(1);
});
