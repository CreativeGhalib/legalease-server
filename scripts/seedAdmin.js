import 'dotenv/config'
import bcrypt from 'bcrypt'
import { connectDatabase } from '../src/config/database.js'
import { env } from '../src/config/env.js'
import { User } from '../src/models/User.js'

if (!env.ADMIN_NAME || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required to seed an admin.')
}

await connectDatabase()
const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
const user = await User.findOneAndUpdate(
  { email: env.ADMIN_EMAIL.toLowerCase() },
  { $set: { fullName: env.ADMIN_NAME, passwordHash, role: 'admin', status: 'active' }, $addToSet: { providers: 'local' } },
  { new: true, upsert: true, setDefaultsOnInsert: true },
)
console.info(`Admin account ready: ${user.email}`)
process.exit(0)
