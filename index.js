import app from './src/app.js'

// Vercel recognizes a root default export as a Node/Express entry point.
// Local development continues to use src/server.js, which owns app.listen().
export default app
