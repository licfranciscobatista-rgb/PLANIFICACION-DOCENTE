import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Registro docente', description: 'Asistencia, comportamiento y evaluación de Matemática' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
