# Sightline

A live meeting console: transcribes, separates speakers, analyses each sentence
as it lands, tells you what to say, flags what does not add up, queues the
questions worth asking, and routes what matters to the right project — then
deletes itself two hours later.

Built for someone sitting in a CoC meeting who needs to be sharper in the room
than everyone else and cannot afford to be wrong on the record.

```
npm install
node server/index.js          # http://127.0.0.1:8787
```

Open it, and click **Run the demo meeting instead**. Nobody is recorded, so you
can show it to a partner without asking anyone for consent.

---

## What it does

| | |
|---|---|
| **Live transcript with diarization** | Words stream in tagged by speaker; turns are assembled, and you can split, merge or reassign any of them. A low-confidence attribution is shown as low-confidence, never laundered into a name. |
| **Identity** | Names are picked up from self-introductions ("Hi, I'm Ben with RISE"). Voice and face templates are opt-in per person and consent-gated — see below. |
| **Rank, colour-coded** | Every speaker carries a rank badge with its own colour. Rank is inferred **from what people claim** — budget control, approval authority, lived experience — never from how they sound. Every inference shows the quote behind it. |
| **Tone meter** | An emoji per speaker from valence / arousal / dominance, with a trend. Below the confidence floor it shows a neutral face and says why, rather than guessing. |
| **The notebook** | A card pops up mid-sentence when a fact, opinion, idea, question, objection or subject change lands: what just happened, how to answer it, two lines you could actually say, and what not to say. |
| **Positioning guardrails** | The notebook also fires on ABLE's own messaging rules — "low-barrier", title inflation, LEAB, claiming audit authority, quoting a price in the room, implying a client roster. Those are the mistakes that cost credibility, and the card beats them out of your mouth. |
| **Worth checking** | Contradictions against what was said earlier, conflicts with records on file, numbers with no source, commitments with no owner or date, and answers that dodged the question. **Not a lie detector — see below.** |
| **Ask this** | A ranked queue of questions built from the flags, the unanswered threads, who in the room can actually decide, and where the conversation is drifting. Each says why it is queued. |
| **Coming next** | Probability of the next rhetorical move and of the next topic, from a Markov chain that starts on priors and learns from the meeting in front of it. It reports its sample count so you can tell a real 70% from a guess. |
| **Point and click** | Click any line: explain it, expand it, tell me how to respond, check it against our records, turn it into a question, send it to a project, pin it past the wipe, fix the speaker, or redact and copy. |
| **Project routing** | Rules match on keywords, speaker, rhetorical move or flag type and queue a note to a project. Nothing sends until you flush, and nothing leaves without passing the redactor. |
| **Time clock** | Elapsed time, billable hours, marks, and talk-time share per speaker — the number that answers "did the people with lived experience actually get the floor". |
| **Two-hour memory** | Everything is editable, copyable, appendable and deletable for two hours, then it deletes itself. Pin what you want to keep. "Wipe now" is unconditional and takes the pins too. |

---

## Three things this deliberately does NOT do

### 1. It does not detect lies

You asked for lie flagging. Here is why it is built as consistency tracking
instead, and why that is the stronger tool.

Deception detection from demeanor or language does not work. Bond and DePaulo's
meta-analysis of 206 studies puts human accuracy at about 54% against a 50%
baseline, and cue-based models do not reliably beat it. A "probably lying" badge
would therefore be wrong close to half the time. It would fall hardest on people
who are nervous, traumatised, disabled, or not speaking their first language —
which in this work is a large share of the room. And the day anyone found out
ABLE ran a deception detector on a partner, ABLE would be finished in Washoe
County.

What Sightline flags instead is observable, quotable and defensible:

- the same person gave two different figures for the same thing, with both quotes
- what they said conflicts with a document you hold, naming the document
- a number arrived with no source
- a commitment landed with no owner or no date
- an answer did not address the question asked, with both quotes

Every flag carries the line *"This is a consistency observation, not an
accusation. People misremember, numbers get revised, and context is missing."*
That sentence is not decoration — it is what makes the flag survive being read
aloud by the person it is about.

In practice this catches more than a lie detector would. In the demo it catches
Ben moving from 30 spots to 20 and hands you the question to ask.

### 2. It does not read status off how someone carries themselves

You asked for a read on what level someone is at from how they present. Built as
asked, that is a machine that scores people on accent, grammar, confidence and
bearing — and it would rank a peer advocate below a program officer every time,
which is the exact bias ABLE exists to push back on.

So standing is inferred from **claims**: who says they can approve, who controls
budget, who supervises, who defers upward, who speaks from lived experience.
Every inference shows the sentence it came from, and a rank you set by hand is
never overwritten.

### 3. It does not record anyone without consent

**Nevada is an all-party consent state.** NRS 200.620 requires the consent of
every party to record a wire communication; NRS 200.650 covers surreptitiously
recording a private in-person conversation. This is criminal law, not etiquette.

So the consent gate is the first screen, and nothing behind it runs until it
clears. It gives you the script to read out loud, records who said yes, blocks
`start()` while anyone is missing, and stops recording immediately if anyone
withdraws. The audit trail is attachable to your minutes.

If client-level information may be discussed, all-party consent is required by
policy regardless of state law — coordinated entry and HMIS confidentiality
obligations outlive the meeting.

