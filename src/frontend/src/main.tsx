import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MsalProvider } from '@azure/msal-react'
import { msalInstance } from '@/auth/authConfig'
import App from './App'
import './index.css'

msalInstance.initialize().then(() => {
  // Handle the redirect response before first render so the auth state is populated.
  // Use .finally() so the app always mounts even if handleRedirectPromise rejects
  // (e.g. AADSTS errors after redirect) — otherwise the page stays blank forever.
  msalInstance.handleRedirectPromise()
    .then((result) => {
      if (result?.account) {
        msalInstance.setActiveAccount(result.account)
      } else {
        const accounts = msalInstance.getAllAccounts()
        if (accounts.length > 0) msalInstance.setActiveAccount(accounts[0])
      }
    })
    .catch((err) => console.error('MSAL redirect error:', err))
    .finally(() => {
      ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
          <MsalProvider instance={msalInstance}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </MsalProvider>
        </React.StrictMode>,
      )
    })
})
