"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Activity, CalendarCheck2, Check, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { apiPost, downloadJson } from "@/lib/client";
import type { Course, RosterRow } from "@/lib/model";

type RosterWorkbookReview = {
  fileName: string;
  parsed: { courses: { courseCode: string; sheetName: string; rows: RosterRow[] }[] };
  review: { courses: { courseId: string; courseCode: string; added: number; updated: number; total: number; retained: number }[]; conflicts: { courseCode: string; message: string }[] };
};

async function sendRosterWorkbook(file: File, mode: "preview" | "import") {
  const form = new FormData(); form.append("file", file); form.append("mode", mode);
  const response = await fetch("/api/registro/roster-workbook", { method: "POST", body: form, cache: "no-store" });
  const result = await response.json() as { data?: RosterWorkbookReview | { fileName: string; result: { students: number; courses: { courseCode: string; added: number; updated: number; total: number; retained: number }[] } }; error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
  return result.data;
}

export function RosterWorkbookImportPanel({ courses, onChange }: { courses: Course[]; onChange: () => void }) {
  const fileId = useId();
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RosterWorkbookReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function analyze() {
    if (!file) { setError("Selecciona el libro Excel de Matemática."); return; }
    if (file.size > 25 * 1024 * 1024) { setError("El libro supera el límite de 25 MB."); return; }
    setBusy(true); setError(""); setSuccess(""); setPreview(null);
    try { setPreview(await sendRosterWorkbook(file, "preview") as RosterWorkbookReview); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo leer el libro."); }
    finally { setBusy(false); }
  }

  async function importAll() {
    if (!file || !preview || preview.review.conflicts.length) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await sendRosterWorkbook(file, "import") as { fileName: string; result: { students: number; courses: { courseCode: string; added: number; updated: number; total: number; retained: number }[] } };
      setSuccess(`Se guardaron ${result.result.students} estudiantes en ${result.result.courses.length} cursos. La operación fue atómica; ningún registro anterior se eliminó.`);
      setPreview(null); setFile(null); setImportOpen(false); onChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la nómina. No se aplicó una parte del lote."); }
    finally { setBusy(false); }
  }

  const listedCodes = courses.map(course => course.code.toLocaleUpperCase()).sort();
  const workbookCodes = preview?.parsed.courses.map(course => course.courseCode).sort() ?? [];
  const courseMismatch = preview && JSON.stringify(listedCodes) !== JSON.stringify(workbookCodes);
  const canImport = Boolean(preview && !courseMismatch && !preview.review.conflicts.length && preview.parsed.courses.length === courses.length);

  const studentCount = courses.reduce((sum, course) => sum + course.students.length, 0);
  const incompleteCount = courses.filter(course => course.students.length === 0).length;

  return <details className="panel roster-workbook-import" open={importOpen} onToggle={event => setImportOpen(event.currentTarget.open)}>
    <summary className="roster-workbook-summary"><div><p className="eyebrow">ADMINISTRAR NÓMINAS</p><h2><FileSpreadsheet size={18}/> Importar o actualizar listas</h2><p>{courses.length} cursos · {studentCount} estudiantes cargados{incompleteCount ? ` · ${incompleteCount} listas pendientes` : ''}</p></div><span className="button secondary">{importOpen ? 'Cerrar' : 'Importar listas'}</span></summary>
    <div className="roster-workbook-body"><p className="muted roster-workbook-note">Lee las pestañas de cada curso y guarda las listas juntas en una sola operación. El libro original no se modifica y sus macros no se ejecutan.</p>
    <div className="roster-workbook-controls"><label htmlFor={fileId}>Libro Excel (.xlsx o .xlsm)<input id={fileId} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(""); setSuccess(""); }}/></label><button type="button" className="button secondary" onClick={() => void analyze()} disabled={busy || !file}>{busy ? <LoaderCircle className="spin" size={16}/> : <FileSpreadsheet size={16}/>} Analizar libro</button></div>
    <p className="muted roster-workbook-note">La pestaña debe llamarse igual que el código del curso y contener encabezados de número/ID y estudiante/nombre. El número organiza la lista; la app crea una identidad interna a partir del nombre para que cambiar el orden no mueva su historial. Los alumnos no incluidos nunca se borran.</p>
    {error && <div className="notice warning" role="alert">{error}</div>}
    {success && <div className="notice success" role="status"><Check size={16}/>{success}</div>}
    {preview && <div className="roster-workbook-preview">
      <div className="table-toolbar"><div><h3>Revisión antes de guardar</h3><p className="muted">{preview.fileName} · {preview.parsed.courses.reduce((sum, course) => sum + course.rows.length, 0)} estudiantes detectados</p></div><span className={'pill '+(canImport ? '' : 'provisional')}>{canImport ? 'Sin conflictos' : 'Requiere revisión'}</span></div>
      {courseMismatch && <div className="notice warning" role="alert">Los códigos de las pestañas ({workbookCodes.join(", ")}) no coinciden con los cursos de este registro ({listedCodes.join(", ")}). No se guardó nada.</div>}
      {preview.review.conflicts.length > 0 && <div className="notice warning" role="alert"><strong>No aplicaré filas que puedan mezclar identidades:</strong><ul>{preview.review.conflicts.map((conflict, index) => <li key={`${conflict.courseCode}-${index}`}>{conflict.courseCode}: {conflict.message}</li>)}</ul></div>}
      <div className="roster-workbook-course-grid">{preview.parsed.courses.map(item => {
        const stats = preview.review.courses.find(course => course.courseCode === item.courseCode);
        return <details className="roster-workbook-course" key={item.courseCode}><summary><strong>{item.courseCode}</strong><span>{item.rows.length} estudiantes</span><small>{stats ? `${stats.added} nuevas · ${stats.updated} actualizaciones · ${stats.retained} anteriores conservados` : 'Curso no encontrado'}</small></summary><div className="table-wrap"><table className="data-table"><thead><tr><th>N.º</th><th>Estudiante</th></tr></thead><tbody>{item.rows.map(row => <tr key={row.externalId}><td>{row.number}</td><td>{row.name}</td></tr>)}</tbody></table></div></details>;
      })}</div>
      <div className="toolbar roster-workbook-actions"><button type="button" className="button primary" disabled={busy || !canImport} onClick={() => void importAll()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Guardar nóminas de todos los cursos</button><button type="button" className="button secondary" disabled={busy} onClick={() => { setPreview(null); setFile(null); }}>Descartar revisión</button></div>
    </div>}
    </div>
  </details>;
}

type ParsedRoster = { rows: RosterRow[]; errors: string[] };

function parseCsv(text: string): ParsedRoster {
  let content = text.replace(/^\uFEFF/, "");
  let delimiter = ",";
  const separatorLine = content.match(/^sep=([,;\t])\r?\n/i);
  if (separatorLine) { delimiter = separatorLine[1]; content = content.slice(separatorLine[0].length); }
  else {
    let quoted = false;
    const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
    for (const char of content) {
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === "\n" || char === "\r")) break;
      if (!quoted && char in counts) counts[char]++;
    }
    delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  const records: string[][] = [];
  let record: string[] = [], field = "", inQuotes = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') { field += '"'; index++; }
      else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) { record.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[index + 1] === "\n") index++;
      record.push(field); if (record.some(value => value.trim())) records.push(record);
      record = []; field = "";
    } else field += char;
  }
  if (inQuotes) return { rows: [], errors: ["El CSV tiene una comilla abierta. Revisa los campos entre comillas."] };
  record.push(field); if (record.some(value => value.trim())) records.push(record);
  if (!records.length) return { rows: [], errors: ["El archivo está vacío."] };
  const headers = records.shift()!.map(value => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const required = ["id", "numero", "nombre"];
  if (!required.every(header => headers.includes(header)) || new Set(headers).size !== headers.length) return { rows: [], errors: ["Usa los encabezados id,numero,nombre, sin columnas repetidas."] };
  const positions = required.map(header => headers.indexOf(header));
  const errors: string[] = [];
  const rows = records.map((values, index) => {
    if (values.length !== headers.length) errors.push(`Fila ${index + 2}: el número de columnas no coincide con los encabezados.`);
    return { externalId: (values[positions[0]] ?? "").trim(), number: Number((values[positions[1]] ?? "").trim()), name: (values[positions[2]] ?? "").trim() };
  });
  if (!rows.length) errors.push("El archivo no contiene estudiantes.");
  return { rows, errors };
}

