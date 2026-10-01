# Prompt: Create the Technology Stack & Technical Architecture Document

Create a complete Markdown document named:

`TECHNOLOGY-STACK.md`

for the product **Personal Eating Coach**.

The document must clearly and explicitly separate:

1. **Requirements** — what the product and system must be able to do.
2. **Constraints** — boundaries that Phase 1 must respect.
3. **Recommendations** — suggested technologies and architecture for satisfying those requirements.
4. **Alternatives** — reasonable alternatives that were considered.
5. **Decisions** — technologies/approaches actually selected for Phase 1.
6. **Future Options** — capabilities intentionally deferred to later phases.

Do NOT mix requirements and technology recommendations.

---

# 1. Document Philosophy

This document is a technical architecture document, but it must not start from technology.

Start from:

```text
Product Requirements
        ↓
Technical Requirements
        ↓
Constraints
        ↓
Architecture Options
        ↓
Technology Recommendations
        ↓
Phase 1 Decisions
```

The document must never say:

> "We need Supabase because Supabase is good."

Instead:

> "The product requires authentication, PostgreSQL-compatible relational data, storage, and per-user access control. Supabase is recommended because it provides these capabilities with low operational overhead."

---

# 2. Requirement Classification

Every important requirement must be classified as one of:

### Product Requirement

Something the product must support.

Example:

> The user must be able to report a meal using photo, text, or voice.

### Technical Requirement

Something the system must support to enable the product.

Example:

> The system must support asynchronous processing of image analysis.

### Constraint

A boundary or limitation.

Example:

> Phase 1 should avoid native mobile development.

### Recommendation

A proposed technical solution.

Example:

> Use Next.js + TypeScript.

### Decision

A recommendation that has been accepted for Phase 1.

Example:

> Phase 1 will use Next.js + TypeScript.

### Future Option

Something intentionally not implemented now.

Example:

> Apple Health integration is a future option.

---

# 3. Required Document Structure

Use this structure:

```text
# Technology Stack & Technical Architecture

1. Executive Summary

2. Product Requirements
   2.1 Functional Requirements
   2.2 Data Requirements
   2.3 AI Requirements
   2.4 Offline Requirements
   2.5 Notification Requirements
   2.6 Analytics Requirements
   2.7 Security & Privacy Requirements

3. Technical Requirements

4. Phase 1 Constraints

5. Architecture Principles

6. Architecture Options

7. Recommended Architecture

8. Technology Stack Recommendations
   8.1 Frontend
   8.2 Backend
   8.3 Database
   8.4 Authentication
   8.5 Storage
   8.6 AI
   8.7 Analytics
   8.8 Notifications
   8.9 Hosting
   8.10 Monitoring

9. Phase 1 Technical Decisions

10. Data Architecture

11. AI Architecture

12. Behavior Engine Architecture

13. Offline / Shabbat Architecture

14. Security Architecture

15. Testing Strategy

16. Deployment Strategy

17. Cost Strategy

18. What We Explicitly Do NOT Build

19. Future Architecture

20. Architecture Decision Records

21. Open Questions
```

---

# 4. Product Requirements

Document the requirements without mentioning specific technologies.

## 4.1 Food Reporting

The system must allow the user to report food using:

- photo
- free text
- voice

The system must transform natural input into structured meal information.

The user must be able to review and correct the system's understanding before it becomes confirmed data.

---

## 4.2 AI Understanding

The system must:

- understand natural language food descriptions
- understand food photos
- support voice transcription
- produce structured information
- express uncertainty
- allow user correction

The system must NOT invent information that it does not know.

---

## 4.3 Confirmed Data

The system must distinguish:

```text
Raw Input
    ↓
AI Understanding
    ↓
User Confirmation
    ↓
Confirmed Data
```

Confirmed data must be distinguishable from AI-generated interpretation.

---

## 4.4 Behavioral Learning

The system must be able to:

- detect contextual signals
- collect intervention outcomes
- identify candidate patterns
- distinguish observations from confirmed patterns
- learn which interventions help the user

---

## 4.5 Interventions

The system must support:

- no intervention
- short question
- small suggestion
- guided action

The system must support a controlled intervention library.

---

## 4.6 First Week

The system must support a dedicated First Week state.

Requirements:

