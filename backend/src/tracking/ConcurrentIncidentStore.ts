import { IncidentEvidenceBundle, ResourceType } from '@exhausttrace/shared';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';

export class ConcurrentIncidentStore {
  private static orchestratorA: IncidentOrchestrator | null = null;
  private static orchestratorB: IncidentOrchestrator | null = null;

  public static startConcurrent(
    serviceA: string,
    resourceA: ResourceType,
    severityA: string,
    serviceB: string,
    resourceB: ResourceType,
    severityB: string
  ) {
    const seedA = `conc-a-${Date.now()}`;
    const seedB = `conc-b-${Date.now()}`;

    this.orchestratorA = new IncidentOrchestrator();
    this.orchestratorB = new IncidentOrchestrator();

    this.orchestratorA.startCustomScenario(serviceA, resourceA, severityA, seedA);
    this.orchestratorB.startCustomScenario(serviceB, resourceB, severityB, seedB);

    this.orchestratorA.pause();
    this.orchestratorB.pause();

    // Step both isolated orchestrators 35 ticks to trigger exhaustion and build causal graph
    for (let i = 0; i < 35; i++) {
      this.orchestratorA.step();
      this.orchestratorB.step();
    }
  }

  public static getState(): { incidentA: IncidentEvidenceBundle | null; incidentB: IncidentEvidenceBundle | null } {
    return {
      incidentA: this.orchestratorA ? this.orchestratorA.getBundle() : null,
      incidentB: this.orchestratorB ? this.orchestratorB.getBundle() : null,
    };
  }
}
