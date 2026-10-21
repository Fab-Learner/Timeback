// Demo students so a fresh install has something to click through.
// Set TIMEBACK_SEED=0 to skip. Only runs when the students table is empty.
const DEMO_STUDENTS = [
  { name: 'Ava Martinez', grade: 4 },
  { name: 'Noah Brooks', grade: 4 },
  { name: 'Mia Chen', grade: 5 },
];

export function seedDemoStudents(service) {
  if (process.env.TIMEBACK_SEED === '0') return;
  if (service.listStudents().length > 0) return;
  for (const student of DEMO_STUDENTS) service.createStudent(student);
}
