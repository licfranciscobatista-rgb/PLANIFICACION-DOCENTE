import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CourseRegisterSummary } from "./model";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 14;
const GAP = 12;
const PANEL_WIDTH = (PAGE_WIDTH - MARGIN * 2 - GAP) / 2;
const MAX_DAYS_PER_PANEL = 21;
const ROW_COUNT = 40;
const ROW_HEIGHT = 12.2;
const HEADER_Y = 648;
const NUMBER_WIDTH = 14;
const TOTAL_WIDTH = 20;
const PERCENT_WIDTH = 24;
const DAY_WIDTH = (PANEL_WIDTH - NUMBER_WIDTH - TOTAL_WIDTH - PERCENT_WIDTH) / MAX_DAYS_PER_PANEL;

type Month = CourseRegisterSummary["months"][number];
type MonthPanel = { month: Month; segment: number; totalSegments: number };
const ink = rgb(0.12, 0.16, 0.17);
const muted = rgb(0.40, 0.45, 0.45);
const line = rgb(0.48, 0.52, 0.51);
const light = rgb(0.91, 0.93, 0.92);
const warning = rgb(0.68, 0.12, 0.12);

function fitText(value: string, font: Helvetica, size: number, width: number) {
  const normalized = value.normalize("NFC");
  if (font.widthOfTextAtSize(normalized, size) <= width) return normalized;
  let result = normalized;
  while (result.length && font.widthOfTextAtSize(result, size) > width) result = result.slice(0, -1);
  return `${result.slice(0, Math.max(0, result.length - 3))}...`;
}

// A type-only placeholder lets fitText accept both embedded Helvetica faces.
type Helvetica = Awaited<ReturnType<PDFDocument["embedFont"]>>;

function drawCentered(page: ReturnType<PDFDocument["addPage"]>, text: string, x: number, width: number, y: number, font: Helvetica, size: number, color = ink) {
  const fitted = fitText(text, font, size, width - 4);
  page.drawText(fitted, { x: x + (width - font.widthOfTextAtSize(fitted, size)) / 2, y, size, font, color });
}

function monthDays(month: Month, segment: number) {
  const start = segment * MAX_DAYS_PER_PANEL;
  return month.slots.slice(start, start + MAX_DAYS_PER_PANEL);
}

