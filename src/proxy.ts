import { auth, demoMode } from './lib/auth';

export default auth.middleware({
  loginUrl: '/auth/sign-in',
  publicRoutes: demoMode ? ['/', '/api', '/prototipo'] : ['/api/health'],
});
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
