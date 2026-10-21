import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

function codeEmail(code) {
  return {
    subject: `Your TimeBack sign-in code: ${code}`,
    text: [
      `Your TimeBack sign-in code is ${code}`,
      '',
      'It expires in 10 minutes. If you did not try to sign in, you can ignore this email.',
    ].join('\n'),
  };
}

export function createSesMailer({ region, accessKeyId, secretAccessKey, from }) {
  const client = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  return {
    async sendCode(to, code) {
      const { subject, text } = codeEmail(code);
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
        }),
      );
    },
  };
}

// Local development: print the code instead of sending it.
export function createConsoleMailer() {
  return {
    async sendCode(to, code) {
      console.log(`[dev] sign-in code for ${to}: ${code}`);
    },
  };
}

// Deployed without email settings: fail loudly rather than pretend to send.
export function createMissingMailer(missing) {
  return {
    async sendCode() {
      throw new Error(`email is not configured; set ${missing.join(', ')}`);
    },
  };
}
