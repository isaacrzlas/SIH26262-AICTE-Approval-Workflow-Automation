import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import './ui.css';

const pages = [
  { id: 'overview', icon: '⌂', label: 'Overview' },
  { id: 'applications', icon: '▤', label: 'Applications' },
  { id: 'evc', icon: '◷', label: 'EVC schedule' },
  { id: 'compliance', icon: '◇', label: 'Compliance' },
  { id: 'audit', icon: '≡', label: 'Activity & audit' },
];
const stageOrder = ['Scrutiny', 'Pending EVC', 'SAC / SHC', 'Approved'];
const roleRegions = { 'Workspace admin': 'All regions', 'Regional officer': 'South', 'EVC member': 'All regions' };

async function request(path, options) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const page = location.pathname.split('/')[1] || 'overview';
  const setPage = (nextPage) => navigate(nextPage === 'overview' ? '/' : `/${nextPage}`);
  const [apps, setApps] = useState([]);
  const [evcQueue, setEvcQueue] = useState([]);
  const [undertakings, setUndertakings] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [role, setRole] = useState('Workspace admin');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const region = roleRegions[role];
  const refresh = useCallback(async () => {
    try {
      const query = region === 'All regions' ? '' : `?region=${encodeURIComponent(region)}`;
      const [applicationResult, evcResult, complianceResult, notificationResult] = await Promise.all([
        request(`/api/applications${query}`), request('/api/evc/queue'), request('/api/undertakings'), request('/api/notifications'),
      ]);
      setApps(applicationResult.items); setEvcQueue(evcResult.items.filter((item) => region === 'All regions' || item.region === region)); setUndertakings(complianceResult.items); setNotifications(notificationResult.items);
    } catch (error) { setToast(error.message); }
  }, [region]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer); }, [toast]);

  const filteredApps = useMemo(() => apps.filter((item) =>
    (status === 'All statuses' || item.status === status) &&
    `${item.institutionName} ${item.id} ${item.region}`.toLowerCase().includes(search.toLowerCase())), [apps, search, status]);
  const evcApps = evcQueue;
  const counts = { review: apps.filter((item) => !['Approved', 'Rejected'].includes(item.status)).length, evc: evcApps.length, due: undertakings.filter((item) => item.status !== 'Fulfilled').length, overdue: undertakings.filter((item) => item.status === 'Overdue').length };

  async function createApplication(event) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await request('/api/applications', { method: 'POST', body: JSON.stringify({ institutionName: form.get('institutionName'), region: form.get('region'), instituteType: form.get('instituteType') }) });
      setToast(`Application created · ${result.application.id}`); setDialog(''); await refresh();
    } catch (error) { setToast(error.message); } finally { setBusy(false); }
  }
  async function advance(item) {
    const action = item.currentStage === 'SAC / SHC' ? 'approve' : 'approve';
    try { await request(`/api/applications/${item.id}/stage`, { method: 'PUT', body: JSON.stringify({ action, comments: '' }) }); setToast('Workflow advanced · audit entry recorded'); await refresh(); }
    catch (error) { setToast(error.message); }
  }
  async function schedule(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await request('/api/evc/schedule', { method: 'POST', body: JSON.stringify({ applicationId: selected.id, scheduledAt: form.get('scheduledAt'), committee: form.get('committee') }) }); setToast('EVC visit scheduled'); setDialog(''); await refresh(); }
    catch (error) { setToast(error.message); }
  }
  async function addUndertaking(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const app = apps[0];
    if (!app) return setToast('Create an application first.');
    try { const description = form.get('description'); await request(`/api/applications/${app.id}/undertakings`, { method: 'POST', body: JSON.stringify({ description, requiredAction: description, dueDate: form.get('dueDate') }) }); setToast('Compliance item added'); setDialog(''); await refresh(); }
    catch (error) { setToast(error.message); }
  }
  async function submitEvidence(item) {
    setSelected(item);
    setDialog('evidence');
  }
  async function saveEvidence(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const evidence = form.get('evidence');
    setBusy(true);
    try {
      await request(`/api/undertakings/${selected.id}`, { method: 'PUT', body: JSON.stringify({ evidence }) });
      setToast('Evidence recorded · item fulfilled'); setDialog(''); setSelected(null); await refresh();
    } catch (error) { setToast(error.message); }
    finally { setBusy(false); }
  }
  async function showAudit(item) {
    try { const result = await request(`/api/applications/${item.id}/audit`); setSelected({ ...item, audit: result.items }); setDialog('audit'); }
    catch (error) { setToast(error.message); }
  }
  const title = pages.find((item) => item.id === page)?.label || 'Overview';

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><span><b>AICTE</b><small>Approval workspace</small></span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{pages.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.label}{item.id === 'evc' && <i>{counts.evc}</i>}</button>)}</nav>
      <div className="side-note"><span className="note-icon">✦</span><b>Prototype workspace</b><p>Demo data resets when the local server restarts. No real accounts or documents are connected.</p><a href="/README.md">Read setup guide ↗</a></div>
      <div className="profile"><span className="avatar">IG</span><span><b>Isaac Gazula</b><small>Demo access</small></span><span className="more">···</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b>{title}</b></div><div className="top-tools"><span className="prototype-tag"><i /> LOCAL DEMO</span><button className="bell" onClick={() => setPage('compliance')} aria-label="Open alerts">♧<em>{notifications.length}</em></button><label className="role-picker"><span>View as</span><select value={role} onChange={(event) => setRole(event.target.value)}><option>Workspace admin</option><option>Regional officer</option><option>EVC member</option></select></label></div></header>
      <div className="content">
        <div className="eyebrow">AICTE APPROVAL WORKSPACE <span className="fresh"><i /> DEMO DATA</span></div>
        <div className="heading-row"><div><h1>{page === 'overview' ? 'Good morning, Isaac' : title}</h1><p>{page === 'overview' ? 'A clear view of what is moving across your approval workflow.' : page === 'applications' ? 'Review applications, move stages, and inspect the audit history.' : page === 'evc' ? 'Review applications that need an expert visit and plan a session.' : page === 'compliance' ? 'Track undertakings, evidence, and upcoming deadlines.' : 'A chronological record of workflow activity.'}</p></div><button className="primary" onClick={() => setDialog(page === 'compliance' ? 'undertaking' : 'application')}>＋ {page === 'compliance' ? 'Add compliance item' : 'New application'}</button></div>
        <section className="metric-grid">
          <Metric icon="▤" label="In review" value={counts.review} foot="Applications moving through review" tone="blue" />
          <Metric icon="◷" label="Awaiting EVC" value={counts.evc} foot="Ready for visit scheduling" tone="amber" />
          <Metric icon="◇" label="Open compliance" value={counts.due} foot={`${counts.overdue} overdue · reminders simulated`} tone="violet" />
          <Metric icon="✓" label="Approved" value={apps.filter((item) => item.status === 'Approved').length} foot="Completed in this demo workspace" tone="green" />
        </section>
        {page === 'overview' && <><section className="panel pipeline-panel"><div className="panel-title"><div><h2>Application pipeline</h2><p>Follow each application from scrutiny to decision.</p></div><button className="quiet" onClick={() => setPage('applications')}>View applications →</button></div><div className="pipeline">{stageOrder.map((stage, index) => { const count = apps.filter((item) => item.currentStage === stage).length; return <div className="stage-card" key={stage}><div className={`stage-icon stage-${index}`}>{['↗','⌁','◎','✓'][index]}</div><small>{stage === 'SAC / SHC' ? 'Committee' : stage}</small><strong>{count.toString().padStart(2, '0')}</strong><div className="progress"><i style={{ width: `${Math.max(7, (count / Math.max(1, apps.length)) * 100)}%` }} /></div></div>; })}</div></section>
          <div className="two-col"><ApplicationsTable items={filteredApps.slice(0, 5)} search={search} setSearch={setSearch} status={status} setStatus={setStatus} onAdvance={advance} onAudit={showAudit} onSchedule={(item) => { setSelected(item); setDialog('schedule'); }} compact /><section className="panel alert-panel"><div className="panel-title"><div><h2>Needs attention</h2><p>Upcoming deadlines and document expiry</p></div><span className="count-chip">{notifications.length}</span></div><div className="alert-list">{notifications.slice(0, 3).map((item) => <Alert key={item.id} item={item} />)}{!notifications.length && <Empty>No open alerts right now.</Empty>}</div><button className="quiet full" onClick={() => setPage('compliance')}>Review compliance →</button></section></div></>}
        {page === 'applications' && <ApplicationsTable items={filteredApps} search={search} setSearch={setSearch} status={status} setStatus={setStatus} onAdvance={advance} onAudit={showAudit} onSchedule={(item) => { setSelected(item); setDialog('schedule'); }} />}
        {page === 'evc' && <section className="panel"><div className="panel-title"><div><h2>EVC queue</h2><p>New institute applications routed to an expert visit.</p></div><span className="count-chip">{evcApps.length} in queue</span></div><div className="evc-grid">{evcApps.map((item) => <article className="evc-card" key={item.id}><span className={`pill ${item.schedule ? 'green' : 'amber'}`}>{item.schedule ? 'Scheduled' : 'Awaiting schedule'}</span><h3>{item.institutionName}</h3><p>{item.id} · {item.region} region</p><div className="evc-meta"><span>Submitted {new Date(item.submittedAt).toLocaleDateString()}</span><b>APH route · New institute</b>{item.schedule && <span>{new Date(item.schedule.scheduledAt).toLocaleString()} · {item.schedule.committee}</span>}</div>{!item.schedule && <button className="primary" onClick={() => { setSelected(item); setDialog('schedule'); }}>◷ Schedule EVC</button>}</article>)}{!evcApps.length && <Empty>No applications are waiting for EVC. Create a new institute application to see the route.</Empty>}</div></section>}
        {page === 'compliance' && <section className="panel"><div className="panel-title"><div><h2>Undertakings & document follow-up</h2><p>Track due dates, submitted evidence, and escalation states.</p></div><button className="secondary" onClick={() => setDialog('undertaking')}>＋ Add undertaking</button></div><div className="compliance-list">{undertakings.map((item) => <article className="compliance-row" key={item.id}><div className={`compliance-symbol ${item.status === 'Overdue' ? 'danger' : item.status === 'Fulfilled' ? 'success' : ''}`}>{item.status === 'Fulfilled' ? '✓' : '◇'}</div><div className="compliance-main"><b>{item.description}</b><p>{item.institutionName} · {item.applicationId}</p><small>{item.id} · Due {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString()}</small>{item.evidence && <div className="evidence-note">Evidence: {item.evidence}</div>}</div><span className={`pill ${item.status === 'Overdue' ? 'red' : item.status === 'Fulfilled' ? 'green' : 'amber'}`}>{item.status}</span>{item.status !== 'Fulfilled' && <button className="secondary" onClick={() => submitEvidence(item)}>Record evidence</button>}</article>)}{!undertakings.length && <Empty>No compliance items yet. Add one to start a demo follow-up.</Empty>}</div><div className="demo-callout"><b>Compliance reminders</b><span>The daily check records 3-day deadline reminders, overdue escalations, and 30/15-day document-expiry alerts. Email delivery requires the notification service to be configured.</span></div></section>}
        {page === 'audit' && <section className="panel"><div className="panel-title"><div><h2>Application activity</h2><p>Select an application to inspect its recorded actions.</p></div></div><div className="table-wrap"><table><thead><tr><th>APPLICATION</th><th>REGION</th><th>STAGE</th><th>STATUS</th><th></th></tr></thead><tbody>{apps.map((item) => <tr key={item.id}><td><b>{item.institutionName}</b><small className="subline">{item.id}</small></td><td>{item.region}</td><td>{item.currentStage}</td><td><span className="pill blue">{item.status}</span></td><td><button className="text-link" onClick={() => showAudit(item)}>View audit →</button></td></tr>)}</tbody></table></div></section>}
        <footer><span>AICTE Approval Workspace</span><span>Prototype · local mock data · v0.2</span></footer>
      </div>
    </main>
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(''); }}><section className="modal"><button className="modal-close" onClick={() => setDialog('')}>×</button>
      {dialog === 'application' && <form onSubmit={createApplication}><span className="eyebrow">START A WORKFLOW</span><h2>New application</h2><p>Create a local demo application. New institutes route through EVC.</p><label>Institution name<input name="institutionName" maxLength="200" required placeholder="e.g. Eastern Valley Institute" /></label><label>Region<select name="region"><option>North</option><option>South</option><option>East</option><option>West</option><option>Central</option></select></label><label>Application path<select name="instituteType"><option value="existing">Existing institute · scrutiny to approval</option><option value="new">New institute · scrutiny, EVC, committee</option></select></label><button disabled={busy} className="primary wide">{busy ? 'Creating…' : 'Create application'}</button></form>}
      {dialog === 'schedule' && selected && <form onSubmit={schedule}><span className="eyebrow">EXPERT VISIT COMMITTEE</span><h2>Schedule EVC</h2><p>{selected.institutionName}</p><label>Visit date & time<input name="scheduledAt" type="datetime-local" required min={new Date().toISOString().slice(0, 16)} /></label><label>Committee / team<input name="committee" required maxLength="120" placeholder="Regional EVC team" /></label><button className="primary wide">Save schedule</button></form>}
      {dialog === 'undertaking' && <form onSubmit={addUndertaking}><span className="eyebrow">COMPLIANCE TRACKING</span><h2>Add undertaking</h2><p>Attach a follow-up item to the latest application in this demo.</p><label>Description<input name="description" maxLength="240" required placeholder="e.g. Submit updated fire safety certificate" /></label><label>Due date<input name="dueDate" type="date" required /></label><button className="primary wide">Add compliance item</button></form>}
      {dialog === 'evidence' && selected && <form onSubmit={saveEvidence}><span className="eyebrow">COMPLIANCE TRACKING</span><h2>Record evidence</h2><p>{selected.description}</p><label>Evidence description<input name="evidence" maxLength="500" required autoFocus placeholder="e.g. Renewed Fire Safety Certificate reviewed." /></label><button disabled={busy} className="primary wide">{busy ? 'Saving…' : 'Submit evidence'}</button></form>}
      {dialog === 'audit' && selected && <><span className="eyebrow">AUDIT TRAIL</span><h2>{selected.institutionName}</h2><p>{selected.id} · {selected.region}</p><div className="audit-list">{selected.audit?.map((entry) => <div className="audit-entry" key={entry.id}><span className="audit-dot" /><div><b>{entry.action.replaceAll('.', ' ')}</b><p>{entry.performedBy} · {new Date(entry.performedAt).toLocaleString()}</p></div></div>)}</div><button className="secondary wide" onClick={() => setDialog('')}>Close</button></>}
    </section></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function Metric({ icon, label, value, foot, tone }) { return <article className="metric-card"><div className="metric-head"><span>{label}</span><i className={tone}>{icon}</i></div><strong>{value.toString().padStart(2, '0')}</strong><small>{foot}</small></article>; }