- minimum 5 available days
- maximum 15 available days
- Offline Periods excluded
- no performance score
- early signals instead of premature confirmed patterns
- small experiments
- transition to normal weekly cycle

---

## 4.7 Weekly Cycle

The system must support:

- weekly data aggregation
- "השבוע שלך"
- weekly learning
- pattern discovery
- one weekly experiment
- experiment outcome
- progress tracking

---

## 4.8 Weight

The product default is:

> Weekly weighing.

The system must support:

- weight entries
- historical weight
- trend calculation
- milestones

Daily weighing must not be required.

---

## 4.9 Activity

Phase 1 activity reporting is manual.

The system must support:

- activity entries
- duration
- activity type
- progression toward 60 minutes/day

Automatic activity integrations are future functionality.

---

## 4.10 Sleep

Phase 1 sleep data is manually reported.

The system must support:

- sleep duration
- optional subjective sleep quality
- historical data
- pattern analysis

No rigid sleep target is required.

---

## 4.11 Stress

The system must support simple 1–5 stress reporting.

It should be usable as behavioral context.

---

# 5. Offline / Shabbat Requirements

The system must support a generic:

```text
OfflinePeriod
```

with:

```text
type
start
end
```

Possible types:

```text
SHABBAT
HOLIDAY
VACATION
USER_DEFINED
```

During an OfflinePeriod the system must support:

- no notifications
- no reminders
- no meal reporting
- no interventions
- no streak penalties
- paused daily goals
- exclusion from adherence calculations

Offline time must not be treated as user failure or missing behavior.

---

# 6. Motzei Shabbat Requirements

The system must allow aggregated reporting after Shabbat.

Required flow:

```text
Free-form Report
        ↓
AI Organization
        ↓
Expected Timeline
        ↓
User Review
        ↓
Correction / Missing Information
        ↓
Confirmed Data
```

If the system does not understand a meal/event:

It must show the missing section and allow the user to add it.

It must NOT invent the missing information.

---

# 7. Notification Requirements

The system must support contextual notifications.

Notifications must respect:

- user preferences
- quiet hours
- Offline Periods
- intervention budget

The system must be able to decide:

```text
No notification
```

when there is no meaningful reason to interrupt the user.

---

# 8. Internationalization Requirements

The system must support:

```text
Hebrew
English
```

from Phase 1.

It must support:

- RTL
- LTR
- translated strings
- locale-aware dates
- locale-aware numbers

The architecture must allow future languages.

---

# 9. Security & Privacy Requirements

The system must support:

- authentication
- per-user data isolation
- secure API keys
- server-side secrets
- controlled file access
- deletion of user data
- minimal retention of food images
- secure storage
- HTTPS

AI provider credentials must never be exposed to the browser.

---

# 10. Phase 1 Constraints

Phase 1 should be:

- Web-first
- Mobile-first
- low cost
- simple to deploy
- simple to maintain
- suitable for one user initially
- extensible to approximately 5–50 users

Avoid unnecessary infrastructure.

The following are explicitly NOT Phase 1 requirements:

- native iOS app
- native Android app
- Apple Health integration
- Google Health Connect
- Kubernetes
- microservices
- event streaming
- complex ML infrastructure
- large-scale distributed architecture

---

# 11. Architecture Principles

The architecture should follow:

```text
Simple
        ↓
Modular
        ↓
Explicit boundaries
        ↓
Provider abstraction
        ↓
Easy migration
```

Avoid:

```text
Premature scale
Premature abstraction
Premature infrastructure
```

---

# 12. Architecture Options

Before recommending a stack, compare reasonable options.

For example:

## Frontend

Possible:

- Next.js
- React + Vite
- another modern React framework

Compare them against actual requirements.

---

## Backend

Possible:

- Supabase-centric architecture
- Next.js backend + managed database
- separate backend service
- AWS architecture

Compare:

- development speed
- operational complexity
- cost
- security
- scalability
- migration path

---

## AI

Possible:

- Gemini
- OpenAI
- Anthropic
- other multimodal provider

Compare only where relevant.

Do not create a huge vendor comparison.

---

# 13. Recommendations

Only after documenting the requirements and options, provide recommendations.

Expected Phase 1 direction:

