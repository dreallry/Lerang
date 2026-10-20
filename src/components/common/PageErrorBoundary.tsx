import { Component, type ReactNode } from 'react';

export class PageErrorBoundary extends Component<{children:ReactNode}, {failed:boolean}> {
  state = {failed:false};

  static getDerivedStateFromError() { return {failed:true}; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="site-container py-12 sm:py-20">
      <section role="alert" className="mx-auto max-w-lg space-y-6 rounded-lg border border-border bg-card p-6 sm:p-10">
        <p className="font-serif text-3xl font-semibold text-primary">lerang.</p>
        <h1 className="text-2xl font-medium tracking-tight">Halaman belum dapat ditampilkan</h1>
        <p className="text-sm leading-7 text-muted-foreground">Terjadi gangguan saat membuka halaman. Muat ulang untuk mencoba kembali. Jika sedang bertransaksi, periksa riwayat sebelum mengulang pembayaran.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => location.reload()} className="button-primary">Muat ulang halaman</button>
          <button type="button" onClick={() => { history.replaceState(null, '', location.pathname + '#catalog'); location.reload(); }} className="button-secondary">Kembali ke katalog</button>
        </div>
      </section>
    </main>;
  }
}
