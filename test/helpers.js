import { skillsFromSubjects } from '../src/content.js';
import { createService, seedSkills } from '../src/service.js';
import { createAccounts } from '../src/accounts.js';
import { createMemoryStore } from '../src/store/memory.js';
import subjects from '../content/index.js';

export const bundledSkills = skillsFromSubjects(subjects);
export const quizOf = (skillId) => bundledSkills.find((s) => s.id === skillId).activities.find((a) => a.type === 'quiz');

// Captures sign-in codes instead of emailing them.
export function createInbox() {
  const sent = [];
  return {
    sent,
    mailer: { sendCode: async (to, code) => sent.push({ to, code }) },
    lastCodeFor: (to) => sent.filter((m) => m.to === to).at(-1)?.code,
  };
}

export async function setup({ store = createMemoryStore(), adminEmails = ['admin@school.test'], clock } = {}) {
  await seedSkills(store, bundledSkills);
  const inbox = createInbox();
  const service = createService({
    store,
    clock,
    coach: async ({ correct }) => (correct ? 'Nice' : 'Try again'),
  });
  const accounts = createAccounts({ store, mailer: inbox.mailer, secret: 'test-secret', adminEmails, clock, log: () => {} });
  return { store, service, accounts, inbox };
}
