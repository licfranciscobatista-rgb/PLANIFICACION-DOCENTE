import { createNeonAuth } from '@neon/auth/next/server';

export const demoMode = process.env.DEMO_MODE === 'true' && !process.env.RENDER && !process.env.RENDER_SERVICE_ID;
export const authConfigured = Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL || 'http://127.0.0.1:39999/auth',
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET || 'local-build-placeholder-do-not-use-in-production-123456' },
});

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function ownerIdFromSession(session: { user?: { id?: string } } | null | undefined) {
  if (!session?.user?.id) throw new AccessError(401, 'Inicia sesión para acceder al registro.');
  return session.user.id;
}

export async function requireOwnerIdentity() {
  if (demoMode) return { id: 'local-demo', name: 'Docente de prueba', email: '' };
  if (!authConfigured) throw new AccessError(503, 'Falta configurar el acceso privado del docente.');
  const { data: session } = await auth.getSession();
  const id = ownerIdFromSession(session);
  return { id, name: session?.user?.name?.trim() ?? '', email: session?.user?.email ?? '' };
}

export async function requireOwner() {
  return (await requireOwnerIdentity()).id;
}
