import { config } from './config.js';
import { buildApp } from './app.js';
import { closeDb } from './lib/db.js';

const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Finish in-flight payments before exiting on a deploy or restart.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(closeDb).finally(() => process.exit(0));
  });
}
