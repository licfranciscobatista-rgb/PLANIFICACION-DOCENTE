'use client';
import { createAuthClient } from '@neon/auth/next';
import { useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
const client = createAuthClient();
export default function Login({configured}:{configured:boolean}) {
  const [mode,setMode]=useState<'signin'|'signup'>('signin');
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [pending,setPending]=useState(false); const [message,setMessage]=useState('');
  async function submit(e:React.FormEvent) {
    e.preventDefault(); setPending(true); setMessage('');
    try {
      const result=mode==='signup' ? await client.signUp.email({email,password,name:name.trim()||email}) : await client.signIn.email({email,password});
      if(result.error) throw new Error(result.error.message || 'No se pudo iniciar la sesión.');
      window.location.assign('/');
    } catch(e) {setMessage(e instanceof Error ? e.message : 'No se pudo conectar. Intenta nuevamente.');}
    finally {setPending(false);}
  }
  return <main className="login-page"><div className="login-card"><BookOpenCheck size={36}/><p className="eyebrow">REGISTRO DOCENTE</p><h1>Tu registro,<br/>en un solo lugar</h1><p className="muted">Asistencia, comportamiento y evaluaciones, con un historial por estudiante.</p>
  {!configured ? <div className="notice warning">El acceso privado todavía no está configurado. El administrador debe conectar Neon Auth.</div> : <form onSubmit={submit}>
  {mode==='signup' && <label>Nombre del docente<input type="text" autoComplete="name" maxLength={120} value={name} onChange={e=>setName(e.target.value)} required/></label>}
  <label>Correo<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
  <label>Contraseña<input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></label>
  <button className="button primary" disabled={pending}>{pending?'Conectando…':mode==='signup'?'Crear mi acceso':'Entrar al registro'}</button>
  {mode==='signin' && <a className="text-button" href="/auth/forgot-password">Olvidé mi contraseña</a>}
  <button type="button" className="text-button" onClick={()=>setMode(mode==='signup'?'signin':'signup')}>{mode==='signin'?'Crear el acceso del docente':'Ya tengo mi acceso'}</button>
  </form>}
  {message && <p className="notice" role="status">{message}</p>}<small>Cada cuenta tiene su propio registro y sus propios datos.</small></div></main>;
}
