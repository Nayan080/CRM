import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, ForbiddenState, LoadingState, NoResultsState } from './state-view';

describe('state views', () => {
  it('loading state is announced politely', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('error state is an alert, shows reference id and retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState requestId="req-42" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: req-42');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('empty, no-results and forbidden states render their titles', () => {
    render(
      <>
        <EmptyState title="No leads yet" />
        <NoResultsState query="smith" />
        <ForbiddenState />
      </>,
    );
    expect(screen.getByText('No leads yet')).toBeInTheDocument();
    expect(screen.getByText(/smith/)).toBeInTheDocument();
    expect(screen.getByText('You don’t have access')).toBeInTheDocument();
  });
});
