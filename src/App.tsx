import React, { lazy, Suspense, useState, useEffect } from 'react';
import { AuctionProvider, useAuction } from './context/AuctionContext';
import { Navbar } from './components/common/Navbar';
import { Footer } from './components/common/Footer';
import { MidtransSnapModal } from './components/common/MidtransSnapModal';
import { GuestGuardView } from './components/common/GuestGuardView';
import { AuctionGuide } from './components/common/AuctionGuide';

import { AuctionCatalog } from './components/user/AuctionCatalog';
import { authPageDestination } from './utils/authFlow';
import { buildAppHash, parseAppHash } from './utils/navigation';
import { EmailVerificationNotice } from './components/auth/EmailVerificationNotice';
import { useFormFeedback } from './components/common/FormFeedback';

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
  const { clearFeedback } = useFormFeedback();
  const [route, setRoute] = useState(() => parseAppHash(window.location.hash));
  const currentView = route.view;
  const [catalogSearch, setCatalogSearch] = useState(() => route.query);
  const [catalogSearchRevision, setCatalogSearchRevision] = useState(0);
  const invalidRoute = currentView === 'not-found' || ['session-detail', 'theme-detail', 'auction-detail'].includes(currentView) && route.id === null;
  useEffect(() => { clearFeedback(); }, [currentView, route.id, sessionRevision, clearFeedback]);

  useEffect(() => { setPollingView(currentView); }, [currentView, setPollingView]);

  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseAppHash(window.location.hash);
      setRoute(parsed);
      if (parsed.view === 'catalog') setCatalogSearch(parsed.query);
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => { window.removeEventListener('popstate', handlePopState); window.removeEventListener('hashchange', handlePopState); };
  }, []);

  const authDestination = authPageDestination(currentView, sessionStatus, currentRole);
  useEffect(() => {
    if (!authDestination) return;
    const hash = buildAppHash(authDestination);
    window.history.replaceState(null, '', hash);
    setRoute(parseAppHash(hash));
  }, [authDestination]);

  const handleNavigate = (view: string, id?: number) => {
    const hash = buildAppHash(view, id);
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    setRoute(parseAppHash(hash));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectAuction = (id: number) => handleNavigate('auction-detail', id);
  const handleSelectTheme = (id: number) => handleNavigate('theme-detail', id);
  const handleSelectSession = (id: number) => handleNavigate('session-detail', id);

  const handleCatalogSearch = (query: string) => {
    setCatalogSearch(query);
    setCatalogSearchRevision((revision) => revision + 1);
    handleNavigate('catalog');
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    const hash = `#catalog${query ? `?${params}` : ''}`;
    window.history.replaceState(null, '', hash);
    setRoute(parseAppHash(hash));
    requestAnimationFrame(() => document.getElementById('catalog-content')?.scrollIntoView({ behavior: 'auto' }));
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
            {invalidRoute && (
              <div role="alert" className="py-12 space-y-4">
                <p>Tautan tidak lengkap, ID tidak valid, atau halaman tidak ditemukan. Pilih lot, tema, atau sesi dari katalog.</p>
                <button type="button" onClick={() => handleNavigate('catalog')} className="button-secondary">Kembali ke katalog</button>
              </div>
            )}
            {currentView === 'session-detail' && route.id !== null && (
              <SesiDetailPage
                sesiId={route.id}
                onBack={() => handleNavigate('catalog')}
                onSelectAuction={handleSelectAuction}
                onNavigate={handleNavigate}
              />
            )}

            {currentView === 'theme-detail' && route.id !== null && (
              <ThemeDetailPage
                themeId={route.id}
                onBack={() => handleNavigate('catalog')}
                onSelectAuction={handleSelectAuction}
                onNavigate={handleNavigate}
              />
            )}

            {currentView === 'auction-detail' && route.id !== null && (
              <LiveAuctionRoom
                lelangId={route.id}
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
              currentRole === 'administrator' || currentRole === 'petugas' ? <AdminFulfillment onNavigate={handleNavigate} selectedInvoiceId={route.invoiceId} /> : <UserFulfillment onNavigate={handleNavigate} selectedInvoiceId={route.invoiceId} />
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
