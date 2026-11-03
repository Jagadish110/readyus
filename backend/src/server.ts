import { config } from './config.js';
import { buildApp } from './app.js';
import { closeDb } from './lib/db.js';
import { startPushWorker } from './lib/push.js';
import { startJobWorker } from './lib/jobs.js';

const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Sends browser alerts a few seconds after they are written. Does nothing until VAPID keys are set.
const stopPushWorker = startPushWorker(app.log);
// Expires orders nobody accepted or paid, sends refunds and billing reminders. No outside scheduler needed.
const stopJobWorker = startJobWorker(app.log);

// Finish in-flight payments before exiting on a deploy or restart.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopPushWorker();
    stopJobWorker();
    app.close().then(closeDb).finally(() => process.exit(0));
  });
}
