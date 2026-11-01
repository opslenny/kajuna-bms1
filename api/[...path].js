import { createApiApp } from '../server/api.js'

const app = createApiApp()

export default function handler(req, res) {
  if (!req.url.startsWith('/api/')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`
  }
  return app(req, res)
}
