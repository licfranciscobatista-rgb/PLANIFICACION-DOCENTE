import { NextRequest, NextResponse } from 'next/server';
import { AccessError, demoMode, requireOwner } from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { RegistroService } from '@/lib/service';
import { AppError, ActivityInput, AttendanceInput, GradesInput, RosterRow } from '@/lib/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function fail(e:unknown) {
  if(e instanceof AccessError || e instanceof AppError) return NextResponse.json({error:e.message},{status:e.status,headers});
  console.error('Registro: fallo interno', e instanceof Error ? e.name : 'unknown');
  return NextResponse.json({error:'No se completó la operación. Conserva el borrador y vuelve a intentarlo.'},{status:500,headers});
}
export async function GET(req:NextRequest) {
  try {
    const owner=await requireOwner(); const service=new RegistroService(await getDatabase(),{demo:demoMode});
    const q=req.nextUrl.searchParams; const action=q.get('action'); let data:unknown;
    switch(action) {
      case 'bootstrap': data=await service.bootstrap(owner); break;
      case 'attendance': data=await service.attendance(owner,q.get('courseId')||'',q.get('date')||'',Number(q.get('block')||1)); break;
      case 'grades': data=await service.grades(owner,q.get('activityId')||''); break;
      case 'report': data=await service.report(owner,q.get('courseId')||'',q.get('studentId')||''); break;
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
    const service=new RegistroService(await getDatabase(),{demo:demoMode}); let data:unknown;
    switch(body.action) {
      case 'attendance': data=await service.saveAttendance(owner,body.input as AttendanceInput);break;
      case 'grades': data=await service.saveGrades(owner,body.input as GradesInput);break;
      case 'activity': data=await service.createActivity(owner,body.input as ActivityInput);break;
      case 'plan': data=await service.updatePlan(owner,body.input as import('@/lib/model').EvaluationPlan);break;
      case 'roster': {const input=body.input as {courseId:string;rows:RosterRow[]};data=await service.importRoster(owner,input.courseId,input.rows);break;}
      default: throw new AccessError(400,'Operación no reconocida.');
    }
    return NextResponse.json({data},{headers});
  } catch(e) {return fail(e);}
}
