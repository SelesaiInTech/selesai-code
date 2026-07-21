#!/usr/bin/env node
// The skill is user-facing documentation. This short runtime prompt is injected
// on every turn, while extension state owns activation and deactivation.
const CAVEMAN_INSTRUCTIONS =
  'CAVEMAN MODE ACTIVE. Terse, technically complete: omit articles, filler, pleasantries, and hedging; fragments, short terms, standard abbreviations, and -> are OK. Preserve technical terms, code blocks, and quoted errors exactly. Use clear normal prose for security warnings, irreversible confirmations, risky multi-step instructions, or requested/repeated clarification; then resume terse mode.';

function getCavemanInstructions() {
  return CAVEMAN_INSTRUCTIONS;
}

module.exports = { getCavemanInstructions };