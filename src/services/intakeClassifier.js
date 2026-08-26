const CATEGORY_KEYWORDS = [
  {
    category: 'Criminal Law',
    keywords: ['arrest', 'arrested', 'bail', 'police', 'custody', 'murder', 'theft', 'robbery', 'dacoit', 'accused', 'charge sheet', 'jail', 'criminal case', 'fir'],
  },
  {
    category: 'Family Law',
    keywords: ['divorce', 'custody', 'alimony', 'dowry', 'marriage', 'talaq', 'spouse', 'child support'],
  },
  {
    category: 'Intellectual Property',
    keywords: ['trademark', 'copyright', 'patent', 'logo', 'brand copy', 'piracy'],
  },
  {
    category: 'Employment Law',
    keywords: ['salary', 'termination', 'fired', 'laid off', 'notice period', 'gratuity', 'provident fund', 'maternity', 'workplace harassment', 'employer'],
  },
  {
    category: 'Immigration Law',
    keywords: ['visa', 'passport', 'green card', 'asylum', 'work permit', 'immigration', 'overseas job'],
  },
  {
    category: 'Property Law',
    keywords: ['land', 'property', 'flat', 'plot', 'khatian', 'mutation', 'eviction', 'possession', 'jomi', 'jomin'],
  },
  {
    category: 'Corporate Law',
    keywords: ['company registration', 'trade license', 'shareholder', 'director', 'incorporation', 'partnership deed', 'vat', 'tin certificate'],
  },
  {
    category: 'Civil Litigation',
    keywords: ['cheque dishonored', 'cheque dishonoured', 'money recovery', 'loan', 'promissory note', 'injunction', 'damages', 'civil suit', 'neighbor'],
  },
]

const URGENT_CUES = ['urgent', 'emergency', 'arrested', 'arrest', 'bail', 'detained', 'tomorrow', 'tonight', 'asap']
const SOON_CUES = ['hearing', 'notice', 'summons', 'sued', 'case filed', 'deadline', 'this week']

export function classifyIntakeMessage(rawMessage) {
  const message = rawMessage.trim().toLowerCase()

  let bestCategory = null
  let bestHits = 0
  for (const group of CATEGORY_KEYWORDS) {
    const hits = group.keywords.filter((keyword) => message.includes(keyword)).length
    if (hits > bestHits) {
      bestHits = hits
      bestCategory = group.category
    }
  }

  const isUrgent = URGENT_CUES.some((cue) => message.includes(cue))
  const isSoon = SOON_CUES.some((cue) => message.includes(cue))
  const urgency = isUrgent ? 'urgent' : isSoon ? 'soon' : 'routine'

  const sentences = rawMessage.trim().split(/(?<=[.!?।])\s+/)
  const summaryBase = sentences.slice(0, 2).join(' ')
  const summary = summaryBase.length > 200 ? `${summaryBase.slice(0, 197)}...` : summaryBase

  return {
    category: bestCategory,
    matchedSpecialization: bestCategory,
    urgency,
    summary,
  }
}
