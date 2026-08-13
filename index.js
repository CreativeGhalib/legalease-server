import app from './src/app.js'
import { connectDatabase } from './src/config/database.js'

let connectionPromise

async function ensureDatabaseConnection() {
  if (!connectionPromise) {
    connectionPromise = connectDatabase().catch((error) => {
      connectionPromise = undefined
      throw error
    })
  }

  return connectionPromise
}

// Vercel recognizes a root default export as a Node/Express entry point.
// Local development continues to use src/server.js, which owns app.listen().
export default async function handler(request, response) {
  try {
    await ensureDatabaseConnection()
    return app(request, response)
  } catch (error) {
    console.error('Production database connection failed.', error)
    return response.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is temporarily unavailable.' },
    })
  }
}