```text
Next.js
TypeScript
React
CSS / CSS Modules
Own Design System
Supabase
PostgreSQL
Supabase Auth
Supabase Storage
AI Gateway
AI Provider
PostHog
Web Push
PWA-ready
```

But these are **recommendations/decisions**, not requirements.

Explain the reasoning for each.

---

# 14. Frontend Recommendation

Recommended:

```text
Next.js
React
TypeScript
CSS / CSS Modules
```

Explain:

- why it satisfies the requirements
- App Router
- routing
- SSR/SSG
- Server Components
- Client Components
- mobile-first Web
- PWA path
- public/private application separation

---

# 15. Design System Recommendation

Recommend an internal lightweight Design System.

Architecture:

```text
Design Tokens
      ↓
UI Components
      ↓
Product Components
      ↓
Screens
```

Possible:

- CSS Variables
- CSS Modules
- small icon abstraction

Do not introduce a large UI framework unless a concrete requirement justifies it.

---

# 16. Backend Recommendation

Recommend evaluating:

> Supabase + PostgreSQL

because it can potentially satisfy:

- database
- authentication
- storage
- row-level security
- backend functions

Explain where the application/domain logic lives.

Do not turn the entire product into arbitrary database logic.

---

# 17. Modular Monolith Recommendation

Recommended Phase 1 architecture:

```text
Modular Monolith
```

with logical modules:

```text
users
meals
food
nutrition
weight
activity
sleep
stress
patterns
interventions
experiments
motivation
ai
shabbat
notifications
analytics
```

Explain that modules are logical boundaries, not separate deployable services.

---

# 18. AI Gateway Recommendation

Recommend:

```text
Application
    ↓
AI Gateway
    ↓
Provider
```

The AI Gateway should hide provider-specific implementation.

Example interface:

```text
analyzeMeal()
analyzeText()
transcribeVoice()
generateInsight()
detectPatternCandidate()
coach()
```

This is an architectural recommendation, not a product requirement.

---

# 19. Deterministic Logic vs AI

Explicitly document this boundary.

### Deterministic

- weight calculations
- dates
- weekly periods
- OfflinePeriod logic
- metrics
- adherence
- activity totals
- milestone calculations

### AI

- language understanding
- image interpretation
- summarization
- coaching
- candidate pattern identification

The AI must not be the source of truth for deterministic calculations.

---

# 20. Data Architecture Recommendation

Recommend relational storage.

Conceptual entities:

```text
User
Profile
MealEntry
MealRawInput
MealUnderstanding
WeightEntry
ActivityEntry
SleepEntry
StressEntry
Pattern
PatternEvidence
Intervention
InterventionOutcome
Experiment
ExperimentOutcome
WeeklySummary
OfflinePeriod
Notification
UserPreference
```

Explain relationships and ownership.

Do not over-normalize prematurely.

---

# 21. Image Storage Recommendation

Recommended flow:

```text
Upload
 ↓
Compress
 ↓
Storage
 ↓
AI analysis
 ↓
Confirmation
 ↓
Structured data
 ↓
Delete original when appropriate
```

Explain privacy and retention decisions.

---

# 22. Activity / Sleep Data Source Architecture

Phase 1:

```text
ActivityDataSource
        ↓
Manual
```

Future:

```text
ActivityDataSource
├── Manual
├── AppleHealth
├── Google Health Connect
└── Other
```

The domain model should not need to change when automatic integrations are introduced.

---

# 23. Notification Recommendation

Recommended architecture:

```text
Behavior Engine
       ↓
Should we contact user?
       ↓
Notification Service
       ↓
Web Push
```

Do not implement:

```text
cron → send notification
```

as the primary behavioral model.

---

# 24. Analytics Recommendation

Evaluate PostHog for Phase 1.

Track product events, not unnecessary sensitive user content.

Example:

```text
meal_report_started
meal_saved
meal_corrected
intervention_shown
intervention_helped
experiment_started
experiment_completed
weekly_summary_viewed
shabbat_report_completed
recovery_returned
```

---

# 25. Testing Recommendation

Recommend:

```text
Unit
Integration
E2E
```

Prioritize critical domain behavior:

- First Week transitions
- Offline Periods
- Shabbat
- Meal confirmation
- AI structured output validation
- Intervention rules
- Weekly calculations
- RLS
- user data isolation

Do not optimize for 100% coverage.

---

