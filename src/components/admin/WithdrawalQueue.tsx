import { useEffect, useState } from 'react';
import api, { type Withdrawal } from '../../services/api';
import { authErrorMessage } from '../../utils/authErrors';
import { formatRupiah, formatDateIndo } from '../../utils/formatters';
import { startPolling } from '../../utils/polling';
import { useFormFeedback } from '../common/FormFeedback';

export function WithdrawalQueue() {
  const { showError, clearFeedback } = useFormFeedback();
  const [rows,setRows]=useState<Withdrawal[]>([]);
  const [error,setError]=useState('');
  const [dataError,setDataError]=useState(false);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState('');
  const [reference,setReference]=useState('');
  const [reason,setReason]=useState('');
  const [saving,setSaving]=useState(false);
  const load=async()=>{
    const response=await api.getWithdrawals();
    if(!Array.isArray(response?.data)) throw new Error('Daftar penarikan dari server belum valid.');
    const records=response.data.map((row:Withdrawal)=>{
      const amount=Number(row.amount);
      if(!row.id||!Number.isSafeInteger(amount)||amount<50000||!['pending','paid','rejected'].includes(row.status))throw new Error('Catatan penarikan belum valid.');
      return {...row,amount};
    });
    return records;
  };
  useEffect(()=>{
    if(saving)return;
    let active=true;
    const refresh=()=>load().then(records=>{if(active){setRows(records);setError('');setDataError(false);}}).catch(err=>{if(active){setError(authErrorMessage(err));setDataError(true);}}).finally(()=>{if(active)setLoading(false);});
    const stop=startPolling(refresh,10000);
    return()=>{active=false;stop();};
  },[saving]);
  const review=async(status:'paid'|'rejected')=>{
    if(saving||dataError)return;
    if(status==='paid'&&!reference.trim()||status==='rejected'&&!reason.trim()){const message=status==='paid'?'Isi referensi transfer bank yang sudah dilakukan.':'Isi alasan penolakan.';setError(message);showError(message,{target:document.getElementById(status==='paid'?'withdraw-reference':'withdraw-reason')});return;}
    setSaving(true);setError('');clearFeedback();
    try{
      await api.reviewWithdrawal(selected,status,reference.trim(),reason.trim());
      setRows(previous=>previous.map(row=>row.id===selected?{...row,status,transfer_reference:status==='paid'?reference.trim():undefined,reason:status==='rejected'?reason.trim():undefined}:row));
      setSelected('');setReference('');setReason('');
      try {setRows(await load());setDataError(false);} catch {const message='Keputusan sudah tersimpan. Muat ulang daftar untuk memastikan data terbaru.';setDataError(true);setError(message);showError(message);}
    }catch(err){const message=authErrorMessage(err);setError(message);showError(message);}finally{setSaving(false);}
  };
  return <section className="border border-border bg-card p-5 sm:p-6 space-y-5" aria-labelledby="withdrawal-heading">
    <div><h2 id="withdrawal-heading" className="text-xl font-medium">Permintaan penarikan saldo</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Transfer dilakukan petugas melalui bank. Catat sebagai selesai setelah transfer berhasil dan referensinya tersedia. Penolakan mengembalikan saldo melalui server.</p></div>
    {error&&<div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p>{dataError&&<button type="button" disabled={saving||loading} className="button-secondary" onClick={()=>{setLoading(true);void load().then(records=>{setRows(records);setError('');setDataError(false);}).catch(err=>setError(authErrorMessage(err))).finally(()=>setLoading(false));}}>Muat ulang penarikan</button>}</div>}
    {loading?<p role="status" className="text-sm text-muted-foreground">Memuat penarikan...</p>:rows.length===0?<p className="text-sm text-muted-foreground">{dataError?'Daftar penarikan belum dapat dipastikan. Muat ulang untuk mencoba lagi.':'Belum ada permintaan penarikan.'}</p>:<div className="divide-y divide-border">{rows.map(row=><article key={row.id} className="py-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-sm font-semibold">{row.nama_lengkap||row.account_holder} · {formatRupiah(row.amount)}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{row.bank_name} · {row.account_number} · {row.account_holder}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateIndo(row.created_at)}</p></div><span className="text-sm">{row.status==='pending'?'Menunggu transfer':row.status==='paid'?'Transfer tercatat':'Ditolak'}</span></div>
      {row.status==='pending'&&<button type="button" disabled={saving||dataError} className="button-secondary" onClick={()=>{setSelected(row.id);setReference('');setReason('');setError('');}}>Periksa permintaan</button>}
      {selected===row.id&&row.status==='pending'&&<form className="grid gap-4 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();void review('paid');}}>
        <div><label htmlFor="withdraw-reference" className="mb-2 block text-sm">Referensi transfer bank</label><input id="withdraw-reference" className="catalog-input" value={reference} onChange={event=>setReference(event.target.value)} maxLength={200}/></div>
        <div><label htmlFor="withdraw-reason" className="mb-2 block text-sm">Alasan penolakan bila diperlukan</label><input id="withdraw-reason" className="catalog-input" value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000}/></div>
        <div className="flex flex-wrap gap-3 sm:col-span-2"><button type="submit" disabled={saving||dataError} className="button-primary">{saving?'Menyimpan...':'Catat transfer selesai'}</button><button type="button" disabled={saving||dataError} className="button-secondary" onClick={()=>void review('rejected')}>Tolak dan kembalikan saldo</button><button type="button" disabled={saving} className="button-secondary" onClick={()=>setSelected('')}>Batal memeriksa</button></div>
      </form>}
      {row.transfer_reference&&<p className="text-sm">Referensi: {row.transfer_reference}</p>}{row.reason&&<p className="text-sm">Alasan: {row.reason}</p>}
    </article>)}</div>}
  </section>;
}