function validateRoster(rows: RosterRow[], course: Course) {
  const errors: string[] = [];
  const ids = new Set<string>(), numbers = new Set<number>();
  for (const [index, row] of rows.entries()) {
    const line = `Fila ${index + 1}`;
    if (!row.externalId || row.externalId.length > 100) errors.push(`${line}: escribe un ID de origen de 1 a 100 caracteres.`);
    if (!Number.isInteger(row.number) || row.number < 1 || row.number > 9999) errors.push(`${line}: el número de lista debe ser un entero de 1 a 9999.`);
    if (!row.name || row.name.length > 180) errors.push(`${line}: escribe un nombre de 1 a 180 caracteres.`);
    if (ids.has(row.externalId)) errors.push(`${line}: el ID de origen está repetido en el archivo.`);
    if (numbers.has(row.number)) errors.push(`${line}: el número de lista está repetido en el archivo.`);
    ids.add(row.externalId); numbers.add(row.number);
    const sameNumber = course.students.find(student => student.number === row.number && student.externalId !== row.externalId);
    if (sameNumber) errors.push(`${line}: el número ${row.number} ya pertenece a otro ID del curso. Usa el ID original o corrige el número.`);
  }
  if (rows.length > 250) errors.push("Importa como máximo 250 estudiantes a la vez.");
  return [...new Set(errors)];
}

