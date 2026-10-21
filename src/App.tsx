import React, { lazy, Suspense, useState, useEffect } from 'react';
import { AuctionProvider, useAuction } from './context/AuctionContext';
import { Navbar } from './components/common/Navbar';
import { Footer } from './components/common/Footer';
import { MidtransSnapModal } from './components/common/MidtransSnapModal';
import { GuestGuardView } from './components/common/GuestGuardView';
import { AuctionGuide } from './components/common/AuctionGuide';

import { AuctionCatalog } from './components/user/AuctionCatalog';
import { authPageDestination } from './utils/authFlow';
import { EmailVerificationNotice } from './components/auth/EmailVerificationNotice';

const LiveAuctionRoom = lazy(() => import('./components/user/LiveAuctionRoom').then((page) => ({ default: page.LiveAuctionRoom })));
const ThemeDetailPage = lazy(() => import('./components/user/ThemeDetailPage').then((page) => ({ default: page.ThemeDetailPage })));
const SesiDetailPage = lazy(() => import('./components/user/SesiDetailPage').then((page) => ({ default: page.SesiDetailPage })));
const UserWallet = lazy(() => import('./components/user/UserWallet').then((page) => ({ default: page.UserWallet })));
const UserC2CSubmission = lazy(() => import('./components/user/UserC2CSubmission').then((page) => ({ default: page.UserC2CSubmission })));
const UserInvoices = lazy(() => import('./components/user/UserInvoices').then((page) => ({ default: page.UserInvoices })));
const UserFulfillment = lazy(() => import('./components/user/UserFulfillment').then((page) => ({ default: page.UserFulfillment })));
const AdminFulfillment = lazy(() => import('./components/admin/AdminFulfillment').then(page => ({ default: page.AdminFulfillment })));
const LoginPage = lazy(() => import('./components/auth/LoginPage').then((page) => ({ default: page.LoginPage })));
const RegisterPage = lazy(() => import('./components/auth/RegisterPage').then((page) => ({ default: page.RegisterPage })));
const ResetPasswordPage = lazy(() => import('./components/auth/ResetPasswordPage').then(page => ({ default: page.ResetPasswordPage })));
const EmailActionPage = lazy(() => import('./components/auth/EmailActionPage').then(page => ({ default: page.EmailActionPage })));
const UserJourney = lazy(() => import('./components/user/UserJourney').then((page) => ({ default: page.UserJourney })));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard').then((page) => ({ default: page.AdminDashboard })));
const AdminC2CKurasi = lazy(() => import('./components/admin/AdminC2CKurasi').then((page) => ({ default: page.AdminC2CKurasi })));
const AdminAuctionManager = lazy(() => import('./components/admin/AdminAuctionManager').then((page) => ({ default: page.AdminAuctionManager })));
const AdminSessionManager = lazy(() => import('./components/admin/AdminSessionManager').then((page) => ({ default: page.AdminSessionManager })));
const AdminReportGenerator = lazy(() => import('./components/admin/AdminReportGenerator').then((page) => ({ default: page.AdminReportGenerator })));
const AdminUserManagement = lazy(() => import('./components/admin/AdminUserManagement').then((page) => ({ default: page.AdminUserManagement })));
const OperationsCenter = lazy(() => import('./components/admin/OperationsCenter').then((page) => ({ default: page.OperationsCenter })));

