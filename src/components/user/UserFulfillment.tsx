import React, { useState, useMemo } from 'react';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah, formatDateIndo } from '../../utils/formatters';
import {
  Truck,
  Package,
  MapPin,
  CheckCircle2,
  Clock,
  Star,
  Copy,
  Check,
  ChevronRight,
  Edit3,
  X,
} from 'lucide-react';
import { GuestGuardView } from '../common/GuestGuardView';
import type { CourierOption } from '../../services/api';
import { isPickup, recipientReady } from '../../utils/shipping';

interface UserFulfillmentProps {
  onNavigate: (view: string, id?: number) => void;
  selectedInvoiceId?: number | null;
}

export const UserFulfillment: React.FC<UserFulfillmentProps> = ({
  onNavigate,
  selectedInvoiceId,
}) => {
  const {
    currentUser,
    fulfillmentList,
    courierOptions,
    pembayaranList,
    barangList,
    updateFulfillmentAddress,
    updateFulfillmentCourier,
    confirmFulfillmentReceived,
  } = useAuction();

  // Selected order state
  const [isSaving, setIsSaving] = useState(false);
  const [activeFulfillmentId, setActiveFulfillmentId] = useState<string | null>(null);

  // Address form state
  const [addressForm, setAddressForm] = useState({
    nama_penerima: '',
    telp_penerima: '',
    alamat_lengkap: '',
    kota: '',
    kode_pos: '',
  });
  const [isEditingAddress, setIsEditingAddress] = useState(false);


  // Rating & Review form state
  const [ratingInput, setRatingInput] = useState<number>(5);
  const [ulasanInput, setUlasanInput] = useState<string>('');

  // Copy resi state
  const [copiedResi, setCopiedResi] = useState(false);

  // Success message toast
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  // Filter orders
  const relevantOrders = useMemo(() => {
    if (!currentUser) return [];
    return fulfillmentList.filter(
      (f) => f.id_user_pembeli === currentUser.id_user || f.id_user_penjual === currentUser.id_user
    );
  }, [fulfillmentList, currentUser]);

  // Determine current active order
  const currentOrder = useMemo(() => {
    if (activeFulfillmentId) {
      return relevantOrders.find((f) => f.id_fulfillment === activeFulfillmentId) || null;
    }
    if (selectedInvoiceId) {
      const match = relevantOrders.find((f) => f.id_pembayaran === selectedInvoiceId);
      if (match) return match;
    }
    return relevantOrders.length > 0 ? relevantOrders[0] : null;
  }, [relevantOrders, activeFulfillmentId, selectedInvoiceId]);
  const pickup = currentOrder ? isPickup(currentOrder) : false;
  React.useEffect(() => { setActiveFulfillmentId(null); }, [selectedInvoiceId]);

  // Set address form initial values when current order changes
  React.useEffect(() => {
    if (currentOrder) {
      setAddressForm({
        nama_penerima: currentOrder.nama_penerima || currentUser?.nama_lengkap || '',
        telp_penerima: currentOrder.telp_penerima || currentUser?.telp || '',
        alamat_lengkap: currentOrder.alamat_lengkap || '',
        kota: currentOrder.kota || '',
        kode_pos: currentOrder.kode_pos || '',
      });
      setIsEditingAddress(currentOrder.id_user_pembeli === currentUser?.id_user && !recipientReady(currentOrder));
    }
  }, [currentOrder?.id_fulfillment, currentOrder?.kurir, currentUser?.id_user]);

  if (!currentUser) {
    return (
      <GuestGuardView
        title="Pengiriman & Pelacakan Lot"
        description="Masuk untuk memantau proses pengiriman, konfirmasi alamat penerima, nomor resi ekspedisi, dan konfirmasi penerimaan barang lelang Anda."
        icon={<Truck className="w-8 h-8 text-primary" />}
        onNavigate={onNavigate}
      />
    );
  }

  // Handle address submit
  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrder || isSaving) return;
    if (
      !addressForm.nama_penerima.trim() ||
      !addressForm.telp_penerima.trim() ||
      !pickup && (!addressForm.alamat_lengkap.trim() ||
      !addressForm.kota.trim() ||
      !addressForm.kode_pos.trim())
    ) {
      setActionMessage('Mohon lengkapi semua kolom alamat pengiriman.');
      setActionFailed(true);
      return;
    }

    setIsSaving(true);
    const res = await updateFulfillmentAddress(currentOrder.id_fulfillment, addressForm);
    setIsSaving(false);
    setActionFailed(!res.success);
    setActionMessage(res.message);
    if (res.success) setIsEditingAddress(false);
    setTimeout(() => setActionMessage(null), 4000);
  };

  // Handle courier select
  const handleSelectCourier = async (courier: CourierOption) => {
    if (!currentOrder || isSaving) return;
    setIsSaving(true);
    const res = await updateFulfillmentCourier(currentOrder.id_fulfillment, {
      kurir: courier.name,
      layanan_kurir: courier.service,
      ongkir: courier.price,
    });
    setIsSaving(false);
    setActionFailed(!res.success);
    setActionMessage(res.message);
    setTimeout(() => setActionMessage(null), 4000);
  };


  // Handle confirm received
  const handleConfirmReceived = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrder || isSaving) return;
    if (!ulasanInput.trim()) {
      setActionMessage('Mohon tuliskan ulasan singkat mengenai kondisi barang yang diterima.');
      setActionFailed(true);
      return;
    }
    setIsSaving(true);
    const res = await confirmFulfillmentReceived(currentOrder.id_fulfillment, ratingInput, ulasanInput);
    setIsSaving(false);
    setActionFailed(!res.success);
    setActionMessage(res.message);
    setTimeout(() => setActionMessage(null), 5000);
  };


  // Copy resi
  const handleCopyResi = async (resi: string) => {
    try { await navigator.clipboard.writeText(resi); setCopiedResi(true); setTimeout(() => setCopiedResi(false), 2000); }
    catch { setActionFailed(true); setActionMessage('Nomor resi belum dapat disalin. Salin langsung dari tampilan pesanan.'); }
  };

  // Associated item & invoice data
  const currentItem = currentOrder ? barangList.find((b) => b.id_barang === currentOrder.id_barang) : null;
  const currentInvoice = currentOrder ? pembayaranList.find((p) => p.id_pembayaran === currentOrder.id_pembayaran) : null;

  // Wizard step state calculation
  const getStepStatus = (step: number) => {
    if (!currentOrder) return 'pending';
    switch (step) {
      case 1:
        return recipientReady(currentOrder) ? 'completed' : 'current';
      case 2:
        if (!recipientReady(currentOrder)) return 'disabled';
        return currentOrder.kurir ? 'completed' : 'current';
      case 3:
        if (!currentOrder.kurir) return 'disabled';
        if (currentOrder.status === 'diterima' || currentOrder.status === 'selesai') return 'completed';
        return currentOrder.status === 'dikirim' ? 'current' : 'pending';
      case 4:
        if (currentOrder.status === 'selesai') return 'completed';
        if (currentOrder.status === 'dikirim' || currentOrder.status === 'diterima') return 'current';
        return 'disabled';
      default:
        return 'pending';
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-6xl mx-auto">
      {/* Header */}
      <div className="space-y-2 pb-6 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground flex items-center gap-2.5">
              <Truck className="w-8 h-8 text-primary" />
              <span>Pengiriman & Pelacakan Logistik (Fulfillment)</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground font-light max-w-2xl mt-1">
              Isi data penerima, atur pengiriman atau pengambilan, lalu konfirmasikan barang yang sudah diterima.
            </p>
          </div>
          <button
            onClick={() => onNavigate('invoices')}
            className="self-start sm:self-auto px-4 py-2 rounded-xl border border-border bg-card text-foreground hover:bg-muted text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <span>Daftar Tagihan</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {actionMessage && (
        <div role={actionFailed ? "alert" : "status"} className={`p-4 border text-xs flex items-center justify-between ${actionFailed ? "border-destructive text-destructive" : "border-border text-foreground"}`}>
          <div className="flex items-center gap-2">
            {!actionFailed && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
            <span>{actionMessage}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-muted-foreground hover:text-foreground text-xs font-bold">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {relevantOrders.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-lg border border-border p-8 space-y-4 max-w-xl mx-auto">
          <Package className="w-12 h-12 text-muted-foreground mx-auto stroke-[1.5]" />
          <h2 className="text-xl font-medium text-foreground">Belum ada pengiriman aktif</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Pesanan fulfillment dibuat secara otomatis saat tagihan lelang yang Anda menangkan telah lunas terbayar.
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => onNavigate('invoices')}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:opacity-90"
            >
              Lihat Tagihan Menang
            </button>
            <button
              onClick={() => onNavigate('catalog')}
              className="px-5 py-2.5 bg-card border border-border text-foreground rounded-xl text-xs font-semibold hover:bg-muted"
            >
              Cari Lelang Aktif
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Order Selector (if multiple orders exist) */}
          {relevantOrders.length > 1 && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Pilih Pesanan Pengiriman:
              </label>
              <div className="flex flex-wrap gap-2">
                {relevantOrders.map((order) => {
                  const item = barangList.find((b) => b.id_barang === order.id_barang);
                  const isSelected = currentOrder?.id_fulfillment === order.id_fulfillment;
                  return (
                    <button
                      key={order.id_fulfillment}
                      onClick={() => setActiveFulfillmentId(order.id_fulfillment)}
                      className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 transition cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                          : 'bg-card text-foreground border-border hover:bg-muted/50'
                      }`}
                    >
                      <Package className="w-4 h-4" />
                      <span>{item?.nama_barang || order.id_fulfillment}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                          isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {order.status.replace('_', ' ')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {currentOrder && currentItem && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {currentOrder.legacy_historical && <p role="status" className="lg:col-span-3 border border-border p-4 text-sm">Riwayat pengiriman dari database lama. Status pembayaran dan pengiriman perlu diperiksa pengelola sebelum transaksi ini dapat dilanjutkan.</p>}
              {/* Left Column: Item Overview & Stepper Progress */}
              <div className="lg:col-span-1 space-y-6">
                {/* Item Card */}
                <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-4">
                  <div className="relative rounded overflow-hidden aspect-[4/3] border border-border">
                    {currentItem.foto_barang[0] ? <img
                      src={currentItem.foto_barang[0]}
                      alt={currentItem.nama_barang}
                      className="w-full h-full object-cover"
                    /> : <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">Foto barang belum tersedia.</p>}
                    <div className="absolute top-3 left-3 bg-foreground/80 backdrop-blur-md text-background text-[11px] font-mono px-2.5 py-1 rounded-full font-bold">
                      Lot #{currentOrder.id_lelang}
                    </div>
                    <div className="absolute top-3 right-3 bg-secondary text-secondary-foreground text-[11px] px-2.5 py-1 rounded-full font-bold border border-border capitalize">
                      {currentOrder.status.replace('_', ' ')}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground uppercase font-bold tracking-wider">
                      {currentItem.kategori}
                    </span>
                    <h2 className="font-medium text-foreground text-lg leading-snug">
                      {currentItem.nama_barang}
                    </h2>
                  </div>

                  <div className="p-3.5 rounded-xl bg-muted/40 border border-border text-xs space-y-1.5">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Harga palu:</span>
                      <span className="font-mono font-bold text-foreground">
                        {currentInvoice ? formatRupiah(currentInvoice.jumlah_pembayaran) : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>No. Invoice:</span>
                      <span className="font-mono text-foreground">INV-{currentOrder.id_pembayaran}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>ID Pengiriman:</span>
                      <span className="font-mono text-foreground font-semibold">{currentOrder.id_fulfillment}</span>
                    </div>
                  </div>
                </div>

                {/* 4-Step Visual Progress Stepper */}
                <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-5">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Tahapan pengiriman
                  </h4>

                  <div className="space-y-4">
                    {[
                      { step: 1, label: 'Data penerima', desc: recipientReady(currentOrder) ? currentOrder.nama_penerima : 'Menunggu data penerima' },
                      { step: 2, label: 'Pilihan Ekspedisi & Ongkir', desc: currentOrder.kurir ? `${currentOrder.kurir} (${formatRupiah(currentOrder.ongkir || 0)})` : 'Atur ekspedisi atau ambil mandiri' },
                      { step: 3, label: pickup ? 'Persiapan pengambilan' : 'Persiapan dan pengiriman', desc: currentOrder.nomor_resi ? `Resi: ${currentOrder.nomor_resi}` : 'Menunggu pembaruan petugas' },
                      { step: 4, label: 'Konfirmasi Serah Terima', desc: currentOrder.rating ? `Rating ${currentOrder.rating} (Tuntas)` : 'Penerimaan oleh pembeli' },
                    ].map((st) => {
                      const status = getStepStatus(st.step);
                      return (
                        <div key={st.step} className="flex items-start gap-3 text-xs">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-mono font-bold flex-shrink-0 text-xs transition ${
                              status === 'completed'
                                ? 'bg-primary text-primary-foreground'
                                : status === 'current'
                                ? 'bg-secondary text-primary border-2 border-primary'
                                : 'bg-muted text-muted-foreground border border-border'
                            }`}
                          >
                            {status === 'completed' ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : st.step}
                          </div>
                          <div>
                            <div
                              className={`font-semibold ${
                                status === 'completed' || status === 'current'
                                  ? 'text-foreground font-bold'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {st.label}
                            </div>
                            <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{st.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Right Column: Active Interactive Steps & Tracking Feed */}
              <div className="lg:col-span-2 space-y-6">
                {/* STEP 1: Alamat Pengiriman */}
                <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="font-medium text-foreground text-lg">
                          Langkah 1: Data penerima
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {pickup ? 'Ambil mandiri memerlukan nama dan kontak penerima.' : 'Ekspedisi memerlukan alamat lengkap. Pilih ambil mandiri jika barang akan diambil langsung.'}
                        </p>
                      </div>
                    </div>
                    {recipientReady(currentOrder) && currentOrder.id_user_pembeli === currentUser.id_user && !isEditingAddress && !currentOrder.legacy_historical && ['menunggu_alamat', 'dikemas'].includes(currentOrder.status) && currentOrder.shipping_payment_status !== 'paid_manual' && (
                      <button
                        onClick={() => setIsEditingAddress(true)}
                        className="text-xs text-primary hover:underline font-semibold flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Ubah data penerima</span>
                      </button>
                    )}
                  </div>

                  {!currentOrder.kurir && !currentOrder.legacy_historical && currentOrder.id_user_pembeli === currentUser.id_user && courierOptions.filter(option => option.id === 'self_pickup').map(option => <button key={option.id} type="button" className="button-secondary" disabled={isSaving} onClick={() => handleSelectCourier(option)}>Pilih ambil mandiri</button>)}

                  {isEditingAddress && !currentOrder.legacy_historical ? (
                    <form onSubmit={handleSaveAddress} className="space-y-4 pt-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-1">
                          <label htmlFor="recipient-name" className="font-semibold text-foreground">Nama Penerima Lengkap *</label>
                          <input
                            id="recipient-name"
                            maxLength={100}
                            type="text"
                            required
                            value={addressForm.nama_penerima}
                            onChange={(e) => setAddressForm({ ...addressForm, nama_penerima: e.target.value })}
                            placeholder="Sesuai KTP penerima"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="recipient-phone" className="font-semibold text-foreground">Nomor Telepon / WhatsApp *</label>
                          <input
                            id="recipient-phone"
                            maxLength={25}
                            type="tel"
                            required
                            value={addressForm.telp_penerima}
                            onChange={(e) => setAddressForm({ ...addressForm, telp_penerima: e.target.value })}
                            placeholder="0812xxxxxxxx"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      {!pickup && <><div className="space-y-1 text-xs">
                        <label htmlFor="recipient-address" className="font-semibold text-foreground">Alamat Lengkap (Jalan, No. Rumah, RT/RW, Patokan) *</label>
                        <textarea
                          id="recipient-address"
                          maxLength={1000}
                          rows={2}
                          required
                          value={addressForm.alamat_lengkap}
                          onChange={(e) => setAddressForm({ ...addressForm, alamat_lengkap: e.target.value })}
                          placeholder="Jl. Thamrin No. 12, Kelurahan Gondangdia, Jakarta Pusat"
                          className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-1">
                          <label htmlFor="recipient-city" className="font-semibold text-foreground">Kota / Kabupaten *</label>
                          <input
                            id="recipient-city"
                            maxLength={100}
                            type="text"
                            required
                            value={addressForm.kota}
                            onChange={(e) => setAddressForm({ ...addressForm, kota: e.target.value })}
                            placeholder="Jakarta Selatan"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="recipient-postcode" className="font-semibold text-foreground">Kode Pos *</label>
                          <input
                            id="recipient-postcode"
                            pattern="[0-9]{5}"
                            maxLength={5}
                            type="text"
                            required
                            value={addressForm.kode_pos}
                            onChange={(e) => setAddressForm({ ...addressForm, kode_pos: e.target.value })}
                            placeholder="12190"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div></>}

                      <div className="pt-2 flex justify-end gap-2">
                        {recipientReady(currentOrder) && (
                          <button
                            type="button"
                            onClick={() => setIsEditingAddress(false)}
                            className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted"
                          >
                            Batal
                          </button>
                        )}
                        <button
                          type="submit" disabled={isSaving}
                          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:opacity-90 shadow-sm cursor-pointer"
                        >
                          Simpan data penerima
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="p-4 rounded-lg bg-muted/30 border border-border text-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-foreground text-sm">{currentOrder.nama_penerima}</div>
                        <span className="font-mono text-muted-foreground">{currentOrder.telp_penerima}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{currentOrder.alamat_lengkap}</p>
                      <div className="text-[11px] font-mono text-muted-foreground pt-1 border-t border-border flex items-center justify-between">
                        <span>
                          {pickup ? 'Pengambilan sesuai kesepakatan' : `${currentOrder.kota}, ${currentOrder.kode_pos}`}
                        </span>
                        <span className="text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Data penerima tersimpan
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <section className="border border-border bg-card p-5 sm:p-6 space-y-5" aria-labelledby="courier-heading">
                  <div>
                    <h2 id="courier-heading" className="text-lg font-medium">Pengambilan dan pengiriman</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Pilih ambil mandiri atau hubungi petugas untuk mengatur kurir. Biaya pengiriman dicatat setelah dikonfirmasi dengan penyedia layanan.</p>
                  </div>
                  {currentOrder.kurir && <p className="border-y border-border py-3 text-sm">Layanan tersimpan: <strong>{currentOrder.kurir}</strong> · {currentOrder.layanan_kurir} · {formatRupiah(currentOrder.ongkir || 0)}</p>}
                  {Number(currentOrder.ongkir) > 0 && <p className="text-sm text-muted-foreground">{currentOrder.shipping_payment_status === 'paid_manual' ? `Bukti ongkir telah dicatat petugas: ${currentOrder.shipping_payment_reference}.` : 'Ongkir dibayar terpisah sesuai kesepakatan dengan petugas. Biaya ini belum dianggap lunas oleh aplikasi.'}</p>}
                  {(!currentOrder.legacy_historical && currentOrder.id_user_pembeli === currentUser?.id_user) && (
                    <div className="space-y-3">
                      {courierOptions.map(courier => (
                        <button key={courier.id} type="button" disabled={isSaving || currentOrder.shipping_payment_status === 'paid_manual' || !['menunggu_alamat', 'dikemas'].includes(currentOrder.status)} onClick={() => handleSelectCourier(courier)}
                          aria-pressed={currentOrder.kurir === courier.name} className="button-secondary w-full text-left disabled:opacity-50">
                          {courier.name} · {formatRupiah(courier.price)}
                        </button>
                      ))}
                      {!recipientReady(currentOrder) && <p className="text-sm text-muted-foreground">Untuk ambil mandiri, pilih layanan lalu simpan nama dan kontak penerima. Ekspedisi memerlukan alamat lengkap.</p>}
                    </div>
                  )}
                </section>

                {/* STEP 3: Tracking & Resi Pengiriman */}
                <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="font-medium text-foreground text-lg">
                          Status pengiriman
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Pembaruan pengiriman dicatat oleh petugas berdasarkan informasi kurir.
                        </p>
                      </div>
                    </div>

                    {currentOrder.nomor_resi && (
                      <div className="flex items-center gap-2 self-start sm:self-auto bg-muted/60 border border-border rounded-xl px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground font-mono text-[11px]">Resi:</span>
                        <span className="font-mono font-bold text-foreground">{currentOrder.nomor_resi}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyResi(currentOrder.nomor_resi!)}
                          className="text-primary hover:opacity-80 transition"
                          title="Salin No Resi"
                        >
                          {copiedResi ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Tracking Timeline */}
                  <div className="space-y-6 pt-2">
                    {currentOrder.tracking_history.map((hist, idx) => {
                      const isLatest = idx === 0;
                      return (
                        <div key={idx} className="relative flex gap-4 text-xs">
                          {/* Line Connector */}
                          {idx !== currentOrder.tracking_history.length - 1 && (
                            <div className="absolute left-[13px] top-6 bottom-0 w-[2px] bg-border -mb-6" />
                          )}

                          {/* Node Icon */}
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                              isLatest
                                ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                                : 'bg-muted text-muted-foreground border border-border'
                            }`}
                          >
                            {hist.status === 'selesai' || hist.status === 'diterima' ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : hist.status === 'dikirim' ? (
                              <Truck className="w-3.5 h-3.5" />
                            ) : (
                              <Package className="w-3.5 h-3.5" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="space-y-1 pb-4 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span
                                className={`font-semibold capitalize text-xs ${
                                  isLatest ? 'text-primary font-bold text-sm' : 'text-foreground'
                                }`}
                              >
                                {hist.status.replace('_', ' ')}
                              </span>
                              <span className="text-[11px] font-mono text-muted-foreground">
                                {formatDateIndo(hist.waktu)}
                              </span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed text-xs">{hist.deskripsi}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* STEP 4: Konfirmasi Penerimaan & Rating Ulasan */}
                <div className="p-5 sm:p-6 rounded-lg bg-card border border-border space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                      <Star className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="font-medium text-foreground text-lg">
                        Langkah 4: Konfirmasi Penerimaan & Ulasan
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Selesaikan transaksi dengan mengonfirmasi fisik barang lelang telah diterima dengan baik
                      </p>
                    </div>
                  </div>

                  {currentOrder.status === 'selesai' ? (
                    <div className="p-5 rounded-lg bg-muted border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground text-xs flex items-center gap-1.5 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-4 h-4" /> Pesanan Diterima & Selesai
                        </span>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-3.5 h-3.5 ${
                                star <= (currentOrder.rating || 5)
                                  ? 'text-amber-500 fill-amber-500'
                                  : 'text-muted-foreground'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      {currentOrder.ulasan && (
                        <p className="text-xs text-foreground italic bg-card p-3 rounded-xl border border-border">
                          "{currentOrder.ulasan}"
                        </p>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={handleConfirmReceived} className="space-y-4 pt-2">
                      <fieldset disabled={isSaving || currentOrder.legacy_historical || currentOrder.id_user_pembeli !== currentUser?.id_user || !['dikirim', 'diterima'].includes(currentOrder.status)} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-foreground">
                          Berikan Rating Pelayanan & Kondisi Barang:
                        </label>
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setRatingInput(s)}
                              className="p-1 hover:scale-110 transition cursor-pointer"
                            >
                              <Star
                                className={`w-6 h-6 ${
                                  s <= ratingInput
                                    ? 'text-amber-500 fill-amber-500'
                                    : 'text-muted-foreground hover:text-amber-400'
                                }`}
                              />
                            </button>
                          ))}
                          <span className="text-xs font-mono font-bold text-foreground ml-2">
                            {ratingInput} / 5 Bintang
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-foreground">
                          Ulasan & Kesan Anda Mengenai Barang Lelang:
                        </label>
                        <textarea
                          rows={3}
                          required
                          value={ulasanInput}
                          onChange={(e) => setUlasanInput(e.target.value)}
                          placeholder="Kondisi barang sesuai deskripsi, packaging kayu sangat rapi, sertifikat otentisitas lengkap..."
                          className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        />
                      </div>

                      <button
                        type="submit" disabled={isSaving}
                        className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 transition shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Konfirmasi Pesanan Diterima & Kirim Ulasan</span>
                      </button>
                    </fieldset>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
