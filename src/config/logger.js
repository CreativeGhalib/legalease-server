import winston from 'winston'

const { combine, timestamp, errors, json, colorize, printf } = winston.format

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    return `${ts} [${level}] ${message}${stack ? `\n${stack}` : ''}${extras}`
  })
)

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
)

const transports = [new winston.transports.Console()]

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports,
})
