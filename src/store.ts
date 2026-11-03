import type { Client, Invoice, Retainer } from "./types.js";

export class MemoryStore {
  clients = new Map<string, Client>();
  retainers = new Map<string, Retainer>();
  invoices = new Map<string, Invoice>();
  processedEvents = new Set<string>();

  retainerBySubscription(subId: string) {
    for (const r of this.retainers.values()) if (r.providerSubscriptionId === subId) return r;
    return undefined;
  }

  retainersFor(clientId: string) {
    return [...this.retainers.values()].filter((r) => r.clientId === clientId);
  }
}
