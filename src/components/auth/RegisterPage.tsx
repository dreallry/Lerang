import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
import {
  User,
  Mail,
  Phone,
  CheckCircle2,
  ChevronLeft,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { auth } from '../../firebase';
import api from '../../services/api';
import { authErrorMessage } from '../../utils/authErrors';
import { parseSessionProfile } from '../../utils/sessionProfile';
import { useAuction } from '../../context/AuctionContext';
import { useFormFeedback } from '../common/FormFeedback';

interface RegisterPageProps {
  onNavigate: (view: string, id?: number) => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ onNavigate }) => {
  const { reloadSession, sessionStatus } = useAuction();
  const [step, setStep] = useState<'form' | 'success'>('form');

  // Form State
  const [formData, setFormData] = useState({
    nama_lengkap: auth.currentUser?.displayName || '',
    username: '',
    email: auth.currentUser?.email || '',
    telp: '',
    alamat: '',
    nik: '',
    password: '',
    confirmPassword: '',
    termsAgreed: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const { showError, clearFeedback } = useFormFeedback();
  const [errorMessage, setErrorMessageState] = useState(() => sessionStorage.getItem('lerang_profile_recovery_notice') || '');
  const setErrorMessage = (message: string) => {
    setErrorMessageState(message);
    if (message) showError(message); else clearFeedback();
  };
  useEffect(() => { sessionStorage.removeItem('lerang_profile_recovery_notice'); }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationWarning, setVerificationWarning] = useState('');
  const hasMatchingUser =
    auth.currentUser?.email?.toLowerCase() === formData.email.trim().toLowerCase();

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrorMessage('');
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nama_lengkap.trim()) {
      setErrorMessage('Mohon isi nama lengkap sesuai identitas resmi (KTP).');
      return;
    }
    if (!formData.username.trim() || !formData.email.trim() || !formData.telp.trim()) {
      setErrorMessage('Username, email, dan nomor HP wajib diisi.');
      return;
    }
    if (!/^\d{16}$/.test(formData.nik)) {
      setErrorMessage('NIK harus tepat 16 digit.');
      return;
    }
    if (auth.currentUser && !hasMatchingUser) {
      setErrorMessage('Keluar dari akun saat ini sebelum mendaftarkan email lain.');
      return;
    }
    if (!hasMatchingUser && formData.password.length < 6) {
      setErrorMessage('Kata sandi minimal 6 karakter.');
      return;
    }
    if (!hasMatchingUser && formData.password !== formData.confirmPassword) {
      setErrorMessage('Kata sandi dan konfirmasi kata sandi tidak cocok.');
      return;
    }
    if (!formData.termsAgreed) {
      setErrorMessage('Anda harus menyetujui Syarat & Ketentuan Lerang.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    let warning = '';
    try {
      if (!auth.currentUser) {
        await createUserWithEmailAndPassword(auth, formData.email.trim(), formData.password);
      }
      if (auth.currentUser) {
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
        if (!auth.currentUser.emailVerified) {
          auth.languageCode = 'id';
          try { await sendEmailVerification(auth.currentUser); }
          catch (error) { warning = `Email verifikasi belum terkirim. ${authErrorMessage(error)} Setelah masuk, gunakan Kirim email verifikasi.`; }
        }
      }

      let registrationResponse: Awaited<ReturnType<typeof api.registerMasyarakat>>;
      try {
        registrationResponse = await api.registerMasyarakat({
          nik: formData.nik,
          nama_lengkap: formData.nama_lengkap.trim(),
          username: formData.username.trim(),
          telp: formData.telp.trim(),
          alamat: formData.alamat.trim() || undefined,
        });
      } catch (error) {
        // A retry can resume a profile insert that succeeded before the response was lost.
        try {
          registrationResponse = await api.me();
        } catch {
          throw error;
        }
      }

      let response: { data: Record<string, unknown> };
      try {
        response = await api.me();
      } catch {
        const savedProfile = registrationResponse?.data;
        if (!savedProfile || !Number.isInteger(Number(savedProfile.id_user))) throw new Error('Profil masyarakat berhasil dibuat, tetapi belum dapat dimuat. Coba masuk lagi.');
        response = {
          data: {
            ...savedProfile,
            nama_lengkap: savedProfile.nama_lengkap || savedProfile.nama || '',
            saldo_wallet: Number(savedProfile.saldo_wallet) || 0,
            saldo_hold: Number(savedProfile.saldo_hold) || 0,
            is_verified: Boolean(savedProfile.is_verified),
          },
        };
      }
      const session = parseSessionProfile(response?.data);
      if (session.kind !== 'masyarakat') throw new Error('Akun petugas tidak dapat didaftarkan sebagai peserta.');
      if (auth.currentUser?.providerData.some(provider => provider.providerId === 'google.com')) {
        reloadSession();
        onNavigate('catalog');
        return;
      }
      sessionStorage.setItem('lerang_registration_email', formData.email.trim().toLowerCase());
      if (warning) sessionStorage.setItem('lerang_registration_notice', warning);
      setVerificationWarning(warning);
      await signOut(auth);
      setStep('success');
      setTimeout(() => {
        onNavigate('login');
      }, 1500);
    } catch (error) {
      setErrorMessage(authErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] w-full flex items-center justify-center py-6 sm:py-10 px-4 sm:px-6">
      <div className="w-full max-w-5xl bg-card border border-border rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12">

        <aside className="lg:col-span-5 hidden lg:flex flex-col justify-between gap-12 p-8 xl:p-10 bg-muted border-r border-border">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Kembali ke Katalog</span>
            </button>
            <div className="pt-4">
              <span className="text-3xl font-bold font-sans tracking-tight block">lerang</span>
              <span className="text-sm text-muted-foreground mt-1 block">
                Akun peserta lelang
              </span>
            </div>
          </div>

          <div className="space-y-8 my-auto py-6">
            <div className="space-y-4">
              <h2 className="text-3xl font-medium leading-tight">
                Satu akun untuk setiap tahap lelang.
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Simpan identitas peserta sebelum mengajukan tawaran atau menitipkan barang.
              </p>
            </div>

            <ol className="divide-y divide-border text-sm">
              <li className="py-4"><span className="text-muted-foreground mr-3">01</span>Daftar dan verifikasi email</li>
              <li className="py-4"><span className="text-muted-foreground mr-3">02</span>Baca kondisi dan aturan lot</li>
              <li className="py-4"><span className="text-muted-foreground mr-3">03</span>Pantau tawaran melalui akun Anda</li>
            </ol>
          </div>

          <div className="pt-5 border-t border-border text-sm text-muted-foreground">
            Gunakan email yang masih aktif untuk verifikasi dan pemulihan akun.
          </div>
        </aside>

        {/* Right Column: Register Form */}
        <div className="lg:col-span-7 p-6 sm:p-10 xl:p-12 flex flex-col justify-between bg-card">
          {/* Mobile Back button */}
          <div className="flex items-center justify-between pb-6 lg:pb-4 border-b border-border/60">
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Kembali ke Katalog</span>
            </button>
            <span className="text-xl font-bold font-sans tracking-tight text-foreground lg:hidden">
              lerang
            </span>
          </div>

          {/* STEP 1: Registration Form */}
          {step === 'form' && (
            <div className="max-w-md w-full mx-auto space-y-6 my-auto py-6">
              <div className="space-y-1.5 text-left">
                <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
                  {sessionStatus === 'profile-required' ? 'Lengkapi profil peserta' : 'Buat akun'}
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Lengkapi identitas peserta. Kolom bertanda * wajib diisi.
                </p>
              </div>

              {/* Error Alert */}
              {errorMessage && (
                <div role="alert" className="p-3 rounded bg-destructive/10 text-destructive border border-destructive/20 text-sm">
                  {errorMessage}
                </div>
              )}

              <form onSubmit={handleFormSubmit} className="space-y-4">
                {/* Full Name */}
                <div className="space-y-1.5">
                  <label htmlFor="register-name" className="text-sm font-medium text-foreground block">
                    Nama Lengkap (Sesuai KTP) <span className="text-primary">*</span>
                  </label>
                  <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2.5 transition-colors">
                    <User className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input
                      id="register-name"
                      autoComplete="name"
                      type="text"
                      required
                      value={formData.nama_lengkap}
                      onChange={(e) => handleInputChange('nama_lengkap', e.target.value)}
                      placeholder="Contoh: Raden Danang Pratama"
                      className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                    />
                  </div>
                </div>

                {/* Username & Phone Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="register-username" className="text-sm font-medium text-foreground block">
                      Username <span className="text-primary">*</span>
                    </label>
                    <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2 transition-colors">
                      <input
                        id="register-username"
                        autoComplete="username"
                        type="text"
                        required
                        maxLength={50}
                        value={formData.username}
                        onChange={(e) => handleInputChange('username', e.target.value)}
                        placeholder="danang_pratama"
                        className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="register-phone" className="text-sm font-medium text-foreground block">
                      No. WhatsApp / HP <span className="text-primary">*</span>
                    </label>
                    <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2.5 transition-colors">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <input
                        id="register-phone"
                        autoComplete="tel"
                        type="tel"
                        required
                        value={formData.telp}
                        onChange={(e) => handleInputChange('telp', e.target.value)}
                        placeholder="08123456789"
                        className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                      />
                    </div>
                  </div>
                </div>

                {/* Optional Address */}
                <div className="space-y-1.5">
                  <label htmlFor="register-address" className="text-sm font-medium text-foreground block">
                    Alamat <span className="text-muted-foreground font-normal">(opsional)</span>
                  </label>
                  <textarea
                    id="register-address"
                    autoComplete="street-address"
                    value={formData.alamat}
                    onChange={(e) => handleInputChange('alamat', e.target.value)}
                    placeholder="Alamat untuk kebutuhan pengiriman"
                    maxLength={500}
                    rows={2}
                    className="w-full rounded border border-border bg-transparent px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="register-nik" className="text-sm font-medium text-foreground block">
                    NIK (16 digit) <span className="text-primary">*</span>
                  </label>
                  <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2 transition-colors">
                    <input
                      id="register-nik"
                      type="text"
                      required
                      inputMode="numeric"
                      pattern="[0-9]{16}"
                      maxLength={16}
                      value={formData.nik}
                      onChange={(e) => handleInputChange('nik', e.target.value.replace(/\D/g, ''))}
                      placeholder="16 digit NIK"
                      className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="register-email" className="text-sm font-medium text-foreground block">
                    Email <span className="text-primary">*</span>
                  </label>
                  <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2.5 transition-colors">
                    <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input
                      id="register-email"
                      autoComplete="email"
                      type="email"
                      required
                      value={formData.email}
                      readOnly={hasMatchingUser}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      placeholder="nama@domain.com"
                      className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                    />
                  </div>
                </div>

                {!hasMatchingUser && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="register-password" className="text-sm font-medium text-foreground block">
                      Kata Sandi <span className="text-primary">*</span>
                    </label>
                    <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden pl-3 pr-1 gap-2 transition-colors">
                      <input
                        id="register-password"
                        autoComplete="new-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={formData.password}
                        onChange={(e) => handleInputChange('password', e.target.value)}
                        placeholder="Min. 6 karakter"
                        className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                        aria-pressed={showPassword}
                        className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="register-confirm-password" className="text-sm font-medium text-foreground block">Ulangi sandi</label>
                    <div className="flex items-center w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2 transition-colors">
                      <input
                        id="register-confirm-password"
                        autoComplete="new-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={formData.confirmPassword}
                        onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                        placeholder="Konfirmasi sandi"
                        className="bg-transparent text-foreground placeholder:text-muted-foreground/70 outline-none text-xs sm:text-sm w-full h-full"
                      />
                    </div>
                  </div>
                </div>
                )}
                {hasMatchingUser && (
                  <p className="text-xs text-muted-foreground">
                    Akun ini sudah masuk. Lengkapi profil masyarakat untuk melanjutkan.
                  </p>
                )}

                {/* Terms agreement checkbox */}
                <div className="pt-2 px-1">
                  <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.termsAgreed}
                      onChange={(e) => handleInputChange('termsAgreed', e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-[#2d6a4f]"
                    />
                    <span>
                      Saya menyetujui{' '}
                      <span>Ketentuan Penawaran Lelang</span>{' '}
                      dan Kebijakan Privasi Lerang Indonesia.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-12 rounded bg-primary text-primary-foreground font-semibold text-sm transition-colors hover:opacity-90 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                >
                  {isSubmitting ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Buat Akun & Profil</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Switch to Login */}
              <div className="text-center pt-3 text-xs text-muted-foreground">
                Sudah memiliki akun terdaftar?{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('login')}
                  className="font-bold text-primary hover:underline cursor-pointer"
                >
                  Masuk di sini &rarr;
                </button>
              </div>
            </div>
          )}

          {/* Success Screen */}
          {step === 'success' && (
            <div className="max-w-md w-full mx-auto text-center space-y-4 my-auto py-10 animate-in fade-in zoom-in-95">
              <div className="w-16 h-16 rounded-lg bg-secondary text-primary mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground font-sans">
                Akun Berhasil Dibuat!
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Selamat datang di Lerang, <strong>{formData.nama_lengkap}</strong>.<br />
                Profil tersimpan. {verificationWarning || 'Buka tautan verifikasi yang dikirim ke email Anda sebelum bertransaksi.'}
              </p>
              <div className="pt-3">
                <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-[11px] text-muted-foreground mt-2">Mengalihkan ke halaman masuk...</p>
              </div>
            </div>
          )}

          {/* Footer note */}
          <div className="text-center pt-4 text-[11px] text-muted-foreground/75">
            &copy; {new Date().getFullYear()} Lerang Indonesia · Sistem lelang daring
          </div>
        </div>
      </div>
    </div>
  );
};
