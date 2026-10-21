// In-memory store for tests and local development. Same interface as the
// Firestore store; data is lost when the process exits.
export function createMemoryStore() {
  const students = new Map();
  const sessions = new Map();
  const users = new Map();
  const otps = new Map();
  const skills = new Map();
  let seq = 0;
  const newId = () => `m${String(++seq).padStart(6, '0')}`;
  const clone = (v) => (v == null ? null : structuredClone(v));

  return {
    kind: 'memory',

    async listStudents() {
      return [...students.values()].map(clone).sort((a, b) => a.name.localeCompare(b.name));
    },
    async getStudent(id) {
      return clone(students.get(id));
    },
    async createStudent({ name, grade }) {
      const s = { id: newId(), name, grade, mastery: {}, completed: [], answered: {}, lastSessionId: null };
      students.set(s.id, s);
      return clone(s);
    },
    async updateStudent(id, fields) {
      const s = students.get(id);
      if (!s) return null;
      Object.assign(s, fields);
      return clone(s);
    },
    async deleteStudent(id) {
      for (const [sid, session] of sessions) if (session.studentId === id) sessions.delete(sid);
      return students.delete(id);
    },
    async resetStudent(id) {
      const s = students.get(id);
      if (!s) return null;
      Object.assign(s, { mastery: {}, completed: [], answered: {} });
      return clone(s);
    },
    async markCompleted(id, activityId) {
      const s = students.get(id);
      if (s && !s.completed.includes(activityId)) s.completed.push(activityId);
    },
    async recordAnswer(id, { expectedCount, activityId, skillId, mastery }) {
      const s = students.get(id);
      if (!s || (s.answered[activityId] ?? 0) !== expectedCount) return false;
      s.answered[activityId] = expectedCount + 1;
      s.mastery[skillId] = mastery;
      return true;
    },

    async startSession(studentId, at) {
      const s = students.get(studentId);
      const prev = s.lastSessionId && sessions.get(s.lastSessionId);
      if (prev && !prev.endedAt) prev.endedAt = at;
      const session = { id: newId(), studentId, startedAt: at, endedAt: null, activeSeconds: 0, idleSeconds: 0 };
      sessions.set(session.id, session);
      s.lastSessionId = session.id;
      return clone(session);
    },
    async getSession(id) {
      return clone(sessions.get(id));
    },
    async endSession(id, at) {
      const session = sessions.get(id);
      if (session && !session.endedAt) session.endedAt = at;
      return clone(session);
    },
    async addHeartbeat(id, active, idle) {
      const session = sessions.get(id);
      session.activeSeconds += active;
      session.idleSeconds += idle;
      return clone(session);
    },
    async listSessions(studentId, limit) {
      return [...sessions.values()]
        .filter((s) => s.studentId === studentId)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(clone);
    },

    async getUser(email) {
      return clone(users.get(email));
    },
    async listUsers() {
      return [...users.values()].map(clone);
    },
    async saveUser(user) {
      users.set(user.email, clone(user));
    },
    async deleteUser(email) {
      users.delete(email);
    },

    async getOtp(email) {
      return clone(otps.get(email));
    },
    async saveOtp(email, otp) {
      otps.set(email, clone(otp));
    },
    async deleteOtp(email) {
      otps.delete(email);
    },
    async bumpOtpAttempts(email) {
      const otp = otps.get(email);
      if (otp) otp.attempts += 1;
    },

    async listSkills() {
      return [...skills.values()].map(clone).sort((a, b) => a.order - b.order);
    },
    async saveSkill(skill) {
      skills.set(skill.id, clone(skill));
    },
    async deleteSkill(id) {
      skills.delete(id);
    },
  };
}
