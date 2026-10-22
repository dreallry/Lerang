import React, { useState, useEffect, useRef } from 'react';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah, formatCompactRupiah, formatDateIndo } from '../../utils/formatters';
import {
  Wallet,
  Lock,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  Building,
  CheckCircle2,
  AlertTriangle,
  Bookmark,
  KeyRound,
  X,
  Loader2,
  Trash2
} from 'lucide-react';
import { GuestGuardView } from '../common/GuestGuardView';
import { useFormFeedback } from '../common/FormFeedback';
import { auth } from '../../firebase';
import { authErrorMessage } from '../../utils/authErrors';
import { generateUUID } from '../../utils/formatters';

interface UserWalletProps {
  onNavigate: (view: string, id?: number) => void;
}

interface SavedAccount {
  id: string;
  bank: string;
  accountNum: string;
  accountName: string;
}

export const UserWallet: React.FC<UserWalletProps> = ({ onNavigate }) => {
  const {
    currentUser,
    transactionsList,
    openMidtransModal,
    allJoinedAuctions,
    hasDepositLocked,
    withdrawFunds,
  } = useAuction();

  const [activeTab, setActiveTab] = useState<'topup' | 'withdraw'>('topup');
  const [topUpAmount, setTopUpAmount] = useState<number>(5000000);
  const [customInput, setCustomInput] = useState<string>('');
  const { showError, clearFeedback } = useFormFeedback();
  const [topUpError, setTopUpErrorState] = useState<string | null>(null);
  const setTopUpError = (message: string | null) => {
    setTopUpErrorState(message);
    if (message) showError(message); else clearFeedback();
  };

  // Withdrawal form states
  const [withdrawBank, setWithdrawBank] = useState<string>('BCA');
  const [withdrawAccountNum, setWithdrawAccountNum] = useState<string>('');
  const [withdrawAccountName, setWithdrawAccountName] = useState<string>(currentUser?.nama_lengkap || '');
  const [withdrawAmountStr, setWithdrawAmountStr] = useState<string>('');
  const [saveThisAccount, setSaveThisAccount] = useState<boolean>(true);
  const [withdrawMessage, setWithdrawMessageState] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const setWithdrawMessage = (notice: typeof withdrawMessage) => {
    setWithdrawMessageState(notice);
    if (notice?.type === 'error') showError(notice.text);
    else if (notice) clearFeedback();
  };

  // Password confirmation modal states
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmPasswordError, setConfirmPasswordErrorState] = useState<string | null>(null);
  const setConfirmPasswordError = (message: string | null) => {
    setConfirmPasswordErrorState(message);
    if (message) showError(message, { target: document.getElementById('withdraw-password') }); else clearFeedback();
  };
  const [isConfirmingWithdraw, setIsConfirmingWithdraw] = useState(false);
  const withdrawalRequest = useRef<{details:string;id:string}|null>(null);

  const accountOwner = currentUser ? auth.currentUser?.uid || '' : '';
  const confirmWithGoogle = auth.currentUser?.providerData.some(provider => provider.providerId === 'google.com') && !auth.currentUser?.providerData.some(provider => provider.providerId === 'password');
  const [accountCache, setAccountCache] = useState<{ owner: string; items: SavedAccount[] }>({ owner: '', items: [] });
  const savedAccounts = accountCache.owner === accountOwner ? accountCache.items : [];

  useEffect(() => {
    let items: SavedAccount[] = [];
    try {
      localStorage.removeItem('lelang_saved_accounts');
      const value: unknown = accountOwner ? JSON.parse(localStorage.getItem(`lelang_saved_accounts_${accountOwner}`) || '[]') : [];
      if (Array.isArray(value)) items = value.filter((item): item is SavedAccount =>
        item && ['id', 'bank', 'accountNum', 'accountName'].every(key => typeof item[key] === 'string')
      );
    } catch { /* Saved accounts are optional when browser storage is unavailable. */ }
    setAccountCache({ owner: accountOwner, items });
    setWithdrawAccountNum('');
    setWithdrawAccountName(currentUser?.nama_lengkap || '');
    setConfirmPassword('');
    setIsConfirmModalOpen(false);
  }, [accountOwner]);

  const saveAccounts = (items: SavedAccount[]) => {
    if (!accountOwner || auth.currentUser?.uid !== accountOwner) return;
    setAccountCache({ owner: accountOwner, items });
    try { localStorage.setItem(`lelang_saved_accounts_${accountOwner}`, JSON.stringify(items)); }
    catch { /* The withdrawal does not depend on saving the account on this device. */ }
  };

  if (!currentUser) {
    return (
      <GuestGuardView
        title="Dompet & Saldo Jaminan"
        description="Masuk untuk melihat saldo dompet, uang jaminan lelang yang sedang berjalan, serta riwayat penarikan dana ke rekening pribadimu."
        icon={<Wallet className="w-8 h-8 text-primary" />}
        onNavigate={onNavigate}
      />
    );
  }

  const userTransactions = transactionsList.filter((t) => t.id_user === currentUser.id_user);

  const lockedAuctions = allJoinedAuctions.filter((item) =>
    hasDepositLocked(item.lelang.id_lelang, currentUser.id_user)
  );

  const handleTriggerTopUp = (amount: number) => {
    setTopUpError(null);
    if (!Number.isSafeInteger(amount) || amount < 100000) {
      setTopUpError('Minimal pengisian saldo (top-up) adalah Rp 100.000.');
      return;
    }

    openMidtransModal({
      type: 'topup',
      amount: amount,
      title: 'Top-Up Saldo Jaminan Lelang',
      onSuccess: () => {
        setCustomInput('');
      },
    });
  };

  // Bank account format validation
  const validateAccountNumber = (bank: string, num: string): string | null => {
    const clean = num.trim();
    if (!/^\d+$/.test(clean)) {
      return 'Nomor rekening hanya boleh berisi angka tanpa spasi atau simbol.';
    }

    switch (bank) {
      case 'BCA':
        if (clean.length !== 10) return 'Nomor rekening BCA harus terdiri dari tepat 10 digit.';
        break;
      case 'Bank Mandiri':
        if (clean.length !== 13) return 'Nomor rekening Bank Mandiri harus terdiri dari tepat 13 digit.';
        break;
      case 'BNI':
        if (clean.length !== 10) return 'Nomor rekening BNI harus terdiri dari tepat 10 digit.';
        break;
      case 'BRI':
        if (clean.length !== 15) return 'Nomor rekening BRI harus terdiri dari tepat 15 digit.';
        break;
      case 'Bank Jago':
        if (clean.length !== 12) return 'Nomor rekening Bank Jago harus terdiri dari tepat 12 digit.';
        break;
      default:
        if (clean.length < 8 || clean.length > 18) return 'Nomor rekening harus terdiri dari 8 hingga 18 digit.';
    }

    return null;
  };

  const handleInitiateWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawMessage(null);

    const nominal = Number(withdrawAmountStr);

    if (!withdrawAccountNum.trim()) {
      setWithdrawMessage({ type: 'error', text: 'Nomor rekening tujuan wajib diisi.' });
      return;
    }

    const accError = validateAccountNumber(withdrawBank, withdrawAccountNum);
    if (accError) {
      setWithdrawMessage({ type: 'error', text: accError });
      return;
    }

    if (!withdrawAccountName.trim()) {
      setWithdrawMessage({ type: 'error', text: 'Nama pemilik rekening wajib diisi sesuai buku tabungan.' });
      return;
    }

    if (!Number.isSafeInteger(nominal) || nominal < 50000) {
      setWithdrawMessage({ type: 'error', text: 'Minimal penarikan dana adalah Rp 50.000.' });
      return;
    }

    if (nominal > currentUser.saldo_wallet) {
      setWithdrawMessage({
        type: 'error',
        text: `Saldo bebas tidak mencukupi. Tersedia: ${formatRupiah(currentUser.saldo_wallet)}.`,
      });
      return;
    }

    // Open security confirmation modal
    setConfirmPassword('');
    setConfirmPasswordError(null);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmWithdraw = async () => {
    if (isConfirmingWithdraw) return;
    if (!confirmWithGoogle && !confirmPassword) {
      setConfirmPasswordError('Harap masukkan kata sandi akun Anda untuk konfirmasi keamanan.');
      return;
    }

    const signedInUser = auth.currentUser;
    if (!signedInUser?.email) {
      setConfirmPasswordError('Sesi akun tidak tersedia. Silakan masuk kembali.');
      return;
    }

    setIsConfirmingWithdraw(true);
    try {
      if (confirmWithGoogle) await reauthenticateWithPopup(signedInUser, new GoogleAuthProvider());
      else await reauthenticateWithCredential(signedInUser, EmailAuthProvider.credential(signedInUser.email, confirmPassword));
      if (auth.currentUser?.uid !== signedInUser.uid) return;
      await signedInUser.getIdToken(true);
      const nominal = Number(withdrawAmountStr);
      const details=JSON.stringify([signedInUser.uid,nominal,withdrawBank,withdrawAccountNum.trim(),withdrawAccountName.trim()]);
      if(withdrawalRequest.current?.details!==details) withdrawalRequest.current={details,id:generateUUID()};
      const result = await withdrawFunds(
        nominal,
        withdrawBank,
        withdrawAccountNum.trim(),
        withdrawAccountName.trim(),
        withdrawalRequest.current!.id
      );

      if (result.success) {
        withdrawalRequest.current=null;
        if (saveThisAccount) {
          const alreadyExists = savedAccounts.some(
            (account) => account.bank === withdrawBank && account.accountNum === withdrawAccountNum.trim()
          );
          if (!alreadyExists) {
            const newAccount: SavedAccount = {
              id: `acc-${Date.now()}`,
              bank: withdrawBank,
              accountNum: withdrawAccountNum.trim(),
              accountName: withdrawAccountName.trim(),
            };
            saveAccounts([newAccount, ...savedAccounts]);
          }
        }
        setWithdrawMessage({ type: 'success', text: result.message });
        setWithdrawAmountStr('');
        setIsConfirmModalOpen(false);
      } else {
        setWithdrawMessage({ type: 'error', text: result.message });
        setConfirmPasswordError(result.message);
      }
    } catch (error) {
      setConfirmPasswordError(authErrorMessage(error));
    } finally {
      setConfirmPassword('');
      setIsConfirmingWithdraw(false);
    }
  };

  const handleSelectSavedAccount = (acc: SavedAccount) => {
    setWithdrawBank(acc.bank);
    setWithdrawAccountNum(acc.accountNum);
    setWithdrawAccountName(acc.accountName);
  };

  const handleDeleteSavedAccount = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    saveAccounts(savedAccounts.filter((account) => account.id !== id));
  };

  return (
    <div className="space-y-12 pb-24 max-w-6xl mx-auto">
      {currentUser.financial_review_required&&<p role="alert" className="border border-border bg-muted p-4 text-sm">Transaksi akun ini menunggu pemeriksaan pengelola. Saldo tetap ditampilkan sesuai catatan; hubungi petugas untuk rekonsiliasi sebelum melakukan transaksi baru.</p>}
      {/* Header */}
      <div className="space-y-2 pb-6 border-b border-border">
        <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
          Dompet
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
          Lihat saldo tersedia, jaminan aktif, dan riwayat transaksi. Isi saldo atau ajukan penarikan ke rekening Anda.
        </p>
      </div>

      {/* 2-Column Balance Overview & Action Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Balances (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Saldo Aktif */}
            <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-3">
              <span className="text-xs text-muted-foreground">Saldo Tersedia (Bebas)</span>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-foreground break-words">
                {formatRupiah(currentUser.saldo_wallet)}
              </div>
              <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                Bisa dipakai untuk ikut lelang baru atau ditarik langsung ke rekening.
              </p>
            </div>

            {/* Saldo Dikunci (Jaminan) */}
            <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Jaminan Sedang Berjalan</span>
                <Lock className="w-4 h-4 text-primary" />
              </div>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-foreground break-words">
                {formatRupiah(currentUser.saldo_hold)}
              </div>
              <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                Sedang dipakai sebagai jaminan untuk {lockedAuctions.length} barang yang kamu ikuti.
              </p>
            </div>
          </div>

          {/* List of Held Deposits */}
          <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="text-lg font-medium text-foreground">Jaminan aktif</h2>
              <span className="text-xs font-mono text-muted-foreground">{lockedAuctions.length} lelang</span>
            </div>

            {lockedAuctions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Tidak ada deposit jaminan yang sedang dikunci saat ini.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {lockedAuctions.map((item) => (
                  <button
                    type="button"
                    key={item.lelang.id_lelang}
                    onClick={() => onNavigate('auction-detail', item.lelang.id_lelang)}
                    className="w-full py-3 flex items-center justify-between gap-4 text-left text-sm cursor-pointer hover:bg-muted/40 px-2 rounded transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-foreground">{item.barang.nama_barang}</div>
                      <div className="text-muted-foreground text-[11px]">Lelang #{item.lelang.id_lelang}</div>
                    </div>
                    <div className="font-mono font-semibold text-foreground">
                      {formatRupiah(item.lelang.uang_jaminan)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Tabbed Action Box (Top-Up or Withdrawal) (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-5">
            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                type="button"
                onClick={() => setActiveTab('topup')}
                aria-pressed={activeTab === 'topup'}
                className={`flex-1 min-h-11 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'topup'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Isi saldo
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('withdraw')}
                aria-pressed={activeTab === 'withdraw'}
                className={`flex-1 min-h-11 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'withdraw'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Tarik dana
              </button>
            </div>

            {activeTab === 'topup' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Isi Saldo Dompet Lelang</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pilih nominal instan atau ketik jumlah yang ingin kamu tambahkan (minimal Rp 100.000):
                  </p>
                </div>

                {topUpError && (
                  <div className="p-3 rounded-xl text-xs flex items-start gap-2 border bg-destructive/10 border-destructive/20 text-destructive">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{topUpError}</span>
                  </div>
                )}

                {/* Presets */}
                <div className="grid grid-cols-2 gap-2">
                  {[2000000, 5000000, 10000000, 25000000].map((nominal) => (
                    <button
                      key={nominal}
                      type="button"
                      onClick={() => {
                        setTopUpAmount(nominal);
                        setCustomInput('');
                        setTopUpError(null);
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-mono font-semibold transition text-center ${
                        topUpAmount === nominal && !customInput
                          ? 'bg-primary text-primary-foreground border-border'
                          : 'bg-muted/40 text-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {formatCompactRupiah(nominal)}
                    </button>
                  ))}
                </div>

                {/* Custom Input */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nominal Lain (Rp)</label>
                  <input
                    type="number"
                    placeholder="Minimal Rp 100.000"
                    value={customInput}
                    onChange={(e) => {
                      setCustomInput(e.target.value);
                      setTopUpError(null);
                      if (e.target.value) {
                        setTopUpAmount(Number(e.target.value));
                      }
                    }}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs font-mono text-foreground focus:border-primary outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleTriggerTopUp(topUpAmount)}
                  className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs border border-border transition hover:opacity-90 shadow-xs cursor-pointer"
                >
                  Lanjut Isi Saldo {formatRupiah(topUpAmount)}
                </button>
              </div>
            ) : (
              /* Withdraw Form */
              <form onSubmit={handleInitiateWithdraw} className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Tarik Dana ke Rekening</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tarik saldo yang tidak terkunci langsung ke rekening bank pribadimu (min. Rp 50.000).
                  </p>
                </div>

                {/* Saved Accounts Selector */}
                {savedAccounts.length > 0 && (
                  <div className="space-y-1.5 pb-2 border-b border-border/80">
                    <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                      <Bookmark className="w-3 h-3 text-primary" /> Rekening Tersimpan:
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {savedAccounts.map((acc) => {
                        const isSelected =
                          withdrawBank === acc.bank && withdrawAccountNum === acc.accountNum;
                        return (
                          <div
                            key={acc.id}
                            onClick={() => handleSelectSavedAccount(acc)}
                            className={`group inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition ${
                              isSelected
                                ? 'bg-primary/10 border-primary text-primary font-semibold'
                                : 'bg-muted/50 border-border text-foreground hover:bg-muted'
                            }`}
                          >
                            <span className="font-mono">{acc.bank} - {acc.accountNum}</span>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSavedAccount(acc.id, e)}
                              className="text-muted-foreground hover:text-destructive transition opacity-60 hover:opacity-100"
                              title="Hapus rekening tersimpan"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {withdrawMessage && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                      withdrawMessage.type === 'success'
                        ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                        : 'bg-destructive/10 border-destructive/20 text-destructive'
                    }`}
                  >
                    {withdrawMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <span>{withdrawMessage.text}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground block">Bank Tujuan</label>
                  <select
                    value={withdrawBank}
                    onChange={(e) => setWithdrawBank(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:border-primary outline-none"
                  >
                    <option value="BCA">Bank BCA (10 digit)</option>
                    <option value="Bank Mandiri">Bank Mandiri (13 digit)</option>
                    <option value="BNI">Bank BNI (10 digit)</option>
                    <option value="BRI">Bank BRI (15 digit)</option>
                    <option value="Bank Jago">Bank Jago (12 digit)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground block">Nomor Rekening</label>
                  <input
                    type="text"
                    placeholder="Contoh: 8201239821"
                    value={withdrawAccountNum}
                    onChange={(e) => setWithdrawAccountNum(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs font-mono text-foreground focus:border-primary outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground block">Nama Pemilik Rekening</label>
                  <input
                    type="text"
                    placeholder="Sesuai buku tabungan"
                    value={withdrawAccountName}
                    onChange={(e) => setWithdrawAccountName(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs text-foreground focus:border-primary outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Nominal Penarikan (Rp)</span>
                    <span className="font-mono">Tersedia: {formatCompactRupiah(currentUser.saldo_wallet)}</span>
                  </div>
                  <input
                    type="number"
                    placeholder="Minimal Rp 50.000"
                    value={withdrawAmountStr}
                    onChange={(e) => setWithdrawAmountStr(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-4 py-2 text-xs font-mono text-foreground focus:border-primary outline-none"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground pt-1">
                  <input
                    type="checkbox"
                    checked={saveThisAccount}
                    onChange={(e) => setSaveThisAccount(e.target.checked)}
                    className="rounded text-primary focus:ring-primary/20"
                  />
                  <span>Simpan rekening ini untuk penarikan berikutnya</span>
                </label>

                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-xs border border-border transition hover:opacity-90 shadow-xs cursor-pointer flex items-center justify-center gap-2"
                >
                  <Building className="w-4 h-4" />
                  <span>Lanjutkan Penarikan Dana</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Transaction History Log */}
      <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border text-xs">
          <span className="font-semibold text-foreground flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary" /> Riwayat Mutasi Saldo & Jaminan
          </span>
          <span className="text-muted-foreground font-mono">{userTransactions.length} transaksi</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-3 px-3">Tanggal</th>
                <th className="py-3 px-3">Jenis</th>
                <th className="py-3 px-3">Keterangan</th>
                <th className="py-3 px-3 text-right">Nominal</th>
                <th className="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {userTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    Belum ada riwayat transaksi dompet.
                  </td>
                </tr>
              ) : (
                userTransactions.map((trx) => {
                  let sign = '';
                  let icon = <Clock className="w-3.5 h-3.5" />;
                  let typeLabel = trx.tipe.replace('_', ' ');

                  if (trx.tipe === 'topup') {
                    icon = <ArrowDownLeft className="w-3.5 h-3.5 text-green-500" />;
                    sign = '+';
                    typeLabel = 'Isi Saldo';
                  } else if (trx.tipe === 'unhold') {
                    icon = <ArrowDownLeft className="w-3.5 h-3.5 text-green-500" />;
                    sign = '+';
                    typeLabel = 'Pelepasan Jaminan';
                  } else if (trx.tipe === 'payout_c2c') {
                    icon = <ArrowDownLeft className="w-3.5 h-3.5 text-green-500" />;
                    sign = '+';
                    typeLabel = 'Hasil Titip Jual';
                  } else if (trx.tipe === 'hold') {
                    icon = <Lock className="w-3.5 h-3.5 text-muted-foreground" />;
                    sign = '-';
                    typeLabel = 'Kunci Jaminan';
                  } else if (trx.tipe === 'pelunasan') {
                    icon = <ArrowUpRight className="w-3.5 h-3.5 text-primary" />;
                    sign = '-';
                    typeLabel = 'Pelunasan Menang Lelang';
                  } else if (trx.tipe === 'withdraw') {
                    icon = <ArrowUpRight className="w-3.5 h-3.5 text-amber-500" />;
                    sign = '-';
                    typeLabel = 'Tarik Dana';
                  } else if (trx.tipe === 'forfeit') {
                    icon = <AlertTriangle className="w-3.5 h-3.5 text-destructive" />;
                    sign = '-';
                    typeLabel = 'Jaminan Terpotong';
                  }

                  const isPending = trx.status === 'pending';

                  return (
                    <tr key={trx.id} className="hover:bg-muted/30">
                      <td className="py-3 px-3 font-mono text-muted-foreground">{formatDateIndo(trx.created_at)}</td>
                      <td className="py-3 px-3 flex items-center gap-1.5 capitalize font-medium">
                        {icon}
                        <span>{typeLabel}</span>
                      </td>
                      <td className="py-3 px-3 text-foreground">{trx.keterangan}</td>
                      <td className={`py-3 px-3 text-right font-mono font-semibold ${
                        trx.tipe === 'forfeit' ? 'text-destructive' : 'text-foreground'
                      }`}>
                        {sign}{formatRupiah(trx.nominal)}
                      </td>
                      <td className="py-3 px-3 text-center text-[11px] font-medium">
                        {isPending ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold animate-pulse font-mono">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            DIPROSES
                          </span>
                        ) : (
                          <span className={`px-2 py-0.5 rounded-full ${
                            trx.tipe === 'forfeit' ? 'bg-destructive/15 text-destructive font-semibold' : 'bg-muted text-muted-foreground'
                          }`}>
                            {trx.status.toUpperCase()}
                          </span>
                        )}
                        {isPending && trx.tipe === 'topup' && trx.request_id && <button type="button" className="focus-ring mt-2 block min-h-11 w-full text-primary underline underline-offset-4" onClick={() => openMidtransModal({type:'topup', amount:trx.nominal, title:'Lanjutkan isi saldo', refId:trx.request_id})}>Lanjutkan pembayaran</button>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Confirmation Password Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <KeyRound className="w-4 h-4 text-primary" />
                <span>Konfirmasi Keamanan Penarikan</span>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground leading-relaxed">
                {confirmWithGoogle ? 'Konfirmasi kembali akun Google sebelum mengajukan penarikan ke rekening:' : 'Masukkan kata sandi akun sebelum mengajukan penarikan ke rekening:'}
              </p>

              <div className="p-3 rounded-xl bg-muted/50 border border-border space-y-1 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bank Tujuan:</span>
                  <strong className="text-foreground">{withdrawBank}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nomor Rekening:</span>
                  <strong className="text-foreground">{withdrawAccountNum}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nama Penerima:</span>
                  <strong className="text-foreground">{withdrawAccountName}</strong>
                </div>
                <div className="flex justify-between pt-1 border-t border-border/80">
                  <span className="text-muted-foreground">Total Penarikan:</span>
                  <strong className="text-primary font-bold text-sm">
                    {formatRupiah(Number(withdrawAmountStr))}
                  </strong>
                </div>
              </div>

              {confirmPasswordError && (
                <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{confirmPasswordError}</span>
                </div>
              )}

              {!confirmWithGoogle && <div className="space-y-1 pt-1">
                <label htmlFor="withdraw-password" className="block text-foreground font-medium">Kata sandi akun</label>
                <input
                  id="withdraw-password"
                  autoComplete="current-password"
                  type="password"
                  autoFocus
                  placeholder="Masukkan kata sandi akun"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmPasswordError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmWithdraw();
                    }
                  }}
                  className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-xs text-foreground focus:border-primary outline-none"
                />
              </div>}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmWithdraw}
                disabled={isConfirmingWithdraw}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition shadow-xs flex items-center gap-2"
              >
                {isConfirmingWithdraw ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{isConfirmingWithdraw ? 'Memproses...' : confirmWithGoogle ? 'Konfirmasi lewat Google' : 'Ajukan penarikan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
