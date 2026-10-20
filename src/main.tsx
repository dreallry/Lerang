import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { PageErrorBoundary } from './components/common/PageErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PageErrorBoundary><App /></PageErrorBoundary>
  </React.StrictMode>,
)
