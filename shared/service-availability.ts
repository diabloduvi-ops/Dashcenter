import type { DashboardGroup, DashboardService, ServiceStatus } from "./types.js";

export interface ServiceAvailabilityIssue {
  groupName: string;
  service: DashboardService;
}

export interface ServiceAvailabilitySummary {
  total: number;
  healthy: number;
  unhealthy: number;
  checking: number;
  unknown: number;
  issues: ServiceAvailabilityIssue[];
}

const ISSUE_PRIORITY: Record<Exclude<ServiceStatus, "healthy">, number> = {
  unhealthy: 0,
  checking: 1,
  unknown: 2,
};

export function summarizeServiceAvailability(groups: DashboardGroup[]): ServiceAvailabilitySummary {
  const monitored = [...groups]
    .filter((group) => group.visible)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .flatMap((group) => [...group.services]
      .filter((service) => service.visible && service.statusCheck)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((service) => ({ groupName: group.name, service })));

  const summary: ServiceAvailabilitySummary = {
    total: monitored.length,
    healthy: 0,
    unhealthy: 0,
    checking: 0,
    unknown: 0,
    issues: [],
  };

  for (const item of monitored) {
    summary[item.service.status] += 1;
    if (item.service.status !== "healthy") summary.issues.push(item);
  }

  summary.issues.sort((left, right) => {
    const priority = ISSUE_PRIORITY[left.service.status as Exclude<ServiceStatus, "healthy">]
      - ISSUE_PRIORITY[right.service.status as Exclude<ServiceStatus, "healthy">];
    return priority || left.groupName.localeCompare(right.groupName) || left.service.name.localeCompare(right.service.name);
  });
  return summary;
}