function Empty({ children }) { return <div className="empty-state">{children}</div>; }
function Alert({ item }) {
  const overdue = item.type === 'undertaking.overdue' || item.type === 'Overdue';
  const label = overdue ? 'Overdue escalation' : item.type === 'document.expiry' ? 'Document expiry' : 'Deadline reminder';
  return <div className="alert-item"><span className={`alert-icon ${overdue ? 'red-bg' : 'amber-bg'}`}>{overdue ? '!' : '◷'}</span><span><b>{label}</b><small>{item.message}</small></span></div>;
}
function ApplicationsTable({ items, search, setSearch, status, setStatus, onAdvance, onAudit, onSchedule, compact = false }) {
  return <section className="panel application-panel"><div className="panel-title"><div><h2>{compact ? 'Recent applications' : 'Applications'}</h2><p>{compact ? 'Current work across your visible region' : `${items.length} applications in this view`}</p></div></div><div className="table-tools"><label className="search-field"><span>⌕</span><input aria-label="Search applications" placeholder="Search institution or ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option>All statuses</option>{['Under Review', 'Pending EVC', 'Approved', 'Rejected', 'Clarification Requested'].map((item) => <option key={item}>{item}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>APPLICATION</th><th>REGION</th><th>SUBMITTED</th><th>STAGE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.institutionName}</b><small className="subline">{item.id}</small></td><td>{item.region}</td><td>{new Date(item.submittedAt).toLocaleDateString()}</td><td>{item.currentStage}</td><td><span className={`pill ${item.status === 'Approved' ? 'green' : item.status === 'Pending EVC' ? 'amber' : 'blue'}`}>{item.status}</span></td><td><div className="actions"><button className="text-link" onClick={() => onAudit(item)}>Audit</button>{item.currentStage === 'Pending EVC' ? <button className="text-link" onClick={() => onSchedule(item)}>Schedule</button> : item.status !== 'Approved' && item.status !== 'Rejected' ? <button className="text-link" onClick={() => onAdvance(item)}>Advance →</button> : null}</div></td></tr>)}{!items.length && <tr><td colSpan="6"><Empty>No applications match. Create a submission to begin.</Empty></td></tr>}</tbody></table></div></section>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
