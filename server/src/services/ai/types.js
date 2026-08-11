/**
 * Structured contracts for the AIService abstraction.
 * Providers must return data matching these shapes.
 */

/**
 * @typedef {Object} ImageAnalysis
 * @property {string} category          - canonical category slug
 * @property {string} categoryLabel     - human readable category name
 * @property {number} confidence        - 0..1
 * @property {'LOW'|'MODERATE'|'HIGH'|'CRITICAL'} severity
 * @property {string} description       - short human description
 * @property {'low'|'medium'|'high'} safetyRisk
 * @property {boolean} relevant         - is the image relevant to a civic issue?
 * @property {boolean} tamperSuspected  - signs of manipulation / re-upload spam
 * @property {object} [imageStats]      - raw visual features (for explainability)
 * @property {string} provider          - provider id
 * @property {'local'|'vision'} mode    - how analysis was produced
 */

/**
 * @typedef {Object} RepairVerification
 * @property {boolean} repairLikelyCompleted
 * @property {number} confidence        - 0..1
 * @property {string} remainingProblem  - e.g. 'Minor surface damage remains'
 * @property {string} summary
 * @property {string} provider
 * @property {'local'|'vision'} mode
 */

/**
 * @typedef {Object} OfficialLookup
 * @property {string} officerName       - person leading the locality ('' if unknown)
 * @property {string} officerRole       - designation e.g. 'Nagar Sevak (Corporator)'
 * @property {string} officerPhone      - public contact number ('' if unknown)
 * @property {string} authority         - governing body, e.g. 'Pune Municipal Corporation'
 * @property {string} ward              - ward / GP name if identifiable
 * @property {string} basis             - how this was determined
 * @property {number} confidence        - 0..1
 * @property {string} provider
 * @property {'local'|'vision'} mode
 */

/**
 * @typedef {Object} ModerationScore
 * @property {number} score             - overall 0..1 (attention needed)
 * @property {number} toxicity          - 0..1
 * @property {number} spam              - 0..1
 * @property {number} profanity         - 0..1
 * @property {string} reason            - short human explanation
 * @property {boolean} flagged          - true when score >= threshold (still human-reviewed)
 * @property {string} provider
 * @property {'local'|'text'} mode
 */

/**
 * @typedef {Object} TriageSuggestion
 * @property {string|null} suggestedDepartmentId
 * @property {string} suggestedDepartmentName
 * @property {'VERIFIED'|'ASSIGNED'|'IN_PROGRESS'|null} suggestedStatus
 * @property {string} priorityRationale
 * @property {string} draftUpdate
 * @property {number} confidence
 * @property {string} provider
 * @property {'local'|'text'} mode
 */

/**
 * @typedef {Object} InsightSummary
 * @property {string} summary           - natural-language brief
 * @property {string} provider
 * @property {'local'|'text'} mode
 */

/**
 * @typedef {Object} QueryParse
 * @property {string} category          - category slug or ''
 * @property {'LOW'|'MODERATE'|'HIGH'|'CRITICAL'|null} severity
 * @property {string} area
 * @property {'open'|'resolved'|'assigned'|null} status
 * @property {number} timeframeDays     - 0 when unspecified
 * @property {string[]} keywords
 * @property {string} provider
 * @property {'local'|'text'} mode
 */

/**
 * @typedef {Object} NotificationDigest
 * @property {string} digest
 * @property {string[]} highlights
 * @property {string} provider
 * @property {'local'|'text'} mode
 */

/**
 * @typedef {Object} ChatReply
 * @property {string} reply
 * @property {string[]} sources
 * @property {string} provider
 * @property {'local'|'text'} mode
 */