export default function StudentPanel({ course, onChange, onOpenAttendance, onOpenBehavior }: { course: Course; onChange: () => void; onOpenAttendance: () => void; onOpenBehavior: () => void }) {
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [externalId, setExternalId] = useState("");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(course.students.length === 0);
  const courseRef = useRef(course.id); courseRef.current = course.id;
  const fileId = useId(), externalIdInput = useId(), numberInput = useId(), nameInput = useId();
  const students = useMemo(() => [...course.students].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id)), [course.students]);
  const previewErrors = useMemo(() => parsed ? [...parsed.errors, ...validateRoster(parsed.rows, course)] : [], [parsed, course]);
  const existingIds = useMemo(() => new Set(course.students.map(student => student.externalId)), [course.students]);
  const newRows = parsed?.rows.filter(row => !existingIds.has(row.externalId)).length ?? 0;

  useEffect(() => { setParsed(null); setError(""); setSuccess(""); setExternalId(""); setNumber(""); setName(""); setEditingId(null); setManageOpen(course.students.length === 0); }, [course.id]);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(""); setSuccess(""); setParsed(null);
    if (!file) return;
    if (file.size > 400_000) { setError("El CSV debe pesar menos de 400 KB."); return; }
    const requestCourse = course.id;
    try { const text = await file.text(); if (courseRef.current === requestCourse) setParsed(parseCsv(text)); }
    catch { if (courseRef.current === requestCourse) setError("No se pudo leer el CSV. Guarda el archivo como CSV UTF-8 y vuelve a intentarlo."); }
  }

  async function saveRows(rows: RosterRow[]) {
    const validation = validateRoster(rows, course);
    if (validation.length) { setError(validation.join(" ")); return; }
    const requestCourse = course.id;
    setBusy(true); setError(""); setSuccess("");
    try {
      await apiPost("roster", { courseId: requestCourse, rows });
      if (courseRef.current === requestCourse) { setSuccess(`Se guardaron ${rows.length} ${rows.length === 1 ? "estudiante" : "estudiantes"}. Se conservaron sus registros anteriores.`); setParsed(null); setExternalId(""); setNumber(""); setName(""); setEditingId(null); }
      onChange();
    } catch (cause) { if (courseRef.current === requestCourse) setError(cause instanceof Error ? cause.message : "No se pudo guardar la lista. El archivo permanece disponible para revisarlo."); }
    finally { setBusy(false); }
  }

  function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveRows([{ externalId: externalId.trim(), number: Number(number), name: name.trim() }]);
  }

  return <section aria-labelledby="students-title">
    <div className="section-heading"><div><p className="eyebrow">Lista e identidad</p><h2 id="students-title">Estudiantes de {course.code}</h2><p className="muted">{students.length} estudiantes. Esta lista alimenta los registros del curso de asistencia, comportamiento y calificaciones.</p></div><div className="toolbar"><button className="button secondary" type="button" onClick={() => downloadJson(`lista-${course.code}.json`, students.map(student => ({ id: student.externalId, numero: student.number, nombre: student.name })))}>Descargar lista</button><button className="button secondary" type="button" disabled={!students.some(student=>student.active)} onClick={onOpenAttendance}><CalendarCheck2 size={16}/> Asistencia</button><button className="button primary" type="button" disabled={!students.some(student=>student.active)} onClick={onOpenBehavior}><Activity size={16}/> Comportamiento</button></div></div>
    <div className="metrics compact student-course-summary"><div className="metric"><span>Estudiantes en la lista</span><strong>{students.length}</strong></div><div className="metric"><span>Activos</span><strong>{students.filter(student => student.active).length}</strong></div><div className="metric"><span>Inactivos</span><strong>{students.filter(student => !student.active).length}</strong></div></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {success && <div className="notice success" role="status">{success}</div>}
    <details className="panel student-management-disclosure" open={manageOpen} onToggle={event => setManageOpen(event.currentTarget.open)}>
      <summary><strong>Administrar matrícula de {course.code}</strong><span>{students.length ? 'Importar, añadir o editar estudiantes' : 'Agrega la lista para iniciar los registros'}</span></summary>
      <div className="student-management-body"><div className="panel">
      <h3>Importar o actualizar desde CSV</h3><p>Encabezados: <code>id,numero,nombre</code>. Usa el mismo ID de origen al actualizar un nombre o número de lista.</p><p className="muted">La importación añade o actualiza estudiantes. Los alumnos que no aparezcan en el CSV conservan sus datos.</p>
      <div className="field"><label htmlFor={fileId}>Archivo CSV UTF-8</label><input key={course.id} id={fileId} type="file" accept=".csv,text/csv" onChange={readFile} disabled={busy} /></div>
      {parsed && <div>
        <h4>Revisión antes de guardar</h4><p>{parsed.rows.length} filas: {newRows} para añadir y {parsed.rows.length - newRows} para actualizar.</p>
        {previewErrors.length > 0 && <div className="notice error" role="alert"><strong>Corrige estos datos antes de importar:</strong><ul>{previewErrors.slice(0, 12).map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>{previewErrors.length > 12 && <p>Hay {previewErrors.length - 12} incidencias adicionales.</p>}</div>}
        <div className="table-wrap"><table className="data-table"><caption>Vista previa del CSV para {course.code}</caption><thead><tr><th>ID de origen</th><th>Número</th><th>Nombre</th><th>Acción</th></tr></thead><tbody>{parsed.rows.slice(0, 250).map((row, index) => <tr key={`${index}-${row.externalId}`}><td>{row.externalId || "Falta ID"}</td><td>{Number.isFinite(row.number) ? row.number : "No válido"}</td><td>{row.name || "Falta nombre"}</td><td><span className="pill">{existingIds.has(row.externalId) ? "Actualizar" : "Añadir"}</span></td></tr>)}</tbody></table></div>
        <div className="toolbar"><button className="button primary" type="button" disabled={busy || previewErrors.length > 0 || parsed.rows.length === 0} onClick={() => void saveRows(parsed.rows)}>{busy ? "Guardando lista…" : `Aplicar ${parsed.rows.length} filas a ${course.code}`}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setParsed(null)}>Descartar archivo</button></div>
      </div>}
    </div>
    <div className="panel"><h3>{editingId ? "Actualizar estudiante" : "Añadir un estudiante"}</h3><form onSubmit={addStudent}><div className="form-grid">
      <div className="field"><label htmlFor={externalIdInput}>ID de origen estable</label><input id={externalIdInput} value={externalId} onChange={event => setExternalId(event.target.value)} required maxLength={100} autoComplete="off" placeholder="Ejemplo: alumno-022" disabled={busy} readOnly={editingId !== null} /></div>
      <div className="field"><label htmlFor={numberInput}>Número de lista</label><input id={numberInput} type="number" min={1} max={9999} step={1} value={number} onChange={event => setNumber(event.target.value)} required disabled={busy} /></div>
      <div className="field"><label htmlFor={nameInput}>Nombre completo</label><input id={nameInput} value={name} onChange={event => setName(event.target.value)} required maxLength={180} autoComplete="off" disabled={busy} /></div>
    </div><div className="toolbar"><button className="button primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar estudiante"}</button>{editingId && <button className="button secondary" type="button" disabled={busy} onClick={() => { setEditingId(null); setExternalId(""); setNumber(""); setName(""); }}>Cancelar edición</button>}</div></form><p className="muted">Si reutilizas un ID existente, se actualizará ese estudiante conservando su identidad y sus registros.</p></div></div>
    <div className="panel student-roster-summary"><h3>Lista actual</h3><div className="table-wrap"><table className="data-table"><caption>Estudiantes vinculados a {course.code}</caption><thead><tr><th>Número</th><th>Nombre</th><th>ID de origen</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{students.length ? students.map(student => <tr key={student.id}><td>{student.number}</td><td>{student.name}</td><td>{student.externalId}</td><td><span className="pill">{student.active ? "Activo" : "Inactivo"}</span></td><td><button type="button" className="button secondary" disabled={busy} onClick={() => { setManageOpen(true); setEditingId(student.id); setExternalId(student.externalId); setNumber(String(student.number)); setName(student.name); setError(""); setSuccess(""); document.getElementById(nameInput)?.focus(); }}>Editar</button></td></tr>) : <tr><td colSpan={5}>Todavía no hay estudiantes. Abre «Administrar matrícula» para añadirlos.</td></tr>}</tbody></table></div></div>
    </details>
  </section>;
}
