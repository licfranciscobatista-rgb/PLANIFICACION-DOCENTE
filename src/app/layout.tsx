import type { Metadata } from 'next';
import Script from 'next/script';
import ThemeToggle from '@/components/theme-toggle';
import './globals.css';
import './dark-theme.css';
export const metadata: Metadata = { title: 'Registro docente', description: 'Asistencia, comportamiento y evaluación de Matemática' };
const themeInitialization = `(()=>{try{const saved=localStorage.getItem('registro-docente-theme');const theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme}catch{document.documentElement.dataset.theme='light'}})();`;
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es" suppressHydrationWarning><body>{children}<ThemeToggle/><Script id="theme-initialization" strategy="beforeInteractive">{themeInitialization}</Script></body></html>;
}
