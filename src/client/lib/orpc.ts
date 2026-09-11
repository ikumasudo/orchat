import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { Router } from '../../server/router.js'

const link = new RPCLink({
  url: `${location.origin}/rpc`,
  fetch: (req, init) =>
    fetch(req, init).then((r) => {
      if (r.status === 401) location.assign('/login')
      return r
    }),
})
export const client: RouterClient<Router> = createORPCClient(link)
export const orpc = createTanstackQueryUtils(client)