function drawPanel(
  page: ReturnType<PDFDocument["addPage"]>,
  panel: MonthPanel | undefined,
  x: number,
  regular: Helvetica,
  bold: Helvetica,
  rowOffset: number,
) {
  const month = panel?.month;
  const segment = panel?.segment ?? 0;
  const totalSegments = panel?.totalSegments ?? 1;
  const monthTitle = month ? month.label.toUpperCase() : "MES: __________________";
  const days = month ? monthDays(month, segment) : [];
  const isLastSegment = segment === totalSegments - 1;
  const tableTop = 724;
  const tableBottom = HEADER_Y - ROW_COUNT * ROW_HEIGHT - 4;
  const firstDayX = x + NUMBER_WIDTH;
  const totalX = firstDayX + DAY_WIDTH * MAX_DAYS_PER_PANEL;
  const percentX = totalX + TOTAL_WIDTH;

  page.drawText(`MES: ${monthTitle}${month && segment > 0 ? ` · CONTINUACIÓN ${segment + 1}` : ""}`, {
    x, y: 706, size: 7, font: bold, color: ink,
  });
  if (month) {
    page.drawText(`${month.taught} días trabajados · ${month.notTaught} no impartidos`, {
      x, y: 695, size: 5.3, font: regular, color: muted,
    });
  }

  // Official monthly headings: one day column per worked class, followed by T and %.
  page.drawRectangle({ x, y: 669, width: PANEL_WIDTH, height: 16, color: light });
  drawCentered(page, "DÍAS TRABAJADOS", firstDayX, DAY_WIDTH * MAX_DAYS_PER_PANEL, 674, bold, 5.8);
  page.drawText("DÍAS", { x: x + 2, y: 658, size: 5.3, font: bold, color: ink });
  for (let i = 0; i < MAX_DAYS_PER_PANEL; i++) {
    const cx = firstDayX + i * DAY_WIDTH;
    drawCentered(page, String(segment * MAX_DAYS_PER_PANEL + i + 1), cx, DAY_WIDTH, 658, bold, 5.1);
    const slot = days[i];
    if (slot) {
      const day = slot.date.slice(8, 10);
      drawCentered(page, `${day}${slot.block > 1 ? `/${slot.block}` : ""}`, cx, DAY_WIDTH, 650, regular, 4.1, muted);
    }
  }
  drawCentered(page, "T", totalX, TOTAL_WIDTH, 658, bold, 5.1);
  drawCentered(page, "%", percentX, PERCENT_WIDTH, 658, bold, 5.1);

  const dataRows = month?.rows.slice().sort((a, b) => a.student.number - b.student.number).slice(rowOffset, rowOffset + ROW_COUNT) ?? [];
  for (let i = 0; i < ROW_COUNT; i++) {
    const y = HEADER_Y - i * ROW_HEIGHT;
    const row = dataRows[i];
    const borderColor = i % 5 === 4 ? line : rgb(0.76, 0.79, 0.78);
    page.drawLine({ start: { x, y: y - 3 }, end: { x: x + PANEL_WIDTH, y: y - 3 }, thickness: 0.25, color: borderColor });
    if (row) {
      page.drawText(String(row.student.number), { x: x + 2, y, size: 5.2, font: regular, color: ink });
      for (let j = 0; j < days.length; j++) {
        const mark = row.marks[segment * MAX_DAYS_PER_PANEL + j];
        if (mark) drawCentered(page, mark, firstDayX + j * DAY_WIDTH, DAY_WIDTH, y, bold, 5.2);
      }
      if (isLastSegment && row.pending === 0 && row.attendancePercent !== null) {
        drawCentered(page, String(row.totalAttendance), totalX, TOTAL_WIDTH, y, bold, 5.1);
        drawCentered(page, `${row.attendancePercent ?? 0}%`, percentX, PERCENT_WIDTH, y, regular, 4.8);
      }
    } else {
      page.drawText(String(rowOffset + i + 1), { x: x + 2, y, size: 5.2, font: regular, color: muted });
    }
  }

  const top = 724;
  page.drawLine({ start: { x, y: top }, end: { x: x + PANEL_WIDTH, y: top }, thickness: 0.55, color: line });
  page.drawLine({ start: { x, y: tableBottom }, end: { x: x + PANEL_WIDTH, y: tableBottom }, thickness: 0.55, color: line });
  const verticals = [x, firstDayX, ...Array.from({ length: MAX_DAYS_PER_PANEL + 1 }, (_, i) => firstDayX + i * DAY_WIDTH), totalX, percentX, x + PANEL_WIDTH];
  for (const vx of new Set(verticals.map(v => Math.round(v * 100) / 100))) {
    page.drawLine({ start: { x: vx, y: tableBottom }, end: { x: vx, y: top }, thickness: 0.25, color: line });
  }
}

function drawRosterPage(document: PDFDocument, summary: CourseRegisterSummary, regular: Helvetica, bold: Helvetica, rowOffset: number, demo: boolean) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const roster = summary.rows.slice().sort((a, b) => a.student.number - b.student.number).slice(rowOffset, rowOffset + ROW_COUNT);
  drawCentered(page, "NÓMINA PARA EL REGISTRO DE ASISTENCIA", 0, PAGE_WIDTH, 755, bold, 12);
  drawCentered(page, `MATEMÁTICA · 5.º DE SECUNDARIA · CURSO ${summary.course.code} · AÑO ESCOLAR 2026-2027`, 0, PAGE_WIDTH, 738, regular, 7);
  if (demo) drawCentered(page, "MUESTRA FICTICIA · NO APTA PARA ENTREGA", 0, PAGE_WIDTH, 723, bold, 7, warning);
  page.drawText("La numeración corresponde a las filas del registro mensual que sigue.", { x: MARGIN, y: 714, size: 7, font: regular, color: muted });
  const top = 690;
  const rowHeight = 13;
  const numberWidth = 34;
  const left = 86;
  const width = PAGE_WIDTH - 2 * left;
  page.drawRectangle({ x: left, y: top - 18, width, height: 18, color: light });
  page.drawText("N.º", { x: left + 7, y: top - 13, size: 7, font: bold, color: ink });
  page.drawText("NOMBRES Y APELLIDOS", { x: left + numberWidth + 7, y: top - 13, size: 7, font: bold, color: ink });
  for (let i = 0; i < ROW_COUNT; i++) {
    const yTop = top - 18 - i * rowHeight;
    const student = roster[i]?.student;
    page.drawLine({ start: { x: left, y: yTop - rowHeight }, end: { x: left + width, y: yTop - rowHeight }, thickness: 0.3, color: line });
    page.drawLine({ start: { x: left, y: yTop }, end: { x: left, y: yTop - rowHeight }, thickness: 0.3, color: line });
    page.drawLine({ start: { x: left + numberWidth, y: yTop }, end: { x: left + numberWidth, y: yTop - rowHeight }, thickness: 0.3, color: line });
    page.drawLine({ start: { x: left + width, y: yTop }, end: { x: left + width, y: yTop - rowHeight }, thickness: 0.3, color: line });
    page.drawText(student ? String(student.number) : String(rowOffset + i + 1), { x: left + 7, y: yTop - 9, size: 6.5, font: regular, color: student ? ink : muted });
    if (student) page.drawText(fitText(student.name, regular, 6.5, width - numberWidth - 14), { x: left + numberWidth + 7, y: yTop - 9, size: 6.5, font: regular, color: ink });
  }
  drawCentered(page, `Nómina ${Math.floor(rowOffset / ROW_COUNT) + 1} · ${summary.course.code}`, 0, PAGE_WIDTH, 92, regular, 6, muted);
}

