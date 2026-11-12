'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Search on submit (Enter or button) to avoid a request per keystroke. */
export function SearchBox({
  label,
  onSearch,
}: {
  label: string;
  onSearch: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(text.trim());
  };
  return (
    <form onSubmit={submit} role="search" className="flex max-w-md gap-2">
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}