const MainLayout: React.FC = () => {
  const { currentRole, sessionStatus, sessionRevision, setPollingView, reloadSession, accountDataStatus, reloadAccountData } = useAuction();
  const [currentView, setCurrentView] = useState<string>(() => window.location.hash.slice(1).split('?')[0] || 'catalog');
  const [selectedAuctionId, setSelectedAuctionId] = useState<number | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogSearchRevision, setCatalogSearchRevision] = useState(0);

  useEffect(() => { setPollingView(currentView); }, [currentView, setPollingView]);

  const parseHash = () => {
    const rawHash = window.location.hash.replace(/^#/, '');
    if (!rawHash) return { view: 'catalog' };

    const [viewPath, queryString] = rawHash.split('?');
    const params = new URLSearchParams(queryString || '');
    const id = params.get('id') ? Number(params.get('id')) : undefined;
    const invoiceId = params.get('invoiceId') ? Number(params.get('invoiceId')) : undefined;

    return {
      view: viewPath || 'catalog',
      id,
      invoiceId,
      query: params.get('q') || '',
    };
  };

  // Browser popstate listener for back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseHash();
      setCurrentView(parsed.view);
      if (parsed.view === 'catalog') setCatalogSearch(parsed.query || '');
      if (parsed.view === 'session-detail' && parsed.id) setSelectedSessionId(parsed.id);
      if (parsed.view === 'theme-detail' && parsed.id) setSelectedThemeId(parsed.id);
      if (parsed.view === 'auction-detail' && parsed.id) setSelectedAuctionId(parsed.id);
      if (parsed.view === 'fulfillment' && (parsed.invoiceId || parsed.id)) {
        setSelectedInvoiceId(parsed.invoiceId || parsed.id || null);
      }
    };

    // On initial load if hash is present
    if (window.location.hash) {
      handlePopState();
    }

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => { window.removeEventListener('popstate', handlePopState); window.removeEventListener('hashchange', handlePopState); };
  }, []);

  const authDestination = authPageDestination(currentView, sessionStatus, currentRole);
  useEffect(() => {
    if (!authDestination) return;
    window.history.replaceState(null, '', `#${authDestination}`);
    setCurrentView(authDestination);
  }, [authDestination]);

  const handleNavigate = (view: string, id?: number) => {
    let hash = `#${view}`;
    if (view === 'fulfillment') {
      setSelectedInvoiceId(id ?? null);
      if (id !== undefined) hash += `?invoiceId=${id}`;
    } else if (view === 'session-detail') {
      if (id !== undefined) {
        setSelectedSessionId(id);
        hash += `?id=${id}`;
      }
    } else if (view === 'theme-detail') {
      if (id !== undefined) {
        setSelectedThemeId(id);
        hash += `?id=${id}`;
      }
    } else if (view === 'auction-detail') {
      if (id !== undefined) {
        setSelectedAuctionId(id);
        hash += `?id=${id}`;
      }
    }

    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectAuction = (lelangId: number) => {
    setSelectedAuctionId(lelangId);
    const hash = `#auction-detail?id=${lelangId}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    setCurrentView('auction-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCatalogSearch = (query: string) => {
    setCatalogSearch(query);
    setCatalogSearchRevision((revision) => revision + 1);
    handleNavigate('catalog');
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    window.history.replaceState(null, '', `#catalog${query ? `?${params}` : ''}`);
    requestAnimationFrame(() => document.getElementById('catalog-content')?.scrollIntoView({ behavior: 'auto' }));
  };

  const handleSelectTheme = (themeId: number) => {
    setSelectedThemeId(themeId);
    const hash = `#theme-detail?id=${themeId}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    setCurrentView('theme-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectSession = (sesiId: number) => {
    setSelectedSessionId(sesiId);
    const hash = `#session-detail?id=${sesiId}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    setCurrentView('session-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary selection:text-primary-foreground antialiased">
      <a href="#main-content" className="skip-link button-primary" onClick={(event) => {
        event.preventDefault();
        document.getElementById('main-content')?.focus();
      }}>Lewati ke konten</a>
      {/* Top Navbar */}
      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        onSearch={handleCatalogSearch}
      />

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="flex-1 w-full">
        <EmailVerificationNotice />
        {sessionStatus === 'error' && <div role="alert" className="site-container flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted py-4 text-sm"><p>Sesi akun belum dapat diverifikasi. Periksa koneksi atau masuk kembali.</p><div className="flex gap-3"><button type="button" onClick={reloadSession} className="button-secondary">Coba lagi</button><button type="button" onClick={() => handleNavigate('login')} className="button-primary">Masuk kembali</button></div></div>}
        {accountDataStatus === 'loading' && <p role="status" className="site-container py-3 text-sm text-muted-foreground">Memuat data akun...</p>}
        {accountDataStatus === 'error' && <div role="alert" className="site-container flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted py-3 text-sm"><p>Data akun belum dapat dimuat. Periksa koneksi lalu coba lagi.</p><button type="button" onClick={reloadAccountData} className="button-secondary">Muat ulang data akun</button></div>}
        {((['login', 'register'].includes(currentView) && (sessionStatus === 'loading' || authDestination !== null)) || (currentView.startsWith('admin-') || ['wallet', 'invoices', 'fulfillment', 'my-listings', 'c2c-submit', 'journey'].includes(currentView)) && ['loading', 'error'].includes(sessionStatus)) ? (
          <p role="status" className="site-container py-16 text-sm text-muted-foreground">{sessionStatus === 'loading' ? 'Memeriksa sesi dan hak akses akun...' : 'Halaman ini menunggu verifikasi sesi akun.'}</p>
        ) : <Suspense fallback={<div className="site-container py-20 text-sm text-muted-foreground" role="status">Memuat halaman...</div>}>
        {/* User Views */}
        {currentView === 'catalog' && (
          <AuctionCatalog
            key={catalogSearchRevision}
            onSelectAuction={handleSelectAuction}
            onSelectTheme={handleSelectTheme}
            onSelectSession={handleSelectSession}
            onNavigate={handleNavigate}
            searchQuery={catalogSearch}
            onSearchChange={setCatalogSearch}
          />
        )}

        {currentView === 'login' && (
          <LoginPage onNavigate={handleNavigate} />
        )}

        {currentView === 'register' && (
          <RegisterPage onNavigate={handleNavigate} />
        )}
        {currentView === 'reset-password' && <ResetPasswordPage onNavigate={handleNavigate} />}
        {currentView === 'auth-action' && <EmailActionPage />}

        {!['catalog', 'login', 'register', 'reset-password', 'auth-action'].includes(currentView) && (
          <div key={sessionRevision} className="site-container page-shell">
            {currentView === 'guide' && <AuctionGuide onNavigate={handleNavigate} />}
            {currentView === 'session-detail' && selectedSessionId && (
              <SesiDetailPage
                sesiId={selectedSessionId}
                onBack={() => handleNavigate('catalog')}
                onSelectAuction={handleSelectAuction}
                onNavigate={handleNavigate}
              />
            )}

            {currentView === 'theme-detail' && selectedThemeId && (
              <ThemeDetailPage
                themeId={selectedThemeId}
                onBack={() => handleNavigate('catalog')}
                onSelectAuction={handleSelectAuction}
                onNavigate={handleNavigate}
              />
            )}

            {currentView === 'auction-detail' && selectedAuctionId && (
              <LiveAuctionRoom
                lelangId={selectedAuctionId}
                onBack={() => handleNavigate('catalog')}
                onNavigate={handleNavigate}
                onSelectAuction={handleSelectAuction}
              />
            )}

            {currentView === 'wallet' && <UserWallet onNavigate={handleNavigate} />}

            {(currentView === 'c2c-submit' || currentView === 'my-listings') && (
              <UserC2CSubmission onNavigate={handleNavigate} />
            )}

            {currentView === 'invoices' && <UserInvoices onNavigate={handleNavigate} />}
            {currentView === 'fulfillment' && (
              currentRole === 'administrator' || currentRole === 'petugas' ? <AdminFulfillment onNavigate={handleNavigate} selectedInvoiceId={selectedInvoiceId} /> : <UserFulfillment onNavigate={handleNavigate} selectedInvoiceId={selectedInvoiceId} />
            )}
            {currentView === 'journey' && <UserJourney onNavigate={handleNavigate} />}

            {currentView.startsWith('admin-') &&
            (!['administrator', 'petugas'].includes(currentRole) ||
              (currentView === 'admin-users' && currentRole !== 'administrator')) ? (
              <GuestGuardView
                title="Akses Petugas"
                description="Masuk dengan akun petugas yang memiliki hak akses untuk membuka halaman ini."
                onNavigate={handleNavigate}
              />
            ) : (
              <>
                {/* Officer & Admin Views */}
                {currentView === 'admin-dashboard' && <AdminDashboard onNavigate={handleNavigate} />}
                {currentView === 'admin-operations' && <OperationsCenter onNavigate={handleNavigate} />}
                {currentView === 'admin-curation' && <AdminC2CKurasi onNavigate={handleNavigate} />}
                {currentView === 'admin-sessions' && <AdminSessionManager onNavigate={handleNavigate} />}
                {currentView === 'admin-auctions' && <AdminAuctionManager onNavigate={handleNavigate} />}
                {currentView === 'admin-reports' && <AdminReportGenerator />}
                {currentView === 'admin-users' && <AdminUserManagement />}
              </>
            )}
          </div>
        )}
        </Suspense>}
      </main>

      {/* Footer */}
      <Footer onNavigate={handleNavigate} />

      {/* Global Modals */}
      <MidtransSnapModal />
    </div>
  );
};

export default function App() {
  return (
    <AuctionProvider>
      <MainLayout />
    </AuctionProvider>
  );
}
