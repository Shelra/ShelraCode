export interface User {
  id: string;
  name: string;
}

const USERS: readonly User[] = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Grace" },
];

export function findUser(id: string): User | undefined {
  const user = USERS.find((candidate) => candidate.id === id);
  return user ? { ...user } : undefined;
}

export function listUsers(): User[] {
  return USERS.map((user) => ({ ...user }));
}
