import { notFound } from 'next/navigation';
import { demoMode } from '@/lib/auth';
import CourseSetupPrototype from '@/components/course-setup-prototype';

export const dynamic = 'force-dynamic';

export default function PrototypePage() {
  if (!demoMode) notFound();
  return <CourseSetupPrototype />;
}
