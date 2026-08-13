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
  existingUser.fullName = env.ADMIN_NAME
  existingUser.passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
  existingUser.status = 'active'
  existingUser.tokenVersion += 1
  await existingUser.save()
  console.info(`Admin account credentials refreshed: ${existingUser.email}`)
  process.exit(0)
}

const activeAdmins = await User.find({ role: 'admin', status: 'active' }).select('+passwordHash')
if (activeAdmins.length === 1) {
  const admin = activeAdmins[0]
  admin.fullName = env.ADMIN_NAME
  admin.email = email
  admin.passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
  admin.tokenVersion += 1
  await admin.save()
  console.info(`Existing admin credentials moved to configured email: ${admin.email}`)
  process.exit(0)
}
if (activeAdmins.length > 1) {
  throw new Error('Multiple active admins exist. Refusing to guess which account should receive the configured credentials.')
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
