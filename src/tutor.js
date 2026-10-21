// AI coaching for quiz answers. With ANTHROPIC_API_KEY set, a model writes a
// short hint; without it (or if the call fails) a template hint is used, so the
// app works offline.
const API_URL = 'https://api.anthropic.com/v1/messages';
const SYSTEM = [
  'You are a patient tutor for K-12 students.',
  'Give one short hint, at most two sentences, that helps the student reason toward the answer.',
  'Never state the correct choice or its letter. Use plain, encouraging language.',
].join(' ');

export function createTutor({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.TUTOR_MODEL ?? 'claude-haiku-5-5',
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  return async function coach({ skill, question, choice, correct }) {
    if (correct) return `Correct. ${skill.name} is coming along.`;

    const fallback = `Not quite. ${question.hint ?? 'Re-read the question and compare each choice to it.'}`;
    if (!apiKey) return fallback;

    try {
      const res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 150,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                `Skill: ${skill.name}`,
                `Question: ${question.prompt}`,
                `Choices: ${question.choices.map((c, i) => `${i}. ${c}`).join('; ')}`,
                `Student chose: ${question.choices[choice]}`,
                `Correct answer (do not reveal): ${question.choices[question.answer]}`,
                'Write the hint.',
              ].join('\n'),
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return fallback;
      const data = await res.json();
      const text = data.content?.find((block) => block.type === 'text')?.text?.trim();
      return text || fallback;
    } catch {
      return fallback;
    }
  };
}
