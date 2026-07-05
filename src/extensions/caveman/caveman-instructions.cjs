#!/usr/bin/env node
// Shared Caveman instruction builder. Caveman is binary on/off (no intensity
// levels), so the skill body is injected verbatim — no mode filtering needed.

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', '..', 'skills', 'caveman', 'SKILL.md');

const FALLBACK_INSTRUCTIONS =
  'CAVEMAN MODE ACTIVE.\n\n' +
  'Respond terse like smart caveman. All technical substance stay. Only fluff die.\n\n' +
  '## Persistence\n\n' +
  'ACTIVE EVERY RESPONSE once triggered. No revert after many turns. No filler drift. ' +
  'Still active if unsure. Off only when user says "stop caveman" or "normal mode".\n\n' +
  '## Rules\n\n' +
  'Drop: articles (a/an/the), filler (just/really/basically/actually/simply), ' +
  'pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. ' +
  'Short synonyms. Abbreviate common terms (DB/auth/config/req/res/fn/impl). ' +
  'Strip conjunctions. Use arrows for causality (X -> Y). One word when one word enough.\n\n' +
  'Technical terms stay exact. Code blocks unchanged. Errors quoted exact.\n\n' +
  '## Auto-Clarity Exception\n\n' +
  'Drop caveman temporarily for: security warnings, irreversible action confirmations, ' +
  'multi-step sequences where fragment order risks misread, user asks to clarify or ' +
  'repeats question. Resume caveman after clear part done.';

function stripFrontmatter(body) {
  return String(body || '').replace(/^---[\s\S]*?---\s*/, '');
}

function getCavemanInstructions() {
  try {
    return 'CAVEMAN MODE ACTIVE.\n\n' + stripFrontmatter(fs.readFileSync(SKILL_PATH, 'utf8'));
  } catch (e) {
    return FALLBACK_INSTRUCTIONS;
  }
}

module.exports = { getCavemanInstructions, stripFrontmatter };