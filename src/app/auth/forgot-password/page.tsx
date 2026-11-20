import PasswordRecovery from '@/components/password-recovery';
import { authConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <PasswordRecovery mode="request" configured={authConfigured} />;
}
