// Decision policy only. Does not change the embedding prompt, model or namespace.
export const DECISION_VERSION = 'algorithm-first-v1';
export const HARD_NEGATIVE_TARGET = 'stamp-phat-ba-quan-am';
export const HARD_NEGATIVE_TARGETS = new Set([
  'stamp-phat-ba-quan-am',
  'stamp-hoang-hau-ngoc-truc',
  'stamp-canh-cua-cham-rong',
  'stamp-hai-thieu-nu-em-be',
  'stamp-em-thuy',
]);
export function isHardNegativeTarget(externalId) {
  return HARD_NEGATIVE_TARGETS.has(externalId);
}
// Conservative interpretation of the EXISTING English description. This is not
// segmentation or an independent vision classifier. Never count figures, leaves,
// door panels, etc. inside one artwork as separate museum artifacts. A missing
// scene cue is unknown, not proof that the image contains only one object.
const OBJECTS = '(?:artworks|artifacts|paintings|statues|sculptures)';
const ADJECTIVES = '(?:(?:distinct|framed|separate|different|small|large|rectangular|wooden)\\s+){0,4}';
const PLURAL = `(?:two|three|four|five|several|multiple)\\s+${ADJECTIVES}${OBJECTS}`;
const SCENE = new RegExp(`^(?:${PLURAL}\\s+(?:are visible|are displayed|hang|stand|on display)|(?:(?:the|this) image (?:shows|displays|depicts) |(?:a|the) (?:museum|gallery) (?:scene|exhibit|interior) (?:shows|features|featuring) )${PLURAL}|(?:a |the )?(?:museum|gallery) (?:wall|interior|exhibit|setting)[^.!?]{0,120}${PLURAL})\\b`, 'i');
const CONTEXT_SCENE = new RegExp(`^(?:the image (?:shows|displays|depicts)|a view of) [^.!?]{0,100}\\b(?:gallery wall|museum exhibit|museum interior|hallway)\\b[^.!?]{0,100}\\b${PLURAL}\\b`, 'i');
const DOMINANT = /\b(?:(?:main|primary|dominant|most prominent|central|largest|larger|prominent)\s+(?:(?:framed|rectangular|horizontal|vertical|large|small|multi-panel|wooden|bronze|seated)\s+){0,4}(?:artwork|artifact|painting|screen|panel|statue|sculpture)|(?:artwork|artifact|painting|statue|sculpture)\s+(?:dominates the (?:image|frame)|is the (?:main|primary) (?:subject|focus)))\b/i;
const UNCLEAR = /^(?:(?:the|this) image (?:shows|contains|has) )?(?:no (?:clear|identifiable|discernible|recognizable) (?:artwork|artifact|museum object)(?: is visible)?|there is no (?:clear|identifiable|discernible|recognizable) (?:artwork|artifact)|no (?:artwork|artifact) is (?:visible|identifiable))\b/i;

export function classifyScene(description) {
  if (typeof description !== 'string' || !description.trim()) return { scene: 'unknown', reject: false, evidence: null };
  const text = description.trim();
  if (UNCLEAR.test(text)) return { scene: 'no_clear_artifact', reject: true, evidence: 'explicit_no_clear_artifact' };
  const firstSentence = text.split(/[.!?]/, 1)[0];
  const negatedPlural = new RegExp(`\\b(?:no|not|without)\\s+${PLURAL}\\b`, 'i').test(firstSentence);
  const multiple = !negatedPlural && (SCENE.test(text) || CONTEXT_SCENE.test(text));
  if (multiple && DOMINANT.test(text)) return { scene: 'single_dominant_artifact', reject: false, evidence: 'multiple_with_explicit_primary' };
  if (multiple) return { scene: 'multi_artifact_scene', reject: true, evidence: 'explicit_multiple_without_primary' };
  return { scene: 'unknown', reject: false, evidence: null };
}

// Runtime routing is based on the D1 external ID of the retrieved candidate,
// NEVER expected labels, user input, names or Vectorize metadata alone.
export function decideRecognition({ ranked, threshold, margin, hardNegativeTriggered = false }) {
  const first = ranked[0];
  const embeddingPass = ranked.length >= 2 && first.score >= threshold && first.score - ranked[1].score >= margin;
  const base = { recognized: false, artifact: null, source: null };
  if (hardNegativeTriggered && isHardNegativeTarget(first?.external_object_id)) return { ...base, status: 'uncertain', reason: 'hard_negative_conflict' };
  return embeddingPass
    ? { ...base, recognized: true, artifact: first, status: 'matched', source: 'embedding', reason: 'threshold_and_margin_passed' }
    : { ...base, status: first?.score >= threshold ? 'uncertain' : 'no_match', reason: first?.score >= threshold ? 'insufficient_margin' : 'below_threshold' };
}
