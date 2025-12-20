import type { Metadata } from 'next';
import ThemeRegistry from '@/components/providers/ThemeRegistry';

export const metadata: Metadata = {
  title: 'AITO Dashboard',
  description: 'AI Team Orchestrator Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
