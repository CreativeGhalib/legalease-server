import mongoose from 'mongoose'
import { Appointment } from '../models/Appointment.js'
import { LawyerProfile } from '../models/LawyerProfile.js'
import { User } from '../models/User.js'
import { createNotification } from '../services/notificationService.js'
import { dhakaTodayKey, endLabelFor, generateDaySlots } from '../utils/slots.js'

function fail(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function isValidId(id) {
  return mongoose.isObjectIdOrHexString(id)
}

async function resolveBookableProfile(profileId) {
  if (!isValidId(profileId)) throw fail('This lawyer is not publicly available.', 404, 'LAWYER_NOT_FOUND')
  const profile = await LawyerProfile.findOne({
    _id: profileId,
    publicationStatus: 'published',
    verificationStatus: 'paid',
    availability: 'available',
  }).populate({ path: 'userId', match: { role: 'lawyer', status: 'active' }, select: '_id fullName' })
  if (!profile?.userId) throw fail('This lawyer is not publicly available.', 404, 'LAWYER_NOT_FOUND')
  return profile
}

export async function getLawyerSlots(request, response, next) {
  try {
    const profile = await resolveBookableProfile(request.params.id)
    const { dateKey } = request.validatedQuery

    const booked = await Appointment.find({ lawyerProfileId: profile._id, dateKey, status: 'scheduled' }).select('start').lean()
    const bookedStarts = new Set(booked.map((doc) => doc.start))

    const slots = generateDaySlots({
      workingHours: profile.workingHours,
      dateKey,
      bookedStarts,
      duration: profile.slotDurationMinutes ?? 30,
    })

    return response.json({ success: true, data: { dateKey, durationMinutes: profile.slotDurationMinutes ?? 30, slots } })
  } catch (error) {
    return next(error)
  }
}

function safeAppointment(appointment, viewer) {
  const base = {
    id: appointment._id.toString(),
    dateKey: appointment.dateKey,
    start: appointment.start,
    end: appointment.end,
    status: appointment.status,
    meetingLink: appointment.meetingLink || '',
    createdAt: appointment.createdAt,
  }
  if (viewer === 'client') {
    return {
      ...base,
      lawyer: appointment.lawyerProfileId
        ? { id: String(appointment.lawyerProfileId._id), fullName: appointment.lawyerProfileId.userId?.fullName ?? 'LegalEase lawyer' }
        : null,
    }
  }
  return {
    ...base,
    client: appointment.userId
      ? { id: String(appointment.userId._id), fullName: appointment.userId.fullName ?? 'Client' }
      : null,
  }
}

export async function createAppointment(request, response, next) {
  try {
    const profile = await resolveBookableProfile(request.body.lawyerProfileId)

    const duplicateUpcoming = await Appointment.findOne({
      userId: request.auth.user.id,
      lawyerProfileId: profile._id,
      status: 'scheduled',
      dateKey: { $gte: dhakaTodayKey() },
    })
    if (duplicateUpcoming) throw fail('You already have an upcoming consultation with this lawyer.', 409, 'APPOINTMENT_EXISTS')

    const booked = await Appointment.find({ lawyerProfileId: profile._id, dateKey: request.body.dateKey, status: 'scheduled' }).select('start').lean()
    const openSlots = generateDaySlots({
      workingHours: profile.workingHours,
      dateKey: request.body.dateKey,
      bookedStarts: new Set(booked.map((doc) => doc.start)),
      duration: profile.slotDurationMinutes ?? 30,
    })
    if (!openSlots.includes(request.body.start)) throw fail('That slot is no longer available.', 409, 'SLOT_UNAVAILABLE')

    const appointment = await Appointment.create({
      lawyerProfileId: profile._id,
      userId: request.auth.user.id,
      dateKey: request.body.dateKey,
      start: request.body.start,
      end: endLabelFor(request.body.start, profile.slotDurationMinutes ?? 30),
    })

    await createNotification({
      userId: profile.userId._id ?? profile.userId,
      title: `Consultation booked for ${appointment.dateKey}`,
      message: `${request.auth.user.fullName} booked ${appointment.start}–${appointment.end}.`,
      type: 'appointment',
      link: '/dashboard',
    })

    const populated = await appointment.populate({ path: 'lawyerProfileId', select: 'userId', populate: { path: 'userId', select: 'fullName' } })
    return response.status(201).json({ success: true, data: { appointment: safeAppointment(populated, 'client') } })
  } catch (error) {
    if (error?.code === 11000) return next(fail('That slot is no longer available.', 409, 'SLOT_UNAVAILABLE'))
    return next(error)
  }
}

export async function listMyAppointments(request, response, next) {
  try {
    const items = await Appointment.find({ userId: request.auth.user.id })
      .sort({ dateKey: -1, start: -1 })
      .populate({ path: 'lawyerProfileId', select: 'userId specialization', populate: { path: 'userId', select: 'fullName' } })
    return response.json({
      success: true,
      data: {
        items: items.map((appointment) => ({
          id: appointment._id.toString(),
          dateKey: appointment.dateKey,
          start: appointment.start,
          end: appointment.end,
          status: appointment.status,
          meetingLink: appointment.meetingLink,
          specialization: appointment.lawyerProfileId?.specialization ?? '',
          counterpartName: appointment.lawyerProfileId?.userId?.fullName ?? 'LegalEase lawyer',
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
}

export async function listLawyerAppointments(request, response, next) {
  try {
    const profile = await LawyerProfile.findOne({ userId: request.auth.user.id }).select('_id')
    if (!profile) return response.json({ success: true, data: { items: [] } })

    const items = await Appointment.find({ lawyerProfileId: profile._id })
      .sort({ dateKey: -1, start: -1 })
      .populate('userId', 'fullName')
    return response.json({
      success: true,
      data: {
        items: items.map((appointment) => ({
          id: appointment._id.toString(),
          dateKey: appointment.dateKey,
          start: appointment.start,
          end: appointment.end,
          status: appointment.status,
          meetingLink: appointment.meetingLink,
          counterpartName: appointment.userId?.fullName ?? 'LegalEase client',
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
}

export async function cancelAppointment(request, response, next) {
  try {
    if (!isValidId(request.params.id)) throw fail('Appointment was not found.', 404, 'APPOINTMENT_NOT_FOUND')

    const appointment = await Appointment.findById(request.params.id).populate('lawyerProfileId', 'userId')
    const isParty =
      appointment &&
      (String(appointment.userId) === String(request.auth.user.id) ||
        (appointment.lawyerProfileId && String(appointment.lawyerProfileId.userId) === String(request.auth.user.id)))
    if (!isParty) throw fail('Appointment was not found.', 404, 'APPOINTMENT_NOT_FOUND')
    if (appointment.status !== 'scheduled') throw fail('This appointment is already closed.', 409, 'APPOINTMENT_ALREADY_CLOSED')

    appointment.status = 'cancelled'
    await appointment.save()
    return response.json({ success: true, data: { id: appointment._id.toString(), status: appointment.status } })
  } catch (error) {
    return next(error)
  }
}

export async function completeAppointment(request, response, next) {
  try {
    if (!isValidId(request.params.id)) throw fail('Appointment was not found.', 404, 'APPOINTMENT_NOT_FOUND')

    const appointment = await Appointment.findById(request.params.id).populate('lawyerProfileId', 'userId')
    if (!appointment || String(appointment.lawyerProfileId?.userId) !== String(request.auth.user.id)) {
      throw fail('Appointment was not found.', 404, 'APPOINTMENT_NOT_FOUND')
    }
    if (appointment.status !== 'scheduled') throw fail('This appointment is already closed.', 409, 'APPOINTMENT_ALREADY_CLOSED')

    appointment.status = 'completed'
    await appointment.save()
    return response.json({ success: true, data: { id: appointment._id.toString(), status: appointment.status } })
  } catch (error) {
    return next(error)
  }
}
