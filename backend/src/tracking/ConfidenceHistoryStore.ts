import { ConfidenceSnapshot, IncidentEvidenceBundle } from '@exhausttrace/shared';

export class ConfidenceHistoryStore {
  private static history: ConfidenceSnapshot[] = [];

  public static updateFromBundle(bundle: IncidentEvidenceBundle) {
    if (bundle?.causalAnalysis?.confidenceHistory) {
      this.history = bundle.causalAnalysis.confidenceHistory;
    }
  }

  public static addSnapshot(snapshot: ConfidenceSnapshot) {
    this.history.push(snapshot);
  }

  public static getHistory(): ConfidenceSnapshot[] {
    return this.history;
  }

  public static clear() {
    this.history = [];
  }
}
