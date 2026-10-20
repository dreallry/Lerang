import { useEffect, useRef, type ReactNode } from 'react';

export function AdminDialog({ title, busy = false, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-lg border-0 bg-transparent p-0 text-foreground backdrop:bg-foreground/40 [&>*]:mx-auto">
    {children}
  </dialog>;
}
