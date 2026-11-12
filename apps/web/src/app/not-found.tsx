import Link from 'next/link';
import { EmptyState } from '@/components/states/state-view';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you’re looking for doesn’t exist or you don’t have access to it."
      action={
        <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Go home
        </Link>
      }
    />
  );
}
