import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { ToastProvider } from './components'
import { AuthProvider } from './features/auth/AuthProvider'
import { LoginScreen } from './features/auth/LoginScreen'
import { RequireAuth } from './features/auth/RequireAuth'
import { AppShell } from './features/shell/AppShell'
import { ContactDetailRoute } from './routes/ContactDetail'
import { ContactsRoute } from './routes/Contacts'
import { GivingRoute } from './routes/Giving'
import { NotFoundRoute } from './routes/NotFound'
import { PipelineRoute } from './routes/Pipeline'
import { ReportsRoute } from './routes/Reports'
import { SettingsRoute } from './routes/Settings'
import { TodayRoute } from './routes/Today'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Every derived number comes from `contact_stats`; keep it briefly warm
        // so the 100ms rule (03 §5.1) holds on navigation.
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/** The route table. Exported bare so tests can mount it in a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<TodayRoute />} />
        <Route path="contacts" element={<ContactsRoute />} />
        <Route path="contacts/:id" element={<ContactDetailRoute />} />
        <Route path="giving" element={<GivingRoute />} />
        <Route path="pipeline" element={<PipelineRoute />} />
        <Route path="reports" element={<ReportsRoute />} />
        <Route path="settings" element={<SettingsRoute />} />
        <Route path="*" element={<NotFoundRoute />} />
      </Route>
    </Routes>
  )
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  return (
    <QueryClientProvider client={client ?? createQueryClient()}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  )
}

export default App
