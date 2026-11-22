const values: Record<string, string | undefined> = {
  "events.endpoint": process.env.EVENTS_ENDPOINT,
};

export const config = {
  get(key: string) {
    return values[key] ?? "";
  },
};
