"use client";
import { useEffect, useState } from "react";

type Habit = { id: string; name: string; checks: string[] };

export function HabitList() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const userId = typeof window !== "undefined" ? localStorage.getItem("uid") : null;

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/habits?user=${userId}`);
      setHabits(await res.json());
    })();
  }, [userId]);

  async function check(habit: Habit) {
    await fetch(`/api/habits/${habit.id}/check`, { method: "POST" });
  }

  return (
    <ul>
      {habits.map((h) => (
        <li key={h.id} onClick={() => check(h)}>{h.name}</li>
      ))}
    </ul>
  );
}
