/**
 * The harness entry (see `wa-harness.html`). Development only — this file is
 * outside `src/` and is never part of a production build.
 *
 * It provides the three things the pane needs from the app shell and nothing
 * else: a QueryClient, a router (the contact chip is a `<Link>`), and the toast
 * provider. The chrome around it is deliberately plain so a screenshot shows
 * the pane, not a mock of the Comms rail that another agent owns.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../src/components'
import { WhatsAppPane } from '../src/features/whatsapp'
import { WhatsAppSettingsCard } from '../src/features/whatsapp'
import '../src/index.css'

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

const showSettings = new URLSearchParams(window.location.search).get('view') === 'settings'

const container = document.getElementById('root')
if (!container) throw new Error('#root missing from wa-harness.html')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <ToastProvider>
          <div className="flex h-screen flex-col bg-ground text-ink">
            <header className="flex shrink-0 items-baseline gap-3 border-b border-border bg-surface px-4 py-3">
              <h1 className="text-[15px] font-bold">WhatsApp</h1>
              <p className="text-[12px] text-muted">
                {showSettings
                  ? 'Settings card — harness'
                  : 'Comms channel pane — harness (the shell renders this through registerCommsChannel)'}
              </p>
            </header>
            {showSettings ? (
              <div className="min-h-0 grow overflow-y-auto px-4 py-4">
                <WhatsAppSettingsCard readOnly={false} />
              </div>
            ) : (
              <main className="flex min-h-0 grow flex-col bg-surface">
                <WhatsAppPane />
              </main>
            )}
          </div>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
