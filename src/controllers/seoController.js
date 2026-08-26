import { LawyerProfile } from '../models/LawyerProfile.js'
import { publicLawyerPipeline } from './publicLawyerController.js'
import { env } from '../config/env.js'

const CACHE_TTL_MS = 10 * 60 * 1000

const CATEGORY_SLUGS = [
  'family-lawyer',
  'criminal-lawyer',
  'corporate-lawyer',
  'property-lawyer',
  'immigration-lawyer',
  'employment-lawyer',
  'civil-lawyer',
  'ip-lawyer',
]

export const STATIC_ROUTES = ['/', '/lawyers', '/about', '/contact', '/privacy', '/terms', '/refund-policy']

let sitemapCache = { fetchedAt: 0, body: null }

export function resetSitemapCache() {
  sitemapCache = { fetchedAt: 0, body: null }
}

function baseUrl() {
  return env.clientOrigins[0] ?? 'https://legalease-sand.vercel.app'
}

async function buildSitemapBody() {
  const base = baseUrl()
  const { pipeline, sort } = publicLawyerPipeline({})
  const eligible = await LawyerProfile.aggregate([...pipeline, { $sort: sort }, { $project: { _id: 1 } }])

  const urls = [
    ...STATIC_ROUTES,
    ...CATEGORY_SLUGS.map((slug) => `/lawyers/in/${slug}`),
    ...eligible.map((row) => `/lawyers/${String(row._id)}`),
  ]

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((path) => `<url><loc>${base}${path}</loc></url>`),
    '</urlset>',
  ].join('\n')
}

export async function getSitemap(_request, response, next) {
  try {
    const now = Date.now()
    if (!sitemapCache.body || now - sitemapCache.fetchedAt > CACHE_TTL_MS) {
      sitemapCache = { fetchedAt: now, body: await buildSitemapBody() }
    }
    response.setHeader('Content-Type', 'application/xml; charset=utf-8')
    return response.send(sitemapCache.body)
  } catch (error) {
    return next(error)
  }
}

export async function getRobots(_request, response) {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /dashboard/',
    'Disallow: /api/',
    'Disallow: /payment/',
    `Sitemap: ${baseUrl()}/sitemap.xml`,
    '',
  ].join('\n')
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  return response.send(body)
}
