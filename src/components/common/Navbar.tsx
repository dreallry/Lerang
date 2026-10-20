import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, Search, X, LogOut } from 'lucide-react';
import { useAuction } from '../../context/AuctionContext';
import { formatCompactRupiah, formatDateIndo } from '../../utils/formatters';
import { authErrorMessage } from '../../utils/authErrors';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string, id?: number) => void;
  onSearch?: (query: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate, onSearch }) => {
  const {
    currentRole, currentUser, currentOfficer, logout, notificationsList,
    markNotificationAsRead, unreadNotifsCount, barangList, lelangList, pembayaranList,
  } = useAuction();
  const [openMenu, setOpenMenu] = useState<'notifications' | 'profile' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const isPublic = currentRole === 'masyarakat';
  const isSignedIn = isPublic ? Boolean(currentUser) : Boolean(currentOfficer);
  const activeName = isPublic ? currentUser?.display_name || currentUser?.nama_lengkap || 'Akun saya' : currentOfficer?.display_name || currentOfficer?.nama_petugas || 'Petugas';
  const avatarUrl = isPublic ? currentUser?.avatar_url : currentOfficer?.avatar_url;
  const initials = activeName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const pendingC2CCount = barangList.filter((item) => item.status_verifikasi === 'pending').length;
  const myWonCount = currentUser
    ? pembayaranList.filter((payment) => payment.id_user === currentUser.id_user && payment.status === 'Belum Dibayar').length
    : 0;
  const relevantNotifications = notificationsList.filter((notification) => isPublic
    ? currentUser && notification.id_user === currentUser.id_user
    : notification.role_target === 'petugas' || notification.id_user === 0);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null);
      if (!searchRef.current?.contains(event.target as Node)) setIsSearchFocused(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const go = (view: string, id?: number) => {
    setOpenMenu(null);
    setIsSearchFocused(false);
    onNavigate(view, id);
  };

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    return lelangList
      .filter((auction) => auction.status !== 'draft' && auction.status !== 'dibatalkan')
      .flatMap((auction) => {
        const item = barangList.find((barang) => barang.id_barang === auction.id_barang);
        if (!item || !`${item.nama_barang} ${item.kategori} ${item.deskripsi_barang}`.toLowerCase().includes(query)) return [];
        return [{ item, auction }];
      })
      .slice(0, 5);
  }, [searchQuery, barangList, lelangList]);

  const submitSearch = () => {
    setOpenMenu(null);
    setIsSearchFocused(false);
    if (onSearch) onSearch(searchQuery.trim());
    else onNavigate('catalog');
  };

  const publicLinks = [
    ['catalog', 'Semua lot'],
    ['c2c-submit', 'Jual di Lerang'],
    ...(currentUser ? [['journey', 'Aktivitas saya'], ['invoices', `Tagihan${myWonCount ? ` (${myWonCount})` : ''}`], ['wallet', 'Dompet']] : []),
  ];
  const staffLinks = [
    ['admin-dashboard', 'Ringkasan'], ['admin-operations', 'Operasional'],
    ['admin-curation', `Kurasi${pendingC2CCount ? ` (${pendingC2CCount})` : ''}`],
    ['admin-sessions', 'Sesi lelang'], ['admin-auctions', 'Kelola lot'],
    ['invoices', 'Tagihan'], ['admin-reports', 'Laporan'], ['fulfillment', 'Pengiriman'],
    ...(currentRole === 'administrator' ? [['admin-users', 'Pengguna']] : []),
  ];
  const accountLinks = isPublic
    ? [['journey', 'Aktivitas saya'], ['c2c-submit', 'Pengajuan barang'], ['invoices', 'Tagihan'], ['fulfillment', 'Pengiriman']]
    : staffLinks;

  return (
    <header ref={headerRef} className="sticky top-0 z-50 w-full border-b border-border bg-white text-neutral-900 dark:bg-card dark:text-foreground">
      <div className="site-container">
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 py-4 lg:grid-cols-[auto_minmax(260px,1fr)_auto] lg:gap-x-12 lg:py-5">
          <button type="button" onClick={() => go(isPublic ? 'catalog' : 'admin-dashboard')} className="min-h-11 justify-self-start text-left" aria-label="Beranda Lerang">
            <span className="font-serif text-[38px] font-semibold leading-none tracking-[-0.045em] text-primary">lerang<span className="text-foreground">.</span></span>
          </button>

          <div
            ref={searchRef}
            className="relative col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsSearchFocused(false);
            }}
          >
            <form role="search" onSubmit={(event) => { event.preventDefault(); submitSearch(); }} className="flex min-h-12 items-center border border-neutral-400 bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary dark:border-border dark:bg-background">
              <label htmlFor="site-search" className="sr-only">Cari barang lelang</label>
              <input
                id="site-search"
                type="search"
                autoComplete="off"
                placeholder="Cari barang, merek, atau kategori"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => { setIsSearchFocused(true); setOpenMenu(null); }}
                aria-controls={isSearchFocused && searchResults.length ? 'site-search-results' : undefined}
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Hapus pencarian"><X className="h-4 w-4" /></button>}
              <button type="submit" className="flex min-h-12 min-w-12 items-center justify-center text-foreground hover:bg-muted" aria-label="Cari"><Search className="h-5 w-5" strokeWidth={1.75} /></button>
            </form>
            {isSearchFocused && searchResults.length > 0 && (
              <div id="site-search-results" className="absolute inset-x-0 top-full z-50 mt-1 border border-border bg-card shadow-lg">
                <p className="px-4 pb-2 pt-4 text-xs text-muted-foreground">Lot yang sesuai</p>
                <ul>
                  {searchResults.map(({ item, auction }) => (
                    <li key={auction.id_lelang}>
                      <button type="button" onClick={() => go('auction-detail', auction.id_lelang)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted focus-visible:outline-offset-[-2px]">
                        {item.foto_barang?.[0] && <img src={item.foto_barang[0]} alt="" className="h-12 w-12 shrink-0 bg-muted object-cover" />}
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.nama_barang}</span><span className="mt-1 block text-xs text-muted-foreground">{formatCompactRupiah(auction.harga_akhir || item.harga_awal)}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={submitSearch} className="min-h-12 w-full border-t border-border px-4 py-3 text-left text-sm font-medium text-primary hover:bg-muted">Lihat semua hasil</button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 justify-self-end sm:gap-3 lg:col-start-3">
            <button type="button" onClick={() => go('guide')} aria-current={currentView === 'guide' ? 'page' : undefined} className="hidden min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground sm:block">Panduan</button>
            {!isSignedIn ? (
              <>
                <button type="button" onClick={() => go('login')} className="min-h-11 px-3 text-sm font-medium hover:text-primary" aria-current={currentView === 'login' ? 'page' : undefined}>Masuk</button>
                <button type="button" onClick={() => go('register')} className="min-h-11 border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Daftar</button>
              </>
            ) : (
              <>
                <div className="relative">
                  <button type="button" onClick={() => { setOpenMenu(openMenu === 'notifications' ? null : 'notifications'); setIsSearchFocused(false); }} className="relative flex min-h-11 min-w-11 items-center justify-center hover:bg-muted" aria-label={`Notifikasi${unreadNotifsCount ? `, ${unreadNotifsCount} belum dibaca` : ''}`} aria-expanded={openMenu === 'notifications'} aria-controls="notification-panel">
                    <Bell className="h-5 w-5" strokeWidth={1.75} />
                    {unreadNotifsCount > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />}
                  </button>
                  {openMenu === 'notifications' && (
                    <section id="notification-panel" aria-label="Notifikasi" className="fixed right-4 top-20 z-50 w-[min(360px,calc(100vw-2rem))] border border-border bg-card p-4 shadow-lg lg:absolute lg:right-0 lg:top-full lg:mt-2">
                      <div className="mb-3 flex items-center justify-between border-b border-border pb-3"><h2 className="text-base font-semibold">Notifikasi</h2><span className="text-xs text-muted-foreground">{relevantNotifications.length} pesan</span></div>
                      <div className="max-h-[60vh] overflow-y-auto">
                        {notificationError && <p role="alert" className="py-2 text-sm text-destructive">{notificationError}</p>}
                        {!relevantNotifications.length ? <p className="py-5 text-sm text-muted-foreground">Belum ada pembaruan akun atau lelang.</p> : relevantNotifications.map((notification) => (
                          <button key={notification.id} type="button" onClick={async () => {
                            setNotificationError('');
                            const result = await markNotificationAsRead(notification.id);
                            if (!result.success) { setNotificationError(result.message); return; }
                            if (notification.link_target?.startsWith('auction/')) go('auction-detail', Number(notification.link_target.split('/')[1]));
                            else if (notification.link_target) go(notification.link_target);
                          }} className={`w-full border-b border-border px-1 py-4 text-left hover:bg-muted ${notification.dibaca ? 'text-muted-foreground' : 'text-foreground'}`}>
                            <span className="block text-sm font-semibold">{notification.judul}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{notification.pesan}</span><span className="mt-2 block text-xs text-muted-foreground">{formatDateIndo(notification.created_at)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
                <div className="relative">
                  <button type="button" onClick={() => { setOpenMenu(openMenu === 'profile' ? null : 'profile'); setIsSearchFocused(false); }} className="flex min-h-11 items-center gap-2 px-2 hover:bg-muted" aria-label="Menu akun" aria-expanded={openMenu === 'profile'} aria-controls="account-panel">
                    {avatarUrl ? <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center border border-border bg-muted text-[11px] font-semibold">{initials}</span>}
                    <span className="hidden max-w-28 truncate text-sm xl:block">{activeName.split(' ')[0]}</span><ChevronDown className="h-4 w-4" />
                  </button>
                  {openMenu === 'profile' && (
                    <section id="account-panel" aria-label="Menu akun" className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-[min(280px,calc(100vw-2rem))] overflow-y-auto border border-border bg-card p-4 shadow-lg">
                      <div className="border-b border-border pb-4"><p className="break-words text-sm font-semibold">{activeName}</p><p className="mt-1 text-xs text-muted-foreground">{isPublic ? 'Akun peserta' : currentRole === 'administrator' ? 'Administrator' : 'Petugas balai'}</p></div>
                      {currentUser && isPublic && <button type="button" onClick={() => go('wallet')} className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-border text-left text-sm"><span>Saldo dompet</span><strong className="font-semibold tabular-nums">{formatCompactRupiah(currentUser.saldo_wallet)}</strong></button>}
                      <div className="py-2">{accountLinks.map(([view, label]) => <button key={view} type="button" onClick={() => go(view)} className="block min-h-11 w-full px-2 text-left text-sm hover:bg-muted" aria-current={currentView === view ? 'page' : undefined}>{label}</button>)}</div>
                      {logoutError && <p role="alert" className="py-2 text-xs text-destructive">{logoutError}</p>}
                      <button type="button" onClick={async () => { try { await logout(); setLogoutError(''); go('catalog'); } catch (error) { setLogoutError(authErrorMessage(error)); } }} className="flex min-h-11 w-full items-center gap-2 border-t border-border px-2 pt-2 text-left text-sm text-muted-foreground hover:text-foreground"><LogOut className="h-4 w-4" />Keluar</button>
                    </section>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <nav aria-label={isPublic ? 'Navigasi utama' : 'Navigasi petugas'} className="flex min-w-0 items-center gap-6 overflow-x-auto border-t border-border sm:gap-8">
          {(isPublic ? publicLinks : staffLinks).map(([view, label]) => (
            <button key={view} type="button" onClick={() => go(view)} aria-current={currentView === view ? 'page' : undefined} className={`min-h-12 shrink-0 whitespace-nowrap border-b-2 py-3 text-[13px] transition-colors ${currentView === view ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}`}>{label}</button>
          ))}
          <button type="button" onClick={() => go('guide')} aria-current={currentView === 'guide' ? 'page' : undefined} className={`min-h-12 shrink-0 whitespace-nowrap border-b-2 text-[13px] sm:hidden ${currentView === 'guide' ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Panduan lelang</button>
        </nav>
      </div>

    </header>
  );
};
