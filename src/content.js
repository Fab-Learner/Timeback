import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Each file in the content directory is one subject with a list of skills.
// Skills list their prerequisites and their activities (lessons and a quiz).
export function loadContent(dir) {
  const skills = [];
  const skillMap = new Map();
  const activities = new Map();

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const subject = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const skill of subject.skills) {
      if (skillMap.has(skill.id)) throw new Error(`duplicate skill ${skill.id}`);
      const entry = {
        id: skill.id,
        name: skill.name,
        subject: subject.subject,
        prereqs: skill.prereqs ?? [],
        activities: skill.activities.map((a) => ({ ...a, skillId: skill.id })),
      };
      if (!entry.activities.some((a) => a.type === 'quiz')) {
        throw new Error(`skill ${skill.id} needs a quiz`);
      }
      for (const activity of entry.activities) {
        if (activities.has(activity.id)) throw new Error(`duplicate activity ${activity.id}`);
        activities.set(activity.id, activity);
        for (const q of activity.questions ?? []) {
          if (!Number.isInteger(q.answer) || q.answer >= q.choices.length) {
            throw new Error(`question ${q.id} has an invalid answer index`);
          }
        }
      }
      skills.push(entry);
      skillMap.set(entry.id, entry);
    }
  }

  for (const skill of skills) {
    for (const prereq of skill.prereqs) {
      if (!skillMap.has(prereq)) throw new Error(`${skill.id} has unknown prereq ${prereq}`);
    }
  }

  return { skills, skillMap, activities };
}
