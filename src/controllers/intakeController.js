import { LawyerProfile } from '../models/LawyerProfile.js'
import { classifyIntakeMessage } from '../services/intakeClassifier.js'
import { publicLawyerPipeline, publicLawyerProjection } from './publicLawyerController.js'

export async function qualifyIntake(request, response, next) {
  try {
    const classification = classifyIntakeMessage(request.body.message)

    const pipelineArgs = classification.matchedSpecialization
      ? { specialization: classification.matchedSpecialization }
      : {}
    const { pipeline, sort } = publicLawyerPipeline(pipelineArgs)

    const recommendedLawyers = await LawyerProfile.aggregate([
      ...pipeline,
      { $sort: sort },
      { $limit: 3 },
      { $project: publicLawyerProjection },
    ])

    return response.json({
      success: true,
      data: {
        category: classification.category,
        urgency: classification.urgency,
        summary: classification.summary,
        matchedSpecialization: classification.matchedSpecialization,
        recommendedLawyers,
      },
    })
  } catch (error) {
    return next(error)
  }
}
