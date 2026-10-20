import { useState } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';
import { useAuction } from '../../context/AuctionContext';
import { formatRupiah } from '../../utils/formatters';

type DirectoryProps = Pick<ReturnType<typeof useAuction>, 'masyarakatList' | 'petugasList' | 'accountDataStatus' | 'reloadAccountData'>;

export const AdminUserManagementView = ({ masyarakatList, petugasList, accountDataStatus, reloadAccountData }: DirectoryProps) => {
  const [activeTab, setActiveTab] = useState<'masyarakat' | 'petugas'>('masyarakat');
  const [search, setSearch] = useState('');
  const [showSensitiveData, setShowSensitiveData] = useState(false);
  const query = search.trim().toLocaleLowerCase('id-ID');
  const users = masyarakatList.filter(user => [user.nama_lengkap, user.username, user.email].some(value => value?.toLocaleLowerCase('id-ID').includes(query)));
  const officers = petugasList.filter(user => [user.nama_petugas, user.username, user.email].some(value => value?.toLocaleLowerCase('id-ID').includes(query)));
  const mask = (value?: string) => {
    if (!value) return '-';
    if (showSensitiveData) return value;
    return value.length < 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
  };

  return (
    <div className="admin-page space-y-6 pb-12">
      <header className="border-b border-border pb-6">
        <p className="mb-2 text-sm text-muted-foreground">Administrasi</p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Pengguna dan petugas</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Periksa profil peserta dan akses staf. Akun aktif dibedakan dari arsip SQL yang belum ditautkan ke Firebase.</p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-border" aria-label="Jenis akun">
        {(['masyarakat', 'petugas'] as const).map(tab => (
          <button key={tab} type="button" aria-pressed={activeTab === tab} onClick={() => { setActiveTab(tab); setSearch(''); setShowSensitiveData(false); }} className={`min-h-11 border-b-2 px-4 text-sm font-medium focus-ring ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {tab === 'masyarakat' ? `Peserta (${masyarakatList.length})` : `Petugas dan admin (${petugasList.length})`}
          </button>
        ))}
      </div>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-md">
          <label htmlFor="account-search" className="mb-2 block text-sm font-medium">Cari {activeTab === 'masyarakat' ? 'peserta' : 'staf'}</label>
          <div className="flex min-h-11 items-center gap-3 rounded border border-border px-3 focus-within:ring-2 focus-within:ring-primary">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input id="account-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nama, email, atau username" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" />
          </div>
        </div>
        {activeTab === 'masyarakat' && <button type="button" aria-pressed={showSensitiveData} onClick={() => setShowSensitiveData(value => !value)} className="button-secondary gap-2">
          {showSensitiveData ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {showSensitiveData ? 'Samarkan NIK dan telepon' : 'Tampilkan NIK dan telepon'}
        </button>}
      </div>

      {accountDataStatus === 'loading' ? <p role="status" className="py-10 text-sm text-muted-foreground">Memuat daftar akun...</p> : accountDataStatus === 'error' ? (
        <div role="alert" className="border-y border-border py-8"><p className="mb-4 text-sm">Daftar akun belum dapat dimuat.</p><button type="button" onClick={reloadAccountData} className="button-secondary">Muat ulang</button></div>
      ) : (
        <div className="overflow-x-auto rounded border border-border" tabIndex={0} role="region" aria-label={activeTab === 'masyarakat' ? 'Tabel peserta, geser untuk melihat semua kolom' : 'Tabel staf, geser untuk melihat semua kolom'}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{activeTab === 'masyarakat' ? 'Daftar peserta' : 'Daftar petugas dan administrator'}</caption>
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Nama dan email</th>
                <th scope="col" className="px-4 py-3 font-medium">{activeTab === 'masyarakat' ? 'Telepon dan NIK' : 'Hak akses'}</th>
                {activeTab === 'masyarakat' && <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">Saldo tersedia / jaminan</th>}
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activeTab === 'masyarakat' ? users.map(user => (
                <tr key={user.id_user}>
                  <td className="px-4 py-4"><div className="font-medium">{user.nama_lengkap}</div><div className="mt-1 break-all text-xs text-muted-foreground">{user.email || `@${user.username}`}</div><div className="mt-1 text-xs text-muted-foreground">Peserta #{user.id_user}</div></td>
                  <td className="whitespace-nowrap px-4 py-4"><div>{mask(user.telp)}</div><div className="mt-1 text-xs text-muted-foreground">NIK: {mask(user.nik)}</div></td>
                  <td className="whitespace-nowrap px-4 py-4 tabular-nums"><div>{formatRupiah(user.saldo_wallet)}</div><div className="mt-1 text-xs text-muted-foreground">Jaminan: {formatRupiah(user.saldo_hold)}</div></td>
                  <td className="px-4 py-4 text-xs">{user.legacy_historical ? 'Arsip SQL, belum tertaut' : user.is_verified ? 'Profil terverifikasi' : 'Belum diverifikasi'}</td>
                </tr>
              )) : officers.map(officer => (
                <tr key={`${officer.legacy_historical ? 'legacy' : 'active'}-${officer.id_petugas}`}>
                  <td className="px-4 py-4"><div className="font-medium">{officer.nama_petugas}</div><div className="mt-1 break-all text-xs text-muted-foreground">{officer.email || `@${officer.username}`}</div><div className="mt-1 text-xs text-muted-foreground">Staf #{officer.id_petugas}</div></td>
                  <td className="px-4 py-4">{officer.id_level === 1 ? 'Administrator' : 'Petugas lelang'}</td>
                  <td className="px-4 py-4 text-xs">{officer.requires_identity_link ? 'Arsip SQL, belum tertaut' : officer.active === true ? 'Aktif' : 'Nonaktif'}</td>
                </tr>
              ))}
              {(activeTab === 'masyarakat' ? users.length : officers.length) === 0 && <tr><td colSpan={activeTab === 'masyarakat' ? 4 : 3} className="px-4 py-12 text-center text-muted-foreground">{search ? 'Tidak ada akun yang cocok dengan pencarian.' : 'Belum ada akun pada daftar ini.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs leading-6 text-muted-foreground">NIK dan nomor telepon disamarkan saat halaman dibuka. Tampilkan hanya jika diperlukan untuk pemeriksaan akun.</p>
    </div>
  );
};

export const AdminUserManagement = () => {
  const { masyarakatList, petugasList, accountDataStatus, reloadAccountData } = useAuction();
  return <AdminUserManagementView masyarakatList={masyarakatList} petugasList={petugasList} accountDataStatus={accountDataStatus} reloadAccountData={reloadAccountData} />;
};
