import { Router } from 'express'
import { getRobots, getSitemap } from '../controllers/seoController.js'

const seoRouter = Router()

seoRouter.get('/robots.txt', getRobots)
seoRouter.get('/sitemap.xml', getSitemap)

export default seoRouter
