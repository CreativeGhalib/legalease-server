#!/usr/bin/env node
/**
 * Migration script to fix broken imgBB image URLs
 * Run with: node scripts/fixBrokenImages.js
 * Must be run from project root: node LegalEase-server/scripts/fixBrokenImages.js
 */

import { config } from 'dotenv'
import { join } from 'path'
import { fileURLToPath } from 'url'

// Load .env before importing any modules that use env
const __filename = fileURLToPath(import.meta.url)
const __dirname = __filename.split('/').slice(0, -1).join('/')
const envPath = join(__dirname, '../.env')

config({ path: envPath })

// Now import env and other modules
import mongoose from 'mongoose'
import { env } from '../src/config/env.js'
import { LawyerProfile } from '../src/models/LawyerProfile.js'

async function fixBrokenImages() {
  try {
    console.log('🔧 Connecting to MongoDB...')
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
    })
    console.log('✅ Connected to MongoDB')

    // Find profiles with broken or missing imgBB images
    console.log('\n🔍 Searching for broken images...')
    
    // Find profiles with the specific broken URL
    const brokenMesbah = await LawyerProfile.countDocuments({
      professionalPhotoUrl: /mesbah-768/i,
    })

    console.log(`Found ${brokenMesbah} profiles with mesbah-768 image`)

    if (brokenMesbah === 0) {
      console.log('\n✅ No broken images found!')
      await mongoose.disconnect()
      process.exit(0)
    }

    // Fix mesbah-768 images by removing them
    if (brokenMesbah > 0) {
      console.log('\n🔧 Fixing mesbah-768 image references...')
      const result = await LawyerProfile.updateMany(
        { professionalPhotoUrl: /mesbah-768/i },
        { $set: { professionalPhotoUrl: '' } }
      )
      console.log(`✅ Updated ${result.modifiedCount} profiles (removed mesbah-768 URLs)`)
    }

    console.log('\n✅ Migration complete!')
    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

fixBrokenImages()
