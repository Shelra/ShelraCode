# Lane 07 — Reality, observability, and continuous alignment

Researcher: reality-alignment-researcher. Date: 2026-09-08.
Question: *How do we determine whether correctly implemented software is actually producing the
intended outcome — and can software ever determine that its own specification is wrong?*

## 1. Summary (10 lines)

1. Observability graduated as an industry standard in May 2026, but every part of the standard that
   could carry *intent* — GenAI/agent conventions, feature flags, profiles — is still marked
   Development or Alpha. The stable parts describe machines, not purposes.
2. Observation is provably partial, not merely incomplete: in the one measured study found, the best
   single telemetry source reconstructed 39–40% of an execution chain; two complementary sources beat
   more of one kind.
3. Runtime verification works, is 12–34x too expensive to leave on, and is still evaluated in test
   suites rather than production. Nobody ships it as a live intent monitor.
4. The Kubernetes/GitOps reconciliation analogy holds **only where desired state and observed state
   are written in the same vocabulary** — replicas, images, volumes. That is the whole trick, and it
   is exactly what human intent does not give you.
5. Even inside that favourable case the loop is unreliable: 56 + 46 real bugs across 21 popular
   controllers, including liveness bugs where reconciliation waits forever, and the Kubernetes docs
   explicitly disclaim ever reaching a stable state.
6. Control theory has been applied to software *resources*, not software *behaviour*; the
   self-adaptive community published a paper in 2020 specifically about being unable to reconcile the
   two property vocabularies, and it is still unreconciled in 2026.
7. Outcome alignment is empirically the weakest arrow in the chain: roughly one third of Microsoft's
   ideas improve the metric they were designed to improve; Google's cited figure is ~10%.
8. Short-horizon metrics are systematically misleading about long-horizon intent. Google's own data
   led it to cut mobile ad load by 50% — a substantially short-term-revenue-negative change that was
   long-term revenue neutral. No automated system proposed that.
