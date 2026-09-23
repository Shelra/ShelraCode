export interface Activity {
  actor: string;
  action: string;
  at: Date;
}

/** One line of the activity feed. */
export function formatActivity(activity: Activity): string {
  return `${activity.actor} ${activity.action} on ${activity.at.toISOString().slice(0, 10)}`;
}
