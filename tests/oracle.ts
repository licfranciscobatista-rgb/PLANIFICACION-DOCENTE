/** Independent fixture/oracle: deliberately has no imports from application code. */
export function teachingDates(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date('2026-10-20T12:00:00Z');
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function expectedRecord(day: number, student: number) {
  const statuses = ['P', 'P', 'A', 'P', 'T', 'P', 'E'] as const;
  return {
    status: statuses[(day + student) % statuses.length],
    behavior: (day * 3 + student) % 11,
    notebook: ((day + student * 2) % 5) / 2,
    comment: `Observación sintética ${day + 1}/${student + 1}`,
  };
}

export function expectedStudent(student: number, days = 30) {
  const counts = { P: 0, A: 0, T: 0, E: 0 };
  let notebook = 0;
  let behavior = 0;
  for (let day = 0; day < days; day += 1) {
    const record = expectedRecord(day, student);
    counts[record.status] += 1;
    notebook += record.notebook;
    behavior += record.behavior;
  }
  return {
    counts,
    notebookRaw: notebook,
    behaviorRaw: behavior,
    notebookPoints: notebook / (days * 2) * 20,
    behaviorPoints: behavior / (days * 10) * 15,
    sessions: days,
  };
}

export function closeTo(actual: number, expected: number, epsilon = 0.011) {
  return Math.abs(actual - expected) <= epsilon;
}
