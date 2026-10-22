import { useEffect, useState } from 'react';
import { applyActionCode, checkActionCode, confirmPasswordReset, signOut, verifyPasswordResetCode } from 'firebase/auth';
import { Eye, EyeOff } from 'lucide-react';
import { auth } from '../../firebase';
import { readEmailAction, appLoginUrl } from '../../utils/authFlow';
import { authErrorMessage } from '../../utils/authErrors';
import { useFormFeedback } from '../common/FormFeedback';

export function EmailActionPage() {
  const { showError, clearFeedback } = useFormFeedback();
  const [action] = useState(() => readEmailAction(location.href));
  const [phase, setPhase] = useState<'checking' | 'ready' | 'done' | 'error'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loginUrl = appLoginUrl(import.meta.env.VITE_APP_URL || location.origin);
  useEffect(() => {
    let active = true;
    const verify = async () => {
      if (!action.code || !['resetPassword', 'verifyEmail', 'recoverEmail'].includes(action.mode)) throw new Error('Tautan akun tidak lengkap. Buka tautan terbaru dari email Anda.');
      if (action.mode === 'resetPassword') {
        const accountEmail = await verifyPasswordResetCode(auth, action.code);
        if (active) { setEmail(accountEmail); setPhase('ready'); }
      } else {
        const info = await checkActionCode(auth, action.code);
        if (active) { setEmail(info.data.email || ''); setPhase('ready'); }
      }
    };
    void verify().catch(error => { if (active) { setError(authErrorMessage(error)); setPhase('error'); } });
    return () => { active = false; };
  }, [action]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (action.mode === 'resetPassword' && password !== confirm) { const message = 'Konfirmasi kata sandi belum sama.'; setError(message); showError(message, { target: document.getElementById('confirm-password') }); return; }
    setBusy(true); setError(''); clearFeedback();
    try {
      if (action.mode === 'resetPassword') {
        await confirmPasswordReset(auth, action.code, password);
        if (auth.currentUser?.email === email) await signOut(auth);
      } else {
        await applyActionCode(auth, action.code);
        if (auth.currentUser) { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); }
      }
      setPassword(''); setConfirm(''); setPhase('done');
      history.replaceState(null, '', location.pathname + '#auth-action');
    } catch (error) { const message = authErrorMessage(error); setError(message); showError(message); }
    finally { setBusy(false); }
  };
  const reset = action.mode === 'resetPassword';
  return <div className="site-container py-10 sm:py-16"><section className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 sm:p-10">
    <a href={loginUrl} className="font-serif text-3xl font-semibold text-primary">lerang.</a>
    <p className="mb-3 mt-8 text-sm text-muted-foreground">Pemulihan akun</p>
    <h1 className="text-3xl font-medium tracking-tight">{phase === 'done' ? reset ? 'Kata sandi diperbarui' : 'Email berhasil diperbarui' : reset ? 'Buat kata sandi baru' : 'Konfirmasi email'}</h1>
    {phase === 'checking' && <p role="status" className="mt-5 text-sm">Memeriksa tautan akun...</p>}
    {phase === 'error' && <div className="mt-5 space-y-5"><p role="alert" className="text-sm leading-7">{error}</p><a href={`${loginUrl.split('#')[0]}#reset-password`} className="button-secondary">Minta tautan pemulihan baru</a></div>}
    {phase === 'done' && <p role="status" className="mt-5 text-sm leading-7">{reset ? 'Gunakan kata sandi baru untuk masuk. Sesi lama akan diminta masuk kembali.' : 'Perubahan email sudah dikonfirmasi. Anda dapat kembali ke aplikasi.'}</p>}
    {phase === 'ready' && <form onSubmit={submit} className="mt-5 space-y-5">
      <p className="break-all text-sm leading-7 text-muted-foreground">{reset ? 'Kata sandi baru untuk' : 'Konfirmasi untuk'} <strong className="text-foreground">{email}</strong>.</p>
      {reset && <>
        <div><label htmlFor="new-password" className="mb-2 block text-sm font-medium">Kata sandi baru</label><div className="flex items-center rounded border border-border focus-within:ring-2 focus-within:ring-primary"><input id="new-password" required minLength={6} autoComplete="new-password" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" /><button type="button" aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={show} onClick={() => setShow(value => !value)} className="flex h-12 w-12 items-center justify-center focus-ring">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><p className="mt-2 text-xs text-muted-foreground">Gunakan sedikitnya 6 karakter dan hindari kata sandi yang pernah dipakai.</p></div>
        <div><label htmlFor="confirm-password" className="mb-2 block text-sm font-medium">Ulangi kata sandi baru</label><input id="confirm-password" type={show ? 'text' : 'password'} required minLength={6} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={busy} className="min-h-12 w-full rounded border border-border bg-transparent px-3 text-sm focus-ring" /></div>
      </>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button type="submit" disabled={busy} className="button-primary w-full disabled:opacity-60">{busy ? 'Menyimpan...' : reset ? 'Simpan kata sandi baru' : 'Konfirmasi email'}</button>
    </form>}
    <a href={loginUrl} className="mt-6 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">Kembali ke halaman masuk</a>
  </section></div>;
}
