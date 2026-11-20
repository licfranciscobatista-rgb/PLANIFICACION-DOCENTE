'use client';

import { createAuthClient } from '@neon/auth/next';
import { ArrowLeft, BookOpenCheck, KeyRound, MailCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

const client = createAuthClient();

type RecoveryMode = 'request' | 'reset';

export default function PasswordRecovery({ mode, configured }: { mode: RecoveryMode; configured: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [token, setToken] = useState('');
  const [invalidLink, setInvalidLink] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (mode !== 'reset') return;
    const params = new URLSearchParams(window.location.search);
    const currentToken = params.get('token') ?? '';
    const hasError = params.has('error') || !currentToken;
    setToken(currentToken);
    setInvalidLink(hasError);
    if (hasError) setMessage('El enlace no es válido o ya venció. Solicita uno nuevo para cambiar tu contraseña.');
  }, [mode]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage('');
    try {
      if (mode === 'request') {
        const result = await client.requestPasswordReset({
          email: email.trim(),
          redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (result.error) throw new Error(result.error.message || 'No se pudo solicitar el cambio.');
        setComplete(true);
        setMessage('Si ese correo tiene una cuenta, recibirás un enlace para cambiar la contraseña. Revisa también la carpeta de spam.');
      } else {
        if (!token || invalidLink) throw new Error('Solicita un enlace nuevo para cambiar tu contraseña.');
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
        const result = await client.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message || 'No se pudo cambiar la contraseña.');
        setComplete(true);
        setMessage('Contraseña actualizada. Ya puedes iniciar sesión con tu nueva clave.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la solicitud. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  const isReset = mode === 'reset';

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="recovery-title">
        <BookOpenCheck size={36} aria-hidden="true" />
        <p className="eyebrow">REGISTRO DOCENTE</p>
        <h1 id="recovery-title">{isReset ? 'Crea una nueva contraseña' : 'Recupera tu acceso'}</h1>
        <p className="muted">
          {isReset
            ? 'Tu registro y el progreso guardado permanecen en la misma cuenta.'
            : 'Te enviaremos un enlace al correo de tu cuenta para que puedas elegir una contraseña nueva.'}
        </p>

        {!configured ? (
          <div className="notice warning" role="status">La recuperación todavía no está conectada con Neon Auth.</div>
        ) : complete ? (
          <div className="password-recovery-complete">
            <div className="notice success" role="status">
              {isReset ? <KeyRound size={17} aria-hidden="true" /> : <MailCheck size={17} aria-hidden="true" />}
              <span>{message}</span>
            </div>
            <a className="button primary wide" href="/auth/sign-in">Volver a iniciar sesión</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            {isReset ? (
              <>
                {invalidLink ? (
                  <div className="notice warning" role="alert">{message}</div>
                ) : (
                  <>
                    <label>Nueva contraseña
                      <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required />
                    </label>
                    <label>Confirma la nueva contraseña
                      <input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={event => setConfirmation(event.target.value)} required />
                    </label>
                  </>
                )}
              </>
            ) : (
              <label>Correo de tu cuenta
                <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
              </label>
            )}

            {!invalidLink && <button className="button primary" disabled={pending}>
              {pending ? 'Procesando…' : isReset ? 'Guardar nueva contraseña' : 'Enviar enlace de recuperación'}
            </button>}
          </form>
        )}

        {message && !complete && !invalidLink && <p className="notice" role="alert">{message}</p>}
        {!complete && <a className="text-button password-recovery-back" href="/auth/sign-in"><ArrowLeft size={14} aria-hidden="true" /> Volver al inicio de sesión</a>}
        <small>Restablecer la contraseña no borra cursos, estudiantes ni calificaciones.</small>
      </section>
    </main>
  );
}