**Face recognition ships off and stays off until each person consents to it
specifically.** Face and voice templates are biometric identifiers. Illinois
BIPA requires a signed written release *before* capture and gives people a
private right of action; Texas CUBI and Washington HB 1493 impose their own
duties; Nevada NRS 603A treats the data as personal information you are on the
hook to protect. Sightline stores an opaque vector and no image or audio, and
"forget this person's biometrics" is always one call away.

---

## Architecture

```
src/sightline/          pure logic, unit tested under Node, served to the browser as-is
  Workspace.js          ABLE / VOA partition and palettes
  Consent.js            the legal gate — recording and biometric
  EphemeralBuffer.js    the two-hour memory
  Timeclock.js          elapsed, billable, talk share
  Diarization.js        turn assembly, split / merge / reassign
  SpeakerRegistry.js    identity, rank, biometric templates, authority inference
  Redaction.js          PII scrubbing, reversible only in-session
  Rhetoric.js           per-sentence move and epistemic type
  ToneMeter.js          valence / arousal / dominance to emoji
  Prediction.js         next move and next topic
  VerificationFlags.js  contradictions, conflicts, unsourced, soft commitments
  Notebook.js           the popup advice cards and positioning guardrails
  QuestionEngine.js     the ranked question queue
  Router.js             rules to projects, pluggable dispatch
  CopilotAdapter.js     the pluggable model brain
  Session.js            the orchestrator the UI drives

server/index.js         zero-dependency static host and API key broker
public/                 the console
tests/sightline/        361 tests
```

**The browser runs the same modules the tests exercise.** `server/index.js`
serves `src/sightline/*.js` verbatim at `/lib/`, and a 30-line CommonJS shim in
`public/boot.js` gives them the `module`/`exports`/`require` they expect. One
implementation, tested once, no bundler.

### The copilot is pluggable, and nothing depends on it

Every analysis runs locally with no network at all. The model makes the results
better; it is not load-bearing. If the key is missing or the API is down, the
meeting still gets transcribed, classified, flagged and prompted — the console
just says "local guidance".

`CopilotAdapter` takes four providers:

- `local` — no network
- `anthropic` — Claude, best judgement on rhetoric and what to say next
- `deepseek` — cheap enough to re-score every sentence rather than a sample
- `existing` — **your already-built copilot.** Point `endpoint` at it and pass a
  `normalize` function if its response shape differs from the documented one.

Its system prompt forbids the model from asserting deception and from inferring
status from demeanor, so a model call cannot reintroduce what the design took
out.

### Keys never reach the browser

A key in client JavaScript is a key published to everyone in the meeting who
opens dev tools, and to anyone the screen is ever shared with. The browser talks
only to the local broker; the broker holds the keys in its own process
environment. It writes no transcripts to disk, logs no request or response
bodies, and binds to localhost unless you force it otherwise.

Copy `server/.env.example` to `server/.env` and fill in what you have:

```
set -a; source server/.env; set +a
npm run serve
```

Without `DEEPGRAM_API_KEY` the app falls back to the browser speech API, which
transcribes but **cannot tell speakers apart**. With it, set
`DEEPGRAM_PROJECT_ID` too so the broker can mint short-lived browser keys and
the long-lived key never leaves the server.

---

## ABLE and VOA never mix

You work for VOA and you volunteer with ABLE. The two must not bleed together,
so the separation is enforced in code rather than left to discipline:

- A project belongs to exactly one workspace. Registering a VOA project on an
  ABLE router throws.
- Notes are stamped with their workspace. `assertOwns` throws on a cross-org
  record and on an unscoped one.
- The palettes are separate. VOA never uses ABLE navy and gold.
- ABLE's positioning guardrails do not load under VOA.
- Switching organisation mid-session wipes the session first, after asking.

**On colour.** ABLE's brand pair is navy and gold, and the skill is explicit:
no neon. The neon in this console is deliberate and confined — it lives on the
screen chrome and on interactive controls only, where visibility under pressure
is the whole point. `Workspace.documentPalette()` returns navy and gold with no
neon in it, and anything this tool ever exports as a document uses that. The two
palettes are separate functions so they cannot be confused.

**VOA's palette here is a placeholder.** It is a neutral steel set chosen to be
visibly *not* ABLE's. Give me VOA's real brand colours and I will set them; I
have not invented them.

---

## Testing

```
npm test                 # everything, with coverage
npm run test:sightline   # just this
```

361 tests across 16 suites for Sightline, on top of the 189 already covering the
resource list. Sightline sits at 99%+ statements and 92% branches.

The browser console is verified separately by driving real Chromium through the
consent gate, a full demo meeting, the point-and-click inspector, every toggle,
the BIPA warning and the workspace switch — 31 checks, including that the word
"lying" appears nowhere in the rendered page.

---

## Where this still needs you

1. **Your existing copilot.** I built the adapter and the drop-in point but I
   could not find the copilot itself in this repo or in the ABLE skill. Tell me
   where it lives and I will wire it in place of the default.
2. **VOA's brand colours.** Placeholder until you supply them.
3. **Records to check against.** `VerificationLedger` gets much sharper when you
   feed it what you already hold — PIT counts, budget lines, prior minutes. It
   can then say "our record says 30" instead of only "you said two things".
4. **Routing rules.** The three starter projects in `public/app.js` are examples.
   They are meant to be edited.
5. **Real diarization.** Set the Deepgram keys. Without them the browser can
   transcribe but cannot separate speakers, and half the value is speaker-aware.
