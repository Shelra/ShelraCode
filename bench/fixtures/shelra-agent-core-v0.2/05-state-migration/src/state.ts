export interface StoredState {
  version: number;
  [key: string]: unknown;
}

export function migrateState(input: unknown): StoredState {
  const state = input as StoredState;
  if (state.version === 1) {
    return {
      ...state,
      version: 2,
      profile: { name: state.userName },
    };
  }
  if (state.version === 2) return state;
  throw new Error("unsupported state version");
}
