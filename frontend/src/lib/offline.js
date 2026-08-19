import { api } from "@/lib/api";

const QUEUE_KEY = "boothiq_lead_queue";

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

// Write every lead to local storage first, then attempt sync.
export function enqueueLead(lead) {
  const q = getQueue();
  const entry = { ...lead, _localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, _attempts: 0 };
  q.push(entry);
  saveQueue(q);
  return entry;
}

export async function submitLead(lead) {
  // Try online first for an immediate lead id (needed for the wheel spin).
  try {
    const { data } = await api.post("/kiosk/leads", lead);
    return { online: true, id: data.id };
  } catch {
    const entry = enqueueLead(lead);
    return { online: false, id: entry._localId, queued: true };
  }
}

let syncing = false;
export async function syncQueue(onStatus) {
  if (syncing) return;
  syncing = true;
  let q = getQueue();
  let backoff = 1000;
  for (const entry of [...q]) {
    try {
      await api.post("/kiosk/leads", entry);
      q = getQueue().filter((e) => e._localId !== entry._localId);
      saveQueue(q);
      backoff = 1000;
    } catch {
      entry._attempts = (entry._attempts || 0) + 1;
      saveQueue(getQueue());
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000); // exponential backoff
    }
  }
  syncing = false;
  if (onStatus) onStatus(getQueue().length);
}
