export type EvidenceStatus = "pass" | "warning" | "fail";

export interface EvidenceCheck {
  key: string;
  label: string;
  status: EvidenceStatus;
  message: string;
  claimIds: string[];
}

export interface EvidenceMetrics {
  claimCount: number;
  factualClaimCount: number;
  citationCoverage: number;
  primarySourceCount: number;
  highRiskGapCount: number;
  conflictCount: number;
}

export interface EvidenceVerification {
  schemaVersion: number;
  taskId: string;
  status: EvidenceStatus;
  readyForTrust: boolean;
  summary: string;
  generatedAt: string;
  metrics: EvidenceMetrics;
  checks: EvidenceCheck[];
}

export function parseEvidenceVerification(
  content: string,
): EvidenceVerification | null {
  try {
    const value = JSON.parse(content) as Partial<EvidenceVerification>;
    if (
      typeof value.taskId !== "string" ||
      !["pass", "warning", "fail"].includes(value.status ?? "") ||
      typeof value.summary !== "string" ||
      typeof value.metrics !== "object" ||
      !Array.isArray(value.checks)
    ) {
      return null;
    }
    return value as EvidenceVerification;
  } catch {
    return null;
  }
}

export function evidenceStatusLabel(status: EvidenceStatus) {
  if (status === "pass") return "Evidence passed";
  if (status === "warning") return "Needs evidence review";
  return "Evidence blocked";
}
