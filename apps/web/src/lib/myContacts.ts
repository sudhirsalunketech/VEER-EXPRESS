/**
 * "Remember my details on this device": a customer's own senders and receivers, kept only in this
 * browser (never sent to the server). Nothing here is shared with other visitors.
 */
export interface MyContact { role: 'SENDER' | 'RECEIVER'; name: string; phone: string; email: string; address: string; pin: string; lastUsed: string }
const KEY = 'veer-my-contacts-v1';
const MAX = 20;

export function myContacts(): MyContact[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function save(list: MyContact[]) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage unavailable */ } }

export function rememberContact(c: Omit<MyContact, 'lastUsed'>) {
  const rest = myContacts().filter((x) => !(x.role === c.role && x.phone === c.phone && x.name.toLowerCase() === c.name.toLowerCase()));
  save([{ ...c, lastUsed: new Date().toISOString() }, ...rest]);
}
export function forgetContact(c: Pick<MyContact, 'role' | 'name' | 'phone'>) {
  save(myContacts().filter((x) => !(x.role === c.role && x.phone === c.phone && x.name === c.name)));
}
export function forgetAllContacts() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Saved contacts for a role, filtered by name or mobile (empty query = most recent). */
export function findMyContacts(role: MyContact['role'], q: string): MyContact[] {
  const t = q.trim().toLowerCase(); const d = t.replace(/\D/g, '');
  return myContacts().filter((c) => c.role === role && (!t || c.name.toLowerCase().includes(t) || (!!d && c.phone.includes(d)))).slice(0, 6);
}