# 26. Deployment Recommendation

Evaluate:

```text
Vercel
```

for Next.js.

Evaluate:

```text
Supabase
```

for database/auth/storage.

Verify current pricing and capabilities using official sources before making current claims.

---

# 27. Cost Requirements vs Cost Recommendations

Separate:

### Requirement

Phase 1 should minimize operating cost.

### Recommendation

Prefer managed services with useful free/low-cost tiers.

### Decision

Use the selected providers after comparing current pricing and limits.

Never confuse "free tier available" with "the product is guaranteed to remain free."

---

# 28. What We Explicitly Reject for Phase 1

This section must distinguish:

### Not required

from:

### Technically possible but intentionally deferred

Examples:

```text
Native mobile
Apple Health
Google Health Connect
Microservices
Kubernetes
Kafka
Redis
Dedicated workers
Complex ML
Dedicated recommendation models
Large UI frameworks
AWS microservice architecture
```

Explain that these may become appropriate only when actual requirements justify them.

---

# 29. Future Architecture

Describe how the system could evolve.

```text
Phase 1
1 user
    ↓
Simple modular architecture

Phase 2
5–50 users
    ↓
Optimization
Caching
Background jobs where justified
AI cost optimization
Automatic data integrations

Later
Large scale
    ↓
Only if required:
Workers
Queues
Service separation
Dedicated infrastructure
```

Do not implement future architecture prematurely.

---

# 30. Decision Table

End with a table like:

| Area          | Requirement              | Recommendation       | Phase 1 Decision  | Future             |
| ------------- | ------------------------ | -------------------- | ----------------- | ------------------ |
| Frontend      | Mobile-first Web         | Next.js              | Next.js           | —                  |
| Language      | Type safety              | TypeScript           | TypeScript        | —                  |
| UI            | Centralized design       | Own Design System    | Yes               | —                  |
| Database      | Relational user data     | PostgreSQL           | Supabase Postgres | —                  |
| Auth          | User authentication      | Supabase Auth        | Yes               | —                  |
| Storage       | Media files              | Supabase Storage     | Yes               | R2 if needed       |
| AI            | Multimodal understanding | Provider abstraction | AI Gateway        | Multiple providers |
| Activity      | Manual Phase 1           | Domain abstraction   | Manual            | Apple/Google       |
| Notifications | Contextual               | Web Push             | Web Push          | Native push        |
| Analytics     | Product events           | PostHog              | Evaluate/Use      | —                  |
| Hosting       | Web deployment           | Vercel               | Evaluate/Use      | Reassess at scale  |

---

# 31. Architecture Decision Records

For every major decision use:

```text
Decision:
Status:
Requirement:
Options:
Chosen:
Why:
Trade-offs:
Revisit when:
```

Example:

```text
Decision: Backend Architecture

Status: Phase 1 Decision

Requirement:
Simple backend with relational data,
authentication, storage and user isolation.

Options:
1. AWS services
2. Separate backend + database
3. Supabase-centric architecture

Chosen:
Supabase + modular application backend

Why:
Lower operational complexity and faster Phase 1 development.

Trade-offs:
Less infrastructure control than fully custom AWS.

Revisit when:
Scale, compliance or infrastructure requirements justify it.
```

---

# 32. Research Requirements

Current external claims must be verified.

Use Web Research for:

- Next.js current capabilities
- Supabase current capabilities and pricing
- Vercel current pricing
- AI provider current capabilities and pricing
- PostHog current pricing
- Web Push support
- current iOS/iPadOS PWA notification support
- Apple Health / HealthKit architecture
- Google Health Connect

Prefer official documentation and official pricing pages.

For every current claim:

- cite the source
- state when it was checked
- distinguish fact from recommendation

---

# 33. Final Output Rule

The final document must make it immediately obvious whether each statement is:

```text
REQUIREMENT
CONSTRAINT
RECOMMENDATION
DECISION
ALTERNATIVE
FUTURE OPTION
```

Do not blur these categories.

The technical stack should be derived from the requirements, not the other way around.

The final architecture should optimize for:

```text
Product fit
+
Simplicity
+
Low cost
+
Security
+
Fast development
+
Modularity
+
Future migration
```

The guiding principle is:

> **Requirements define what the system must do.
> Recommendations define how we choose to build it.**
