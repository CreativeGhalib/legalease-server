import 'dotenv/config'
import bcrypt from 'bcrypt'
import { connectDatabase } from '../src/config/database.js'
import { env } from '../src/config/env.js'
import { User } from '../src/models/User.js'

if (!env.ADMIN_NAME || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required to seed an admin.')
}

await connectDatabase()
const email = env.ADMIN_EMAIL.toLowerCase()
const existingUser = await User.findOne({ email }).select('+passwordHash')

if (existingUser) {
  if (existingUser.role !== 'admin') {
    throw new Error('ADMIN_EMAIL belongs to an existing non-admin account. Refusing to overwrite it.')
  }
  console.info(`Admin account already exists: ${existingUser.email}`)
  process.exit(0)
}

const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
const user = await User.create({
  fullName: env.ADMIN_NAME,
  email,
  passwordHash,
  role: 'admin',
  providers: ['local'],
})
console.info(`Admin account created: ${user.email}`)
process.exit(0)
