import type { Metadata } from 'next';
import ThemeRegistry from '@/components/providers/ThemeRegistry';
import DashboardLayout from '@/components/layout/DashboardLayout';

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
        <ThemeRegistry>
          <DashboardLayout>{children}</DashboardLayout>
        </ThemeRegistry>
      </body>
    </html>
  );
}
