export type ContextCategory = "environmental" | "behavioral";
export type ValidityStatus = "V" | "S" | "M" | "U" | "X";
export type TruthValue = "T" | "F" | "I";
export type Sensitivity = "L" | "H";
export type ConditionStrength = "soft" | "hard";
export type McacDecision = "ALLOW" | "VERIFY" | "DENY";
export type SourceClass = "srv" | "ext";
export type ActionClass = "read" | "write" | "export" | "admin";

export type EnvironmentalItemKind = "time" | "location" | "network" | "device";
export type BehavioralItemKind = "session" | "frequency" | "history" | "navigation" | "request";
export type ContextItemKind = EnvironmentalItemKind | BehavioralItemKind;
export type ContextValueMap = Readonly<{
  time: Readonly<{ weekday: number; hour: number; timezone: string }>;
  location: Readonly<{ country: string; region: string }>;
  network: "corporate" | "vpn" | "known" | "unknown";
  device: Readonly<{ registered: boolean; deviceId: string | null; tokenAgeSeconds: number }>;
  session: Readonly<{ method: string; ageSeconds: number }>;
  frequency: Readonly<{ count: number; windowSeconds: number }>;
  history: Readonly<{ classes: readonly Readonly<{ resourceClass: string; count: number }>[]; windowDays: number; enrollmentComplete: boolean }>;
  navigation: Readonly<{ previousClass: string | null; currentClass: string; transitionCount: number; enrollmentComplete: boolean }>;
  request: Readonly<{ resourceClass: string; actionClass: ActionClass }>;
}>;
export type ContextItemValue<K extends ContextItemKind = ContextItemKind> = ContextValueMap[K];
export type ThresholdValue = string | number | boolean | readonly (string | number | boolean)[] | Readonly<{ startHour: number; endHour: number; weekdays?: readonly number[] }>;
export type ItemValue = ContextItemValue | ThresholdValue;

/** Eq. (2)'s tuple plus the derived status retained in an evaluation trace. */
export type ContextItem<K extends ContextItemKind = ContextItemKind> = { [P in K]: Readonly<{
  kind: P;
  value: ContextItemValue<P> | null;
  observedAt: number | null;
  sourceClass: SourceClass | null;
  integrityFlag: 0 | 1;
  validityStatus: ValidityStatus;
}> }[K];

export type ContextEvidenceItem<K extends ContextItemKind = ContextItemKind> = { [P in K]: Readonly<{
  kind: P;
  value: ContextItemValue<P> | null;
  observedAt: number | null;
  sourceClass: SourceClass | null;
  integrityFlag: 0 | 1;
}> }[K];

export type EnvironmentalContext = Readonly<{ [K in EnvironmentalItemKind]: ContextEvidenceItem<K> }>;
export type BehavioralContext = Readonly<{ [K in BehavioralItemKind]: ContextEvidenceItem<K> }>;
export type ContextEvidence = Readonly<{ environmental: EnvironmentalContext; behavioral: BehavioralContext }>;

export type Comparator = "eq" | "neq" | "in" | "lt" | "lte" | "gt" | "gte" | "in_window" | "registered" | "not_novel" | "expected_transition";
export type Threshold = ThresholdValue | Readonly<{ by: "network"; values: Readonly<Record<string, ThresholdValue>> }>;
export type Condition = Readonly<{
  id: string;
  item: ContextItemKind;
  comparator: Comparator;
  parameter: Threshold;
  strength: ConditionStrength;
}>;
export type Rule = Readonly<{
  id: string;
  resourceClass: string;
  actions: readonly ActionClass[];
  environmental: readonly Condition[];
  behavioral: readonly Condition[];
  failOpen: 0 | 1;
}>;

export type DeclaredConsistencyConstraint = Readonly<{ id: string; items: readonly ContextItemKind[] }>;
/** Constraint outcomes are explicit recorded inputs from the policy constraint evaluator. */
export type ConsistencyEvidence = Readonly<{ id: string; violated: boolean }>;

export type ResourceProfile = Readonly<{ sensitivity: Sensitivity; stepUpAvailable: boolean; waiverDurationSeconds: number }>;

export type PolicyVersion = Readonly<{
  version: string;
  resourceProfiles: Readonly<Record<string, ResourceProfile>>;
  freshnessSeconds: Readonly<Record<ContextItemKind, number>>;
  verificationRequired: Readonly<Record<ContextItemKind, 0 | 1>>;
  consistencyConstraints: readonly DeclaredConsistencyConstraint[];
  expectedTransitions: readonly Readonly<{ previousClass: string; currentClass: string }>[];
  rules: readonly Rule[];
  strictLowSensitivity: boolean;
  interactions: Readonly<{ environmentConditionedThresholds: boolean; crossCategoryConsistency: boolean }>;
}>;

export type InteractionEvaluation = Readonly<{
  id: string;
  kind: "environment_conditioned_threshold" | "cross_category_consistency";
  inputReferences: readonly string[];
  result: "APPLIED" | "NOT_VIOLATED" | "INDETERMINATE" | "DISABLED";
  explanation: string;
}>;

export type AuthorizationRequest = Readonly<{
  requestId: string;
  time: number;
  userId: string;
  sessionId: string;
  resourceId: string;
  resourceClass: string;
  action: ActionClass;
}>;

export type ConditionEvaluation = Readonly<{
  ruleId: string;
  conditionId: string;
  category: ContextCategory;
  itemReferences: readonly ContextItemKind[];
  items: readonly ContextItem[];
  outcome: TruthValue;
  strength: ConditionStrength;
  severity: 0 | 1 | 2;
  reasonCode: string;
  explanation: string;
}>;

export type McacTrace = Readonly<{
  requestId: string;
  time: string;
  user: string;
  sessionId: string;
  resource: string;
  resourceClass: string;
  action: ActionClass;
  policyVersion: string;
  baseline: boolean;
  sensitivity: Sensitivity | null;
  stepUpAvailable: boolean | null;
  consistencyEvidence: readonly ConsistencyEvidence[];
  /** Recorded values make the decision independently replayable. */
  items: readonly ContextItem[];
  conditions: readonly ConditionEvaluation[];
  interactions: readonly InteractionEvaluation[];
  mEnv: 0 | 1 | 2;
  mBeh: 0 | 1 | 2;
  m: 0 | 1 | 2;
  decision: McacDecision;
  waiver: WaiverEvidence | null;
  previousHash: string;
  hash: string;
}>;

export type AuthorizationInput = Readonly<{
  request: AuthorizationRequest;
  baselinePermission: boolean;
  policy: PolicyVersion;
  context: ContextEvidence;
  consistencyEvidence: readonly ConsistencyEvidence[];
  waiver: WaiverEvidence | null;
  previousHash: string;
}>;

/** Verification validity is an explicit result from the verification workflow; scope is rechecked by the PDP. */
export type WaiverEvidence = Readonly<{
  userId: string;
  sessionId: string;
  resourceClass: string;
  action: string;
  verifiedAt: number;
  expiresAt: number;
  assuranceMeetsRequired: boolean;
}>;

export type AuthorizationResult = Readonly<{
  decision: McacDecision;
  baselinePermission: boolean;
  mEnv: 0 | 1 | 2;
  mBeh: 0 | 1 | 2;
  severity: 0 | 1 | 2;
  conditionEvaluations: readonly ConditionEvaluation[];
  trace: McacTrace;
}>;
