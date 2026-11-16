import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestDatabase } from '../src/lib/db';
import { RegistroService } from '../src/lib/service';

test('la demo vacía crea el espacio de trabajo sin cursos ni datos de prueba', async () => {
  const db = await createTestDatabase();
  try {
    const service = new RegistroService(db, { demo: true, seedDemoRoster: false, today: () => '2026-11-15' });
    const bootstrap = await service.bootstrap('empty-demo-teacher');

    assert.equal(bootstrap.demo, true, 'mantiene habilitado el modo de prueba local');
    assert.deepEqual(bootstrap.courses, [], 'no precarga cursos ni listas de estudiantes');
    assert.deepEqual(bootstrap.activities, [], 'no precarga actividades ni notas');
    assert.ok(bootstrap.plan, 'conserva un plan base para que el flujo pueda iniciar');
    for (const table of ['students', 'activities', 'attendance', 'grades', 'class_sessions', 'scheduled_sessions', 'evaluation_criteria']) {
      const result = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE owner_id=$1`, ['empty-demo-teacher']);
      assert.equal(Number(result.rows[0]?.count), 0, `la tabla ${table} debe iniciar vacía`);
    }
  } finally {
    await db.close();
  }
});
