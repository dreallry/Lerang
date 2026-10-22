import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah } from '../../utils/formatters';
import { topUpRequestId } from '../../utils/paymentAttempt';
import { loadSnap } from '../../utils/midtransSnap';
import { auth } from '../../firebase';
import api, { SnapPaymentResponse } from '../../services/api';
import { useFormFeedback } from './FormFeedback';

declare global {
  interface Window {
    snap?: { pay: (token: string, callbacks: {
      onSuccess: () => void; onPending: () => void; onError: () => void; onClose: () => void;
    }) => void };
  }
}

const delay = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export const MidtransSnapModal: React.FC = () => {
  const { midtransModal, closeMidtransModal, topUpDeposit, payInvoice, refreshFinancialData, transactionsList } = useAuction();
  const { showError, clearFeedback } = useFormFeedback();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState('');
  const [amountToPay, setAmountToPay] = useState(0);
  const [checkout, setCheckout] = useState<SnapPaymentResponse | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const run = useRef(0);
  const [epoch, setEpoch] = useState(0);
  const checking = useRef(false);
  const verified = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const owner = auth.currentUser?.uid || '';

  useEffect(() => {
    setEpoch(++run.current); checking.current = false; verified.current = false;
    if (!midtransModal?.isOpen || !owner) return;
    setIsProcessing(false); setIsVerified(false); setMessage(''); setCheckout(null); setSandbox(false); setTerminal(false);
    setAmountToPay(midtransModal.amount);
    const key = `lerang_topup_${owner}_${midtransModal.amount}`;
    let cached = attempts.current.get(key) || '';
    try { cached = sessionStorage.getItem(key) || cached; } catch { /* The in-memory ID still prevents repeated requests in this tab. */ }
    const id = midtransModal.type === 'topup'
      ? topUpRequestId(midtransModal.amount, transactionsList, midtransModal.refId || cached, () => window.crypto?.randomUUID?.() || '') : '';
    if (id) {
      attempts.current.set(key, id);
      try { sessionStorage.setItem(key, id); } catch { /* The server ledger also retains pending request IDs. */ }
    }
    setRequestId(id);
    const element = dialog.current;
    element?.showModal();
    return () => { run.current++; element?.close(); };
  }, [midtransModal, owner]);

  if (!midtransModal?.isOpen) return null;
  const active = () => epoch === run.current && Boolean(owner) && auth.currentUser?.uid === owner;

  const checkPayment = async (payment: SnapPaymentResponse) => {
    if (!active() || checking.current || verified.current) return;
    const orderId = payment.data?.order_id;
    if (!orderId) return;
    checking.current = true; setIsProcessing(true); setMessage('Memeriksa pembayaran melalui server...'); clearFeedback();
    try {
      const deadline = Date.now() + 60_000;
      while (active() && Date.now() < deadline) {
        const status = await api.syncPayment(orderId);
        if (!active()) return;
        const paid = await refreshFinancialData({ type: midtransModal.type, orderId });
        if (!active()) return;
        if (['failed','review_required'].includes(status.data.status)) {
          setTerminal(true);
          const message = status.data.status === 'failed' ? 'Pembayaran ini sudah berakhir atau gagal. Saldo tidak ditambahkan. Kembali ke dompet atau tagihan untuk membuat pembayaran baru.' : 'Pembayaran memerlukan pemeriksaan petugas. Jangan mengulang pembayaran sebelum statusnya dipastikan.';
          setMessage(message); showError(message);
          return;
        }
        if (paid) {
          verified.current = true;
          if (midtransModal.type === 'topup') {
            const key = `lerang_topup_${owner}_${midtransModal.amount}`;
            attempts.current.delete(key);
            try { sessionStorage.removeItem(key); } catch { /* Server payment state remains authoritative. */ }
          }
          midtransModal.onSuccess?.();
          setIsVerified(true); setMessage('Pembayaran telah diverifikasi. Saldo atau tagihan sudah diperbarui.');
          return;
        }
        await delay(2000);
      }
      if (active()) setMessage('Belum ada konfirmasi pembayaran. Anda bisa menutup halaman ini dan memeriksa riwayat transaksi.');
    } catch (error) {
      if (active()) { const message = error instanceof Error ? error.message : 'Status belum dapat diperiksa. Coba kembali.'; setMessage(message); showError(message); }
    } finally {
      if (active()) { checking.current = false; setIsProcessing(false); }
    }
  };

  const handleStartPayment = async () => {
    if (isProcessing || !active()) return;
    setIsProcessing(true); setMessage(''); clearFeedback();
    try {
      if (midtransModal.type === 'topup' && !requestId) throw new Error('Browser tidak dapat membuat ID transaksi yang aman. Perbarui browser lalu coba lagi.');
      const payment = checkout || (midtransModal.type === 'topup'
        ? await topUpDeposit(midtransModal.amount, requestId) : await payInvoice(Number(midtransModal.refId)));
      if (!active()) return;
      if (!payment.success || !payment.data?.snap_token || !payment.data.client_key) throw new Error(payment.message || 'Data pembayaran belum tersedia dari server.');
      setCheckout(payment); setSandbox(!payment.data.is_production);
      const amount = midtransModal.type === 'topup' ? payment.data.nominal : payment.data.total_tagihan;
      if (typeof amount === 'number') setAmountToPay(amount);
      await loadSnap(payment.data.client_key, payment.data.is_production);
      if (!active()) return;
      if (!window.snap) throw new Error('Midtrans belum siap. Coba lanjutkan pembayaran yang sama.');
      setMessage('Selesaikan pembayaran di Midtrans. Server akan memeriksa statusnya.');
      const finish = (text: string) => { if (active() && !verified.current && !checking.current) { setIsProcessing(false); setMessage(text); } };
      // Snap renders outside this dialog; release the browser focus trap while its checkout is open.
      dialog.current?.close();
      const restore = () => { if (active() && !dialog.current?.open) dialog.current?.showModal(); };
      window.snap.pay(payment.data.snap_token, {
        onSuccess: () => { restore(); void checkPayment(payment); },
        onPending: () => { restore(); finish('Pembayaran belum selesai. Lanjutkan pembayaran yang sama atau periksa status.'); },
        onError: () => { restore(); const message = 'Pembayaran dilaporkan gagal oleh Midtrans. Periksa status melalui server sebelum mengulang.'; finish(message); if (active() && !verified.current && !checking.current) showError(message); },
        onClose: () => { restore(); finish('Jendela Midtrans ditutup. Pembayaran yang sama bisa dilanjutkan.'); },
      });
    } catch (error) {
      if (active()) {
        if (!dialog.current?.open) dialog.current?.showModal();
        const message = error instanceof Error ? error.message : 'Gagal menyiapkan pembayaran.';
        setMessage(message); showError(message); setIsProcessing(false);
      }
    }
  };

  return <dialog ref={dialog} aria-labelledby="payment-title" onCancel={event => { event.preventDefault(); closeMidtransModal(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-lg border border-border bg-card p-0 text-foreground backdrop:bg-foreground/40">
    <div className="flex items-center justify-between gap-3 border-b border-border p-5">
      <div><h2 id="payment-title" className="font-semibold">Pembayaran Midtrans</h2><p className="mt-1 text-sm text-muted-foreground">{midtransModal.title}</p></div>
      <button type="button" onClick={closeMidtransModal} aria-label="Tutup pembayaran" className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center"><X className="h-5 w-5" /></button>
    </div>
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4"><span className="text-sm text-muted-foreground">Total pembayaran</span><strong className="text-xl tabular-nums">{formatRupiah(amountToPay)}</strong></div>
      <p className="text-sm leading-6 text-muted-foreground">Pilih metode pembayaran di Midtrans. Saldo dan tagihan berubah setelah server mengonfirmasi pembayaran.</p>
      {sandbox && <p role="status" className="border border-border p-3 text-sm">Midtrans Sandbox. Gunakan pembayaran uji; dana bank nyata tidak digunakan.</p>}
      {message && <p role="status" className="border border-border bg-muted p-3 text-sm leading-6">{message}</p>}
      {!isVerified && !terminal && <button type="button" onClick={handleStartPayment} disabled={isProcessing} className="button-primary flex w-full items-center justify-center gap-2 disabled:opacity-50">{isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{isProcessing ? 'Memproses...' : checkout ? 'Lanjutkan pembayaran yang sama' : 'Lanjutkan ke Midtrans'}</button>}
      {checkout && !isVerified && !terminal && <button type="button" disabled={isProcessing} onClick={() => void checkPayment(checkout)} className="button-secondary w-full disabled:opacity-50">Periksa status pembayaran</button>}
      {(isVerified || terminal) && <button type="button" onClick={closeMidtransModal} className="button-primary w-full">{isVerified ? 'Selesai' : 'Kembali'}</button>}
    </div>
  </dialog>;
};
