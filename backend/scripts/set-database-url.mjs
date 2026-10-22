// Saves DATABASE_URL into backend/.env after checking that it really connects.
//
//   node backend/scripts/set-database-url.mjs
//
// It asks for ONLY your database password (hidden, nothing is printed). The host,
// user and database are filled in for this project's Supabase Transaction pooler.
// The password is URL-encoded for you, so symbols like @ or # are fine.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const PROJECT_REF = 'fxkdwwjjugdymniivdwy';
const HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
const PORT = 6543; // Transaction pooler
const DATABASE = 'postgres';

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => process.stdout.write(text.includes(question) ? text : '•'.repeat(Math.min(text.length, 1)));
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = (await askHidden('Database password (type it, then press Enter): ')).trim();
if (!password) {
  console.error('Nothing entered. Run the command again.');
  process.exit(1);
}
console.log(`Got ${password.length} characters.`);

const url = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${HOST}:${PORT}/${DATABASE}`;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  const { rows } = await client.query('select current_user as who, current_database() as db');
  console.log(`Connected to "${rows[0].db}" as "${rows[0].who}".`);
} catch (error) {
  // Only a fixed, safe description: the driver's message can echo parts of the input.
  const text = String(error?.message ?? '');
  console.error(
    /password authentication failed/i.test(text)
      ? 'Could not connect: the password was not accepted. Nothing was saved. Check it and run the command again.'
      : 'Could not connect to the database pooler. Nothing was saved.'
  );
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const lines = existing.split(/\r?\n/).filter((line) => line.trim() !== '' && !/^\s*DATABASE_URL\s*=/.test(line));
lines.push(`DATABASE_URL=${url}`);
fs.writeFileSync(envPath, lines.join('\n') + '\n');
console.log(`Saved to ${envPath}`);
console.log('Now tell Claude it is done.');
