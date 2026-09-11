import { createRootRoute, createRoute, createRouter, useLocation, useParams } from '@tanstack/react-router'
import { Layout } from './components/Layout.js'
import { Chat } from './routes/chat.js'
import { Usage } from './routes/usage.js'

// Chat はルート直下で常駐させる。/ → /c/:id の遷移で再マウントされるとストリーム中の状態が消えるため
function Root() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const { pathname } = useLocation()
  return <Layout>{pathname === '/usage' ? <Usage /> : <Chat id={id} />}</Layout>
}

const rootRoute = createRootRoute({ component: Root })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' })
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/c/$id' })
const usageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/usage' })

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, chatRoute, usageRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
