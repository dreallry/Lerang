import { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import api, { ApiError } from "@/services/api";
import { auth } from "@/firebase";
import { authErrorMessage } from '@/utils/authErrors';
import { parseSessionProfile } from '@/utils/sessionProfile';
import { useAuction } from '@/context/AuctionContext';
import { useFormFeedback } from '../common/FormFeedback';

export interface LoginFormProps {
  className?: string;
  imageSrc?: string;
  title?: string;
  subtitle?: string;
  onNavigate?: (view: string, id?: number) => void;
  onSuccess?: () => void;
}

export default function LoginForm({
  className,
  imageSrc = "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80",
  title = "Masuk",
  subtitle = "Gunakan email dan kata sandi untuk melanjutkan.",
  onNavigate,
  onSuccess,
}: LoginFormProps) {
  const { reloadSession } = useAuction();
  const { showError } = useFormFeedback();
  const registrationEmail = typeof window !== "undefined"
    ? window.sessionStorage.getItem("lerang_registration_email") || ""
    : "";
  const [identifier, setIdentifier] = useState(registrationEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(
    window.sessionStorage.getItem('lerang_registration_notice') || (registrationEmail
      ? "Registrasi berhasil. Verifikasi email dari kotak masuk Anda, lalu masuk dengan email yang sudah terisi."
      : null),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (registrationEmail) {
      window.sessionStorage.removeItem("lerang_registration_email");
      window.sessionStorage.removeItem('lerang_registration_notice');
    }
  }, [registrationEmail]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatusMessage(null);
    setIsSubmitting(true);
    let firebaseSignedIn = false;

    try {
      await signInWithEmailAndPassword(auth, identifier.trim().toLowerCase(), password);
      firebaseSignedIn = true;
      const response = await api.me();
      const session = parseSessionProfile(response?.data);
      onSuccess?.();
      onNavigate?.(session.kind === 'petugas' ? 'admin-dashboard' : 'catalog');
    } catch (error) {
      if (firebaseSignedIn && error instanceof ApiError && error.status === 403 && /belum memiliki profil/i.test(error.message)) {
        window.sessionStorage.setItem('lerang_profile_recovery_notice', 'Akun sudah masuk. Lengkapi profil peserta untuk melanjutkan.');
        onNavigate?.('register');
        return;
      }
      if (firebaseSignedIn) await signOut(auth).catch(() => undefined);
      const message = authErrorMessage(error);
      setStatusMessage(message);
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      const response = await api.syncGoogleProfile();
      reloadSession();
      onNavigate?.(response.data.profile_required ? 'register' : (parseSessionProfile((await api.me()).data).kind === 'petugas' ? 'admin-dashboard' : 'catalog'));
    } catch (error) {
      const message = authErrorMessage(error);
      setStatusMessage(message);
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-lg border border-border bg-card md:grid-cols-2",
        className
      )}
    >
      <div className="relative hidden min-h-[620px] overflow-hidden bg-muted md:block">
        <img
          className="absolute inset-0 h-full w-full object-cover"
          src={imageSrc}
          alt="Kendaraan dalam katalog lelang"
        />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-foreground/90 p-8 text-background">
          <div className="space-y-1">
            <span className="text-2xl font-bold font-sans tracking-tight">lerang</span>
            <span className="mt-1 block text-sm text-background/80">
              Katalog lelang Lerang
            </span>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-medium leading-snug">
              Temukan lot pilihan dan ikuti penawaran dari satu akun.
            </h2>
            <p className="text-sm text-background/80 leading-relaxed">
              Riwayat tawaran, tagihan, dan status pengiriman tersedia setelah masuk.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center p-6 sm:p-10 lg:p-12 bg-card">
        <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col items-center justify-center">
          <span className="text-2xl font-bold font-sans tracking-tight text-foreground md:hidden mb-2">
            lerang
          </span>
          <h1 className="text-3xl sm:text-4xl text-foreground font-medium tracking-tight">{title}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-2 text-center">{subtitle}</p>

          <p className="mt-6 w-full border-b border-border pb-4 text-sm leading-6 text-muted-foreground">Peserta, petugas, dan admin masuk di sini. Halaman tujuan mengikuti hak akses akun.</p>

          <label htmlFor="login-email" className="mt-6 w-full text-sm font-medium">Email</label>
          <div className="flex items-center w-full mt-2 bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden px-3 gap-2.5 transition-colors">
            <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              id="login-email"
              type="email"
              placeholder="nama@contoh.com"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="bg-transparent text-foreground placeholder:text-muted-foreground/75 outline-none text-xs sm:text-sm w-full h-full"
              required
              disabled={isSubmitting}
              autoComplete="email"
            />
          </div>

          <label htmlFor="login-password" className="mt-4 w-full text-sm font-medium">Kata sandi</label>
          <div className="flex items-center mt-2 w-full bg-transparent border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 h-12 rounded overflow-hidden pl-3 pr-1 gap-2.5 transition-colors">
            <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              placeholder="Kata sandi"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="bg-transparent text-foreground placeholder:text-muted-foreground/75 outline-none text-xs sm:text-sm w-full h-full"
              required
              autoComplete="current-password"
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
              aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

            <div className="w-full flex justify-end mt-4">
              <button
                type="button"
                onClick={() => onNavigate?.('reset-password')}
                disabled={isSubmitting}
                className="min-h-11 text-xs text-muted-foreground hover:text-primary hover:underline disabled:opacity-50"
              >
                Lupa kata sandi?
              </button>
            </div>

          {statusMessage && (
            <div
              role="alert"
              className="w-full mt-3 p-3 rounded bg-muted text-foreground text-sm border border-border"
            >
              {statusMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full h-12 rounded text-primary-foreground bg-primary hover:opacity-90 transition-colors font-semibold text-sm cursor-pointer disabled:opacity-60"
          >
            {isSubmitting ? "Memproses..." : "Masuk"}
          </button>

          <div className="my-5 flex w-full items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />atau<span className="h-px flex-1 bg-border" /></div>
          <button type="button" onClick={() => void handleGoogleSignIn()} disabled={isSubmitting} className="button-secondary w-full gap-3 disabled:opacity-60">
            <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.6h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.8Z"/><path fill="#34A853" d="M24 44c5.5 0 10.2-1.8 13.6-4.8L31 34.3a12.5 12.5 0 0 1-18.6-6.5H5.6v5.1A20.5 20.5 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.4 27.8a12.2 12.2 0 0 1 0-7.6v-5.1H5.6a20 20 0 0 0 0 17.8l6.8-5.1Z"/><path fill="#EA4335" d="M24 11.9c3 0 5.6 1 7.7 3l5.7-5.7A19.5 19.5 0 0 0 24 4 20.5 20.5 0 0 0 5.6 15.1l6.8 5.1A12.2 12.2 0 0 1 24 11.9Z"/></svg>
            Lanjutkan dengan Google
          </button>

          <p className="text-muted-foreground text-xs mt-5 text-center">
            Belum punya akun?{" "}
            <button
              type="button"
              onClick={() => onNavigate?.("register")}
              className="text-primary font-semibold hover:underline cursor-pointer"
            >
              Daftar
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

export { LoginForm };
