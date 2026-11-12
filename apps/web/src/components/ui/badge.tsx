import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

/** Small status label. Always includes text, so meaning never depends on colour alone. */
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}
    >
      {children}
    </span>
  );
}
