// Demo students for local development with in-memory storage.
const DEMO_STUDENTS = [
  { name: 'Ava Martinez', grade: 4 },
  { name: 'Noah Brooks', grade: 4 },
  { name: 'Mia Chen', grade: 5 },
];

export async function seedDemoStudents(store) {
  if ((await store.listStudents()).length > 0) return;
  for (const student of DEMO_STUDENTS) await store.createStudent(student);
}
