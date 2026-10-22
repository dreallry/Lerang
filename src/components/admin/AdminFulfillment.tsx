import { useEffect, useState, type FormEvent } from 'react';
import { useAuction } from '../../context/AuctionContext';
import type { FulfillmentOrder, FulfillmentStatus } from '../../types';
import { formatDateIndo, formatRupiah } from '../../utils/formatters';
import { isPickup, nextShippingStatus, recipientReady, shippingBlockReason, shippingLabels } from '../../utils/shipping';
import { useFormFeedback } from '../common/FormFeedback';

export function AdminFulfillment({ selectedInvoiceId, onNavigate }: { selectedInvoiceId?: number | null; onNavigate: (view: string, id?: number) => void }) {
  const { fulfillmentList, barangList, accountDataStatus, reloadAccountData, accountUpdatedAt } = useAuction();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (selectedInvoiceId) { setStatus('all'); setSearch(''); setSelected(null); } }, [selectedInvoiceId]);
  const activeCount = fulfillmentList.filter(order => !order.legacy_historical && order.status !== 'selesai').length;
  const rows = fulfillmentList.filter(order => {
    if (status === 'active' && (order.legacy_historical || order.status === 'selesai') || status === 'archive' && !order.legacy_historical || !['active', 'all', 'archive'].includes(status) && (order.legacy_historical || order.status !== status)) return false;
    const item = barangList.find(item => item.id_barang === order.id_barang);
    return `${order.id_fulfillment} ${order.id_pembayaran} ${item?.nama_barang || ''} ${order.kurir || ''} ${order.nomor_resi || ''} ${order.nama_penerima || ''}`.toLocaleLowerCase('id').includes(search.trim().toLocaleLowerCase('id'));
  });
  const order = rows.find(row => row.id_fulfillment === selected) || rows.find(row => row.id_pembayaran === selectedInvoiceId) || rows[0];

  return <div className="admin-page space-y-6 pb-20">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl sm:text-4xl font-medium tracking-tight">Pengiriman dan pengambilan</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">Kelola penerima, penawaran kurir, bukti ongkir, dan serah terima. Penyelesaian dan pencairan hasil penjual tetap menunggu konfirmasi pembeli.</p></div><button type="button" className="button-secondary" onClick={reloadAccountData} disabled={accountDataStatus === 'loading'}>Muat ulang pengiriman</button></header>
    <p className="text-sm text-muted-foreground">{activeCount} pesanan nonarsip belum selesai. {accountUpdatedAt && `Data diperbarui ${formatDateIndo(accountUpdatedAt)}.`}</p>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)]"><label className="grid gap-2 text-sm">Cari barang, tagihan, penerima, kurir atau resi<input className="catalog-input w-full" value={search} onChange={event => { setSearch(event.target.value); setSelected(null); }} /></label><label className="grid gap-2 text-sm">Status pengiriman<select className="catalog-input w-full" value={status} onChange={event => { setStatus(event.target.value); setSelected(null); }}><option value="active">Belum selesai (nonarsip)</option><option value="all">Semua pesanan</option>{Object.entries(shippingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="archive">Arsip SQL</option></select></label></div>
    {accountDataStatus !== 'ready' && <p role={accountDataStatus === 'error' ? 'alert' : 'status'} className="border border-border p-4 text-sm">{accountDataStatus === 'error' ? 'Pembaruan gagal. Tindakan dinonaktifkan sampai data berhasil dimuat ulang.' : 'Memuat data pengiriman...'}</p>}
    {accountDataStatus !== 'ready' && fulfillmentList.length === 0 ? null : rows.length === 0 ? <div className="border border-border py-12 px-5 text-center"><h2 className="text-lg font-medium">{fulfillmentList.length ? 'Tidak ada pesanan yang sesuai filter' : 'Belum ada pengiriman tercatat'}</h2><p className="mt-3 text-sm text-muted-foreground">{fulfillmentList.length ? 'Ubah status ke Semua pesanan atau kosongkan pencarian. Arsip SQL disimpan terpisah dari antrean aktif.' : 'Pengiriman dibuat server setelah pelunasan tagihan terverifikasi.'}</p><button type="button" className="button-secondary mt-5" onClick={() => onNavigate('invoices')}>Periksa tagihan</button></div> : <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.8fr)]">
      <nav aria-label="Daftar pesanan pengiriman" className="max-h-[70vh] overflow-y-auto border border-border divide-y divide-border">{rows.map(row => <button key={row.id_fulfillment} type="button" aria-pressed={row.id_fulfillment === order?.id_fulfillment} onClick={() => setSelected(row.id_fulfillment)} className={`block min-h-11 w-full p-4 text-left focus-ring ${row.id_fulfillment === order?.id_fulfillment ? 'bg-secondary' : 'bg-card hover:bg-muted'}`}><span className="block text-sm font-medium">{barangList.find(item => item.id_barang === row.id_barang)?.nama_barang || `Barang #${row.id_barang}`}</span><span className="mt-2 block break-all text-xs text-muted-foreground">{row.id_fulfillment} · INV-{row.id_pembayaran}</span><span className="mt-2 block text-sm">{row.legacy_historical ? 'Arsip SQL' : shippingLabels[row.status]}</span>{row.kurir && <span className="mt-1 block text-xs text-muted-foreground">{row.kurir}{row.nomor_resi ? ` · ${row.nomor_resi}` : ''}</span>}</button>)}</nav>
      {order && <ShippingDetail key={order.id_fulfillment} order={order} disabled={accountDataStatus !== 'ready'} />}
    </div>}
  </div>;
}

