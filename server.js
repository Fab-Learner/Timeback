import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { loadContent } from './src/content.js';
import { createService } from './src/service.js';
import { createTutor } from './src/tutor.js';
import { createApi } from './src/api.js';
import { createHttpServer } from './src/http.js';
import { seedDemoStudents } from './src/seed.js';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

const db = openDb(process.env.TIMEBACK_DB ?? join(root, 'data', 'timeback.db'));
const content = loadContent(join(root, 'content'));
const service = createService({ db, content, coach: createTutor() });
seedDemoStudents(service);

createHttpServer({ api: createApi(service), publicDir: join(root, 'public') }).listen(port, () => {
  console.log(`TimeBack running at http://localhost:${port}`);
});
