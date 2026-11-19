import { redirect } from 'next/navigation';
import { AccessError, demoMode, requireOwnerIdentity } from '@/lib/auth';
import RegistroApp from '@/components/registro-app';
export const dynamic='force-dynamic';
export default async function Page() {
  let teacherName='Docente';
  try {const identity=await requireOwnerIdentity();teacherName=identity.name||identity.email||teacherName;}
  catch(e) {if(e instanceof AccessError && e.status===401)redirect('/auth/sign-in');return <main className="login-page"><div className="login-card"><h1>Acceso al registro</h1><p>{e instanceof Error?e.message:'No se pudo acceder al registro.'}</p><a href="/auth/sign-in" className="button primary">Iniciar sesión</a></div></main>;}
  return <RegistroApp demo={demoMode} teacherName={teacherName}/>;
}
