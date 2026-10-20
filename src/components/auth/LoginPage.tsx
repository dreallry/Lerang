import React from 'react';
import LoginForm from '@/components/ui/login-form';
import { ChevronLeft } from 'lucide-react';

interface LoginPageProps {
  onNavigate: (view: string, id?: number) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigate }) => {
  return (
    <div className="min-h-[calc(100vh-120px)] w-full flex flex-col items-center justify-center py-6 sm:py-10 px-4 sm:px-6">
      <div className="w-full max-w-5xl mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Kembali ke Katalog Lelang</span>
        </button>
        <span className="text-sm text-muted-foreground">
          Akun Lerang
        </span>
      </div>

      <LoginForm onNavigate={onNavigate} />
    </div>
  );
};
