/**
 * prf-loader.js  — UCP PRF Profile Loader
 * Ethics Beyond Boundaries · Saint Petersburg College
 *
 * Parses PRF-22 JSON output, identifies the student's dominant reasoning
 * framework, computes their ATCF sensitivity tier, and generates
 * personalized interpretation text for every simulation panel.
 *
 * PUBLIC API  (window.UCPProfile):
 *   .load(jsonString)       → { ok, error }
 *   .clear()
 *   .isLoaded()             → bool
 *   .getFramework()         → engine key string
 *   .getFrameworkName()     → display name string
 *   .getATCFTier()          → 'low' | 'medium' | 'high'
 *   .getProfile()           → full parsed object
 *   .getBadgeHTML()         → HTML string (styled, self-contained)
 *   .personalize(type, data)→ HTML string replacing generic text
 *
 * PERSONALIZE TYPES:
 *   'friction'     — friction interpretation panel
 *   'gap'          — suppression gap panel
 *   'combined'     — combined reading synthesis
 *   'voice'        — first-person voice narrative
 *   'transmission' — generational transmission analysis
 *
 * Expected JSON input structure (PRF-22 theory-first output):
 * {
 *   "version": "1.0",
 *   "generated": "ISO timestamp",
 *   "respondent_id": "optional",
 *   "foundations": {
 *     "CareWeight":            float,  // z(Item1)
 *     "FairnessWeight":        float,  // z(Item2)
 *     "BindingWeight":         float,  // mean(z(Items 3-5))
 *     "IndividualizingWeight": float,  // mean(z(Items 1-2))
 *     "Conservation":          float,  // mean(z(Items 11-12))
 *     "Openness":              float   // z(Item13) - Conservation
 *   },
 *   "atcf": {
 *     "ConstraintSensitivity": float,  // reverse(z(Item20))
 *     "DepletionSensitivity":  float,  // reverse(z(Item21))
 *     "SystemResponsibility":  int     // 1-4, Item22
 *   }
 * }
 */

