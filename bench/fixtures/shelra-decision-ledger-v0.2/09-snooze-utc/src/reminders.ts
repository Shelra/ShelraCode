export interface Reminder {
  id: string;
  text: string;
  /** When the reminder is due, as stored. */
  dueAt: string;
  /** When the reminder was last snoozed, as stored. */
  snoozedAt?: string;
}

/** A reminder due at the given time. */
export function createReminder(id: string, text: string, due: Date): Reminder {
  return { id, text, dueAt: due.toISOString() };
}
