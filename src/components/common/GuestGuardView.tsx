import React from 'react';

interface GuestGuardViewProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  onNavigate: (view: string, id?: number) => void;
}

export const GuestGuardView: React.FC<GuestGuardViewProps> = ({ title, description, onNavigate }) => (
  <div className="mx-auto max-w-xl py-6 sm:py-12">
    <button type="button" onClick={() => onNavigate('catalog')} className="text-link mb-8 min-h-11 text-sm text-muted-foreground">Kembali ke katalog</button>
    <section className="border-y border-border py-10 sm:py-12">
      <p className="mb-3 text-sm text-muted-foreground">Masuk untuk melanjutkan</p>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{description}</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" onClick={() => onNavigate('login')} className="button-primary">Masuk ke akun</button>
        <button type="button" onClick={() => onNavigate('register')} className="button-secondary">Buat akun</button>
      </div>
    </section>
  </div>
);
