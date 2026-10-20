import { useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../firebase';
import { useAuction } from '../../context/AuctionContext';
import { authErrorMessage } from '../../utils/authErrors';
import { appLoginUrl } from '../../utils/authFlow';

export function EmailVerificationNotice() {
  const { currentUser, reloadSession } = useAuction();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!currentUser || currentUser.email_verified) return null;
  const act = async (check: boolean) => {
    if (!auth.currentUser) return;
    setBusy(true); setMessage('');
    try {
      if (check) {
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
        if (auth.currentUser.emailVerified) reloadSession();
        else setMessage('Email belum terverifikasi. Buka tautan verifikasi dari kotak masuk Anda.');
      } else {
        auth.languageCode = 'id';
        await sendEmailVerification(auth.currentUser, { url: appLoginUrl(import.meta.env.VITE_APP_URL || location.origin) });
        setMessage('Email verifikasi dikirim. Periksa kotak masuk dan folder spam.');
      }
    } catch (error) { setMessage(authErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <aside className="site-container border-b border-border py-4 text-sm" aria-label="Verifikasi email"><p className="font-medium">Verifikasi email sebelum bertransaksi</p><p className="mt-1 leading-6 text-muted-foreground">Buka tautan verifikasi untuk {currentUser.email}. Top up, jaminan, dan penawaran memerlukan email terverifikasi.</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void act(false)} className="button-secondary">Kirim email verifikasi</button><button type="button" disabled={busy} onClick={() => void act(true)} className="button-secondary">Saya sudah verifikasi</button></div>{message && <p role="status" className="mt-3 leading-6">{message}</p>}</aside>;
}