function ShippingDetail({ order, disabled }: { order: FulfillmentOrder; disabled: boolean }) {
  const { showError, clearFeedback } = useFormFeedback();
  const { pembayaranList, barangList, courierOptions, reloadAccountData, updateFulfillmentAddress, updateFulfillmentCourier, updateFulfillmentTracking, recordShippingPayment } = useAuction();
  const invoice = pembayaranList.find(invoice => invoice.id_pembayaran === order.id_pembayaran);
  const blocked = shippingBlockReason(order, invoice);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [address, setAddress] = useState({ nama_penerima: order.nama_penerima || '', telp_penerima: order.telp_penerima || '', alamat_lengkap: order.alamat_lengkap || '', kota: order.kota || '', kode_pos: order.kode_pos || '' });
  const [mode, setMode] = useState(isPickup(order) ? 'pickup' : 'courier');
  const [quote, setQuote] = useState({ kurir: isPickup(order) ? '' : order.kurir || '', layanan_kurir: isPickup(order) ? '' : order.layanan_kurir || '', ongkir: String(order.ongkir ?? '') });
  const [reference, setReference] = useState('');
  const [resi, setResi] = useState(order.nomor_resi || '');
  const [note, setNote] = useState('');
  const [action, setAction] = useState<'next' | 'note'>('next');
  const [version, setVersion] = useState(order.tgl_update || '');
  const stale = version !== (order.tgl_update || '');
  const next = nextShippingStatus(order);
  const editable = ['menunggu_alamat', 'dikemas'].includes(order.status);
  const paidShipping = order.shipping_payment_status === 'paid_manual';
  const locked = saving || disabled || !!blocked || stale;
  const loadCurrentVersion = () => {
    setVersion(order.tgl_update || '');
    setAddress({ nama_penerima: order.nama_penerima || '', telp_penerima: order.telp_penerima || '', alamat_lengkap: order.alamat_lengkap || '', kota: order.kota || '', kode_pos: order.kode_pos || '' });
    setMode(isPickup(order) ? 'pickup' : 'courier');
    setQuote({ kurir: isPickup(order) ? '' : order.kurir || '', layanan_kurir: isPickup(order) ? '' : order.layanan_kurir || '', ongkir: String(order.ongkir ?? '') });
    setResi(order.nomor_resi || '');
    setReference(''); setNote(''); setAction('next');
    setFailed(false); setMessage('Formulir menggunakan data pengiriman terbaru. Periksa tujuan dan ongkir sebelum menyimpan.'); clearFeedback();
  };
  const mutate = async (operation: () => Promise<{ success: boolean; message: string; updated_at?: string }>) => {
    if (locked) return;
    setSaving(true); setMessage(''); clearFeedback();
    try {
      const result = await operation();
      if (result.success && typeof result.updated_at === 'string') setVersion(result.updated_at);
      setFailed(!result.success); setMessage(result.message);
      if (!result.success) showError(result.message);
    }
    catch { const message = 'Pembaruan belum dapat dipastikan. Muat ulang data sebelum mengulang tindakan.'; setFailed(true); setMessage(message); showError(message); }
    finally { setSaving(false); }
  };
  const saveAddress = (event: FormEvent) => { event.preventDefault(); void mutate(async () => {
    const result = await updateFulfillmentAddress(order.id_fulfillment, { ...address, expected_updated_at: version });
    if (result.success && !isPickup(order)) setQuote({ kurir: '', layanan_kurir: '', ongkir: '' });
    return result;
  }); };
  const saveQuote = (event: FormEvent) => {
    event.preventDefault();
    const pickup = courierOptions.find(option => option.id === 'self_pickup');
    if (mode === 'pickup' && !pickup) { const message = 'Layanan ambil mandiri belum tersedia dari server. Muat ulang data.'; setFailed(true); setMessage(message); showError(message); return; }
    void mutate(() => updateFulfillmentCourier(order.id_fulfillment, { ...(mode === 'pickup' ? { kurir: pickup!.name, layanan_kurir: pickup!.service, ongkir: pickup!.price } : { ...quote, ongkir: Number(quote.ongkir) }), expected_updated_at: version }));
  };
  const saveTracking = (event: FormEvent) => { event.preventDefault(); const status = action === 'note' ? order.status : next; if (status) void mutate(async () => {
    const result = await updateFulfillmentTracking(order.id_fulfillment, resi.trim(), status, note.trim(), version);
    if (result.success) { setNote(''); setAction('next'); }
    return result;
  }); };

  return <article className="min-w-0 space-y-6" aria-label={`Rincian ${order.id_fulfillment}`}>
    <div className="border border-border bg-card p-5 space-y-3"><h2 className="text-xl font-medium">{barangList.find(item => item.id_barang === order.id_barang)?.nama_barang || `Barang #${order.id_barang}`}</h2><p className="break-all text-sm">{order.id_fulfillment} · INV-{order.id_pembayaran} · {shippingLabels[order.status]}</p><p className="text-sm text-muted-foreground">Diperbarui {formatDateIndo(order.tgl_update)}. Pembeli #{order.id_user_pembeli}.</p>{blocked && <p role="status" className="border border-border bg-muted p-3 text-sm">{blocked}</p>}{message && <p role={failed ? undefined : 'status'} className={`border border-border p-3 text-sm ${failed ? 'text-destructive' : ''}`}>{message}</p>}</div>
    {failed && <button type="button" className="button-secondary" disabled={saving || disabled} onClick={reloadAccountData}>Periksa pembaruan pengiriman</button>}
    {stale && <div role="alert" className="space-y-3 border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>Pesanan telah berubah. Isianmu tetap disimpan dan belum dikirim. Periksa penerima dan tujuan terbaru sebelum melanjutkan.</p><p>Memuat versi terbaru akan mengganti isian formulir dengan data server, termasuk mengosongkan catatan dan referensi yang belum disimpan.</p><button type="button" className="button-secondary" disabled={saving || disabled} onClick={loadCurrentVersion}>Gunakan versi terbaru</button></div>}
    <section className="border border-border bg-card p-5 space-y-4"><h3 className="text-lg font-medium">Penerima dan tujuan</h3><p className="text-sm leading-6">{order.nama_penerima || 'Penerima belum diisi'} · {order.telp_penerima || 'Kontak belum diisi'}<br />{isPickup(order) ? 'Ambil mandiri; alamat pengiriman tidak diwajibkan.' : `${order.alamat_lengkap || 'Alamat belum diisi'} ${order.kota || ''} ${order.kode_pos || ''}`}</p>{editable && !blocked && <form onSubmit={saveAddress} className="space-y-4"><fieldset disabled={locked || paidShipping} className="grid gap-4 sm:grid-cols-2">{(['nama_penerima', 'telp_penerima', 'alamat_lengkap', 'kota', 'kode_pos'] as const).map(field => <label key={field} className={`grid gap-2 text-sm ${field === 'alamat_lengkap' ? 'sm:col-span-2' : ''}`}>{{ nama_penerima: 'Nama penerima', telp_penerima: 'Telepon penerima', alamat_lengkap: 'Alamat lengkap', kota: 'Kota / kabupaten', kode_pos: 'Kode pos' }[field]}<input className="catalog-input w-full" type={field === 'telp_penerima' ? 'tel' : 'text'} value={address[field]} maxLength={field === 'alamat_lengkap' ? 1000 : field === 'telp_penerima' ? 25 : field === 'kode_pos' ? 5 : 100} required={['nama_penerima', 'telp_penerima'].includes(field) || !isPickup(order)} pattern={field === 'kode_pos' && !isPickup(order) ? '[0-9]{5}' : undefined} onChange={event => setAddress({ ...address, [field]: event.target.value })} /></label>)}<button type="submit" className="button-primary sm:col-span-2">Simpan data penerima</button></fieldset>{paidShipping && <p className="text-sm text-muted-foreground">Ongkir sudah dicatat dibayar; perubahan tujuan memerlukan penyelesaian dengan petugas terlebih dahulu.</p>}</form>}</section>
    <section className="border border-border bg-card p-5 space-y-4"><h3 className="text-lg font-medium">Layanan dan ongkir</h3><p className="text-sm leading-6">{order.kurir || 'Layanan belum dipilih'}{order.layanan_kurir ? ` · ${order.layanan_kurir}` : ''}{order.kurir && ` · ${formatRupiah(order.ongkir || 0)}`}</p>{editable && !blocked && <form onSubmit={saveQuote}><fieldset disabled={locked || paidShipping} className="space-y-4"><label className="grid gap-2 text-sm">Metode penyerahan<select className="catalog-input" value={mode} onChange={event => setMode(event.target.value)}><option value="courier">Ekspedisi yang disepakati</option><option value="pickup">Ambil mandiri</option></select></label>{mode === 'courier' && <><label className="grid gap-2 text-sm">Kurir<input className="catalog-input" required maxLength={100} value={quote.kurir} onChange={event => setQuote({ ...quote, kurir: event.target.value })} /></label><label className="grid gap-2 text-sm">Layanan<input className="catalog-input" required maxLength={200} value={quote.layanan_kurir} onChange={event => setQuote({ ...quote, layanan_kurir: event.target.value })} /></label><label className="grid gap-2 text-sm">Ongkir disepakati (Rp)<input type="number" className="catalog-input" required min={0} max={9999999999999} step={1} value={quote.ongkir} onChange={event => setQuote({ ...quote, ongkir: event.target.value })} /></label><p className="text-sm text-muted-foreground">Tarif diisi sesuai penawaran penyedia layanan. Ongkir tidak termasuk tagihan lelang atau saldo aplikasi.</p></>}<button type="submit" className="button-primary">Simpan layanan dan ongkir</button></fieldset></form>}
      {Number(order.ongkir) > 0 && <div className="border-t border-border pt-4 space-y-3"><p className="text-sm">{paidShipping ? `Bukti ongkir tercatat: ${order.shipping_payment_reference}. ${formatDateIndo(order.shipping_paid_at)}` : 'Ongkir belum dicatat diterima. Cocokkan dana dan bukti sebelum pengiriman.'}</p>{!paidShipping && editable && !blocked && <form onSubmit={event => { event.preventDefault(); void mutate(() => recordShippingPayment(order.id_fulfillment, { reference: reference.trim(), amount: Number(order.ongkir), courier: order.kurir || '', service: order.layanan_kurir || '', expected_updated_at: version })); }} className="space-y-3"><label className="grid gap-2 text-sm">Referensi bukti ongkir diterima<input required minLength={4} maxLength={200} value={reference} onChange={event => setReference(event.target.value)} className="catalog-input" /></label><p className="text-sm text-muted-foreground">Pencatatan manual oleh petugas setelah dana diterima. Tombol ini tidak memindahkan uang.</p><button type="submit" disabled={locked || order.status !== 'dikemas'} className="button-secondary">Catat bukti ongkir diterima</button></form>}</div>}
    </section>
    {!blocked && <section className="border border-border bg-card p-5 space-y-4"><h3 className="text-lg font-medium">Status dan resi</h3>{order.nomor_resi && <p className="break-all text-sm">Resi tersimpan: {order.nomor_resi}</p>}{['dikemas', 'dikirim'].includes(order.status) ? <form onSubmit={saveTracking}><fieldset disabled={locked} className="space-y-4"><label className="grid gap-2 text-sm">Tindakan<select className="catalog-input" value={action} onChange={event => setAction(event.target.value as 'next' | 'note')}><option value="next">{next === 'dikirim' ? 'Serahkan ke ekspedisi' : isPickup(order) ? 'Catat serah terima ambil mandiri' : 'Catat tiba di tujuan'}</option><option value="note">Tambahkan catatan / koreksi resi</option></select></label>{!isPickup(order) && <label className="grid gap-2 text-sm">Nomor resi<input className="catalog-input" required={action === 'next' && next === 'dikirim'} maxLength={100} value={resi} onChange={event => setResi(event.target.value)} /></label>}<label className="grid gap-2 text-sm">Catatan tindakan<textarea className="catalog-input w-full" rows={3} required maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>{action === 'next' && !recipientReady(order) && <p className="text-sm text-destructive">Lengkapi data penerima sebelum penyerahan.</p>}<button type="submit" disabled={action === 'next' && (!recipientReady(order) || !order.kurir || Number(order.ongkir) > 0 && !paidShipping)} className="button-primary">Simpan pembaruan pengiriman</button></fieldset></form> : <p className="text-sm text-muted-foreground">{order.status === 'menunggu_alamat' ? 'Isi data penerima dan layanan sebelum penyerahan.' : order.status === 'diterima' ? 'Barang sudah diserahkan. Pembeli perlu mengonfirmasi penerimaan melalui akunnya.' : 'Pesanan selesai. Riwayat disimpan untuk pemeriksaan.'}</p>}</section>}
    <section className="border border-border bg-card p-5"><h3 className="text-lg font-medium">Riwayat pengiriman</h3>{order.tracking_history.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Belum ada catatan pengiriman.</p>}<ol className="mt-4 divide-y divide-border">{order.tracking_history.map((event, index) => <li key={`${event.waktu}-${index}`} className="py-3"><p className="text-sm leading-6">{event.deskripsi}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateIndo(event.waktu)} · {shippingLabels[event.status] || event.status}</p></li>)}</ol></section>
  </article>;
}
