import { notFound } from 'next/navigation';
import { demoMode } from '@/lib/auth';
import RegistroApp from '@/components/registro-app';

export const dynamic = 'force-dynamic';

export default function ActivityFlowPrototypePage() {
  if (!demoMode) notFound();
  return <RegistroApp demo initialView="activities" />;
}
