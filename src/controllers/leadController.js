import mongoose from 'mongoose'
import { ChatLead } from '../models/ChatLead.js'
import { sendCsvResponse } from '../utils/csv.js'

const PAGE_SIZE = 20

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function leadDto(lead) {
  const notes = lead.notes ?? []
  const lastNote = notes.at(-1)
  return {
    id: String(lead._id),
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    legalIssue: lead.legalIssue,
    urgencyLevel: lead.urgencyLevel,
    source: lead.source,
    status: lead.status,
    lastNote: lastNote ? { text: lastNote.text, at: lastNote.at } : null,
    createdAt: lead.createdAt,
  }
}

function queryFilter(query) {
  const filter = {}
  if (query.status) filter.status = query.status
  if (query.source) filter.source = query.source
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {}
    if (query.dateFrom) filter.createdAt.$gte = new Date(`${query.dateFrom}T00:00:00.000Z`)
    if (query.dateTo) filter.createdAt.$lte = new Date(`${query.dateTo}T23:59:59.999Z`)
  }
  return filter
}

export async function createLead(request, response, next) {
  try {
    const lead = await ChatLead.create(request.body)
    return response.status(201).json({
      success: true,
      data: { leadId: String(lead._id), status: lead.status },
    })
  } catch (error) {
    return next(error)
  }
}

export async function listLeads(request, response, next) {
  try {
    const { page } = request.validatedQuery
    const filter = queryFilter(request.validatedQuery)
    const [items, totalItems] = await Promise.all([
      ChatLead.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      ChatLead.countDocuments(filter),
    ])
    return response.json({
      success: true,
      data: { items: items.map(leadDto) },
      meta: { page, pageSize: PAGE_SIZE, totalItems, totalPages: Math.ceil(totalItems / PAGE_SIZE) },
    })
  } catch (error) {
    return next(error)
  }
}

export async function updateLeadStatus(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) throw fail('Lead was not found.', 404, 'LEAD_NOT_FOUND')
    const lead = await ChatLead.findByIdAndUpdate(
      request.params.id,
      { $set: { status: request.body.status } },
      { new: true },
    ).lean()
    if (!lead) throw fail('Lead was not found.', 404, 'LEAD_NOT_FOUND')
    return response.json({ success: true, data: { lead: leadDto(lead) } })
  } catch (error) {
    return next(error)
  }
}

export async function addLeadNote(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) throw fail('Lead was not found.', 404, 'LEAD_NOT_FOUND')
    const lead = await ChatLead.findByIdAndUpdate(
      request.params.id,
      { $push: { notes: { text: request.body.note, adminId: request.auth.user.id, at: new Date() } } },
      { new: true },
    ).lean()
    if (!lead) throw fail('Lead was not found.', 404, 'LEAD_NOT_FOUND')
    return response.json({ success: true, data: { lead: leadDto(lead) } })
  } catch (error) {
    return next(error)
  }
}

export async function exportLeads(request, response, next) {
  try {
    const leads = await ChatLead.find(queryFilter(request.validatedQuery))
      .sort({ createdAt: -1, _id: -1 })
      .limit(5000)
      .lean()
    return sendCsvResponse(response, 'leads',
      ['id', 'name', 'phone', 'email', 'legalIssue', 'urgencyLevel', 'source', 'status', 'lastNote', 'createdAt'],
      leads.map((lead) => {
        const item = leadDto(lead)
        return [item.id, item.name, item.phone, item.email, item.legalIssue, item.urgencyLevel, item.source, item.status, item.lastNote?.text ?? '', item.createdAt?.toISOString?.() ?? item.createdAt]
      }),
    )
  } catch (error) {
    return next(error)
  }
}
