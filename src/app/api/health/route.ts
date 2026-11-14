import { getDatabase } from '@/lib/db';
import { authConfigured, demoMode } from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET() {
  if(!demoMode && !authConfigured) return Response.json({status:'configuration_required'},{status:503});
  try {await (await getDatabase()).query('SELECT 1');return Response.json({status:'ok',mode:demoMode?'demo':'private'});}
  catch{return Response.json({status:'database_unavailable'},{status:503});}
}