export async function buildAttendanceRegisterPdf(summary: CourseRegisterSummary, demo: boolean) {
  const months = summary.months.filter(month => month.taught > 0).sort((a, b) => a.key.localeCompare(b.key));
  if (!months.length) throw new Error("No hay sesiones impartidas para generar el registro.");
  const rosterCount = Math.max(summary.rows.length, ...months.map(month => month.rows.length));
  const rosterSegments = Math.max(1, Math.ceil(rosterCount / ROW_COUNT));
  const pagePairs: { left?: MonthPanel; right?: MonthPanel; rowOffset: number }[] = [];
  for (let rowSegment = 0; rowSegment < rosterSegments; rowSegment++) {
    const rowOffset = rowSegment * ROW_COUNT;
    const panels = months.flatMap(month => {
      const totalSegments = Math.max(1, Math.ceil(month.slots.length / MAX_DAYS_PER_PANEL));
      return Array.from({ length: totalSegments }, (_, segment) => ({ month, segment, totalSegments }));
    });
    for (let index = 0; index < panels.length; index += 2) pagePairs.push({ left: panels[index], right: panels[index + 1], rowOffset });
  }

  const document = await PDFDocument.create();
  document.setTitle(`Registro de asistencia ${summary.course.code} · Matemática · 2026-2027`);
  document.setSubject("Registro mensual de asistencia y puntualidad por curso");
  document.setCreator("Registro docente");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let rowOffset = 0; rowOffset < rosterCount; rowOffset += ROW_COUNT) drawRosterPage(document, summary, regular, bold, rowOffset, demo);

  pagePairs.forEach(({ left, right, rowOffset }, pageIndex) => {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawCentered(page, "REGISTRO DE ASISTENCIA Y PUNTUALIDAD", 0, PAGE_WIDTH, 765, bold, 11);
    drawCentered(page, `MATEMÁTICA · 5.º DE SECUNDARIA · CURSO ${summary.course.code} · AÑO ESCOLAR 2026–2027`, 0, PAGE_WIDTH, 750, regular, 7);
    page.drawText("DOCENTE: __________________________________________", { x: MARGIN, y: 732, size: 6.5, font: regular, color: ink });
    if (demo) drawCentered(page, "MUESTRA FICTICIA · NO APTA PARA ENTREGA", 0, PAGE_WIDTH, 739, bold, 7, warning);
    if (rosterSegments > 1) drawCentered(page, `ESTUDIANTES ${rowOffset + 1}-${Math.min(rowOffset + ROW_COUNT, rosterCount)}`, 0, PAGE_WIDTH, 716, bold, 6, muted);
    drawPanel(page, left, MARGIN, regular, bold, rowOffset);
    drawPanel(page, right, MARGIN + PANEL_WIDTH + GAP, regular, bold, rowOffset);
    page.drawText("P = presente · A = ausencia · T = tardanza · E = excusa · R = retiro voluntario. Tres tardanzas equivalen a una ausencia.", {
      x: MARGIN, y: 119, size: 6.2, font: regular, color: ink,
    });
    page.drawText("T = P + tardanzas - una por cada tres tardanzas; % = T / días trabajados × 100. R se excluye desde la fecha del retiro.", {
      x: MARGIN, y: 108, size: 5.9, font: regular, color: muted,
    });
    page.drawText("T y % quedan vacíos si falta registrar alguna sesión del mes.", { x: MARGIN, y: 97, size: 5.9, font: regular, color: muted });
    drawCentered(page, `${pageIndex + 1 + rosterSegments} / ${pagePairs.length + rosterSegments}`, 0, PAGE_WIDTH, 25, regular, 6, muted);
  });

  return document.save();
}
