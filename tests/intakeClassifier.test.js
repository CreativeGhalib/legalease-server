import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIntakeMessage } from '../src/services/intakeClassifier.js'

test('classifier maps English and Banglish descriptions onto the canonical specializations', () => {
  const cases = [
    ['Police arrested my brother last night and we need bail urgently', 'Criminal Law'],
    ['I filed for divorce and want custody of my children', 'Family Law'],
    ['Someone copied my logo for their shop', 'Intellectual Property'],
    ['My salary has not been paid for three months', 'Employment Law'],
    ['I need a work permit extension for overseas job', 'Immigration Law'],
    ['amar jomi niye problem hocche, neighbor is claiming my plot', 'Property Law'],
    ['We need help registering our new company and trade license', 'Corporate Law'],
    ['The cheque was dishonored and they refuse to repay the loan', 'Civil Litigation'],
  ]
  for (const [message, expected] of cases) {
    assert.equal(classifyIntakeMessage(message).category, expected, `category mismatch for: ${message}`)
  }
})

test('urgency escalates on urgent cues and stays routine otherwise', () => {
  assert.equal(classifyIntakeMessage('Police arrested my brother').urgency, 'urgent')
  assert.equal(classifyIntakeMessage('There is a hearing next week about divorce').urgency, 'soon')
  assert.equal(classifyIntakeMessage('I want to register a trademark for my brand').urgency, 'routine')
})

test('summary keeps at most the first two sentences within 200 characters', () => {
  const long = 'First sentence about the dispute. Second sentence with more detail. Third sentence should be dropped entirely.'
  const result = classifyIntakeMessage(long)
  assert.ok(result.summary.startsWith('First sentence'))
  assert.ok(!result.summary.includes('Third sentence'))

  const padded = classifyIntakeMessage(`${'x'.repeat(250)}. Second.`)
  assert.ok(padded.summary.length <= 200)
})

test('unrecognised text yields a null category without throwing', () => {
  const result = classifyIntakeMessage('Hello there friend')
  assert.equal(result.category, null)
  assert.equal(result.urgency, 'routine')
})
