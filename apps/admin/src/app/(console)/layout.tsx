import { Shell } from '@/components/shell';
import { SessionProvider } from '@/lib/session';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
