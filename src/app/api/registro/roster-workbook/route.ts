import { NextRequest, NextResponse } from 'next/server';
import { AccessError, demoMode, requireOwner } from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { AppError } from '@/lib/model';
import { parseRosterWorkbook } from '@/lib/roster-import';
import { RegistroService } from '@/lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const maxWorkbookBytes = 25 * 1024 * 1024;

function fail(error: unknown) {
  if (error instanceof AccessError || error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error('Registro: fallo al importar una nómina', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({ error: 'No se pudo analizar el libro. El archivo original permanece intacto.' }, { status: 500, headers });
}

function serviceOptions() {
  return { demo: demoMode, ...(demoMode && process.env.DEMO_TODAY ? { today: () => process.env.DEMO_TODAY! } : {}), ...(demoMode && process.env.DEMO_NOTE ? { demoNote: process.env.DEMO_NOTE } : {}) };
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireOwner();
    const origin = request.headers.get('origin');
    const expected = new URL(process.env.APP_URL || request.url).origin;
    if (!origin || origin !== expected) throw new AccessError(403, 'Origen de la solicitud no permitido.');
    const form = await request.formData();
    const file = form.get('file');
    const mode = form.get('mode');
    if (!(file instanceof File)) throw new AppError(400, 'Selecciona un libro de Excel para analizar.');
    if (file.size > maxWorkbookBytes) throw new AppError(413, 'El libro supera el límite de 25 MB.');
    if (mode !== 'preview' && mode !== 'import') throw new AppError(400, 'Selecciona analizar o importar la nómina.');

    const service = new RegistroService(await getDatabase(), serviceOptions());
    const bootstrap = await service.bootstrap(owner);
    if (!bootstrap.courses.length) throw new AppError(409, 'Primero crea los cursos que recibirán la nómina.');
    let parsed;
    try { parsed = await parseRosterWorkbook(new Uint8Array(await file.arrayBuffer()), bootstrap.courses.map(course => course.code)); }
    catch (error) { throw new AppError(400, error instanceof Error ? error.message : 'El libro no contiene listas válidas.'); }

    const batches = parsed.courses.map(item => ({ courseId: bootstrap.courses.find(course => course.code.toLocaleUpperCase() === item.courseCode)!.id, rows: item.rows }));
    if (mode === 'preview') {
      const review = await service.previewRosterImport(owner, batches);
      return NextResponse.json({ data: { fileName: file.name, parsed, review } }, { headers });
    }
    const result = await service.importRosters(owner, batches);
    return NextResponse.json({ data: { fileName: file.name, result } }, { headers });
  } catch (error) { return fail(error); }
}
