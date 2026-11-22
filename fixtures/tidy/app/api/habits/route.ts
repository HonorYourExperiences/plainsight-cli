import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("user");
  const habits = await db.habit.findMany({ where: { userId } });
  return Response.json(habits);
}
