import mongoose from 'mongoose'
import { HiringRequest } from '../models/HiringRequest.js'
import { CaseDocument, MAX_DOCUMENTS_PER_CASE } from '../models/CaseDocument.js'
import { resolveEngagementFor } from './caseTrackerController.js'
import { transferFileToImgbb } from './uploadController.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function safeDocument(document, viewerId) {
  return {
    id: document._id.toString(),
    imageUrl: document.imageUrl,
    originalName: document.originalName,
    mimeType: document.mimeType,
    uploadedByRole: document.uploadedByRole,
    uploadedByMe: String(document.uploadedById) === String(viewerId),
    createdAt: document.createdAt,
  }
}

export async function uploadCaseDocument(request, response, next) {
  try {
    const { engagement } = await resolveEngagementFor(request.auth.user, request.params.hiringRequestId)

    if (!request.file) throw fail('Choose an image file to upload.', 400, 'IMAGE_REQUIRED')

    const activeCount = await CaseDocument.countDocuments({ hiringRequestId: engagement._id, deletedAt: null })
    if (activeCount >= MAX_DOCUMENTS_PER_CASE) {
      throw fail(`A case can hold at most ${MAX_DOCUMENTS_PER_CASE} evidence images.`, 409, 'DOCUMENT_LIMIT_REACHED')
    }

    const imageUrl = await transferFileToImgbb(request.file)

    const document = await CaseDocument.create({
      hiringRequestId: engagement._id,
      uploadedById: request.auth.user.id,
      uploadedByRole: request.auth.user.role === 'lawyer' ? 'lawyer' : 'user',
      imageUrl,
      originalName: request.file.originalname ?? '',
      mimeType: request.file.mimetype,
    })

    return response.status(201).json({
      success: true,
      data: { document: safeDocument(document, request.auth.user.id) },
    })
  } catch (error) {
    return next(error)
  }
}

export async function listCaseDocuments(request, response, next) {
  try {
    const { engagement } = await resolveEngagementFor(request.auth.user, request.params.hiringRequestId)

    const documents = await CaseDocument.find({ hiringRequestId: engagement._id, deletedAt: null })
      .sort({ createdAt: -1, _id: -1 })

    return response.json({
      success: true,
      data: { items: documents.map((doc) => safeDocument(doc, request.auth.user.id)) },
    })
  } catch (error) {
    return next(error)
  }
}

export async function deleteCaseDocument(request, response, next) {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) {
      throw fail('Document was not found.', 404, 'DOCUMENT_NOT_FOUND')
    }

    const document = await CaseDocument.findOne({ _id: request.params.id, deletedAt: null })
    if (!document) throw fail('Document was not found.', 404, 'DOCUMENT_NOT_FOUND')

    const engagement = await HiringRequest.findById(document.hiringRequestId)
    const isUploader = String(document.uploadedById) === String(request.auth.user.id)
    const isLawyerOfRecord = engagement && String(engagement.lawyerId) === String(request.auth.user.id)
    if (!isUploader && !isLawyerOfRecord) throw fail('Document was not found.', 404, 'DOCUMENT_NOT_FOUND')

    document.deletedAt = new Date()
    await document.save()

    return response.json({ success: true, data: { id: document._id.toString(), deleted: true } })
  } catch (error) {
    return next(error)
  }
}
