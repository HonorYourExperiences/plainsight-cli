import { getServerSession } from "next-auth";

export async function currentUser() {
  const session = await getServerSession();
  return session?.user as { id: number } | undefined;
}

export function withUser<T>(action: (data: FormData, user: { id: number }) => Promise<T>) {
  return async (data: FormData) => {
    const user = await currentUser();
    if (!user) throw new Error("Not logged in");
    return action(data, user);
  };
}
