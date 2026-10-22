import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuctionProvider, useAuction } from '../../src/context/AuctionContext';

if (!('fixtureSetUser' in window)) throw new Error('This fixture requires the isolated browser test configuration and intercepted API responses.');

function SessionFixture() {
  const { sessionStatus, sessionRevision, reloadSession, lockDepositForAuction } = useAuction();
  const [result, setResult] = useState('');
  return (
    <main>
      <h1>Context session regression fixture</h1>
      <p>No production credentials or payments are used. API responses must be intercepted by the browser test.</p>
      <output data-testid="session">{sessionStatus}:{sessionRevision}</output>
      <button type="button" onClick={reloadSession}>Reload fixture session</button>
      <button type="button" onClick={async () => { setResult('pending'); setResult(JSON.stringify(await lockDepositForAuction(1))); }}>Lock fixture deposit</button>
      <output data-testid="result">{result}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<AuctionProvider><SessionFixture /></AuctionProvider>);
