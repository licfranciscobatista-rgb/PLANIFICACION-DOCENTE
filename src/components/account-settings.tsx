'use client';

import { useState, type FormEvent } from 'react';
import { Check, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { createAuthClient } from '@neon/auth/next';

const authClient = createAuthClient();

export default function AccountSettings({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setSaved(false);
    if (newPassword !== confirmation) {
      setMessage('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (newPassword === currentPassword) {
      setMessage('La contraseña nueva debe ser diferente de la actual.');
      return;
    }

    setPending(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword });
      if (result.error) throw new Error(result.error.message || 'No se pudo cambiar la contraseña.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setSaved(true);
      setMessage('La contraseña se actualizó correctamente.');
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const normalized = raw.toLocaleLowerCase();
      setMessage(normalized.includes('invalid password') || normalized.includes('incorrect password')
        ? 'La contraseña actual no es correcta.'
        : raw || 'No se pudo cambiar la contraseña. Revisa los datos e inténtalo otra vez.');
    } finally {
      setPending(false);
    }
  }

  return <div className="account-page">
    <section className="section-heading">
      <div><p className="eyebrow">PERFIL Y SEGURIDAD</p><h1>Cuenta del docente</h1><p className="muted">Consulta el correo asociado y administra tu contraseña.</p></div>
    </section>

    <section className="panel account-identity-card" aria-labelledby="account-email-title">
      <div className="account-card-icon"><Mail size={20}/></div>
      <div className="account-identity-copy"><h2 id="account-email-title">Correo de la cuenta</h2><p className="muted">Este es el correo usado para iniciar sesión y recuperar el acceso.</p></div>
      <div className="account-email-value">{email || 'No disponible en esta sesión'}</div>
    </section>

    <section className="panel account-password-card" aria-labelledby="account-password-title">
      <div className="account-panel-heading"><div><p className="eyebrow">SEGURIDAD</p><h2 id="account-password-title">Cambiar contraseña</h2><p className="muted">Confirma tu contraseña actual y elige una nueva de al menos 8 caracteres.</p></div><div className="account-card-icon"><KeyRound size={20}/></div></div>
      <form className="account-password-form" onSubmit={submit}>
        <label>Contraseña actual<input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
        <div className="form-grid">
          <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label>
          <label>Confirma la nueva contraseña<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
        </div>
        {message && <div className={'notice '+(saved?'success':'warning')} role={saved?'status':'alert'}>{saved&&<Check size={16}/>}<span>{message}</span></div>}
        <div className="account-form-footer"><p><ShieldCheck size={15}/> La contraseña se valida y actualiza de forma segura con Neon Auth.</p><button className="button primary" type="submit" disabled={pending}>{pending?'Actualizando…':'Guardar contraseña'}</button></div>
      </form>
    </section>
  </div>;
}
