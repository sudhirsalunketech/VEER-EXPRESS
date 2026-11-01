/** Live staff & branch pages, backed by the /org API (role rules are enforced by the server). */
import { useState } from 'react';
import { DataTable } from '../components/ui';
import { call } from '../lib/api';
import { useLoad } from '../data/source';
import type { DemoUser, Role } from '../demo/store';
import { PageHead } from './Operations';

interface Staff { id: string; email: string; name: string; role: Role; branchId: string | null; active: boolean }
interface Branch { id: string; name: string; city: string }

/** Mirrors the server's rule — only used to offer sensible choices; the server decides. */
const CAN_CREATE: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ['ADMIN', 'ACCOUNTANT', 'BOOKING_STAFF'],
  ADMIN: ['ACCOUNTANT', 'BOOKING_STAFF'],
};
const GLOBAL_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super admin', ADMIN: 'Admin (operations)', BOOKING_STAFF: 'Counter staff', ACCOUNTANT: 'Accountant' };
const label = (r: string) => ROLE_LABEL[r] ?? r.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const Err = ({ text }: { text: string }) => <p className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{text}</p>;

export function StaffPage({ user }: { user: DemoUser }) {
  const roles = CAN_CREATE[user.role] ?? [];
  const isGlobal = GLOBAL_ROLES.includes(user.role);
  const staff = useLoad(() => call<Staff[]>('/org/staff'), [], [] as Staff[]);
  const branches = useLoad(() => call<Branch[]>('/org/branches'), [], [] as Branch[]);
  const [form, setForm] = useState({ name: '', email: '', role: roles.at(-1) ?? 'BOOKING_STAFF', branchId: '', password: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!roles.length) return <><PageHead t="Staff management" /><Err text="Your role cannot manage staff accounts." /></>;
  const needsBranch = !GLOBAL_ROLES.includes(form.role as Role);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); staff.refresh(); return true; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  };
  const create = async () => {
    const branchId = form.branchId || (branches.value.length === 1 ? branches.value[0].id : '');
    const body = { name: form.name.trim(), email: form.email.trim(), role: form.role, password: form.password, ...(isGlobal && needsBranch ? { branchId } : {}) };
    if (await run(() => call('/org/staff', { method: 'POST', body: JSON.stringify(body) }), `Account created for ${body.email}. Share the password with them securely.`))
      setForm({ ...form, name: '', email: '', password: '' });
  };
  const branchName = (id: string | null) => (id ? branches.value.find((b) => b.id === id)?.name ?? id : 'Head office');

  return (
    <>
      <PageHead t="Staff management" s={isGlobal ? 'All staff accounts. Deactivation takes effect immediately.' : 'Staff at your branch. Deactivation takes effect immediately.'} />
      {staff.error && <Err text={staff.error} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <DataTable title="Staff" rows={staff.value} filters={[{ label: 'roles', options: [...new Set(staff.value.map((s) => label(s.role)))], get: (s) => label(s.role) }]}
          columns={[
            { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role', value: (s) => label(s.role) },
            { key: 'branchId', label: 'Branch', value: (s) => branchName(s.branchId) },
            { key: 'active', label: 'Status', render: (s) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-navy-50 text-navy-400'}`}>{s.active ? 'Active' : 'Deactivated'}</span>, value: (s) => (s.active ? 'Active' : 'Deactivated') },
            { key: 'id', label: '', render: (s) => s.email === (user as { email?: string }).email ? <span className="text-xs text-navy-400">You</span> : (
              <button className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50" disabled={busy}
                onClick={() => run(() => call(`/org/staff/${s.id}/${s.active ? 'deactivate' : 'activate'}`, { method: 'POST' }), `${s.name} ${s.active ? 'deactivated' : 'reactivated'}.`)}>
                {s.active ? 'Deactivate' : 'Reactivate'}
              </button>) },
          ]} />
        <div className="card h-fit p-5">
          <h3 className="font-semibold">Add staff account</h3>
          <div className="mt-3 space-y-3">
            <label className="block"><span className="label">Full name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><span className="label">Email</span><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="block"><span className="label">Role</span>
              <select className="input" aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
            {isGlobal && needsBranch && branches.value.length > 1 && <label className="block"><span className="label">Branch</span>
              <select className="input" aria-label="Branch" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">Select branch</option>{branches.value.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
            <label className="block"><span className="label">Temporary password</span><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <p className="text-xs text-navy-400">At least 10 characters with a letter and a digit.{needsBranch && branches.value.length === 1 && ` Counter staff work at ${branches.value[0].name}.`}</p>
            <button className="btn-primary w-full" disabled={busy} onClick={create}>Create account</button>
            {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.text}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
