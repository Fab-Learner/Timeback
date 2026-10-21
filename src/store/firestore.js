import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Firestore layout:
//   students/{id}            name, grade, mastery{}, completed[], answered{}, lastSessionId
//   students/{id}/answers/*  one document per quiz answer (history)
//   sessions/{id}            studentId, startedAt, endedAt, activeSeconds, idleSeconds
//   users/{email}            email, name, role ('admin' | 'guide')
//   otps/{email}             hashed sign-in code and its limits
//   skills/{id}              name, subject, order, prereqs[], activities[]
//
// The server uses the Admin SDK, which bypasses Firestore security rules, so the
// database can stay in production mode with all client access denied.

const NOT_FOUND = 5;
const BATCH_LIMIT = 400;

export function createFirestoreStore({ serviceAccount, projectId, appName = 'timeback' } = {}) {
  const app = initializeApp(
    serviceAccount ? { credential: cert(serviceAccount), projectId: serviceAccount.project_id } : { projectId },
    appName,
  );
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const studentsCol = db.collection('students');
  const sessionsCol = db.collection('sessions');
  const usersCol = db.collection('users');
  const otpsCol = db.collection('otps');
  const skillsCol = db.collection('skills');

  const withId = (doc) => (doc.exists ? { id: doc.id, ...doc.data() } : null);
  const dataOf = (doc) => (doc.exists ? doc.data() : null);

  async function updateOrNull(ref, fields) {
    try {
      await ref.update(fields);
    } catch (err) {
      if (err.code === NOT_FOUND) return null;
      throw err;
    }
    return withId(await ref.get());
  }

  return {
    kind: 'firestore',

    async listStudents() {
      const snap = await studentsCol.get();
      return snap.docs.map(withId).sort((a, b) => a.name.localeCompare(b.name));
    },
    async getStudent(id) {
      return withId(await studentsCol.doc(id).get());
    },
    async createStudent({ name, grade }) {
      const ref = studentsCol.doc();
      const data = { name, grade, mastery: {}, completed: [], answered: {}, lastSessionId: null };
      await ref.set(data);
      return { id: ref.id, ...data };
    },
    async updateStudent(id, fields) {
      return updateOrNull(studentsCol.doc(id), fields);
    },
    async deleteStudent(id) {
      const ref = studentsCol.doc(id);
      if (!(await ref.get()).exists) return false;
      const sessions = await sessionsCol.where('studentId', '==', id).get();
      for (let i = 0; i < sessions.docs.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const doc of sessions.docs.slice(i, i + BATCH_LIMIT)) batch.delete(doc.ref);
        await batch.commit();
      }
      await db.recursiveDelete(ref);
      return true;
    },
    async resetStudent(id) {
      return updateOrNull(studentsCol.doc(id), { mastery: {}, completed: [], answered: {} });
    },
    async markCompleted(id, activityId) {
      await studentsCol.doc(id).update({ completed: FieldValue.arrayUnion(activityId) });
    },
    // Fails (returns false) if another answer was recorded since the caller read
    // the student, so two quick submissions cannot both count for one question.
    async recordAnswer(id, { expectedCount, activityId, skillId, mastery, log }) {
      const ref = studentsCol.doc(id);
      return db.runTransaction(async (tx) => {
        const data = dataOf(await tx.get(ref));
        if (!data || (data.answered?.[activityId] ?? 0) !== expectedCount) return false;
        tx.update(ref, {
          answered: { ...data.answered, [activityId]: expectedCount + 1 },
          mastery: { ...data.mastery, [skillId]: mastery },
        });
        tx.set(ref.collection('answers').doc(), { activityId, skillId, ...log });
        return true;
      });
    },

    async startSession(studentId, at) {
      const studentRef = studentsCol.doc(studentId);
      const sessionRef = sessionsCol.doc();
      const session = { studentId, startedAt: at, endedAt: null, activeSeconds: 0, idleSeconds: 0 };
      await db.runTransaction(async (tx) => {
        const prevId = dataOf(await tx.get(studentRef))?.lastSessionId;
        const prevRef = prevId ? sessionsCol.doc(prevId) : null;
        const prev = prevRef ? dataOf(await tx.get(prevRef)) : null;
        if (prev && !prev.endedAt) tx.update(prevRef, { endedAt: at });
        tx.set(sessionRef, session);
        tx.update(studentRef, { lastSessionId: sessionRef.id });
      });
      return { id: sessionRef.id, ...session };
    },
    async getSession(id) {
      return withId(await sessionsCol.doc(id).get());
    },
    async endSession(id, at) {
      const ref = sessionsCol.doc(id);
      await db.runTransaction(async (tx) => {
        const data = dataOf(await tx.get(ref));
        if (data && !data.endedAt) tx.update(ref, { endedAt: at });
      });
      return withId(await ref.get());
    },
    async addHeartbeat(id, active, idle) {
      const ref = sessionsCol.doc(id);
      await ref.update({
        activeSeconds: FieldValue.increment(active),
        idleSeconds: FieldValue.increment(idle),
      });
      return withId(await ref.get());
    },
    async listSessions(studentId, limit) {
      const snap = await sessionsCol.where('studentId', '==', studentId).get();
      return snap.docs
        .map(withId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    },

    async getUser(email) {
      return dataOf(await usersCol.doc(email).get());
    },
    async listUsers() {
      return (await usersCol.get()).docs.map((d) => d.data());
    },
    async saveUser(user) {
      await usersCol.doc(user.email).set(user);
    },
    async deleteUser(email) {
      await usersCol.doc(email).delete();
    },

    async getOtp(email) {
      return dataOf(await otpsCol.doc(email).get());
    },
    async saveOtp(email, otp) {
      await otpsCol.doc(email).set(otp);
    },
    async deleteOtp(email) {
      await otpsCol.doc(email).delete();
    },
    async bumpOtpAttempts(email) {
      await otpsCol.doc(email).update({ attempts: FieldValue.increment(1) });
    },

    async listSkills() {
      const snap = await skillsCol.get();
      return snap.docs.map(withId).sort((a, b) => a.order - b.order);
    },
    async saveSkill(skill) {
      const { id, ...data } = skill;
      await skillsCol.doc(id).set(data);
    },
    async deleteSkill(id) {
      await skillsCol.doc(id).delete();
    },
  };
}
