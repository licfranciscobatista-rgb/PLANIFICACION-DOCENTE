'use client';
import { createAuthClient } from '@neon/auth/next';
import { useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
const client = createAuthClient();
export default function Login({configured}:{configured:boolean}) {
  const [mode,setMode]=useState<'signin'|'signup'|'verify'>('signin');
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [code,setCode]=useState('');
  const [pending,setPending]=useState(false); const [message,setMessage]=useState('');
  async function submit(e:React.FormEvent) {
    e.preventDefault(); setPending(true); setMessage('');
    try {
      if (mode==='verify') {
        const result=await client.emailOtp.verifyEmail({email,otp:code});
        if(result.error) throw new Error(result.error.message);
        setMode('signin'); setMessage('Correo verificado. Ya puedes entrar.'); return;
      }
      const result=mode==='signup' ? await client.signUp.email({email,password,name:'Docente'}) : await client.signIn.email({email,password});
      if(result.error) throw new Error(result.error.message || 'No se pudo iniciar la sesión.');
      if(mode==='signup' && result.data?.user && !result.data.user.emailVerified) {setMode('verify');setMessage('Introduce el código recibido en tu correo.');}
      else window.location.assign('/');
    } catch(e) {setMessage(e instanceof Error ? e.message : 'No se pudo conectar. Intenta nuevamente.');}
    finally {setPending(false);}
  }
  return <main className="login-page"><div className="login-card"><BookOpenCheck size={36}/><p className="eyebrow">MATEMÁTICA · 5.º DE SECUNDARIA</p><h1>Tu registro,<br/>en un solo lugar</h1><p className="muted">Asistencia, comportamiento y evaluaciones, con un historial por estudiante.</p>
  {!configured ? <div className="notice warning">El acceso privado todavía no está configurado. El administrador debe conectar Neon Auth y el correo del docente.</div> : <form onSubmit={submit}>
  <label>Correo<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
  {mode==='verify' ? <label>Código de verificación<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} required/></label> : <label>Contraseña<input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></label>}
  <button className="button primary" disabled={pending}>{pending?'Conectando…':mode==='signup'?'Crear mi acceso':mode==='verify'?'Verificar correo':'Entrar al registro'}</button>
  {mode!=='verify' && <button type="button" className="text-button" onClick={()=>setMode(mode==='signup'?'signin':'signup')}>{mode==='signin'?'Crear el acceso del docente':'Ya tengo mi acceso'}</button>}
  </form>}
  {message && <p className="notice" role="status">{message}</p>}<small>Acceso reservado a la cuenta autorizada del docente.</small></div></main>;
}
