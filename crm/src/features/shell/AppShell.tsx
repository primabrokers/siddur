import { Outlet } from 'react-router'
import { isConfigured } from '../../lib/env'
import { CaptureProvider } from '../capture/QuickCapture'
import { OmniProvider } from '../search/OmniProvider'
import { MobileTabBar } from './MobileTabBar'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * The app frame (03 §1): sidebar + top bar at ≥1024px, bottom tab bar below.
 * Content scrolls inside the main column; the chrome never scrolls away.
 *
 * `OmniProvider` sits inside `CaptureProvider` because the command palette
 * dispatches into Quick Capture (03 §3) — the palette owns no behaviour of its
 * own, only routes to surfaces that already exist.
 */
export function AppShell() {
  return (
    <CaptureProvider>
      <OmniProvider>
        <div className="flex min-h-dvh bg-ground">
          <Sidebar />
          <div className="flex min-w-0 grow flex-col">
            <TopBar />
            {!isConfigured ? (
              <p className="border-b border-border bg-[#FCF0E3] px-4 py-2 text-[12px] text-flag-today-ink lg:px-6">
                Supabase publishable key not set — data will not load. Set <code>VITE_SUPABASE_ANON_KEY</code>.
              </p>
            ) : null}
            <main className="min-h-0 grow overflow-y-auto px-4 py-4 lg:px-6 lg:py-5">
              <Outlet />
            </main>
            <MobileTabBar />
          </div>
        </div>
      </OmniProvider>
    </CaptureProvider>
  )
}
