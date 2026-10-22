import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebase';
import { authErrorMessage } from '../../utils/authErrors';
import { appLoginUrl } from '../../utils/authFlow';
import { useFormFeedback } from '../common/FormFeedback';

export function ResetPasswordPage({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { showError, clearFeedback } = useFormFeedback();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); clearFeedback();
    try {
      auth.languageCode = 'id';
      await sendPasswordResetEmail(auth, email.trim().toLowerCase(), { url: appLoginUrl(import.meta.env.VITE_APP_URL || location.origin) });
      setSent(true);
    } catch (error) { const message = authErrorMessage(error); setError(message); showError(message); }
    finally { setBusy(false); }
  };
  return <div className="site-container py-10 sm:py-16"><div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 sm:p-10">
    <p className="mb-3 text-sm text-muted-foreground">Akun Lerang</p>
    <h1 className="text-3xl font-medium tracking-tight">{sent ? 'Periksa kotak masuk' : 'Lupa kata sandi?'}</h1>
    {sent ? <div role="status" className="mt-5 space-y-4 text-sm leading-7"><p>Jika <strong className="break-all">{email}</strong> terdaftar, tautan pemulihan telah dikirim. Periksa juga folder spam.</p><p>Tautan hanya dapat digunakan sekali. Gunakan tautan dari email yang paling baru.</p></div> : <form onSubmit={submit} className="mt-5 space-y-5">
      <p className="text-sm leading-7 text-muted-foreground">Masukkan email akun. Kami akan mengirim tautan untuk membuat kata sandi baru.</p>
      <div><label htmlFor="reset-email" className="mb-2 block text-sm font-medium">Email akun</label><input id="reset-email" type="email" required autoComplete="email" disabled={busy} value={email} onChange={event => setEmail(event.target.value)} placeholder="nama@contoh.com" className="min-h-12 w-full rounded border border-border bg-transparent px-3 text-sm focus-ring" /></div>
      {error && <p className="text-sm leading-6 text-destructive">{error}</p>}
      <button type="submit" disabled={busy} className="button-primary w-full disabled:opacity-60">{busy ? 'Mengirim tautan...' : 'Kirim tautan pemulihan'}</button>
    </form>}
    <button type="button" onClick={() => onNavigate('login')} className="mt-6 min-h-11 text-sm text-primary underline underline-offset-4">Kembali ke halaman masuk</button>
  </div></div>;
}