9. Detecting "specification satisfied, intent violated" is done today by a *human heuristic*
   (Twyman's Law) plus a retention metric — and the measured twin is worse: 83% of agent runs with a
   perfect outcome score contained a specification violation nobody would have seen.
10. The arrow this mission cares about most — production evidence flowing back to change a
    specification — has essentially no literature, no standard, and no workshop track. It is the
    emptiest square on the board.

---

## 2. Observability and runtime verification: what is observable today

### 2.1 The standard

```
CLAIM: OpenTelemetry graduated from the CNCF on 21 May 2026 with traces, metrics and logs stable,
but every convention that would carry intent or AI behaviour is still pre-stable.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: CNCF announcement (21 May 2026): 12,000+ contributors from 2,800+ companies; the
JavaScript API package saw 1.36 billion downloads in 12 months, Python 1.3 billion, both setting
monthly records in April 2026; "core observability signals: metrics, logs, and traces" plus the
Collector and semantic conventions form the graduated surface; Profiles is in alpha. Separately:
GenAI semantic conventions were moved out of the main semantic-conventions repository into
open-telemetry/semantic-conventions-genai and carry "Status: Development"; feature-flag conventions
carry "Status: Development"; CI/CD conventions carry "Status: Release Candidate"; the profiles signal
page carries "Status: Alpha".
SOURCE: "CNCF Announces OpenTelemetry's Graduation..." — CNCF — 2026-05-21 —
https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/ — accessed 2026-09-08;
https://opentelemetry.io/docs/specs/semconv/ ; https://opentelemetry.io/docs/specs/semconv/gen-ai/ ;
https://github.com/open-telemetry/semantic-conventions-genai ;
https://opentelemetry.io/docs/specs/semconv/feature-flags/ ;
https://opentelemetry.io/docs/specs/semconv/cicd/ ;
https://opentelemetry.io/docs/concepts/signals/profiles/ — all accessed 2026-09-08.
COUNTEREVIDENCE: The stability guarantee is narrower than it sounds. OTel's versioning document
protects attribute *keys*, metric names/kinds/units, span names and kinds, and well-known attribute
*values* — and explicitly does NOT stabilise arbitrary attribute values, span links, metric
descriptions, or "the actual values being recorded". The schema is stable; what the numbers mean is
not.
OPEN QUESTION: Does gen_ai semconv reach Stable before 2028, and does it ever gain an attribute
naming the *task the user asked for* rather than the model call that was made?
```

```
CLAIM: Observability is partial by construction, and complementarity of sources beats volume.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: A 2026 empirical study of multi-source telemetry under software-supply-chain attacks
reports the best *single* telemetry source achieved 0.391 weighted tag/step coverage and 0.403 mean
chain reconstruction; minimal two-source fusion raised these to 0.636 and 0.639 (~1.6x). The stated
determinant of reconstruction is whether phases "share joinable identifiers across sources
(host/user/process and network endpoints)" — the join key, not the data volume, is the binding
constraint. Sources compared: host/process lineage, audit logs, Zeek/Suricata network traces, eBPF
container instrumentation, cloud monitor streams.
SOURCE: "An Empirical Study of Observability Limits in Advanced Software Supply Chain Attacks" —
arXiv:2603.16694 — Mar 2026 — https://arxiv.org/html/2603.16694v1 — accessed 2026-09-08.
COUNTEREVIDENCE: One study, security domain, synthetic attack chains; the coverage numbers do not
transfer directly to functional-requirement observation. I searched for an equivalent study of
functional requirement coverage from telemetry and found NOT FOUND.
OPEN QUESTION: What is the analogous number for requirements — what fraction of a written
specification is observable at all from a standard OTel pipeline?
```

```
CLAIM: Runtime verification is technically mature and economically unshippable as an always-on
intent monitor.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: PyMOP, the largest Python RV evaluation to date (1,463 GitHub projects, 290,133 unit
tests, 73 API specifications, 18,254,008 events, 5,686,846 monitor instances) reports mean overhead
of 12.33x for its cheapest algorithm and 33.96x for another, with maxima of 848x and 5,500x. It
found 93 unique bugs (44 confirmed or fixed) with a 42.9% false-positive rate — better than the ~90%
cited for Java RV systems. The paper states PyMOP was evaluated only during testing and names
deployment monitoring as future work.
SOURCE: "A Generic and Efficient Python Runtime Verification System and its Large-scale Evaluation" —
Shen, Yaseen, Silva, Guan, Lee, d'Amorim, Legunsen — arXiv:2509.06324 — 2025-09-08 —
https://arxiv.org/html/2509.06324v1 — accessed 2026-09-08.
COUNTEREVIDENCE: Targeted monitors are far cheaper. iCFTL-Diagnostics reports instrumentation
overhead below 30% execution time and below 20% memory for state-based specifications; Varanus checks
each event in roughly constant time. Overhead is a function of specification granularity, not of RV
as such.
OPEN QUESTION: What is the cheapest monitor that can falsify a *requirement* (not an API protocol)?
Nobody publishes that curve.
```

### 2.2 What is observable — table

| Thing you may want to know | Observable today? | Evidence |
| --- | --- | --- |
| Did the request succeed, how long, how loaded | Yes, commodity | Google SRE four golden signals: "latency, traffic, errors, and saturation. If you can only measure four metrics of your user-facing system, focus on these four." |
| Which service on the path was slow | Yes | OTel traces stable; CNCF TAG Observability whitepaper defines traces as distributed transaction records |
| Which line of code burned CPU | Yes but Alpha | OTel Profiles `Status: Alpha`; eBPF agent profiles "most languages without any code changes" |
| Which build/deploy produced this behaviour | Nearly | OTel CI/CD semconv `Status: Release Candidate` |
| Which feature-flag variant the user saw | Not stably | OTel feature-flag semconv `Status: Development` |
| What the agent decided and why | Not stably | gen_ai semconv `Status: Development`, moved to a separate repository |
| Whether an API protocol was violated | Yes, at 12–34x cost | PyMOP overheads; 73 shipped API specifications |
| Whether a temporal behavioural policy was violated | Yes, in research | VIGIL: >95% recall, <10% FPR on real LLM-agent runs; ACTORCHESTRA (Erlang); Varanus (CSP) |
| *Why* a specification was violated (which statements) | Yes, in research | iCFTL-Diagnostics: 90% precision on 100 of 112 specifications across 10 projects; ≥90% reduction in lines to inspect; diagnosis ≤7 min, ≤25 MB |
| Which component is faulty, not just that something is | Yes, in research, at cost | LOLA RV+model-based diagnosis: 246 ms–1,106 ms per instant for k-instant diagnosis; up to 136 s for k-temporal; NP-hard in general |
| Whether the user was actually happy | **No** | Google SRE: an error budget "is an approximation of user satisfaction"; users "might be unhappy, but simply lacking an alternative" |
| Whether the specification was the right specification | **No** | No system found; see §6 and §8 |

```
CLAIM: The organisation with the most telemetry in the world deliberately refuses to automate the
inference from telemetry to cause.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Google's SRE book states of monitoring design: "We avoid 'magic' systems that try to learn
thresholds or automatically detect causality"; reports "only limited success with complex dependency
hierarchies"; and requires that "rules that catch real incidents most often should be as simple,
predictable, and reliable as possible." On the metric-to-happiness link the SRE Workbook states an
error budget "is an approximation of user satisfaction... A four-hour outage every 30 days would
probably result in fewer unhappy users than four separate one-hour outages every 30 days, which in
turn would cause fewer unhappy users than a constant error rate of 0.5%, but our error budget treats
them the same", and warns that in reliability experiments users "might be unhappy, but simply lacking
an alternative".
SOURCE: Google SRE Book, "Monitoring Distributed Systems" —
https://sre.google/sre-book/monitoring-distributed-systems/ — accessed 2026-09-08; Google SRE
Workbook, "Implementing SLOs" — https://sre.google/workbook/implementing-slos/ — accessed 2026-09-08.
COUNTEREVIDENCE: 2026 practitioner sentiment is more optimistic. Grafana's 4th annual Observability
Survey (1,363 responses, collected 1 Oct 2025 – 10 Jan 2026) reports 92% see value in AI for anomaly
detection. But 95% want AI to "show its work", 38% name complexity/overhead as their biggest concern,
and alert fatigue is the top obstacle to faster incident response at 30%. Appetite is not capability.
OPEN QUESTION: Has Google's stance changed since the SRE book, or is the 2026 AIOps wave simply not
adopted where the stakes are highest?
```

---

## 3. Reconciliation as an engineering model: where the analogy holds and where it fails

The north-star hypothesis implicitly proposes: *treat intent as desired state, reality as actual
state, and run a controller.* Kubernetes is the canonical existence proof. I tested it.

### 3.1 What the primary sources actually say

The Kubernetes documentation is far more modest than the folklore:

> "In Kubernetes, controllers are control loops that watch the state of your cluster, then make or
> request changes where needed. Each controller tries to move the current cluster state closer to the
> desired state."

and, critically:

> "Kubernetes takes a cloud-native view of systems, and is able to handle constant change. Your
> cluster could be changing at any point as work happens and control loops automatically fix
> failures. This means that, potentially, your cluster never reaches a stable state. As long as the
> controllers for your cluster are running and able to make useful changes, it doesn't matter if the
> overall state is stable or not."

The GitOps principles (OpenGitOps v1.0.0, CNCF GitOps Working Group) make the same move: principle 4
is "Continuously Reconciled — Software agents continuously observe actual system state and attempt to
apply the desired state." *Attempt*. There is no convergence claim anywhere in the four principles.

### 3.2 Holds / fails table

| Property the analogy needs | Holds? | Evidence |
| --- | --- | --- |
| Desired state is expressible | **Holds — and this is the whole trick.** | Kubernetes CRs declare `replicas: 3`, `storage: 20Gi`, images, affinity rules. Desired and observed are in the *same units*. |
| Actual state is observable in the same vocabulary | Holds *inside the platform* | Acto exploits exactly this: "modern cloud management platforms based on state reconciliation... maintain the system states in uniform, interpretable state objects that can be systematically queried and analyzed." |
| Error signal `desired − actual` is computable | Holds for quantities, **fails for intent** | No source found computing an error signal between a natural-language requirement and observed behaviour. See §6. |
| The controller actually converges | **Fails routinely** | Acto (SOSP'23) found 56 new bugs in 11 popular Kubernetes operators (42 confirmed, 30 fixed, none rejected), plus 6 in Kubernetes and the Go runtime. Sieve (OSDI'22) found 46 bugs in 10 controllers. |
| Failure to converge is visible | **Fails** | Acto's Figure 2: a TiDB operator liveness bug — "If a declared affinity rule cannot be satisfied, TiDBOp enters an infinite waiting loop and the pod will never be assigned. TiDBOp cannot be recovered by rolling back with a satisfiable affinity rule." |
| You can tell when reconciliation has finished | **Fails; heuristic only** | Acto: "Convergence time ranges from one second to 10 minutes, so setting a fixed timer would be unreliable. Acto uses a reset timer... conservatively set to three times the system restart time." |
| Existing systems already check intent satisfaction | **Fails** | Acto's study of operators' own test suites: "Finding 4. The few assertions on system behavior are basic and mostly check service availability." |
| Level-triggering (recover from any start state) | Holds as a *principle*, not as a fact | Acto's campaigns "leverage the level-triggering principle: a correct operator must reconcile the system to the desired state regardless of the start state and must recover from error states" — this is the property Acto tests, and it is the property that fails. |
| The plant is stationary | **Fails** | Kubernetes docs: "your cluster never reaches a stable state"; chaos engineering exists precisely because "systems behave differently depending on environment and traffic patterns". |
| Effects are prompt | **Fails for outcomes** | Google needed cohort-based methodology over months to measure ads blindness; short-term effect "is not always predictive of the long-term effect". |
| Humans are outside the loop | **Fails by design and by law** | RFC 9315 requires operator involvement to "moderate between conflicting concerns"; EU AI Act Art. 14 mandates human override for high-risk systems. |

```
CLAIM: Kubernetes reconciliation is a working analogy for *quantities the platform itself owns*, and
even there it fails often enough that a dedicated testing tool found dozens of bugs per ecosystem.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Acto: "To date, Acto has helped find 56 serious new bugs (42 were confirmed and 30 have
been fixed) in eleven Kubernetes operators with few false alarms" — Acto-blackbox reports no false
alarms, whitebox 0.19%. Acto also found six bugs in Kubernetes and the Go runtime affecting multiple
operators, all confirmed or fixed. The paper's own conclusion: the evaluated operators "are popular
open-source projects... suggesting that operator correctness is hard to achieve." Sieve (OSDI'22)
independently found 46 bugs in 10 controllers using intermediate-state, unobserved-state and
stale-state fault patterns.
SOURCE: "Acto: Automatic End-to-End Testing for Operation Correctness of Cloud System Management" —
Gu, Sun, Zhang, Jiang, Wang, Vaziri, Legunsen, Xu — SOSP '23, 23–26 Oct 2023 —
https://doi.org/10.1145/3600006.3613161 , PDF https://tianyin.github.io/pub/acto.pdf — accessed
2026-09-08; Sieve — https://github.com/sieve-project/sieve — accessed 2026-09-08; Kubernetes
controller docs — https://kubernetes.io/docs/concepts/architecture/controller/ — accessed 2026-09-08;
OpenGitOps Principles v1.0.0 — https://opengitops.dev/ — accessed 2026-09-08.
COUNTEREVIDENCE: The bugs are in operator *code*, not in the reconciliation *model*. One could argue
the model is sound and implementations are immature. But the liveness bug (infinite wait, unrecoverable
by rollback) and the convergence-detection problem (1 s to 10 min, no decision procedure) are
properties of open reconciliation systems, not of one bad operator.
OPEN QUESTION: Is there any deployed reconciliation system that reports a *proof* of convergence
rather than a heuristic timeout? I found NOT FOUND.
```

```
CLAIM: Control theory has been applied to the resources software consumes, not to what the software
means; the mismatch between control properties and software properties was named in 2020 and is still
open in 2026.
LABEL: STRONG TREND
CONFIDENCE: high
EVIDENCE: Shevtsov, Weyns et al., "Control-Theoretical Software Adaptation: A Systematic Literature
Review" (IEEE TSE, 2017/2018, 90 citations) states: "Most of the times, however, the adaptation
targeted the resources that the software has available for execution (CPU, storage, etc.) more than
the software application itself." Cámara, Papadopoulos, Vogel, Weyns, Garlan, Huang, Tei, "Towards
Bridging the Gap between Control and Self-Adaptive System Properties" (2020): control systems reason
about stability and settling time, self-adaptive systems about performance, reliability and cost, and
"it is not easy to reconcile these two types of properties or identify under which conditions they
constitute a good fit to provide run-time guarantees." My 2025–2026 arXiv sweeps for control-theoretic
guarantees in self-adaptive software returned only LLM-loop dynamics papers and control applications
outside software; no paper reconciling the two vocabularies.
SOURCE: https://doi.org/10.1109/tse.2017.2704579 — accessed 2026-09-08; arXiv:2004.11846 —
https://arxiv.org/abs/2004.11846 — accessed 2026-09-08.
COUNTEREVIDENCE: SLO-driven control has advanced considerably on the resource axis: SLO-Scaler
reports 29–56% fewer violations under bursty traffic with 18–33% fewer replicas; ARBITER selected
rollback in all ten deployment-regression runs where horizontal pod autoscaling failed. The control
loop works — on latency and replicas.
OPEN QUESTION: Is there a control-theoretic formulation where the controlled variable is a
*requirement satisfaction degree* rather than a resource or a latency percentile?
```

```
CLAIM: The only standards-body treatment of the full intent loop is Intent-Based Networking, and it
names "intent drift" as a first-class phenomenon while reserving intent revision for humans.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: RFC 9315 defines intent as "A set of operational goals (that a network should meet) and
outcomes (that a network is supposed to deliver) defined in a declarative manner without specifying
how to achieve or implement them." §2: "Intent Assurance. Functions and interfaces that allow users to
validate and monitor that the network is indeed adhering to and complying with intent." §5.2: "Intent
drift occurs when a system originally meets the intent, but over time gradually allows its behavior to
change or be affected until it no longer does or does so in a less effective manner." §5.2.3, on what
happens when goals conflict: "reporting functions need to be triggered that alert operators and
provide them with the necessary information and tools to react appropriately, e.g., by helping them
articulate modifications to the original intent to moderate between conflicting concerns."
SOURCE: RFC 9315, "Intent-Based Networking - Concepts and Definitions" — IETF —
https://www.rfc-editor.org/rfc/rfc9315.txt — accessed 2026-09-08.
COUNTEREVIDENCE: RFC 9315 is Informational, from the networking domain, and its "intent" is still
narrow and quantitative (VPN path protection, SLA classes). It does not demonstrate that the model
extends to application semantics.
OPEN QUESTION: Software engineering has no equivalent document. Why has nobody written RFC 9315 for
application software?
```

---

## 4. Outcome alignment: what can be automated, what must remain human

### 4.1 The base rate — most software does not produce its intended outcome

```
CLAIM: Roughly two thirds of deliberately-built, correctly-implemented features fail to improve the
metric they were designed to improve.
LABEL: STRONG TREND
CONFIDENCE: high
EVIDENCE: Kohavi, Deng, Frasca, Walker, Xu, Pohlmann (KDD 2013), Tenet 3, verbatim: "Features are
built because teams believe they are useful, yet in many domains most ideas fail to improve key
metrics. Only one third of the ideas tested at Microsoft improved the metric(s) they were designed to
improve. Success is even harder to find in well-optimized domains like Bing." The same passage quotes
Manzi that at Google only "about 10 percent of these [controlled experiments were] leading to business
changes"; Kaushik that "80% of the time you/we are wrong about what a customer wants"; Moran that
Netflix considers 90% of what they try to be wrong; Hadiaris (Quicken Loans) that after five years he
can "guess the outcome of a test about 33% of the time"; McKinley (Etsy) that "nearly everything
fails". The paper's own conclusion: "we are poor at assessing the value of ideas."
SOURCE: "Online Controlled Experiments at Large Scale" — Kohavi et al. — KDD 2013 —
https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/... (mirror:
https://exp-platform.com/Documents/2013%20controlledExperimentsAtScale.pdf) — accessed 2026-09-08.
COUNTEREVIDENCE: These are consumer web/search domains with heavy prior optimisation. The base rate
for, e.g., internal enterprise tooling or a first version of a product is unmeasured and plausibly
better. The 2013 date is old; I found no more recent equivalently-explicit figure from a first party.
OPEN QUESTION: What is the 2026 figure, and does it differ for AI-generated features?
```

This is the single most important number in this lane. If two thirds of *correctly implemented,
deliberately designed* changes fail to serve their intent, then the chain
`intent → spec → software → reality` is dominated by its last arrow, not its first. Formalising
intent perfectly would move you from ~33% to at best ~33%-plus-whatever-share-of-failures-were-caused-by-misspecification.

### 4.2 Short-term measurement is systematically wrong about long-term intent

```
CLAIM: Optimising the measurable short-term metric can be directly opposed to the intent, and
detecting this required inventing new experimental methodology and years of data.
LABEL: STRONG TREND
CONFIDENCE: high
NOTE ON LABEL: the primary sources are 2013 and 2015 first-party papers, not 2025-2026, so this is
labelled STRONG TREND rather than OBSERVED TODAY: three independent first-party sources (Kohavi 2013,
Hohnhold 2015, Google SRE Workbook) point the same way over more than a decade, and I found nothing
2025-2026 that contradicts or supersedes them.
EVIDENCE: Hohnhold, O'Brien, Tang (Google, KDD 2015) developed cohort-based methodology to quantify
user *learning* effects, and applied it to "ads blindness and sightedness, the phenomenon of users
changing their inherent propensity to click on or interact with ads." Verbatim from the paper: "We
have long recognized that optimizing for short-term revenue may be detrimental in the long-term if
users learn to ignore the ads, or, even worse, stop using Google." Two applications followed: a change
to the search ads auction increasing the weight of ads quality, and "a 50% reduction of the ad load on
Google's mobile search interface." On that second change: "Reducing the mobile ad load strongly
improved the user experience but was a substantially short-term revenue negative change; with our
work, the long-term revenue impact was shown to be neutral." Kohavi's 2013 companion statement:
"'Profit' is not a good OEC, as short-term theatrics (e.g., raising prices) can increase short-term
profit, but hurt it in the long run... The hard part is finding metrics that are measurable in the
short-term that are predictive of long-term goals."
SOURCE: "Focusing on the Long-term: It's Good for Users and Business" — Hohnhold, O'Brien, Tang —
Google — KDD 2015 —
https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43887.pdf — accessed
2026-09-08.
COUNTEREVIDENCE: Google *did* eventually automate this: they built "a model that uses metrics
measurable in the short-term to predict the long-term". So the mapping is learnable — with a decade of
first-party longitudinal data on hundreds of millions of users. That is not available to a solo
builder, and the paper is explicit that the model is domain-specific to ads.
OPEN QUESTION: Is the short-to-long-term predictive mapping transferable across products, or must it
be re-learned per product from data most builders will never have?
```

### 4.3 Can software detect that a specification is satisfied but the intent is not?

The strongest documented instance in the literature is a human catching it.

```
CLAIM: The state of the art for detecting "the metric moved the right way, but the intent was
violated" is a human heuristic (Twyman's Law) cross-checked against a second, slower metric.
LABEL: STRONG TREND
CONFIDENCE: high
NOTE ON LABEL: the documented case is from 2017. The claim is really that nothing has superseded it —
which rests on my own null searches (see sources items 49-54) rather than on a positive 2025-2026
source, so STRONG TREND is the honest ceiling.
EVIDENCE: Microsoft's Analysis and Experimentation team documents an MSN.com experiment replacing the
Outlook.com button with a mail-app button. Result: "we saw a 4.7% increase in overall navigation clicks
on the page, and a 28% increase in the number of clicks on the button. There was also a 27% increase
in the number of clicks on the button adjacent to the mail button. It seemed like we had hit a
jackpot." The actual mechanism was user confusion: "some users continued to click on the button
expecting it to work like it used to. They may have also clicked on the button adjacent to mail button
to check if other buttons are working... Had this treatment been shipped to all users, it would have
caused a lot of user dissatisfaction. In fact we shut down the experiment mid-way." What caught it was
(a) no stat-sig change in retention/satisfaction metrics, (b) a per-day segment showing clicks
decaying, and (c) the explicit application of Twyman's Law: "any unexpected metric movement, positive
or negative, usually means there is an issue. It is a common bias in all of us to view surprising
negative results with a lot of skepticism as compared to surprising results that appear positive."
SOURCE: "A Dirty Dozen: Twelve Common Metric Interpretation Pitfalls in Online Controlled
Experiments" — Dmitriev, Gupta, Kim, Vaz — Microsoft — KDD '17, 13–17 Aug 2017 —
https://doi.org/10.1145/3097983.3098024 , PDF
https://exp-platform.com/Documents/2017-08%20KDDMetricInterpretationPitfalls.pdf — accessed 2026-09-08.
COUNTEREVIDENCE: The same paper argues part of this *must* be automated: on heterogeneous treatment
effects it says "it's pretty much impossible to reliably detect such effects via a manual analysis...
Our system automatically analyses every experiment scorecard and warns the user if heterogeneous
treatment effects are found." So the division is: machines find the anomaly, humans decide what it
means. The paper also documents Simpson's-paradox segment invalidation detected automatically by an
SRM test.
OPEN QUESTION: Is Twyman's Law learnable? It is a prior over *surprise*, which requires a model of
what the change was supposed to do — i.e. the intent. Nobody has tried to encode it.
```

### 4.4 What can be automated (with evidence)

| Task | Automatable today? | Evidence |
| --- | --- | --- |
| Detect that a run violated a written behavioural policy | Yes | VIGIL: ">95% recall and a false-positive rate below 10%" on real LLM-agent runs across office-document, operational and engineering tasks |
| Detect procedural failures invisible to outcome scoring | Yes, emerging | AgentPex extracts behavioural specifications from agent instructions and "surfaces specification violations that are not captured by outcome-only scoring", evaluated on 424 τ²-bench traces |
| Localise which statements caused a violation | Yes | iCFTL-Diagnostics: 90% precision, ≥90% reduction in lines to inspect |
| Localise which *component* is faulty | Yes, at cost | LOLA RV+MBD; NP-hard, k-temporal diagnosis up to 136 s |
| Detect a data-quality/instrumentation bug masquerading as a win | Partly | Dmitriev et al.: automated SRM tests, scorecard-wide heterogeneous-effect warnings |
| Choose the remediation for an SLO breach | Yes, guarded | ARBITER: OTel-native causal resource graph, typed action interface, chose rollback in all 10 deployment-regression runs where HPA failed |
| Translate a natural-language goal into a numeric SLO | Yes, emerging | Intent Engine: F1 0.941 (GPT-4.1 mini), 85.1% reduction in aggregate hallucination, downstream placement failure 30.8% → 2.1% |
| Judge regulatory compliance continuously | Weakly | govllm: small-judge agreement 51.5–69.1%; position bias degrades agreement by up to 25 percentage points; specialised panel beats best single judge by 3.5 pp |
| Decide whether a surprising metric movement means the intent was served | **No** | §4.3 |
| Decide that the specification itself was wrong | **No** | §6, §8 |

### 4.5 What must remain human — with evidence, not assertion

```
CLAIM: Human authority over intent revision is currently mandated by law for high-risk systems, not
merely recommended by engineers.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: EU AI Act Article 14 (Human oversight) requires high-risk AI systems be designed so that
assigned humans can "properly understand the relevant capacities and limitations" of the system,
"remain aware of the possible tendency of automatically relying or over-relying on the output"
(automation bias), "correctly interpret the high-risk AI system's output", "decide, in any particular
situation, not to use the high-risk AI system or to otherwise disregard, override or reverse the
output", and "intervene in the operation of the high-risk AI system or interrupt the system through a
'stop' button or similar procedure". For Annex III 1(a) biometric identification, at least two persons
must separately verify. Application dates: 2 December 2027 for Annex III high-risk systems, 2 August
2028 for Annex I.
SOURCE: EU AI Act, Article 14 — https://artificialintelligenceact.eu/article/14/ — accessed 2026-09-08.
COUNTEREVIDENCE: Article 14 governs *AI systems*, not software specifications generally; it constrains
who may override an AI output, not who may rewrite a requirement. Its reach over an AI-driven
specification pipeline is untested. Also, the 2026 case study of a 717,725-line refactor with "no
human code review" (arXiv:2608.12440) shows practitioners already removing humans from the loop where
no such regulation binds.
OPEN QUESTION: When an AI proposes a specification change on the basis of production telemetry, is
that an "output" under Art. 14, or is it upstream of the regulated system?
```

```
CLAIM: The decision that must remain human is not "did the number move" but "which of the conflicting
things we want does this number stand for" — and both the IETF and Microsoft's experimentation
practice locate the human at exactly that point.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: RFC 9315 §5.2.3 places the human at conflict resolution, "helping them articulate
modifications to the original intent to moderate between conflicting concerns". Google's SRE Workbook
places the human at the proxy boundary: an SLO target means "almost all users should be happy with your
service (assuming they are otherwise happy with the utility of the service)" — the parenthesis is the
whole unautomated problem. Google's ads decision (50% mobile ad-load cut) was a trade between a
measured short-term revenue loss and an unmeasured long-term user-satisfaction gain; the paper reports
that before the methodology existed "we did not know what trade-off to use between revenue and user
satisfaction, so we tended to be conservative".
SOURCE: RFC 9315 §5.2.3; Google SRE Workbook "Implementing SLOs"; Hohnhold et al. 2015 — all accessed
2026-09-08.
COUNTEREVIDENCE: govllm (arXiv:2605.24737) attempts exactly this automation for regulatory criteria
and reports that inter-judge disagreement is itself a usable signal for "regulatory grey zones"
warranting human review — i.e. the machine can at least *route* the decision. But it concedes "Human
arbitration remains necessary when inter-judge variance indicates genuine regulatory grey zones", and
its judges agree with ground truth only 51.5–69.1% of the time.
OPEN QUESTION: Can a system reliably detect that it has reached a value trade-off it is not authorised
to make? That is a different and possibly easier problem than making the trade-off.
```

```
CLAIM: Intent is discovered by reacting to a built system, not stated before it, and this is now
measured at scale in agent sessions.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: "Requirements After the First Edit" analysed 3,553 eligible SWE-chat sessions. Framing:
"Coding agents often implement changes before users have fully articulated their requirements, echoing
a pattern from requirements engineering: stakeholders cannot express a constraint until part of the
system exists to react to." Finding: "A requirement's arrival is followed by roughly twice as much
invalidation as matched non-requirement edits, robust to user-turn and net-deletion checks", and "This
burden shows no detectable decline over a session". A controlled experiment found "delayed disclosure
relocates implementation post-reveal, while advance warning produces no detected effect on
overwriting."
SOURCE: "Requirements After the First Edit: Mining Late Requirement Emergence and Rework in Real-World
Coding-Agent Sessions" — arXiv:2609.03028 — 2026-09-02 — accessed 2026-09-08.
COUNTEREVIDENCE: The authors are explicit that the invalidation link is "not demonstrated as causal",
that the measure is a proxy (deletion/replacement of prior agent-authored lines), and that "several
intervals remain wide". Also, advance warning producing no effect argues against the reading that
better elicitation would fix it — which cuts against lane 02's framing as much as it supports mine.
OPEN QUESTION: If advance warning does not help, is the reality→intent arrow *irreducible* rather than
a failure of elicitation?
```

---

## 5. Digital twins for software: adoption evidence

```
CLAIM: Digital twins are a cyber-physical and industrial practice; there is essentially no digital-twin
practice for pure software systems, and the term when used in software means "a test environment".
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Systematic searches returned nothing about twins of software systems as such.
(a) OpenAlex title/abstract search "digital twin AND software system" from 2024-01-01: 2,841 works,
top-cited results are precision agriculture, IoT networks, BIM/indoor monitoring, predictive
maintenance, Industry 4.0 asset administration shells, LiDAR mapping — no software-system twins.
(b) OpenAlex "digital twin AND microservice" from 2023-01-01: 253 works; top results are built assets,
smart energy, water-treatment plants, smart buildings, IoT security, irrigation — microservices appear
as the *implementation architecture of a physical* twin, never as the twinned subject.
(c) arXiv search "digital twin software system observability" returned: "Sandbox-Enabled Digital Twin
for Cyber-Physical Systems" (2606.17001, controller binaries in a sandbox, demonstrated on OpenPLC);
"From Digital Twins to Digital Twin Prototypes" (2401.07985, "test embedded software systems in a
virtual context, without the need of a connection to a physical object", two field studies in ocean
observation and smart farming); "Systematic Comparison of Software Agents and Digital Twins"
(2307.08421), which concedes "a clear and definitive distinction between the two paradigms cannot be
made" and "further standardization is required"; and "Reusing Model Validation Methods for the
Continuous Validation of Digital Twins of Cyber-Physical Systems" (2512.04117).
SOURCE: OpenAlex API queries as above — https://api.openalex.org/works — accessed 2026-09-08; arXiv
search — https://arxiv.org/search/ — accessed 2026-09-08.
COUNTEREVIDENCE: The functional equivalent for software exists under different names and is thriving —
staging environments, shadow traffic, chaos experiments in production, the OpenTelemetry Demo Store
used as a benchmark substrate for failure-diagnosis datasets (500+ expert-labelled failure cases in
AIOps2025/RCA100). The concept is present; the *label* is absent. Whether that is a naming artefact or
a real gap is the open question.
OPEN QUESTION: Is there any organisation running a continuously-synchronised executable model of its
production software against which it evaluates proposed specification changes? I searched and found
NOT FOUND.
```

The honest reading: for software, "digital twin" adds nothing you do not get from a staging
environment plus replayed production traffic, and the reason it has not caught on is that the
expensive part of a physical twin — the physics model — is free for software (you have the source),
while the expensive part for software — the *environment and the users* — is exactly what a twin
cannot model.

---

## 6. Semantic runtime diagnostics: from stack traces to "observed behaviour violates requirement X"

### 6.1 What exists

The field is real and moving, but every working system requires the requirement to already be written
in a checkable form. None of them starts from a requirement in prose and ends at a runtime verdict
without a human-authored translation step.

| System | What it maps | Result | Gap |
| --- | --- | --- | --- |
| iCFTL-Diagnostics (2509.17776) | violated iCFTL specification → the statements that caused it | 90% precision on 100/112 specs, 10 projects; ≥90% fewer lines to inspect; ≤7 min, ≤25 MB; <30% time overhead | Requires iCFTL specifications to exist |
| LOLA RV+MBD (2606.23720) | observations + system description → which component is abnormal | 246 ms–1,106 ms per instant (k-instant); up to 136 s (k-temporal) | Requires a model; NP-hard; synchronous discrete-time only |
| VIGIL (2606.26524) | agent execution trace → violation of a skill's behavioural policy | >95% recall, <10% FPR | Policy language is hand-written; SMT over finite traces |
| AgentPex / "Willful Disobedience" (2603.23806) | agent instructions → behavioural spec → trace compliance | 424 traces; **83% of perfect-reward traces contain a procedural violation**; ~$0.019/trace | Spec extracted from the prompt, so it inherits the prompt's blind spots |
| govllm (2605.24737) | production outputs → continuous regulatory compliance score | judge agreement 51.5–69.1%; panel +3.5 pp over best single judge | Judges are the weak link; position bias up to 25 pp |
| ARBITER (2607.19182) | OTel graph → bounded DiagnosisContext → typed remediation action | rollback selected in 10/10 regression runs; HPA failed all | Target is an SLO number, not a requirement |
| AgenticOpsEval (2606.29193) | telemetry → localisation / identification / reasoning-grounding | 500+ expert-labelled failure cases; 6,000+ competition teams | Benchmarks diagnosis, not requirement satisfaction |
| Protocol-Driven Development (2605.12981) | runtime violation → signed evidence → repair context → regenerated implementation → revalidation | **proposed, not evaluated** | see below |

### 6.1a The measured decoupling of outcome and specification

This is the sharpest number I found in the lane, and it points the opposite way from the usual worry.

```
CLAIM: Outcome success and specification compliance are only loosely coupled, and outcome-only
measurement is blind to the great majority of specification violations in *successful* runs.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: AgentPex extracts behavioural specifications from agent instructions and checks execution
traces, evaluated on 424 clean τ²-bench traces (140 Claude, 144 GPT-4.1, 140 o4-mini) across airline,
retail and telecom domains. Headline result: "Among 58 Claude 3.5 Sonnet traces with perfect τ²-bench
reward, 48 (83%) contain at least one procedural violation." Conversely, as a predictor of outcome
failure the specification-compliance signal is weak: output_spec "achieves ROC-AUC 0.680" and "flags
48% of τ²-bench-failed traces" at a threshold below 65. Compliance scores by specification type:
output 63.6–66.9, transition 59.2–80.6, predicted-plan 77.0–81.0, argument groundedness 98.1–99.1.
Cost of the check: ~9 LLM API calls per trace, ~77,621 tokens, 139 s wall clock, ~$0.019 per trace.
The paper positions the signal as "a meaningful complementary signal", not a replacement for ground
truth.
SOURCE: "Willful Disobedience: Automatically Detecting Failures in Agentic Traces" — Reshabh K Sharma,
Shraddha Barke, Benjamin Zorn — arXiv:2603.23806v2 — 2026-03-25 / rev. 2026-05-08 —
https://arxiv.org/html/2603.23806v2 — accessed 2026-09-08.
COUNTEREVIDENCE: τ²-bench is a synthetic customer-service benchmark; "procedural violation" is defined
relative to a specification the tool itself extracted from the prompt, so some fraction of the 83% may
be extraction artefacts rather than real violations. ROC-AUC 0.680 is weak enough that one could argue
the extracted specification is simply not measuring the thing the reward measures.
OPEN QUESTION: Is the 83% a property of agents, of τ²-bench, or of prompt-derived specifications? The
same experiment on a specification written independently of the prompt would settle it.
```

Two consequences for the north-star chain. First, the popular worry — "the spec is satisfied but the
intent is not" — has a measured twin that is far more common in agentic systems: **the intent is
satisfied and the specification is not**, in 83% of successful runs. Second, ROC-AUC 0.680 means
specification compliance is a *weak* predictor of outcome. If you were to build a reconciliation
controller whose error signal is specification compliance, you would be controlling on a sensor that
explains a minority of the variance in what you actually care about.

### 6.2 The one design that closes the loop — and it is unbuilt

```
CLAIM: The only published architecture that explicitly routes runtime evidence back into the artifact
that produced the code is Protocol-Driven Development, and its authors state its central claims are
unevaluated.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: PDD defines a protocol as a triplet P = (S, B, O) — structural, behavioural and operational
invariants — with "An implementation I is protocol-compliant if and only if I ⊨ P ⇔ (I ⊨ S) ∧ (I ⊨ B) ∧
(I ⊨ O)". Admission produces a cryptographically bound Evidence object; deployment extends this into a
Dynamic Evidence Ledger, L_t = L_{t-1} || E_t, to which "Runtime verifiers append signed observations,
invariant checks, and violations". The remediation pathway is stated as
E_t^fail → C_t → I' → Validate(I', P) → L_{t+1}: a signed violation becomes structured repair context,
the generator proposes a patch, and the patch must re-enter the validator — "This connects live
failures back to the generation loop without granting the generator runtime authority." Crucially the
paper defines a Monitorable Runtime Projection with Ω_P^r ⊆ Ω_P — only part of a protocol is checkable
online. The paper's evaluation section is an agenda of six questions, not results; it states "These
claims are empirically falsifiable" and lists the Runtime Verification Layer, ledger performance and
regeneration reliability as not yet measured.
SOURCE: "Protocol-Driven Development: Governing Generated Software Through Invariants and Continuous
Evidence" — Jun He, Deying Yu — arXiv:2605.12981v3 — 2026-05-13/19 —
https://arxiv.org/html/2605.12981v3 — accessed 2026-09-08.
COUNTEREVIDENCE: It is a two-author position paper with no implementation, no benchmark and no
adoption. Its own Theorem 1 is conditional on validator soundness, and it concedes "If the validator
is unsound, if the protocol omits a relevant property, or if the evidence binding is compromised, PDD
does not provide the stated admission guarantee", and that translating narrative requirements into
protocols "remains semi-manual".
OPEN QUESTION: Ω_P^r ⊆ Ω_P is the right formalism for the monitorability gap. Has anyone *measured*
the ratio |Ω_P^r| / |Ω_P| for a real specification? I found NOT FOUND.
```

### 6.3 The verification-is-relative result

```
CLAIM: A 2026 ACM Computing Surveys survey of deployed formally verified systems concludes that
verification success is always relative to a specification and a set of hypotheses — i.e. even a
proved system can be wrong about reality.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Huang, Ebersold, Kogtenkov, Meyer, Liu, §4.4: "Any verification success is relative: we
verify a certain program element against a certain specification under certain hypotheses." And: "The
specification may be wrong (in the sense of not correctly expressing the desired behavior) or
incomplete." And: "To guarantee that a system is 'bug-free' one would have to prove that the
specifications are correct and complete, the models are consistent with the code..." The survey also
notes verification is iterative, "as opposed to an ideal two-step process of writing the program then
running a tool to prove its correctness", and that few compilers are themselves certified.
SOURCE: "Lessons from Formally Verified Deployed Software Systems" — Huang, Ebersold, Kogtenkov,
Meyer, Liu — ACM Computing Surveys, 2026-01-16 — https://doi.org/10.1145/3785652 ; extended version
arXiv:2301.02206 — https://arxiv.org/html/2301.02206 — accessed 2026-09-08.
COUNTEREVIDENCE: The survey's overall verdict is positive about verification's practicality; this
quote is a caveat, not its thesis.
OPEN QUESTION: For deployed verified systems, how many post-deployment defects were specification
defects rather than proof or TCB defects? The survey does not give the split.
```

---

## 7. Evidence freshness: how production evidence ages

```
CLAIM: Treating a compliance or correctness verdict as durable is a named fallacy — "compliance
fiction" — but no one has quantified how fast runtime evidence about a requirement decays.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: govllm argues current approaches suffer from "a 'compliance fiction' — the illusion that
systems evaluated at time t₀ remain compliant indefinitely", and proposes compliance as a continuous
signal derived from production observability rather than a static audit verdict at deployment. PDD
makes the same move from the correctness side: build-time evidence "should not be read as a perpetual
guarantee that every future execution will remain compliant", and extends admission evidence into a
running ledger. RFC 9315 names the phenomenon at the intent level as intent drift. DORA's own framing
of its metrics is that they are "leading indicators for organizational performance and employee
well-being" and "lagging indicators for software development and delivery practices" — neither is a
statement about the freshness of evidence for a *requirement*.
SOURCE: arXiv:2605.24737 (accessed 2026-09-08); arXiv:2605.12981v3 (accessed 2026-09-08); RFC 9315
§5.2 (accessed 2026-09-08); https://dora.dev/guides/dora-metrics-four-keys/ (accessed 2026-09-08).
COUNTEREVIDENCE: The concept has good coverage; the *measurement* does not. I searched arXiv and
OpenAlex for evidence half-life / staleness of runtime evidence per requirement and found NOT FOUND.
OPEN QUESTION: If a requirement was last observed satisfied on Tuesday and the service deploys
fourteen times a week, what is the posterior on Friday? Nobody has published a model.
```

---

## 8. Contradictions with common belief

**8.1 "Observability tells you whether your system is doing its job." It tells you whether the
machine is healthy, and the people who built the discipline say so explicitly.**
Google's own SRE Workbook concedes that an error budget "is an approximation of user satisfaction"
that "treats the same" a four-hour outage and a constant 0.5% error rate, and that in reliability
experiments users "might be unhappy, but simply lacking an alternative." My sweep of 2025–2026 SLO
research (SLO-Scaler, ARBITER, QONNECT, ORACL, cost-aware autoscaling, tail-latency prediction,
autoscaling surveys) found **not one** paper connecting an SLO to a user or business outcome; every
one optimises violation rate, tail latency or resource cost. The industry standard for "is it doing
its job" is a latency percentile.

**8.2 "Kubernetes proves reconciliation works — just point it at specifications."**
Three counter-facts. (i) Kubernetes' own documentation refuses the convergence claim: "potentially,
your cluster never reaches a stable state... it doesn't matter if the overall state is stable or not."
(ii) Where reconciliation is supposed to work it frequently does not: 56 bugs in 11 operators (Acto)
plus 46 in 10 controllers (Sieve), including an operator that "enters an infinite waiting loop" and
"cannot be recovered by rolling back". (iii) The analogy works *because* Kubernetes writes desired and
observed state in the same units. Human intent is not written in units you can query. The reconciler
metaphor smuggles in the hardest part of the problem as a solved premise.

**8.3 "More telemetry gets you closer to the truth."**
The best single telemetry source in the one measured study reconstructed 39.1% of the chain; adding a
*complementary* second source got 63.6%, and the paper's conclusion is that shared join keys, not
volume, are the constraint. Meanwhile Grafana's 2026 survey (n=1,363) reports complexity/overhead as
the number-one concern (38%) and alert fatigue as the number-one obstacle to incident response (30%).
Volume is currently a cost centre with a negative marginal return past the second complementary
source.

**8.4 "AI-assisted development is showing up in delivery outcomes."** Two 2025–2026 sources
contradict each other head-on. DORA 2025 (≈5,000 respondents; 90% using AI; >80% believing it raised
their productivity) reports AI adoption has "a positive relationship with software delivery throughput
and product performance" and a negative one with stability. The Productivity-Reliability Paradox paper
reports telemetry across 10,000+ developers showing "98% more pull requests but 91% longer review
times with flat delivery metrics", alongside a 19% slowdown in the most rigorous RCT. One of these is
measuring belief and the other is measuring behaviour. For this lane the point is sharper: the
self-report and the telemetry disagree, and the telemetry is the thing my lane is supposed to trust.

**8.5 "The problem is systems that satisfy the spec but miss the intent."** In agentic systems the
measured problem today is the *reverse*: among 58 Claude 3.5 Sonnet τ²-bench traces with **perfect
reward**, 48 (83%) contained at least one procedural violation of the specification extracted from
their own instructions. And specification compliance predicts outcome failure only weakly — ROC-AUC
0.680, flagging 48% of failed traces. Both directions of the spec/outcome decoupling are real, and the
one nobody is building for is the common one. A system that only watched outcomes would have declared
all 58 runs correct.

**8.6 "Specification-driven development is about to close the loop from production back to
specifications."** SpecOps 2026 — the first International Workshop on Specification-Driven Development
Life Cycle, 6 October 2026, collocated with ISSTA at Oakland — is organised around intent
formalization, AI-driven specification, and requirements-coverage testing. I read both the workshop
page and the papers/keynotes page: neither mentions runtime evidence, observability, telemetry,
monitoring, or feedback from production to specification. The community forming around
"specification-driven SDLC" is, as of today, a *pre-deployment* community.

---

## 9. Problems nobody is talking about

**9.1 The unit-mismatch problem — the missing compiler from requirement to falsifier.**
Reconciliation needs `desired − actual` to be computable, which needs both in one vocabulary. Every
working system in §6 requires a human to have already written the requirement in the observation
language (iCFTL formulas, VIGIL policies, SLO thresholds). Intent Engine automates exactly one narrow
case of this — natural language to a numeric SLO artifact, F1 0.941 — and the fact that it is
*publishable* in 2026 shows how little of this space is covered. Nobody is building the general
artifact: given a requirement, emit the observation that would falsify it. This is the load-bearing
missing piece of the entire north-star chain, and it has no name in the literature.

**9.2 The monitorability ratio is undefined and unmeasured.**
PDD names it — Ω_P^r ⊆ Ω_P, the monitorable runtime projection — and then does not measure it. No
specification language I found lets an author declare which clauses are runtime-checkable, so no
project can answer "what fraction of our specification is unobservable in principle?" Teams therefore
cannot distinguish "we are not monitoring this" from "this cannot be monitored". Both look identical
in a dashboard: absent.

**9.3 Evidence half-life.**
Everyone agrees evidence goes stale (compliance fiction, intent drift, build-time evidence "not a
perpetual guarantee"). Nobody publishes a decay function. There is no notion of "this requirement was
last observed satisfied at T, under conditions C, and the posterior probability it still holds is p".
Given deployment frequencies measured in deploys-per-day, most runtime evidence in a modern system is
about a system that no longer exists.

**9.4 The judge is an unmodelled controller.**
If LLM judging becomes the comparator in the loop, its bias *is* the control error. govllm measured
this and found agreement of 51.5–69.1% and position bias degrading agreement by up to 25 percentage
points, with no single model dominating across criteria. In control terms that is a sensor with a
large, input-dependent, uncalibrated offset. The literature on LLM-as-judge treats it as an evaluation
method; nobody treats it as a sensor requiring calibration, drift monitoring, and a stated noise floor.

**9.5 The cost of the loop is never priced.**
RV overheads of 12–34x mean, up to 5,500x worst case; LOLA diagnosis NP-hard; observability complexity
already the top practitioner concern at 38%. There is no published curve of "assurance per unit of
observation cost" for any requirement class. Every proposal in §6 implicitly assumes observation is
free. For a solo builder it is the dominant cost.

**9.6 The two joins you need are the two least mature parts of the standard.**
To ask "did this specification change produce the intended effect?" you need to join (a) which variant
was live — feature-flag semconv, `Status: Development` — with (b) what the system/agent actually did —
gen_ai semconv, `Status: Development`, and only recently moved to its own repository. Traces, metrics
and logs graduated; the two attributes that would let you attribute an outcome to an intent did not.

**9.7 Nobody has asked what happens when the controller's setpoint is contested.**
Kubernetes has one desired state. A product has several stakeholders with conflicting desired states,
and RFC 9315 handles this by paging a human. No software system I found represents *competing* intents
as first-class objects with an arbitration record. The reconciliation model assumes the setpoint is
given; in product software the setpoint is the argument.

---

## 10. What becomes commodity / what stays hard

### Commodity by ~2030

- **Emitting semantically-standard traces, metrics and logs.** OBSERVED TODAY — OTel graduated,
  1.36B JS + 1.3B Python API downloads in twelve months.
- **Correlating a request across services and to a deploy.** OBSERVED TODAY / STRONG TREND — traces
  stable; CI/CD semconv at Release Candidate.
- **Continuous profiling in production.** STRONG TREND — Profiles Alpha with an eBPF agent that
  profiles most languages with no code changes.
- **Predicting and remediating numeric SLO breaches.** STRONG TREND — SLO-Scaler 29–56% fewer
  violations with 18–33% fewer replicas; ARBITER 10/10 correct rollbacks vs HPA 0/10.
- **Translating a plain-language goal into a numeric target.** STRONG TREND — Intent Engine F1 0.941,
  placement failure 30.8% → 2.1%.
- **Checking a trace against a written behavioural policy.** STRONG TREND — VIGIL >95% recall,
  <10% FPR.
- **Narrating a plausible root cause from telemetry.** STRONG TREND — AgenticOpsEval, ARBITER
  DiagnosisContext, and heavy commercial investment.

### Stays hard past 2035

- **Writing the observation that would falsify a requirement.** OBSERVED TODAY as unsolved — §9.1.
- **Knowing which parts of a requirement are observable at all.** OBSERVED TODAY as unsolved — §9.2.
- **Deciding whether a metric movement means the intent was served.** OBSERVED TODAY — the MSN
  Outlook case was caught by Twyman's Law plus a retention metric, by a person.
- **Predicting long-horizon outcomes from short-horizon measurements.** OBSERVED TODAY — Google needed
  new methodology, cohort designs, and a decade of first-party data, and the resulting model is
  domain-specific.
- **Detecting convergence in an open system.** OBSERVED TODAY — Acto's 1 s–10 min spread and its
  heuristic reset timer; Kubernetes' explicit disclaimer of stability.
- **Holding authority to revise a specification.** OBSERVED TODAY — EU AI Act Art. 14 (applicable
  2 Dec 2027 / 2 Aug 2028); RFC 9315 §5.2.3 routing conflicting intents to operators.
- **Enumerating what could falsify a requirement** (as distinct from judging a candidate). STRONG
  TREND — consistent with the mission's prior finding that LLMs judge membership far better than they
  enumerate sets (F1 0.60–0.77 vs 0.26–0.48, arXiv:2608.01000). This asymmetry is the single most
  useful design constraint in this lane: build systems that *check* many cheap candidate falsifiers,
  never systems that ask a model to *list* what could go wrong.

---

## 11. Unserved problems, with classification

| Problem | Classification | Why current tools fail | Competitors |
| --- | --- | --- | --- |
| Compile a requirement into the observation that would falsify it | APPARENTLY OPEN | Every system requires a human-authored formal spec first | Intent Engine (narrow: NL → numeric SLO); nothing general |
| Declare and measure the monitorable fraction of a specification | APPARENTLY OPEN | No specification language carries monitorability annotations | PDD names Ω_P^r ⊆ Ω_P; does not measure it |
| Evidence half-life / staleness ledger per requirement | APPARENTLY OPEN | Evidence is a verdict, not a decaying quantity | govllm "compliance fiction" (concept only); PDD ledger (proposed) |
| Route runtime violations back into the artifact that generated the code | RESEARCH-STAGE | Needs the two prior items to exist | PDD (unimplemented); SAFE-AI framework (position paper) |
| Cheap always-on semantic monitors (<5% overhead) for behaviour, not API protocols | RESEARCH-STAGE | RV overhead 12–34x mean at API-spec granularity | PyMOP, iCFTL, Varanus, RTLola, ACTORCHESTRA — all pre-production |
| Calibrated judge-as-sensor for outcome decisions | EMERGING | Judges agree 51.5–69.1%, position bias up to 25 pp | govllm; the whole LLM-as-judge literature, which does not treat it as a sensor |
| Business/user outcome as a first-class SLI alongside latency | UNDER-SERVED | SLO tooling optimises violation rate and cost | Zero of ~10 SLO papers surveyed connect to outcomes |
| Agent/LLM runtime observability with a stable contract | CROWDED (vendors) / EMERGING (standard) | gen_ai semconv still Development | Many commercial LLM-observability vendors; OTel GenAI SIG |
| Explicit representation of competing intents and their arbitration record | APPARENTLY OPEN | Reconciliation assumes a single setpoint | RFC 9315 pages a human; no software equivalent |

---

## 12. Open questions for the second wave

1. **What fraction of a real specification is observable from a standard OTel pipeline?** Take one
   mid-sized OSS service with written requirements and measure |Ω_P^r| / |Ω_P|. Nobody has done this;
   the number would reframe the whole intent-formalization agenda.
2. **What is the 2026 base rate?** Kohavi's one-third figure is from 2013. Is the rate of
   ideas-that-improve-their-target-metric different for AI-generated features, and in which direction?
3. **Is Twyman's Law encodable?** It is a prior over surprise, which needs a model of what the change
   was supposed to do. If the specification is machine-readable, is "this movement is too good to be
   true given the stated intent" a computable predicate?
4. **What is the decay function for runtime evidence?** Given deploy frequency, traffic mix, and
   dependency churn, how fast does "requirement R was observed satisfied" lose force?
5. **Does the reconciliation analogy survive if you restrict intent to the observable projection?**
   I.e. is a system that only ever accepts requirements it can monitor strictly more useful than one
   that accepts prose it cannot check? This is testable and cheap.
6. **Is judge disagreement a usable proxy for "this is a value decision, escalate"?** govllm claims so
   but does not validate it against human escalation decisions — and lane 07's prior on semantic
   collapse (arXiv:2607.01953: models unanimously converge on one wrong reading in 3–32% of tasks)
   suggests agreement is *not* evidence of correctness, so silence from a disagreement detector must
   not be read as safety.
7. **Where exactly does authority sit when telemetry proposes a specification change?** Article 14
   regulates outputs of high-risk systems; a telemetry-derived proposal to amend a requirement may be
   outside its scope. If it is, there is currently no rule at all.
8. **Has anyone measured harm from telemetry-driven specification change?** I found strong evidence
   that telemetry-driven *feature* decisions harm outcomes (Google ads blindness; MSN Outlook button;
   Kohavi's OEC warnings) but NOT FOUND for a case where telemetry was used to rewrite a written
   requirement and the result was measured. This is the mission's central question and the evidence
   for it does not yet exist.
9. **Why is the SLO literature outcome-blind?** Is it a research-community artefact (latency is
   measurable and publishable) or a genuine claim that outcomes are not controllable?
10. **What would RFC 9315 for application software look like?** Networking has a standards-body
    vocabulary for intent, intent drift and intent assurance. Software engineering does not. Writing
    that vocabulary may be the cheapest high-leverage contribution available in this lane.
