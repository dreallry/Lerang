import React, {lazy, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {PageErrorBoundary} from '../../src/components/common/PageErrorBoundary';
import '../../src/index.css';

const BrokenPage = lazy(() => Promise.reject(new Error('Fixture: failed to fetch dynamically imported module')));
const recovery = location.hash === '#catalog';
createRoot(document.getElementById('root')!).render(recovery
  ? <main><h1>Katalog pemulihan fixture</h1><p>Hanya pengujian. Tidak ada transaksi dibuat.</p></main>
  : <PageErrorBoundary><Suspense fallback={<p role="status">Memuat halaman uji...</p>}><BrokenPage /></Suspense></PageErrorBoundary>);
