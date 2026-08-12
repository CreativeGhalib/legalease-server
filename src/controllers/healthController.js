import { databaseStatus } from '../config/database.js'

export function getHealth(_request, response) {
  response.status(200).json({
    success: true,
    data: { status: 'ok', database: databaseStatus() },
  })
}
