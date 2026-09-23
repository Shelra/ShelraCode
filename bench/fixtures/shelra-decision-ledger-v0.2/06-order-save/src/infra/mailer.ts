export interface Mail {
  to: string;
  subject: string;
  body: string;
}

const outbox: Mail[] = [];

export function sendMail(mail: Mail): void {
  outbox.push({ ...mail });
}

export function sentMails(): Mail[] {
  return outbox.map((mail) => ({ ...mail }));
}

export function clearOutbox(): void {
  outbox.length = 0;
}
