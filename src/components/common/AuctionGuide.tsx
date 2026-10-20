import React from 'react';
import { useAuction } from '../../context/AuctionContext';

interface AuctionGuideProps {
  onNavigate: (view: string) => void;
}

const steps = [
  {
    title: 'Baca detail lot',
    description: 'Periksa foto, kondisi barang, harga awal, biaya, dan jadwal sebelum menawar. Setiap lot memiliki detail yang berbeda; gunakan informasi di halaman barang untuk menentukan pilihan Anda.',
  },
  {
    title: 'Siapkan akun dan jaminan',
    description: 'Masuk untuk melihat saldo dompet dan nominal jaminan yang dibutuhkan untuk lot pilihan. Lengkapi data akun dan periksa persyaratan pada halaman lot sebelum mengajukan penawaran.',
  },
  {
    title: 'Ikuti penawaran',
    description: 'Riwayat dan penawaran tertinggi tampil di halaman lot. Periksa nominal penawaran serta waktu yang tersisa sebelum mengirimkan tawaran Anda.',
  },
  {
    title: 'Periksa tagihan setelah menang',
    description: 'Ikuti batas pembayaran yang tertera pada tagihan. Setelah pembayaran selesai, lengkapi alamat penerima dan pantau status pengiriman dari akun Anda.',
  },
];

export const AuctionGuide: React.FC<AuctionGuideProps> = ({ onNavigate }) => {
  const { currentUser, currentOfficer, currentRole } = useAuction();
  const isSignedIn = Boolean(currentUser || currentOfficer);

  return (
    <article className="mx-auto max-w-5xl">
      <button type="button" onClick={() => onNavigate('catalog')} className="text-link mb-6 inline-flex min-h-11 items-center text-sm text-muted-foreground">Kembali ke katalog</button>
      <header className="mb-10 border-b border-border pb-8 sm:mb-12">
        <h1 className="font-serif text-4xl leading-tight text-foreground sm:text-5xl">Panduan mengikuti lelang</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">Dari memilih barang hingga menerima pesanan. Detail biaya, jaminan, dan jadwal dapat Anda lihat pada masing-masing lot.</p>
      </header>

      <ol className="divide-y divide-border">
        {steps.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-4 py-7 first:pt-0 sm:grid-cols-[3rem_1fr_1.5fr] sm:gap-x-8 sm:py-8">
            <span aria-hidden="true" className="pt-1 text-sm tabular-nums text-muted-foreground">0{index + 1}</span>
            <h2 className="text-lg font-semibold leading-snug text-foreground sm:text-xl">{step.title}</h2>
            <p className="col-start-2 mt-3 text-sm leading-7 text-muted-foreground sm:col-start-auto sm:mt-0">{step.description}</p>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">Katalog bisa Anda jelajahi tanpa akun. Masuk saat Anda siap mengikuti penawaran.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => onNavigate('catalog')} className="button-secondary whitespace-nowrap">Jelajahi katalog</button>
          <button type="button" onClick={() => onNavigate(isSignedIn ? currentRole === 'masyarakat' ? 'journey' : 'admin-dashboard' : 'register')} className="button-primary whitespace-nowrap">{isSignedIn ? 'Buka akun saya' : 'Buat akun'}</button>
        </div>
      </div>
      {!isSignedIn && <p className="mt-4 text-sm text-muted-foreground sm:text-right">Sudah punya akun? <button type="button" onClick={() => onNavigate('login')} className="text-link inline-flex min-h-11 items-center px-1 text-foreground">Masuk</button></p>}
    </article>
  );
};
