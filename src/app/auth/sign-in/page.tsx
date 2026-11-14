import Login from '@/components/login';
import { authConfigured } from '@/lib/auth';
export const dynamic='force-dynamic';
export default function Page() { return <Login configured={authConfigured} />; }
