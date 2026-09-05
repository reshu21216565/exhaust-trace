import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { IncidentProvider } from './lib/IncidentContext.tsx'

import { UIProvider } from './lib/UIContext.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIProvider>
      <IncidentProvider>
        <App />
      </IncidentProvider>
    </UIProvider>
  </React.StrictMode>,
)
