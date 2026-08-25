import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------- mocks -----

const session = {
  access_token: 'test-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'r',
  user: { id: 'user-1', email: 'braun@yeshiva.org' },
}

const authState = { session: session as unknown as null }

const maybeSingle = vi.fn(async () => ({
  data: { id: 'user-1', role: 'fundraiser', full_name: 'Ahron Braun' },
  error: null,
}))

const from = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle }) }),
}))

const unsubscribe = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: authState.session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
      signOut,
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
    },
    from,
  },
  isConfigured: true,
}))

vi.mock('../src/lib/env', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-key',
  isConfigured: true,
}))

// Imported after the mocks so the modules pick them up.
const { AppProviders, AppRoutes } = await import('../src/App')

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  )
}

// ---------------------------------------------------------------- tests -----

describe('app shell', () => {
  beforeEach(() => {
    authState.session = session as unknown as null
    vi.clearAllMocks()
  })

  it('renders the sidebar mark, the full nav and the pinned views', async () => {
    renderApp('/')

    const nav = await screen.findAllByRole('navigation', { name: 'Primary' })
    expect(nav.length).toBeGreaterThan(0)
    const sidebar = nav[0] as HTMLElement

    expect(within(sidebar).getByText('Yeshiva CRM')).toBeInTheDocument()
    for (const label of ['Today', 'Contacts', 'Pipeline', 'Giving', 'Reports', 'Settings']) {
      expect(within(sidebar).getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(within(sidebar).getByText('Pinned views')).toBeInTheDocument()
    expect(within(sidebar).getByText('Overdue follow-ups')).toBeInTheDocument()
    expect(within(sidebar).getByText('LYBUNT')).toBeInTheDocument()
  })

  it('renders the top bar search hint and the quick-capture button', async () => {
    renderApp('/')

    const topBar = await screen.findByRole('banner')
    expect(within(topBar).getByRole('button', { name: /search people/i })).toBeInTheDocument()
    expect(within(topBar).getByRole('button', { name: 'Quick capture' })).toBeInTheDocument()
    expect(within(topBar).getByText('/')).toBeInTheDocument()
  })

  it('shows the signed-in team member initials once the row loads', async () => {
    renderApp('/')
    expect(await screen.findByRole('button', { name: 'Account: Ahron Braun' })).toBeInTheDocument()
  })

  it('opens the quick-capture sheet and closes it with Escape', async () => {
    const user = userEvent.setup()
    renderApp('/')

    const topBar = await screen.findByRole('banner')
    await user.click(within(topBar).getByRole('button', { name: 'Quick capture' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Quick capture' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens quick capture straight from the PWA shortcut url', async () => {
    renderApp('/?capture=1')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('renders the mobile tab bar with the Magic Plus', async () => {
    renderApp('/')
    const navs = await screen.findAllByRole('navigation', { name: 'Primary' })
    const tabBar = navs[navs.length - 1] as HTMLElement
    expect(within(tabBar).getByRole('button', { name: 'Quick capture' })).toBeInTheDocument()
    expect(within(tabBar).getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('routes to each stub screen', async () => {
    renderApp('/giving')
    expect(await screen.findByRole('heading', { level: 1, name: 'Giving' })).toBeInTheDocument()
  })

  it('renders the 404 for an unknown path', async () => {
    renderApp('/nowhere')
    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument()
  })
})

describe('route guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the login screen when signed out', async () => {
    authState.session = null
    renderApp('/contacts')

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('offers the magic-link path on the login form', async () => {
    authState.session = null
    const user = userEvent.setup()
    renderApp('/login')

    await user.click(await screen.findByRole('button', { name: /email me a sign-in link instead/i }))
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })
})
