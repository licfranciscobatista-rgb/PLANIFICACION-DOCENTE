import { NextRequest, NextResponse } from 'next/server';
import { AccessError, demoMode, requireOwner } from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { RegistroService } from '@/lib/service';
import { buildAttendanceRegisterPdf } from '@/lib/attendance-pdf';
import { AppError, ActivityInput, AttendanceInput, DailyAssessmentInput, GradesInput, RosterRow, SharedActivityInput } from '@/lib/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function serviceOptions(){
  const simulatedToday=demoMode?process.env.DEMO_TODAY:undefined;
  const demoNote=demoMode?process.env.DEMO_NOTE:undefined;
  const seedDemoRoster=demoMode&&process.env.DEMO_SEED_ROSTER!=='false';
  return {demo:demoMode,...(demoMode?{seedDemoRoster}:{}),...(simulatedToday?{today:()=>simulatedToday}:{}),...(demoNote?{demoNote}:{})};
}
function fail(e:unknown) {
  if(e instanceof AccessError || e instanceof AppError) return NextResponse.json({error:e.message},{status:e.status,headers});
  console.error('Registro: fallo interno', e instanceof Error ? e.name : 'unknown');
  return NextResponse.json({error:'No se completó la operación. Conserva el borrador y vuelve a intentarlo.'},{status:500,headers});
}
export async function GET(req:NextRequest) {
  try {
    const owner=await requireOwner(); const service=new RegistroService(await getDatabase(),serviceOptions());
    const q=req.nextUrl.searchParams; const action=q.get('action'); let data:unknown;
    switch(action) {
      case 'bootstrap': data=await service.bootstrap(owner); break;
      case 'attendance': data=await service.attendance(owner,q.get('courseId')||'',q.get('date')||'',Number(q.get('block')||1)); break;
      case 'register-summary': data=await service.registerSummary(owner,q.get('courseId')||''); break;
      case 'attendance-imports': data=await service.attendanceImports(owner); break;
      case 'attendance-register-pdf': {
        const courseId=q.get('courseId')||'';
        if(!courseId) throw new AppError(400,'Selecciona un curso para descargar su registro.');
        const summary=await service.registerSummary(owner,courseId);
        let bytes:Uint8Array;
        try { bytes=await buildAttendanceRegisterPdf(summary,demoMode); }
        catch(e) { if(e instanceof Error && e.message==='No hay sesiones impartidas para generar el registro.') throw new AppError(404,e.message,'NOT_FOUND'); throw e; }
        const filename=`registro-asistencia-${summary.course.code.toLowerCase()}-2026-2027.pdf`;
        const body=new ArrayBuffer(bytes.byteLength);new Uint8Array(body).set(bytes);
        return new NextResponse(body,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${filename}"`,'Content-Length':String(bytes.byteLength)}});
      }
      case 'grades': data=await service.grades(owner,q.get('activityId')||''); break;
      case 'indicator-usage': data=await service.indicatorUsage(owner); break;
      case 'report': data=await service.report(owner,q.get('courseId')||'',q.get('studentId')||''); break;
      case 'competency-summary': data=await service.competencySummary(owner,q.get('courseId')||''); break;
      case 'teacher-ledger': data=await service.teacherLedger(owner,q.get('period')||undefined); break;
      case 'period-sheet': data=await service.periodSheet(owner,q.get('period')||'P2',q.get('courseId')||'');break;
      case 'audit': data=await service.audit(owner); break;
      case 'export': return new NextResponse(JSON.stringify(await service.exportData(owner),null,2),{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="registro-docente-respaldo.json"'}});
      default: return NextResponse.json({error:'Operación no reconocida.'},{status:400,headers});
    }
    return NextResponse.json({data},{headers});
  } catch(e) { return fail(e); }
}
export async function POST(req:NextRequest) {
  try {
    const owner=await requireOwner();
    const origin=req.headers.get('origin');
    const expected=new URL(process.env.APP_URL||req.url).origin;
    if(!origin || origin!==expected) throw new AccessError(403,'Origen de la solicitud no permitido.');
    const text=await req.text(); if(text.length>500_000) throw new AccessError(413,'El archivo supera el tamaño permitido.');
    let body:{action:string;input:unknown}; try {body=JSON.parse(text);}catch{throw new AccessError(400,'El contenido enviado no es válido.');}
    const service=new RegistroService(await getDatabase(),serviceOptions()); let data:unknown;
    switch(body.action) {
      case 'attendance': data=await service.saveAttendance(owner,body.input as AttendanceInput);break;
      case 'daily-assessment': data=await service.saveDailyAssessment(owner,body.input as DailyAssessmentInput);break;
      case 'grades': data=await service.saveGrades(owner,body.input as GradesInput);break;
      case 'activity': data=await service.createActivity(owner,body.input as ActivityInput);break;
      case 'shared-activity': data=await service.createSharedActivity(owner,body.input as SharedActivityInput);break;
      case 'configure-activity': data=await service.configureActivityEvaluation(owner,body.input);break;
      case 'criterion': data=await service.saveEvaluationCriterion(owner,body.input);break;
      case 'criteria-import': data=await service.importEvaluationCriteria(owner,body.input);break;
      case 'archive-criterion': {const input=body.input as {id?:unknown}|null;data=await service.archiveEvaluationCriterion(owner,typeof input?.id==='string'?input.id:'');break;}
      case 'course': data=await service.createCourse(owner,body.input);break;
      case 'manage-roster': data=await service.manageRoster(owner,body.input);break;
      case 'period-sheet-plan': data=await service.savePeriodSheetPlan(owner,body.input);break;
      case 'period-sheet-grades': data=await service.savePeriodSheetGrades(owner,body.input);break;
      case 'curriculum-sequence': data=await service.saveCurriculumSequence(owner,body.input);break;
      case 'sequence': {const input=body.input as {period?:unknown;sequence?:unknown}|null;if(typeof input?.period!=='string')throw new AppError(400,'Selecciona un período para guardar la secuencia.');data=await service.savePlanSequence(owner,input.period,input.sequence as NonNullable<import('@/lib/model').EvaluationPlan['sequence']>);break;}
      case 'plan': data=await service.updatePlan(owner,body.input as import('@/lib/model').EvaluationPlan);break;
      case 'activate-plan': {const input=body.input as {period?:unknown}|null;data=await service.activatePlan(owner,typeof input?.period==='string'?input.period:'');break;}
      case 'roster': {const input=body.input as {courseId:string;rows:RosterRow[]};data=await service.importRoster(owner,input.courseId,input.rows);break;}
      default: throw new AccessError(400,'Operación no reconocida.');
    }
    return NextResponse.json({data},{headers});
  } catch(e) {return fail(e);}
}
