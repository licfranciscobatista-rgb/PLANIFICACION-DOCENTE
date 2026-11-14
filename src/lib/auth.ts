import { createNeonAuth } from '@neon/auth/next/server';

export const demoMode = process.env.DEMO_MODE === 'true' && !process.env.RENDER && !process.env.RENDER_SERVICE_ID;
export const authConfigured = Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET && process.env.OWNER_EMAIL);
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL || 'http://127.0.0.1:39999/auth',
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET || 'local-build-placeholder-do-not-use-in-production-123456' },
});

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireOwner() {
  if (demoMode) return 'local-demo';
  if (!authConfigured) throw new AccessError(503, 'Falta configurar el acceso privado del docente.');
  const { data: session } = await auth.getSession();
  if (!session?.user) throw new AccessError(401, 'Inicia sesión para acceder al registro.');
  if (session.user.email.toLowerCase() !== process.env.OWNER_EMAIL!.trim().toLowerCase()) {
    throw new AccessError(403, 'Esta cuenta no tiene acceso al registro.');
  }
  if (!session.user.emailVerified) throw new AccessError(403, 'Verifica tu correo antes de acceder a los estudiantes.');
  return session.user.id;
}
