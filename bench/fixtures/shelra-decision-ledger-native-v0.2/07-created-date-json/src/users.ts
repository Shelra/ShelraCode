export interface User {
  id: string;
  displayName: string;
  createdAt: Date;
}

const USERS: readonly User[] = [
  { id: "u1", displayName: "Ada", createdAt: new Date("2026-01-05T10:00:00.000Z") },
  { id: "u2", displayName: "Grace", createdAt: new Date("2026-02-11T16:30:00.000Z") },
];

export function findUser(id: string): User | undefined {
  return USERS.find((user) => user.id === id);
}
