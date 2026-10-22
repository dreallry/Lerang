import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { nativeValidationMessage } from '../../utils/formFeedback';

type FeedbackOptions = { target?: HTMLElement | null };
type FeedbackAPI = {
  showError: (message: string, options?: FeedbackOptions) => void;
  showSuccess: (message: string, options?: FeedbackOptions) => void;
  clearFeedback: () => void;
};
type Notice = {
  id: number;
  message: string;
  type: 'error' | 'success';
  target: HTMLElement | null;
  returnFocus: HTMLElement | null;
  host: HTMLElement;
};

const FeedbackContext = createContext<FeedbackAPI | null>(null);

export function FormFeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const sequence = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const noticeRef = useRef(notice);
  noticeRef.current = notice;

  const clearFeedback = useCallback(() => {
    const current = noticeRef.current;
    if (panel.current?.contains(document.activeElement) && current?.returnFocus?.isConnected) {
      current.returnFocus.focus({ preventScroll: true });
    }
    setNotice(null);
  }, []);

  const show = useCallback((type: Notice['type'], message: string, options?: FeedbackOptions) => {
    if (!message.trim()) return;
    const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
    const target = options?.target ?? null;
    const host = target?.closest<HTMLDialogElement>('dialog[open]') ?? dialogs.item(dialogs.length - 1) ?? document.body;
    const current = noticeRef.current;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice({ id: ++sequence.current, type, message, target, host, returnFocus: panel.current?.contains(active) ? current?.returnFocus ?? null : active });
  }, []);
  const showError = useCallback((message: string, options?: FeedbackOptions) => show('error', message, options), [show]);
  const showSuccess = useCallback((message: string, options?: FeedbackOptions) => show('success', message, options), [show]);

  useEffect(() => {
    let validationPending = false;
    let validationReset: ReturnType<typeof setTimeout> | undefined;
    const invalid = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
      event.preventDefault();
      if (validationPending) return;
      validationPending = true;
      validationReset = setTimeout(() => { validationPending = false; }, 0);
      const labelCopy = field.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
      labelCopy?.querySelectorAll('input, select, textarea, button, [aria-hidden="true"]').forEach(node => node.remove());
      const label = field.getAttribute('aria-label') || labelCopy?.textContent || field.name || 'Isian ini';
      showError(nativeValidationMessage({
        label,
        type: field.type,
        min: field instanceof HTMLInputElement ? field.min : '',
        max: field instanceof HTMLInputElement ? field.max : '',
        minLength: field instanceof HTMLSelectElement ? -1 : field.minLength,
        maxLength: field instanceof HTMLSelectElement ? -1 : field.maxLength,
        validity: field.validity,
      }), { target: field });
      field.focus({ preventScroll: true });
    };
    document.addEventListener('invalid', invalid, true);
    window.addEventListener('hashchange', clearFeedback);
    window.addEventListener('popstate', clearFeedback);
    return () => {
      document.removeEventListener('invalid', invalid, true);
      window.removeEventListener('hashchange', clearFeedback);
      window.removeEventListener('popstate', clearFeedback);
      clearTimeout(validationReset);
    };
  }, [showError, clearFeedback]);

  useEffect(() => {
    if (!notice) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      clearFeedback();
    };
    const close = (event: Event) => {
      if (event.target === notice.host) clearFeedback();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('close', close, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('close', close, true);
    };
  }, [notice, clearFeedback]);

  return <FeedbackContext.Provider value={{ showError, showSuccess, clearFeedback }}>
    {children}
    {notice && createPortal(<div ref={panel} data-form-feedback className="form-feedback fixed z-[200] overflow-y-auto rounded border border-foreground bg-card p-4 text-foreground shadow-lg">
      <div className="flex items-start gap-3">
        {notice.type === 'error' ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
        <div key={notice.id} role={notice.type === 'error' ? 'alert' : 'status'} aria-atomic="true" className="min-w-0 flex-1 text-sm leading-6">
          <p className="font-semibold">{notice.type === 'error' ? 'Belum berhasil' : 'Berhasil'}</p>
          <p className="break-words">{notice.message}</p>
        </div>
        <button type="button" onClick={clearFeedback} aria-label="Tutup pemberitahuan" className="focus-ring -mr-2 -mt-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {notice.target?.isConnected && <button type="button" className="button-secondary mt-3 min-h-11" onClick={() => {
        const target = notice.target;
        clearFeedback();
        if (!target?.isConnected) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'center', behavior: 'auto' });
      }}>Periksa isian</button>}
    </div>, notice.host)}
  </FeedbackContext.Provider>;
}

export function useFormFeedback(): FeedbackAPI {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('FormFeedbackProvider is required.');
  return feedback;
}

