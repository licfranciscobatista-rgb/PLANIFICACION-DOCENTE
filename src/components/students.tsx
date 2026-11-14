"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { apiPost, downloadJson } from "@/lib/client";
import type { Course, RosterRow } from "@/lib/model";

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

export default function StudentPanel({ course, onChange }: { course: Course; onChange: () => void }) {
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [externalId, setExternalId] = useState("");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const courseRef = useRef(course.id); courseRef.current = course.id;
  const fileId = useId(), externalIdInput = useId(), numberInput = useId(), nameInput = useId();
  const students = useMemo(() => [...course.students].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id)), [course.students]);
  const previewErrors = useMemo(() => parsed ? [...parsed.errors, ...validateRoster(parsed.rows, course)] : [], [parsed, course]);
  const existingIds = useMemo(() => new Set(course.students.map(student => student.externalId)), [course.students]);
  const newRows = parsed?.rows.filter(row => !existingIds.has(row.externalId)).length ?? 0;

  useEffect(() => { setParsed(null); setError(""); setSuccess(""); setExternalId(""); setNumber(""); setName(""); setEditingId(null); }, [course.id]);

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
    <div className="section-heading"><div><p className="eyebrow">Lista e identidad</p><h2 id="students-title">Estudiantes de {course.code}</h2><p className="muted">{students.length} estudiantes. Cada ID mantiene vinculadas sus asistencias y sus notas.</p></div><button className="button secondary" type="button" onClick={() => downloadJson(`lista-${course.code}.json`, students.map(student => ({ id: student.externalId, numero: student.number, nombre: student.name })))}>Descargar lista</button></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {success && <div className="notice success" role="status">{success}</div>}
    <div className="panel">
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
    </div><div className="toolbar"><button className="button primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar estudiante"}</button>{editingId && <button className="button secondary" type="button" disabled={busy} onClick={() => { setEditingId(null); setExternalId(""); setNumber(""); setName(""); }}>Cancelar edición</button>}</div></form><p className="muted">Si reutilizas un ID existente, se actualizará ese estudiante conservando su identidad y sus registros.</p></div>
    <div className="panel"><h3>Lista actual</h3><div className="table-wrap"><table className="data-table"><caption>Estudiantes vinculados a {course.code}</caption><thead><tr><th>Número</th><th>Nombre</th><th>ID de origen</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{students.length ? students.map(student => <tr key={student.id}><td>{student.number}</td><td>{student.name}</td><td>{student.externalId}</td><td><span className="pill">{student.active ? "Activo" : "Inactivo"}</span></td><td><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditingId(student.id); setExternalId(student.externalId); setNumber(String(student.number)); setName(student.name); setError(""); setSuccess(""); document.getElementById(nameInput)?.focus(); }}>Editar</button></td></tr>) : <tr><td colSpan={5}>Todavía no hay estudiantes. Importa la lista o añade el primero.</td></tr>}</tbody></table></div></div>
  </section>;
}