;(function (window) {
  'use strict';

  // ─────────────────────────────────────────────────
  // FRAMEWORK DISPLAY METADATA
  // ─────────────────────────────────────────────────
  const FW_META = {
    individual_rights: {
      name:  'Individual / Rights-Based',
      icon:  '⚖️',
      color: '#4a7fb5',
      short: 'Rights-Based',
    },
    relational_we: {
      name:  'Relational / We-Centered',
      icon:  '🤝',
      color: '#3a8a5c',
      short: 'Relational',
    },
    hierarchical_role: {
      name:  'Hierarchical / Role-Based',
      icon:  '🏛️',
      color: '#8a6fb5',
      short: 'Role-Based',
    },
    boundary_integrity: {
      name:  'Boundary / Integrity-Centered',
      icon:  '🛡️',
      color: '#c9a84c',
      short: 'Boundary',
    },
    custodial_stewardship: {
      name:  'Custodial / Stewardship',
      icon:  '🌱',
      color: '#4a9a7a',
      short: 'Custodial',
    },
  };

  // ─────────────────────────────────────────────────
  // INTERNAL STATE
  // ─────────────────────────────────────────────────
  let _profile   = null;   // parsed PRF-22 JSON
  let _framework = null;   // dominant framework key
  let _atcfTier  = null;   // 'low' | 'medium' | 'high'

  // ─────────────────────────────────────────────────
  // FRAMEWORK SCORING
  // Maps PRF-22 foundation weights to the 5 UCP frameworks.
  // Each framework has a linear scoring function over the
  // z-scored foundation weights. Highest score wins.
  // ─────────────────────────────────────────────────
  function _scoreFrameworks(f) {
    const C  = f.CareWeight          || 0;
    const Fr = f.FairnessWeight       || 0;
    const Bi = f.BindingWeight        || 0;
    const In = f.IndividualizingWeight|| 0;
    const Co = f.Conservation         || 0;
    const Op = f.Openness             || 0;

    return {
      individual_rights:     0.40*Fr + 0.30*In - 0.30*Bi,
      relational_we:         0.40*C  + 0.30*In - 0.10*Bi,
      hierarchical_role:     0.40*Bi - 0.20*Op - 0.10*Co,
      boundary_integrity:    0.30*Bi + 0.40*Co - 0.10*Op,
      custodial_stewardship: 0.30*Co + 0.20*Bi + 0.20*((_profile.atcf.SystemResponsibility||2)/4),
    };
  }

  function _pickFramework(scores) {
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])[0][0];
  }

  // ─────────────────────────────────────────────────
  // ATCF TIER COMPUTATION
  // ─────────────────────────────────────────────────
  function _computeATCFTier(atcf) {
    const cs = atcf.ConstraintSensitivity || 0;
    const ds = atcf.DepletionSensitivity  || 0;
    const mean = (cs + ds) / 2;
    if (mean < 0.20) return 'low';
    if (mean < 0.60) return 'medium';
    return 'high';
  }

  // ─────────────────────────────────────────────────
  // ATCF TIER MODIFIER SENTENCES
  // Short prefixes that modulate intensity of any reading.
  // ─────────────────────────────────────────────────
  const ATCF_PREFIX = {
    high: {
      friction: `Your ATCF profile indicates high sensitivity to both resource constraint and depletion — this level of friction will hit harder and degrade your capacity faster than it would for a lower-sensitivity profile. `,
      gap:      `Given your high depletion sensitivity, the suppression gap is especially costly for you: the effort of self-censorship under institutional pressure compounds the stress you are already managing. `,
      voice:    `For someone with high constraint and depletion sensitivity, the felt experience described below is likely more acute than for someone with greater psychological bandwidth. `,
      combined: `Your ATCF profile suggests you will feel the weight of this pattern more directly than average — high sensitivity to constraint and depletion means structural dysfunction registers as personal cost faster. `,
      transmission: `Your high ATCF sensitivity means you would notice the effects of this generational trajectory earlier than most — the accumulating costs of suppression and friction register as personal depletion before they appear as institutional statistics. `,
    },
    medium: {
      friction: ``,
      gap:      ``,
      voice:    ``,
      combined: ``,
      transmission: ``,
    },
    low: {
      friction: `Your ATCF profile indicates low sensitivity to constraint and depletion — you have significant bandwidth to absorb friction without rapid capacity degradation. This may allow you to maintain analytical distance that others in this system cannot. `,
      gap:      `Your ATCF profile suggests you can sustain self-censorship costs longer than most before experiencing capacity degradation — but "can absorb it longer" is not the same as "it isn't happening." `,
      voice:    `Your relatively low ATCF sensitivity may mean the felt experience below is less immediately acute for you — though the structural features it describes are still shaping your coordination even if they feel manageable. `,
      combined: `Your lower ATCF sensitivity means you may be experiencing this pattern as more manageable than colleagues with higher sensitivity profiles — but you are still inside the same structural conditions. `,
      transmission: `Your lower ATCF sensitivity may give you more capacity to observe this trajectory from a slight distance — an analytical advantage, but also a risk of not recognizing when structural conditions are affecting others more severely. `,
    },
  };

  // ─────────────────────────────────────────────────
  // FRICTION READINGS
  // What coordination drag means to each framework.
  // Owns: energy cost and drag only. No suppression language.
  // ─────────────────────────────────────────────────
  const FRICTION_TEXT = {
    individual_rights: {
      reading: `From a rights-based standpoint, friction of this level signals procedural failure.
        Rules that apply unequally, processes that don't give every agent equivalent standing,
        or channels that require some people to work harder to be heard — all of these produce
        coordination drag. High friction is not just inefficiency: it is an indicator that
        the system's own stated procedures are failing to treat agents as equals.`,
      low: `From a rights-based standpoint, low friction suggests the procedural scaffolding
        is functioning as it should — rules are being applied consistently and the process
        is not creating systematic extra costs for any particular group of agents.`,
    },
    relational_we: {
      reading: `From a relational standpoint, friction is not only an efficiency cost — it is
        relational energy that cannot go toward the people who need it. Every unit of
        coordination energy consumed by navigating the process is energy unavailable for
        genuine attention, care, and mutual recognition. High-friction systems hollow out
        the very relational capacity they depend on.`,
      low: `From a relational standpoint, low friction means most coordination energy is
        reaching the actual work of caring for people rather than being consumed by the
        process itself. This is the prerequisite for genuine relational connection
        within institutional settings.`,
    },
    hierarchical_role: {
      reading: `From a role-based standpoint, when everyone occupies their proper position and
        information travels through legitimate channels, coordination should flow with
        minimal drag. Friction at this level signals role confusion — someone is occupying
        a position beyond their competence, legitimate channels are being bypassed, or the
        chain of authority that makes collective action possible has been disrupted.`,
      low: `From a role-based standpoint, low friction is what proper role structure is
        designed to produce — clear authority, clear channels, predictable process.
        This level of drag suggests the hierarchy is functioning as intended.`,
    },
    boundary_integrity: {
      reading: `From a boundary standpoint, high friction is the cost of holding a line in a
        system that is pressing against it. This drag is not necessarily a design flaw —
        it may be what integrity maintenance feels like from the inside. The critical
        question is not how to reduce the friction but whether the boundary being
        maintained is worth it, and whether the energy cost is sustainable.`,
      low: `From a boundary standpoint, low friction may mean either that boundaries are
        being respected without requiring constant defense, or that they have already
        been eroded to the point where resistance has ceased. These two situations look
        identical in the metrics.`,
    },
    custodial_stewardship: {
      reading: `From a custodial standpoint, high friction is often the cost of improvisation —
        of a generation reinventing what their predecessors built through accumulated
        practice. When inherited coordination practices are ignored or abandoned in favor
        of novelty, everything takes more effort. The ancestors solved many of these
        problems already; the drag represents the cost of forgetting.`,
      low: `From a custodial standpoint, low friction often signals that inherited practices
        are being honored and followed — that the current generation is benefiting from
        the coordination wisdom accumulated by those who came before.`,
    },
  };

  // ─────────────────────────────────────────────────
  // GAP READINGS
  // What the suppression gap means through each lens.
  // Owns: all suppression/voice language.
  // ─────────────────────────────────────────────────
  const GAP_TEXT = {
    individual_rights: {
      low:  `From a rights-based standpoint, a minimal suppression gap means the system is
             treating agents as genuine epistemic equals — what people know is reaching
             the people who need to know it, regardless of position.`,
      mid:  `From a rights-based standpoint, this gap represents unequal epistemic standing.
             Some voices are structurally less able to surface what they know.
             This is a fairness problem, not just an efficiency problem.`,
      high: `From a rights-based standpoint, this is a significant rights violation.
             Critical information is being asymmetrically distributed — agents who have
             a legitimate stake in this decision are being structurally excluded from
             contributing what they know to it.`,
      crit: `From a rights-based standpoint, this is a fundamental failure of equal
             standing. The agents in this system do not have equivalent access to the
             epistemic process. What some know cannot reach where it needs to go,
             regardless of how clearly or urgently they say it.`,
    },
    relational_we: {
      low:  `From a relational standpoint, a minimal gap means the network of mutual
             recognition is intact — people are genuinely seen and genuinely heard,
             and that attention is reaching the decisions that matter.`,
      mid:  `From a relational standpoint, this gap means some people in this room
             are being formally present while their actual knowledge is being rendered
             unavailable. They are acknowledged but not truly heard.`,
      high: `From a relational standpoint, the network of mutual recognition has been
             significantly damaged. The gap between what people know and what they can
             say measures the distance between being present in the room and being
             genuinely in the conversation.`,
      crit: `From a relational standpoint, mutual recognition has effectively broken
             down. People cannot speak because they are not being truly seen — their
             presence is maintained as form while the substance of genuine attention
             has been removed. This is relational collapse.`,
    },
    hierarchical_role: {
      low:  `From a role-based standpoint, a minimal gap means legitimate authority
             is functioning correctly — information is flowing through proper channels
             to the people whose role it is to act on it.`,
      mid:  `From a role-based standpoint, this gap signals that legitimate authority
             is being distorted somewhere in the chain. Information is not traveling
             through proper channels — either the channels are blocked, or someone
             with decision authority is not honoring their role's obligations.`,
      high: `From a role-based standpoint, this gap indicates that the chain of
             legitimate authority has been corrupted. People with the right to
             contribute their knowledge to decisions are being prevented from doing
             so — which means decisions are being made by authority without the
             full intelligence that authority is obligated to use.`,
      crit: `From a role-based standpoint, legitimate authority has been structurally
             captured. The gap is so large that decision-makers are effectively
             operating in an information vacuum — their role requires them to use
             the institution's full intelligence, and they are not being allowed to.`,
    },
    boundary_integrity: {
      low:  `From a boundary standpoint, a minimal suppression gap means what is
             true and important is being honored — it is reaching the people
             who need to know it without being filtered or diluted.`,
      mid:  `From a boundary standpoint, this gap means some of what is true and
             important is being treated as negotiable — filtered or suppressed
             for organizational convenience. The integrity of knowledge is
             being compromised.`,
      high: `From a boundary standpoint, this is a sanctity violation. Something
             true and important is being systematically filtered before it can
             reach the decisions it should inform. The integrity of knowledge
             itself is under institutional assault.`,
      crit: `From a boundary standpoint, what should be inviolable has been
             violated at scale. The knowledge that exists in this system —
             knowledge that is true and consequential — is being treated as
             though its integrity doesn't matter. This is institutional
             dishonesty at the structural level.`,
    },
    custodial_stewardship: {
      low:  `From a custodial standpoint, a minimal gap means inherited knowledge
             is reaching the present decision — the accumulated wisdom of
             those who came before is being honored and consulted.`,
      mid:  `From a custodial standpoint, some of what was inherited is not
             reaching the present decision. Part of the institutional memory,
             the hard-won knowledge accumulated over time, is being blocked
             before it can inform the choices being made today.`,
      high: `From a custodial standpoint, inherited knowledge is not reaching
             the decisions that need it. The current generation is making
             choices without access to what previous generations paid dearly
             to learn. This dishonors both the past and the future.`,
      crit: `From a custodial standpoint, the chain of transmitted knowledge
             has been severed. Decisions are being made in ignorance of what
             was inherited — not from lack of that knowledge, but because the
             structure has made it impossible to consult it. The ancestors
             are being actively silenced.`,
    },
  };

  // Map gap numeric to band key
  function _gapBand(gap) {
    if (gap < 0.05) return 'low';
    if (gap < 0.15) return 'mid';
    if (gap < 0.30) return 'high';
    return 'crit';
  }

  // ─────────────────────────────────────────────────
  // COMBINED READING ADDITIONS
  // Framework-specific lens on the named quadrant pattern.
  // Appended to the generic synthesis paragraph.
  // ─────────────────────────────────────────────────
  const COMBINED_TEXT = {
    // Pattern: healthy
    healthy: {
      individual_rights: `From your rights-based standpoint, notice whether this health is
        uniform — whether every agent has equivalent access to this functioning process,
        or whether it is healthy for some while quietly excluding others.`,
      relational_we: `From your relational standpoint, this is what genuine mutual recognition
        produces in institutional form. The room is actually working — people are genuinely
        present and their knowledge is reaching decisions.`,
      hierarchical_role: `From your role-based standpoint, this is what proper structure is
        designed to produce. Roles are being honored, channels are functioning, and authority
        is being used as it was intended.`,
      boundary_integrity: `From your boundary standpoint, this pattern is worth examining
        carefully — ask whether the low friction and suppression reflect genuine integrity,
        or whether boundaries have simply stopped being tested.`,
      custodial_stewardship: `From your custodial standpoint, this healthy pattern is worth
        preserving — it represents what the institution was built to do, and it can be
        lost faster than it was built.`,
    },
    // Pattern: blocked (high gap, low friction)
    blocked: {
      individual_rights: `From your rights-based standpoint, this is the most troubling pattern
        of all: the process works efficiently, but it is working efficiently to exclude certain
        voices. The Boisjoly case reads this way — clean process, catastrophic epistemic failure.
        Efficiency is not justice.`,
      relational_we: `From your relational standpoint, the blocked pattern describes a false
        community — people are present and the process is smooth, but genuine voices are being
        silenced. The forms of participation are maintained while the substance of real hearing
        has been removed.`,
      hierarchical_role: `From your role-based standpoint, the blocked pattern indicates
        authority capture — someone in the hierarchy is using their position to filter what
        reaches the top rather than to channel the institution's full intelligence upward.
        The hierarchy is functioning against its own purpose.`,
      boundary_integrity: `From your boundary standpoint, the blocked pattern describes
        sanctioned dishonesty — the system has formalized a procedure for making decisions
        without full information. The boundary between what is known and what is allowed
        to matter has been normalized rather than contested.`,
      custodial_stewardship: `From your custodial standpoint, the blocked pattern represents
        ancestral silencing — the institution's accumulated knowledge exists, but the current
        structure has cut off access to it. Decisions are being made as though the institution
        has no memory.`,
    },
    // Pattern: exhausted (low gap, high friction)
    exhausted: {
      individual_rights: `From your rights-based standpoint, the exhausted pattern represents
        a fairness failure of process — every agent is paying a disproportionate coordination
        tax just to participate. The equal standing of agents requires that basic process not
        consume their capacity before they can contribute.`,
      relational_we: `From your relational standpoint, this pattern is particularly costly —
        the relational energy required for genuine care and mutual recognition is being consumed
        by process friction before it can reach the people who need it. Honest and exhausted
        is still exhausted.`,
      hierarchical_role: `From your role-based standpoint, the exhausted pattern signals
        structural overcomplexity — too many approval levels, unclear jurisdictions, or
        competing authority structures that force agents to navigate rather than work.
        The fix is structural clarity, not more effort.`,
      boundary_integrity: `From your boundary standpoint, the exhausted pattern may represent
        the cost of genuine integrity maintenance — holding important limits in a system that
        constantly presses against them is genuinely costly. The question is whether the
        exhaustion is the price of something worth protecting.`,
      custodial_stewardship: `From your custodial standpoint, the exhausted pattern often
        emerges when inherited practice has been abandoned — when the current generation
        must reconstruct through effort what their predecessors built into routine.
        The friction is the cost of forgetting.`,
    },
    // Pattern: breakdown (high gap, high friction)
    breakdown: {
      individual_rights: `From your rights-based standpoint, the breakdown pattern represents
        a compound rights failure — both the fairness of the process and the equal standing
        of agents have collapsed simultaneously. This is beyond inefficiency; it is a
        structural negation of the equal stake agents are supposed to have.`,
      relational_we: `From your relational standpoint, the breakdown pattern describes
        relational collapse — people are being silenced and worn down simultaneously,
        and the network of mutual recognition that the institution depends on has
        effectively dissolved. Recovery requires rebuilding genuine connection, not
        just repairing process.`,
      hierarchical_role: `From your role-based standpoint, the breakdown pattern indicates
        that legitimate authority has been systemically corrupted — roles are distorting
        information flow while simultaneously consuming coordination capacity. The hierarchy
        is doing the opposite of what it is supposed to do.`,
      boundary_integrity: `From your boundary standpoint, the breakdown pattern is the
        most serious: not only are important things being suppressed, but the entire system
        is running at enormous cost in the process. The institution is paying a high price
        to maintain a structure that violates its own integrity.`,
      custodial_stewardship: `From your custodial standpoint, the breakdown pattern
        represents generational failure — both the inherited knowledge and the inherited
        practice of coordination have been lost. The current generation is neither
        consulting what was accumulated nor functioning according to what was built.`,
    },
    // Pattern: mixed
    mixed: {
      individual_rights: `From your rights-based standpoint, focus first on the suppression
        gap — the procedural friction matters less than whether every agent has equal
        access to the decision.`,
      relational_we: `From your relational standpoint, focus first on where voices are
        being lost — the friction matters less than whether genuine mutual attention
        is reaching those who need it.`,
      hierarchical_role: `From your role-based standpoint, ask which specific authority
        relationship is producing the most drag — the mixed signal often traces to one
        specific structural failure in the chain of command.`,
      boundary_integrity: `From your boundary standpoint, ask what specifically is being
        suppressed — mixed signals often mean a particular type of knowledge is being
        filtered, even when other types flow freely.`,
      custodial_stewardship: `From your custodial standpoint, ask which part of the
        inherited practice is failing — mixed signals often mean that some traditions
        are being honored while others have been abandoned.`,
    },
  };

  // ─────────────────────────────────────────────────
  // VOICE NARRATIVE ADDITIONS
  // Framework-specific final paragraph added to the
  // generic narrative. Describes what this reasoner's
  // moral intuition is specifically screaming at them.
  // ─────────────────────────────────────────────────
  const VOICE_ADDITION = {
    // high gap + high friction (silenced and exhausted)
    breakdown: {
      individual_rights: `What your rights-based intuition is telling you in this situation:
        this is a procedural emergency. The system is simultaneously unfair and blocking
        the information that would reveal its unfairness. The first obligation is to create
        a protected channel for the suppressed knowledge before anything else can be fixed.`,
      relational_we: `What your relational intuition is telling you: the people in this
        system need to be genuinely seen before they can function. The exhaustion and
        the silence are connected — people have stopped trying to be heard because
        genuine hearing has been absent for too long. Recovery starts with presence,
        not process.`,
      hierarchical_role: `What your role-based intuition is telling you: someone is in
        the wrong place. The combination of suppression and friction almost always
        traces to a specific authority failure — a person occupying a position they
        are using against its purpose. Identifying and correcting that failure is
        the structural priority.`,
      boundary_integrity: `What your boundary intuition is telling you: something
        important is being violated and the institution is paying enormous energy to
        maintain the violation. The cost of this pattern will keep compounding until
        what was suppressed is finally acknowledged. There is no efficient path
        through this — only through it.`,
      custodial_stewardship: `What your custodial intuition is telling you: the
        institution has lost touch with what it was built for. The exhaustion and
        the silencing are both symptoms of a generation trying to operate without
        the guidance of what was inherited. Recovery requires going back before
        it can go forward.`,
    },
    // high gap + low friction (Boisjoly pattern)
    blocked: {
      individual_rights: `What your rights-based intuition is telling you: the smooth
        process is the problem, not the solution. An efficient procedure for making
        decisions without full information is still a procedure for making bad decisions.
        The first question is not "how do we make this run better" but "whose voice
        is this process designed to exclude."`,
      relational_we: `What your relational intuition is telling you: someone in this
        room is not actually in the conversation. The smooth surface of the process
        is masking the absence of genuine hearing. Find the person whose knowledge
        is circulating in the hallway after the meeting rather than in the meeting
        itself — that is where the real information is.`,
      hierarchical_role: `What your role-based intuition is telling you: the authority
        structure has been inverted somewhere. Someone above their station is filtering
        rather than channeling. The process works — but it works for the wrong person's
        purposes. Authority here is being used as a gate rather than as a channel.`,
      boundary_integrity: `What your boundary intuition is telling you: something is
        being treated as negotiable that isn't. The smooth process has normalized a
        violation — made it routine to decide without the information that should be
        treated as non-negotiable input. The efficiency is the camouflage.`,
      custodial_stewardship: `What your custodial intuition is telling you: the
        institution's memory is not being consulted. The process works in the
        present tense while ignoring what was accumulated in the past. Ask whose
        knowledge is being excluded and how long it has been since that knowledge
        was genuinely sought.`,
    },
    // low gap + high friction (honest but exhausted)
    exhausted: {
      individual_rights: `What your rights-based intuition is telling you: the equal
        burden of coordination cost is itself a fairness issue. If this level of
        friction is borne equally by all agents, it may be tolerable. If some agents
        are paying a disproportionate share of the process cost, the exhaustion has
        an inequitable distribution that the aggregate numbers don't reveal.`,
      relational_we: `What your relational intuition is telling you: people are honest
        here, and that matters — but honesty without the energy to act on it is
        incomplete. The relational network is intact but strained. The priority is
        reducing the friction before the honest people stop having the capacity to
        remain honest.`,
      hierarchical_role: `What your role-based intuition is telling you: the structure
        is overcomplicated. When everyone is speaking honestly and coordination still
        costs this much, the problem is not in people — it is in the architecture.
        Clarifying jurisdictions, reducing approval layers, and removing redundant
        process steps is a role-based obligation, not just an efficiency preference.`,
      boundary_integrity: `What your boundary intuition is telling you: distinguish
        between friction that protects something important and friction that simply
        burns resources. Some of this drag may be the cost of genuine integrity.
        Some of it may be institutional scar tissue from old conflicts. They require
        different responses.`,
      custodial_stewardship: `What your custodial intuition is telling you: the
        high friction likely means inherited coordination practices have been
        replaced with something improvised. Ask which practices the institution
        has abandoned that previous generations used to manage this kind of
        coordination. The drag is a trail of breadcrumbs back to what was lost.`,
    },
    // healthy
    healthy: {
      individual_rights: `What your rights-based intuition notices here: this is rare,
        and it is worth examining whether it is genuinely universal or whether there
        are agents experiencing this system differently than the aggregate metrics suggest.
        Healthy systems can contain pockets of exclusion that the averages obscure.`,
      relational_we: `What your relational intuition notices here: this is what genuine
        mutual recognition produces in institutional form. Protect it. The conditions
        that make it possible — genuine hearing, low pressure on honest speech —
        are fragile and can be lost faster than they were built.`,
      hierarchical_role: `What your role-based intuition notices here: the structure is
        working as designed. This is worth documenting — understanding exactly which
        features of this arrangement produce healthy coordination is the only way to
        replicate it when conditions change.`,
      boundary_integrity: `What your boundary intuition notices here: ask what is being
        protected that makes this health possible. Healthy systems have often preserved
        something that other systems have allowed to erode. The question is what that
        is, so it can be maintained.`,
      custodial_stewardship: `What your custodial intuition notices here: this health
        was likely built by people who are no longer in this room. Honor what they
        created by understanding it — not just using it.`,
    },
    // generic fallback
    mixed: {
      individual_rights: `Your rights-based intuition will be most activated by the
        suppression gap component — ask whether the information asymmetry you see has
        a systematic pattern, or whether it is distributed randomly across agents.`,
      relational_we: `Your relational intuition will be most activated by the question
        of whose voice is absent from this system. Mixed patterns often contain one
        structural feature that, when named, makes the rest legible.`,
      hierarchical_role: `Your role-based intuition will be most activated by the
        friction component — ask which specific authority relationship is generating
        the most coordination cost.`,
      boundary_integrity: `Your boundary intuition will be most activated by the gap
        component — ask specifically what type of knowledge is being suppressed,
        and whether it is the same type consistently.`,
      custodial_stewardship: `Your custodial intuition will be most activated by
        trajectory questions — how long has this pattern been present, and what
        is it selecting for in the people who remain?`,
    },
  };

  // ─────────────────────────────────────────────────
  // TRANSMISSION ADDITIONS
  // Framework-specific reading of generational patterns.
  // Appended to the generic transmission analysis.
  // ─────────────────────────────────────────────────
  const TRANSMISSION_TEXT = {
    individual_rights: {
      improving: `From a rights-based standpoint, improving coordination across generations
        is only genuinely positive if the improvement is equitably distributed —
        if all agents are gaining capacity, not just those who were already well-positioned
        within the power structure.`,
      degrading: `From a rights-based standpoint, the degradation visible in this trajectory
        is raising a structural rights question: which agents are bearing the largest
        share of the declining capacity? Aggregate decline often distributes unevenly,
        with those lowest in the hierarchy absorbing the most.`,
      gapGrowing: `From a rights-based standpoint, a widening suppression gap is a rights
        crisis accumulating in slow motion. Each generation is less able to surface
        what it knows than the one before. The institution is systematically selecting
        for silence.`,
      gapShrinking: `From a rights-based standpoint, a shrinking gap across generations
        means the institution is becoming more epistemically fair — more of what agents
        know is reaching the decisions that need it. This is structural progress.`,
    },
    relational_we: {
      improving: `From a relational standpoint, improved coordination across generations
        means the network of mutual recognition is being strengthened rather than eroded.
        The institution is learning to hear more of what its members know.`,
      degrading: `From a relational standpoint, degrading coordination represents
        the slow collapse of mutual recognition across time. Each cohort is less able
        to genuinely connect with and hear the next. The institution is becoming
        more isolated from itself.`,
      gapGrowing: `From a relational standpoint, a widening suppression gap across
        generations means each cohort is less seen than the previous one. The institution
        is selecting for agents who have learned to participate without actually speaking,
        which is not participation at all.`,
      gapShrinking: `From a relational standpoint, a shrinking suppression gap across
        generations means the network of genuine hearing is being restored. People
        are progressively more able to be actually present in the conversation,
        not just formally present.`,
    },
    hierarchical_role: {
      improving: `From a role-based standpoint, improving coordination across generations
        means the authority structure is functioning as designed — selecting for agents
        who honor their roles and use legitimate channels, which produces better
        institutional performance over time.`,
      degrading: `From a role-based standpoint, degrading coordination across generations
        means something in the authority structure is compounding over time — a role
        that was occupied poorly is now shaping who gets to occupy the next generation
        of roles. The structural failure is reproducing itself.`,
      gapGrowing: `From a role-based standpoint, a growing suppression gap means the
        authority structure is increasingly being used to filter rather than to channel.
        Each generation inherits a hierarchy that is more opaque to the information
        it was built to transmit.`,
      gapShrinking: `From a role-based standpoint, a shrinking suppression gap means
        legitimate authority is progressively better at channeling what the institution
        knows to the people who need to act on it. This is the authority structure
        functioning as it was designed to function.`,
    },
    boundary_integrity: {
      improving: `From a boundary standpoint, improved coordination across generations
        may mean that the institution is honoring what is important more consistently
        over time — but verify that the improvement reflects genuine integrity rather
        than the gradual abandonment of contested limits.`,
      degrading: `From a boundary standpoint, degrading coordination across generations
        raises the question of which boundaries have been eroded. Declining capacity
        often follows the normalization of small violations that compound over time.`,
      gapGrowing: `From a boundary standpoint, a growing suppression gap across
        generations means that what should be treated as inviolable is being
        progressively more suppressed. The institution is selecting for agents
        who have learned to compromise what should not be compromised.`,
      gapShrinking: `From a boundary standpoint, a shrinking suppression gap means
        the institution is progressively less willing to compromise what it knows
        to be true. This is integrity being institutionalized over time.`,
    },
    custodial_stewardship: {
      improving: `From a custodial standpoint, improving coordination across generations
        means the institution is successfully transmitting both its coordination capacity
        and the practices that sustain it. The ancestors' work is being honored and extended.`,
      degrading: `From a custodial standpoint, degrading coordination across generations
        is exactly what custodial ethics is designed to prevent — the loss of what was
        accumulated through sacrifice and accumulated practice. The current generation
        is failing its obligation to the next.`,
      gapGrowing: `From a custodial standpoint, a growing suppression gap across
        generations means inherited knowledge is increasingly unable to reach the present
        decision. Each generation inherits a structure more opaque to its own history
        than the one before.`,
      gapShrinking: `From a custodial standpoint, a shrinking suppression gap means
        the institution is progressively better at consulting what it has inherited —
        the accumulated knowledge is reaching the decisions it was accumulated to inform.`,
    },
  };

  // ─────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────

  // Determine which quadrant/pattern label applies
  function _getPattern(raw, perceived, friction) {
    const gap     = raw - perceived;
    const highGap = gap > 0.18;
    const highFric= friction > 0.45;

    if (!highGap && !highFric) return 'healthy';
    if (highGap  && !highFric) return 'blocked';
    if (!highGap && highFric)  return 'exhausted';
    if (highGap  && highFric)  return 'breakdown';
    return 'mixed';
  }

  // Wrap personalized text in a consistent styled container
  function _wrap(content, tone) {
    const borderColors = {
      rights:   '#4a7fb5',
      relational:'#3a8a5c',
      role:     '#8a6fb5',
      boundary: '#c9a84c',
      custodial:'#4a9a7a',
    };
    const fwKey    = _framework || 'individual_rights';
    const meta     = FW_META[fwKey] || FW_META.individual_rights;
    const border   = meta.color;

    return `
      <div style="margin-top:12px;padding:12px 14px;
                  border-left:4px solid ${border};
                  border-radius:0 8px 8px 0;
                  background:rgba(255,255,255,.08);">
        <div style="font-family:'Courier New',monospace;font-size:.66rem;
                    text-transform:uppercase;letter-spacing:.1em;
                    color:${border};margin-bottom:6px;opacity:.9">
          ${meta.icon} Interpreting through your ${meta.short} profile
        </div>
        <div style="font-size:.86rem;line-height:1.65;opacity:.88">
          ${content}
        </div>
      </div>`;
  }

  // Same wrapper but for light-background panels
  function _wrapLight(content) {
    const fwKey = _framework || 'individual_rights';
    const meta  = FW_META[fwKey] || FW_META.individual_rights;
    const border= meta.color;

    return `
      <div style="margin-top:12px;padding:12px 14px;
                  border-left:4px solid ${border};
                  border-radius:0 8px 8px 0;
                  background:rgba(0,0,0,.03);">
        <div style="font-family:'Courier New',monospace;font-size:.66rem;
                    text-transform:uppercase;letter-spacing:.1em;
                    color:${border};margin-bottom:6px">
          ${meta.icon} Interpreting through your ${meta.short} profile
        </div>
        <div style="font-size:.85rem;line-height:1.65;color:#333">
          ${content}
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────
  // PUBLIC INTERFACE
  // ─────────────────────────────────────────────────
  const UCPProfile = {

    /**
     * Parse and store a PRF-22 JSON profile.
     * @param  {string|object} input  JSON string or parsed object
     * @return {{ ok: bool, error: string|null }}
     */
    load(input) {
      try {
        const parsed = typeof input === 'string' ? JSON.parse(input) : input;

        let f, a;

        if (parsed.prf22 && parsed.prf22.moralFoundations) {
          const mf   = parsed.prf22.moralFoundations;
          const vals = parsed.prf22.values             || {};
          const atcf = (parsed.prf22.resilience || {}).ATCF;
          const z = x => (x - 3.0);
          f = {
            CareWeight:            z(mf.Care      || 3),
            FairnessWeight:        z(mf.Fairness   || 3),
            BindingWeight:         ( z(mf.Loyalty   || 3) + z(mf.Authority || 3) + z(mf.Purity    || 3) ) / 3,
            IndividualizingWeight: ( z(mf.Care      || 3) + z(mf.Fairness  || 3) ) / 2,
            Conservation:          ( z(mf.Authority || 3) + z(mf.Purity    || 3) ) / 2,
            Openness:              z(vals.Openness  || 3),
          };
          const atcfVal = atcf != null ? atcf : 3;
          const sensitivity = (5 - atcfVal) / 4.0;
          a = { ConstraintSensitivity: sensitivity, DepletionSensitivity: sensitivity, SystemResponsibility: 2 };
          if (parsed.derivedMetrics && parsed.derivedMetrics.C_PFC != null) parsed._cpfc = parsed.derivedMetrics.C_PFC;
          parsed.foundations = f; parsed.atcf = a;
        } else if (parsed.foundations && parsed.atcf) {
          f = parsed.foundations; a = parsed.atcf;
          if (f.CareWeight           === undefined) throw new Error('Missing CareWeight');
          if (f.FairnessWeight       === undefined) throw new Error('Missing FairnessWeight');
          if (f.BindingWeight        === undefined) throw new Error('Missing BindingWeight');
          if (f.IndividualizingWeight=== undefined) throw new Error('Missing IndividualizingWeight');
          if (a.ConstraintSensitivity=== undefined) throw new Error('Missing ConstraintSensitivity');
          if (a.DepletionSensitivity  === undefined) throw new Error('Missing DepletionSensitivity');
        } else {
          throw new Error('Unrecognised PRF JSON format. Expected a PRF-22 Digital E-Twin file (with "prf22" key) or theory-first file (with "foundations" key).');
        }

        _profile  = parsed;
        const scores = _scoreFrameworks(f);
        _framework   = _pickFramework(scores);
        _atcfTier    = _computeATCFTier(a);

        try {
          localStorage.setItem('ucp-prf-profile', JSON.stringify(parsed));
          localStorage.setItem('ucp-prf-framework', _framework);
          localStorage.setItem('ucp-prf-tier', _atcfTier);
        } catch(e) {}

        return { ok: true, error: null };

      } catch(e) {
        return { ok: false, error: e.message };
      }
    },

    /** Load from localStorage if previously saved */
    loadFromStorage() {
      try {
        const saved = localStorage.getItem('ucp-prf-profile');
        if (!saved) return { ok: false, error: 'No saved profile' };
        return this.load(JSON.parse(saved));
      } catch(e) {
        return { ok: false, error: e.message };
      }
    },

    clear() {
      _profile = null; _framework = null; _atcfTier = null;
      try {
        localStorage.removeItem('ucp-prf-profile');
        localStorage.removeItem('ucp-prf-framework');
        localStorage.removeItem('ucp-prf-tier');
      } catch(e) {}
    },

    isLoaded()        { return _profile !== null; },
    getFramework()    { return _framework; },
    getFrameworkName(){ return _framework ? (FW_META[_framework]?.name || _framework) : null; },
    getATCFTier()     { return _atcfTier; },
    getProfile()      { return _profile; },

    /**
     * Returns a small inline HTML badge showing the loaded profile.
     * Suitable for insertion anywhere in an app's UI.
     */
    getBadgeHTML() {
      if (!_profile) return '';
      const meta = FW_META[_framework] || {};
      const tier = _atcfTier;
      const tierLabel = { low: 'Low ATCF sensitivity', medium: 'Medium ATCF sensitivity', high: 'High ATCF sensitivity' }[tier] || '';
      const tierColor = { low: '#3a8a5c', medium: '#c9a84c', high: '#c87843' }[tier] || '#888';
      const rid = _profile.respondent_id ? ` · ID: ${_profile.respondent_id}` : '';

      return `
        <div style="display:inline-flex;align-items:center;gap:10px;
                    background:#fff;border:1px solid ${meta.color};
                    border-radius:20px;padding:5px 14px 5px 10px;
                    box-shadow:0 2px 8px rgba(0,0,0,.08)">
          <span style="font-size:1.1em">${meta.icon}</span>
          <span style="font-family:'Courier New',monospace;font-size:.72rem;
                       color:${meta.color};font-weight:bold">
            ${meta.name}
          </span>
          <span style="font-family:'Courier New',monospace;font-size:.66rem;
                       color:${tierColor};border-left:1px solid #ddd;padding-left:8px">
            ${tierLabel}
          </span>
          <span style="font-family:'Courier New',monospace;font-size:.62rem;
                       color:#aaa">${rid}</span>
        </div>`;
    },

    /**
     * Generate personalized interpretation text for a simulation panel.
     *
     * @param  {string} type   'friction'|'gap'|'combined'|'voice'|'transmission'
     * @param  {object} data   Metrics and context relevant to the panel
     * @return {string}        HTML string to inject into the panel
     */
    personalize(type, data) {
      if (!_profile || !_framework) return '';

      const fw   = _framework;
      const tier = _atcfTier || 'medium';
      const prefix = ATCF_PREFIX[tier]?.[type] || '';

      switch (type) {

        case 'friction': {
          const { raw, perceived, friction } = data;
          const texts = FRICTION_TEXT[fw];
          if (!texts) return '';
          const reading = (friction > 0.38) ? texts.reading : texts.low;
          return _wrap(`${prefix}${reading}`);
        }

        case 'gap': {
          const { raw, perceived } = data;
          const gap  = (raw || 0) - (perceived || 0);
          const band = _gapBand(gap);
          const texts= GAP_TEXT[fw];
          if (!texts) return '';
          const reading = texts[band] || texts.mid;
          return _wrapLight(`${prefix}${reading}`);
        }

        case 'combined': {
          const { raw, perceived, friction } = data;
          const pattern = _getPattern(raw || 0, perceived || 0, friction || 0);
          const texts = COMBINED_TEXT[pattern];
          if (!texts) return '';
          const reading = texts[fw] || '';
          return _wrapLight(`${prefix}${reading}`);
        }

        case 'voice': {
          const { raw, perceived, friction } = data;
          const pattern = _getPattern(raw || 0, perceived || 0, friction || 0);
          const texts = VOICE_ADDITION[pattern];
          if (!texts) return '';
          const reading = texts[fw] || VOICE_ADDITION.mixed[fw] || '';
          // Voice panel has dark background — use dark wrapper
          return _wrap(`${prefix}${reading}`);
        }

        case 'transmission': {
          const { gens } = data;
          if (!gens || !gens.length) return '';
          const n   = gens.length;
          const g0  = gens[0].metrics;
          const gF  = gens[n-1].metrics;
          const texts = TRANSMISSION_TEXT[fw];
          if (!texts) return '';

          const gap0 = (g0.lambda_raw||0) - (g0.lambda_perceived||0);
          const gapF = (gF.lambda_raw||0) - (gF.lambda_perceived||0);
          const rawTrend = gF.lambda_raw > g0.lambda_raw + 0.02 ? 'improving'
                         : gF.lambda_raw < g0.lambda_raw - 0.02 ? 'degrading'
                         : null;
          const gapTrend = gapF > gap0 + 0.03 ? 'gapGrowing'
                         : gapF < gap0 - 0.03 ? 'gapShrinking'
                         : null;

          const parts = [];
          if (rawTrend && texts[rawTrend]) parts.push(texts[rawTrend]);
          if (gapTrend && texts[gapTrend]) parts.push(texts[gapTrend]);
          if (!parts.length) return '';

          return _wrap(`${prefix}${parts.join(' ')}`);
        }

        default:
          return '';
      }
    },

  }; // end UCPProfile

  window.UCPProfile = UCPProfile;

  // Auto-load from localStorage on script init (silent)
  UCPProfile.loadFromStorage();

})(window);
