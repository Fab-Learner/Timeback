import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillsFromSubjects } from './src/content.js';
import { createService, seedSkills } from './src/service.js';
import { createAccounts } from './src/accounts.js';
import { createConsoleMailer, createMissingMailer, createSesMailer } from './src/mailer.js';
import { createMemoryStore } from './src/store/memory.js';
import { createFirestoreStore } from './src/store/firestore.js';
import { createTutor } from './src/tutor.js';
import { createApi } from './src/api.js';
import { createHttpServer } from './src/http.js';
import { seedDemoStudents } from './src/seed.js';
import subjects from './content/index.js';

const env = process.env;
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(env.PORT ?? 3000);
const deployed = Boolean(env.VERCEL);

function createStore() {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    return createFirestoreStore({ serviceAccount: JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) });
  }
  if (env.FIRESTORE_EMULATOR_HOST) {
    return createFirestoreStore({ projectId: env.GCLOUD_PROJECT ?? 'demo-timeback' });
  }
  console.warn('FIREBASE_SERVICE_ACCOUNT is not set: using in-memory storage. Data is lost on restart.');
  return createMemoryStore();
}

function createMailer() {
  const needed = ['SES_REGION', 'SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY', 'EMAIL_FROM'];
  const missing = needed.filter((key) => !env[key]);
  if (missing.length === 0) {
    return createSesMailer({
      region: env.SES_REGION,
      accessKeyId: env.SES_ACCESS_KEY_ID,
      secretAccessKey: env.SES_SECRET_ACCESS_KEY,
      from: env.EMAIL_FROM,
    });
  }
  if (deployed) {
    console.error(`Sign-in emails will fail: missing ${missing.join(', ')}`);
    return createMissingMailer(missing);
  }
  return createConsoleMailer();
}

function sessionSecret() {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (deployed) throw new Error('SESSION_SECRET must be set');
  console.warn('SESSION_SECRET is not set: using a random one, so sign-ins end when the server restarts.');
  return randomBytes(32).toString('base64url');
}

const adminEmails = (env.ADMIN_EMAILS ?? '').split(',').filter((e) => e.trim());
if (adminEmails.length === 0) console.warn('ADMIN_EMAILS is not set: nobody can sign in until it is.');

const store = createStore();
await seedSkills(store, skillsFromSubjects(subjects));
if (store.kind === 'memory') await seedDemoStudents(store);

const service = createService({ store, coach: createTutor() });
const accounts = createAccounts({ store, mailer: createMailer(), secret: sessionSecret(), adminEmails });

createHttpServer({
  api: createApi({ service, accounts, secureCookies: deployed }),
  publicDir: join(root, 'public'),
}).listen(port, () => {
  console.log(`TimeBack running at http://localhost:${port} (storage: ${store.kind})`);
});
