import { getAuth } from "@/lib/auth.mjs";

export const runtime = "nodejs";
const handle = async (req) => (await getAuth()).handler(req);
export { handle as GET, handle as POST };
