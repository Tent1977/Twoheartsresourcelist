/**
 * Rhetoric.js — sentence-level analysis of what a speaker is actually doing.
 *
 * Every sentence gets a rhetorical MOVE (what the speaker is doing with it) and
 * an EPISTEMIC TYPE (fact / opinion / idea / subject-shift). The notebook and
 * the prediction engine both key off these, so this is the spine of the
 * analysis layer.
 *
 * This is a fast lexical pass that runs on every sentence in real time. The
 * copilot (Claude / DeepSeek) re-scores the interesting ones asynchronously —
 * see CopilotAdapter. The lexical pass never blocks the transcript.
 */

'use strict';

const MOVES = [
  { move: 'request',     re: /\b(?:can you|could you|would you|i need you to|please)\b/i, weight: 1.05 },
  // A trailing "?" is decisive. A sentence-initial wh-word only signals a
  // question when the sentence is NOT a completed statement — otherwise
  // "When I was unsheltered, I parked there." reads as a question.
  { move: 'question',    re: /\?\s*$|^(?:who|what|when|where|why|how|do|does|did|can|could|would|should|is|are|will)\b(?![^?]*[.!]\s*$)/i, weight: 1.0 },
  { move: 'decision',    re: /\b(?:we(?:'ve| have) decided|let'?s go with|final answer|that'?s settled|approved)\b/i, weight: 0.95 },
  { move: 'commitment',  re: /\bi(?:'ll| will)\b|\bwe(?:'ll| will)\b|\bi commit\b|\bby (?:friday|monday|next week|end of)\b/i, weight: 0.9 },
  { move: 'data-point',  re: /\b\d+(?:\.\d+)?\s*(?:%|percent|people|beds|units|dollars|clients|households)\b|\$\s?\d/i, weight: 0.9 },
  { move: 'objection',   re: /\b(?:i disagree|that'?s not right|i don'?t think|that won'?t work|that will not work)\b/i, weight: 0.85 },
  { move: 'concession',  re: /\b(?:fair (?:point|enough)|you'?re right|i take your point|granted|that'?s true)\b/i, weight: 0.85 },
  { move: 'action-item', re: /\b(?:action item|follow up|circle back|send (?:me|us|over)|put together|draft (?:a|the)|schedule)\b/i, weight: 0.85 },
  { move: 'procedural',  re: /\b(?:next (?:item|slide|on the agenda)|moving on|let'?s start|any other business|minutes)\b/i, weight: 0.85 },
  { move: 'deflection',  re: /\b(?:that(?:'s| is) (?:a )?(?:different|another) (?:conversation|topic)|let'?s table|park that|outside (?:my|our) (?:scope|lane)|i'?d have to check)\b/i, weight: 0.8 },
  { move: 'anecdote',    re: /\b(?:when i was|i remember|there was (?:a|this)|i had a (?:client|guy|woman|neighbor))\b/i, weight: 0.8 },

  { move: 'hedge',       re: /\b(?:maybe|possibly|i think|i believe|sort of|kind of|probably|might|could be|not sure|i'?m not certain)\b/i, weight: 0.6 },
];

// Epistemic type — is this checkable, or is it a preference?
const FACT_CUES = /\b(?:according to|the data (?:shows|says)|the report|studies show|as of|the statute|per (?:hud|the) policy|we counted|the numbers)\b|\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s*(?:%|percent)\b/i;
const OPINION_CUES = /\b(?:i (?:think|feel|believe)|in my (?:opinion|view)|personally|it seems|i'?d say|honestly|frankly)\b/i;
const IDEA_CUES = /\b(?:what if|we (?:could|should|might)|imagine if|proposal|suggestion|here'?s an idea|why don'?t we)\b/i;
const SUBJECT_SHIFT_CUES = /\b(?:on another note|switching gears|separately|different (?:topic|subject)|before i forget|new topic|moving on to)\b/i;

/**
 * Moves that leave something owed by the room. A request phrased as a question
 * ("can you send me the file?") is a request, but it still needs an answer, so
 * open-thread tracking has to treat both the same.
 */
const ENQUIRY_MOVES = ['question', 'request'];

/** Split text into sentences. Keeps decimals and common abbreviations intact. */
function segment(text) {
  if (!text) return [];
  const protectedText = String(text)
    .replace(/\b(Mr|Mrs|Ms|Dr|Sr|Jr|St|vs|etc|Inc|Ltd|Ave|approx)\./gi, '$1<ABBR>')
    .replace(/(\d)\.(\d)/g, '$1<DEC>$2');
  const parts = protectedText.match(/[^.!?]+[.!?]*/g) || [];
  return parts
    .map((s) => s.replace(/<ABBR>/g, '.').replace(/<DEC>/g, '.').trim())
    .filter((s) => s.length > 0);
}

function classify(sentence) {
  const s = String(sentence || '');
  const hits = MOVES
    .filter((m) => m.re.test(s))
    .sort((a, b) => b.weight - a.weight);

  const move = hits.length ? hits[0].move : 'statement';
  const alternates = hits.slice(1, 3).map((h) => h.move);

  let epistemic = 'assertion';
  if (SUBJECT_SHIFT_CUES.test(s)) epistemic = 'subject-shift';
  else if (IDEA_CUES.test(s)) epistemic = 'idea';
  else if (OPINION_CUES.test(s)) epistemic = 'opinion';
  else if (FACT_CUES.test(s)) epistemic = 'fact';

  // Confidence is a function of how cleanly one move won.
  const top = hits.length ? hits[0].weight : 0.35;
  const runnerUp = hits.length > 1 ? hits[1].weight : 0;
  const confidence = Number(Math.min(0.98, top - runnerUp * 0.3 + (hits.length ? 0.1 : 0)).toFixed(2));

  return {
    text: s,
    move,
    alternates,
    epistemic,
    confidence,
    // These are the things the notebook is allowed to interrupt on.
    notebookWorthy: ['fact', 'opinion', 'idea', 'subject-shift'].includes(epistemic)
      || ['question', 'objection', 'commitment', 'decision'].includes(move),
    wordCount: s.split(/\s+/).filter(Boolean).length,
  };
}

/** Analyze a whole turn. */
function analyzeTurn(turn) {
  const sentences = segment(turn.text).map(classify);
  return {
    turnId: turn.id,
    speaker: turn.speaker,
    sentences,
    dominantMove: sentences.length
      ? sentences.slice().sort((a, b) => b.confidence - a.confidence)[0].move
      : 'statement',
    hasQuestion: sentences.some((s) => ENQUIRY_MOVES.includes(s.move)),
    hasCommitment: sentences.some((s) => s.move === 'commitment' || s.move === 'decision'),
  };
}

module.exports = { segment, classify, analyzeTurn, MOVES, ENQUIRY_MOVES };
