import type { Metadata } from 'next';
import { SystemStatus } from './system-status';

export const metadata: Metadata = { title: 'System status' };

export default function StatusPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
      <SystemStatus />
    </section>
  );
}
