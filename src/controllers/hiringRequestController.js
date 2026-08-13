import { createHiringRequest, decideHiringRequest, getScopedRequest, listClientRequests, listLawyerRequests } from '../services/hiringService.js'

export async function createRequest(request, response, next) { try { return response.status(201).json({ success: true, data: { request: await createHiringRequest(request.auth.user, request.body.lawyerProfileId) } }) } catch (error) { return next(error) } }
export async function listMine(request, response, next) { try { return response.json({ success: true, data: { items: await listClientRequests(request.auth.user.id) } }) } catch (error) { return next(error) } }
export async function listReceived(request, response, next) { try { return response.json({ success: true, data: { items: await listLawyerRequests(request.auth.user.id) } }) } catch (error) { return next(error) } }
export async function getRequest(request, response, next) { try { return response.json({ success: true, data: { request: await getScopedRequest(request.params.id, request.auth.user) } }) } catch (error) { return next(error) } }
export async function decideRequest(request, response, next) { try { return response.json({ success: true, data: { request: await decideHiringRequest(request.params.id, request.auth.user, request.body.decision) } }) } catch (error) { return next(error) } }
