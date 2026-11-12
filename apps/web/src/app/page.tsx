import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Migration Business Management CRM</h1>
        <p className="max-w-2xl text-muted-foreground">
          Engineering foundation (Stage 1). Sign-up, workspaces and business modules arrive in later
          stages.
        </p>
      </div>
      <div>
        <Link href="/status" className={buttonVariants({ variant: 'default' })}>
          Check system status
        </Link>
      </div>
    </section>
  );
}
