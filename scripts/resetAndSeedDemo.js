import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDatabase } from '../src/config/database.js'
import { env } from '../src/config/env.js'
import { User } from '../src/models/User.js'
import { LawyerProfile } from '../src/models/LawyerProfile.js'
import { HiringRequest } from '../src/models/HiringRequest.js'
import { PaymentTransaction } from '../src/models/PaymentTransaction.js'
import { Comment } from '../src/models/Comment.js'

if (process.env.DEMO_RESET_CONFIRM !== 'DELETE_ALL_NON_ADMIN_DATA') throw new Error('Set DEMO_RESET_CONFIRM=DELETE_ALL_NON_ADMIN_DATA to run this destructive reset.')
if (!env.MONGODB_URI || !env.IMGBB_API_KEY) throw new Error('MONGODB_URI and IMGBB_API_KEY are required.')

const portraits = [
  ['Naila Rahman', 'Family Law', 'Family transitions, custody matters, and practical settlement planning.', 14500, 9, 'Dhaka, Bangladesh', 'naila-rahman.png'],
  ['Saira Hossain', 'Employment Law', 'Clear advice for employees and growing teams on workplace policies and contracts.', 13000, 7, 'Chattogram, Bangladesh', 'saira-hossain.png'],
  ['Arif Chowdhury', 'Criminal Defense', 'Focused defense representation with careful preparation and direct communication.', 16000, 11, 'Dhaka, Bangladesh', 'arif-chowdhury.png'],
  ['Farhan Kabir', 'Corporate Law', 'Business formation and commercial contracts for founders and established companies.', 18000, 10, 'Sylhet, Bangladesh', 'farhan-kabir.png'],
  ['Maya Sen', 'Intellectual Property', 'Brand, copyright, and commercial-rights guidance for creators and businesses.', 15500, 8, 'Dhaka, Bangladesh', 'maya-sen.png'],
  ['Daniel Wright', 'Immigration Law', 'Steady guidance through complex immigration applications and appeals.', 17000, 14, 'London, United Kingdom', 'daniel-wright.png'],
]
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const assetDir = resolve(root, 'LegalEase-client/src/assets/demo-lawyers')
async function upload(filename) {
  const body = new FormData(); body.append('image', new Blob([await readFile(resolve(assetDir, filename))], { type: 'image/png' }), filename)
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, { method: 'POST', body, signal: AbortSignal.timeout(30000) })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.success || !result.data?.display_url) throw new Error(`imgBB upload failed for ${filename}.`)
  return result.data.display_url
}
await connectDatabase()
if (!await User.exists({ role: 'admin', status: 'active' })) throw new Error('At least one active admin must exist; refusing to reset.')
const backupDirectory = resolve(root, 'LegalEase-server/.local-backups')
await mkdir(backupDirectory, { recursive: true })
const backup = {
  createdAt: new Date().toISOString(),
  users: await User.collection.find({}).toArray(),
  lawyerProfiles: await LawyerProfile.collection.find({}).toArray(),
  hiringRequests: await HiringRequest.collection.find({}).toArray(),
  paymentTransactions: await PaymentTransaction.collection.find({}).toArray(),
  comments: await Comment.collection.find({}).toArray(),
}
const backupPath = resolve(backupDirectory, `before-demo-reset-${Date.now()}.json`)
await writeFile(backupPath, JSON.stringify(backup), { encoding: 'utf8', mode: 0o600 })
await Promise.all([Comment.deleteMany({}), PaymentTransaction.deleteMany({}), HiringRequest.deleteMany({}), LawyerProfile.deleteMany({}), User.deleteMany({ role: { $ne: 'admin' } })])
const urls = await Promise.all(portraits.map(([, , , , , , filename]) => upload(filename)))
const users = await User.create(portraits.map(([fullName], i) => ({ fullName, email: `demo.${i + 1}@legalease.example`, role: 'lawyer', providers: [] })))
const now = new Date()
await LawyerProfile.create(portraits.map(([fullName, specialization, bio, fee, experienceYears, location], i) => ({ userId: users[i]._id, professionalPhotoUrl: urls[i], specialization, bio, consultationFeeMinor: fee, experienceYears, licenseNumber: `DL-DEMO-${101 + i}`, location, languages: ['English', 'Bangla'], availability: i === 3 ? 'busy' : 'available', verificationStatus: 'paid', verificationPaidAt: now, publicationStatus: 'published' })))
console.info(`Demo reset complete: 6 fictional published lawyer profiles created; active admin accounts preserved. Backup: ${backupPath}`)
process.exit(0)
