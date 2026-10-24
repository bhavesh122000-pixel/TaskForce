/* Raikan conveyancing workflow definitions (learned from monday.com, Oct 2026).
   Shared by the server and the browser. Edit labels or ready states here. */
(function (root) {
  'use strict';

  // Matter types. "side" decides which checklist and readiness columns apply.
  const MATTER_TYPES = [
    { key: 'P', label: 'Purchaser', short: 'P', side: 'P' },
    { key: 'V', label: 'Vendor', short: 'V', side: 'V' },
    { key: 'PA', label: 'Purchaser – off the plan / allotment', short: 'PA', side: 'P' },
    { key: 'VPA', label: 'Vendor – off the plan / allotment', short: 'V (PA)', side: 'V' },
    { key: 'LD', label: 'Land division', short: 'LD', side: null },
    { key: 'SP', label: 'Spouse addition / removal', short: 'Spouse', side: null },
    { key: 'O', label: 'Other', short: 'Other', side: null },
    // Taxation / bookkeeping jobs: only staff with Taxation access (and admins) can see these
    { key: 'TAX', label: 'Taxation / bookkeeping', short: 'TAX', side: 'T', area: 'tax' },
  ];
  MATTER_TYPES.forEach(t => { t.area = t.area || 'conv'; });
  const TYPE = Object.fromEntries(MATTER_TYPES.map(t => [t.key, t]));
  const sideOf = type => (TYPE[type] || {}).side || null;
  const areaOf = type => (TYPE[type] || {}).area || 'conv';
  const AREAS = [{ key: 'conv', label: 'Conveyancing' }, { key: 'tax', label: 'Taxation' }];

  // Stage timeline. Due dates count from the day the matter is opened, or from settlement (S).
  const STAGES = [
    { key: 'contact', label: 'Contact Details', sides: ['P'], from: 'opened', days: 0, when: 'On instruction' },
    { key: 's1', label: 'Stage 1 Greetings', sides: ['P', 'V'], from: 'opened', days: 1, when: 'On instruction' },
    { key: 'form1', label: 'Form1 Review', sides: ['P', 'V'], from: 'opened', days: 3, when: 'On receipt of Form 1' },
    { key: 's2', label: 'Stage 2 Formation', sides: ['P', 'V'], from: 'opened', days: 2, when: 'Straight after intake' },
    { key: 's3', label: 'Stage 3', sides: ['P', 'V'], from: 'settlement', days: -35, when: 'Within 5 weeks of settlement' },
    { key: 's4', label: 'Stage 4', sides: ['P', 'V'], from: 'settlement', days: -14, when: 'Settlement − 2 weeks' },
    { key: 's5', label: 'Stage 5', sides: ['P', 'V'], from: 'settlement', days: -7, when: 'Settlement − 1 week' },
    { key: 's51', label: 'Stage 5.1', sides: ['P'], from: 'settlement', days: -2, when: 'Settlement − 2 days' },
    { key: 's6', label: 'Stage 6', sides: ['P', 'V'], from: 'settlement', days: 0, when: 'Settlement day' },
  ];

  // Checklist item status labels (exact monday.com wording) + "Not Required" for "if applicable" items.
  const ITEM_STATUS = {
    P: ['Done', 'Requested', 'Email Sent', 'Added', 'Signed', 'Matching', 'Yes', 'No', 'Shortfall Authority', 'Trust Account', 'Received', 'Not Required'],
    V: ['Working on it', 'Done', 'Stuck', 'Received', 'Not Required'],
    T: ['Waiting from Client', 'Received', 'Working on it', 'Posted', 'Reconciled', 'Done', 'Stuck', 'Not Required'],
  };
  const SUB_STATUS = {
    T: ['Waiting from Client', 'Received', 'Working on it', 'Posted', 'Reconciled', 'Done', 'Stuck', 'Not Required'],
    P: ['Waiting from Client', 'Done', 'Stuck', 'Yes', 'No', 'No Issues', 'Issues Identified', 'Not Required'],
    V: ['Waiting from Client', 'Done', 'Stuck', 'Not Required'],
  };
  // Which statuses count as finished for progress, due dates and escalation
  const COMPLETE = ['Done', 'Posted', 'Reconciled', 'Email Sent', 'Added', 'Signed', 'Matching', 'Yes', 'No', 'Shortfall Authority', 'Trust Account', 'Received', 'No Issues', 'Issues Identified', 'Not Required'];
  const isComplete = s => COMPLETE.includes(s);
  function statusTone(s) {
    if (!s) return 'gray';
    if (/stuck/i.test(s)) return 'red';
    if (s === 'Issues Identified') return 'orange';
    if (s === 'Not Required') return 'gray';
    if (isComplete(s)) return 'green';
    return 'yellow';
  }

  // Default BC - P and BC - V checklists. [title, [sub-items]] or 'title'.
  const FORM1 = [
    ['Form1 Notes', ['PIR', 'Council Search', 'Form1 Preparation Date', 'Form1 Received Date by Client', 'Cooling Off Date', 'Form1 Received Date by Us', 'Form1 Review Date', 'Form1 Notes']],
    ['Title Copy', ['Title', 'Title No. matches CoS', 'Vendor name matches CoS', 'Fee Simple', 'Easement', 'Encumbrance', 'Mortgage', "Registrar-General's Notes", 'Caveat', 'By-Laws']],
    ['Rates / Adjustment Statement', ['Council Rates p/a', 'Rental p/week', 'SA Water p/q', 'Strata admin + sinking p/q', 'Land Tax Single Holding p/a', 'ESL p/a']],
    'Encumbrance Applies', 'Encumbrance Lift & Replace', 'SA Water Recycle Audit Report required', 'GST Applies', 'Swimming Pool Compliance Required', 'Anything required before settlement',
  ];
  const DEFAULT_CHECKLISTS = {
    P: {
      contact: ['Mortgage Broker', "Vendor's Conveyancer", 'Real Estate Agent', "Bank's / Bank's Settlement Agent"],
      s1: ['Add Settlement Date in Outlook', 'Add Finance Date in Outlook', 'New Client Conveyancing Form Received', 'Story Sheet Received', 'CoS Received', 'Form1 Received', 'Form1 Reviewed', 'Greetings Email Sent', 'Greetings Email Sent to Broker / Banker'],
      form1: FORM1,
      s2: ['Create CATs', ['Create PEXA', ['Invite Bank', 'Invite Conveyancer']], 'Add Settlement Completion Email in PEXA', 'Create Transfer Document in PEXA', 'Add Contact Details in Outlook', 'Add VoIP line number', 'Schedule SMS for finance date (two days before)'],
      s3: [['Documents Sign', ['VOI', 'Client Authorisation', 'Auth to Act', 'T1']], 'Shortfall Funds Trust / Authority', ['Revenue SA Stamping', ['Create Workspace', 'Send Invite', 'Evidence of Citizenship or PR (Visa)']]],
      s4: ['VOI Signed', 'Client Authorisation Signed', 'Auth to Act Signed', 'T1 Signed', 'Match PEXA Statement with CATs', 'Funds into Trust Account / Shortfall Authority', 'Incoming Bank Accepted', 'MoT Bank Accepted', 'Email adjustment statement'],
      s5: ['PEXA T1 name matches CoS', 'Capital Gain Withholding Certificate', 'PEXA T1 address matches Auth to Act', 'Swimming Pool Compliance', 'Form1 ATO', 'PEXA name matches VOI', 'PEXA DOB matches VOI', 'SMS Name on Title', 'Check Form1 Notes', 'Check CoS Notes', 'Evidence of Australian Citizenship or PR', 'Settlement email is in PEXA', 'Land Held on Trust email (if applicable)', 'FIRB email (if applicable)'],
      s51: ['Stamping in PEXA', 'Stamp Duty coming to Trust Account', 'Our fees coming to our account', 'PEXA FSS matches CATs'],
      s6: ['Check Search', 'Sign Documents in PEXA', ['After Settlement Completion', ['Receipt in Trust Account', 'CATs Trust Account close', 'Close file in CATs', 'Pay Stamp Duty', 'SMS client on completion', 'Settlement List Excel']], ['PEXA Folder', ['PEXA email', 'FSS and statement']], 'Archive Folder'],
    },
    V: {
      s1: ['Add Settlement Date in Outlook', 'Add Finance Date in Outlook', 'New Client Conveyancing Form Received', 'Capital Gain Withholding Certificate email', 'Greetings Email Sent', 'Story Sheet Received', 'CoS Received', 'Form1 Received'],
      form1: FORM1,
      s2: ['Create CATs', ['Create PEXA', ['Invite Bank', 'Invite Conveyancer']], 'Add Settlement Completion Email in PEXA', 'Create Transfer Document in PEXA', 'Add Contact Details in Outlook', 'Add Settlement Date in Outlook', 'Add VoIP line number'],
      s3: [['Documents Sign', ['VOI', 'Client Authorisation', 'Auth to Act', 'T1']], 'Discharge Authority', ['Revenue SA Stamping', ['Create Workspace', 'Send Invite']], 'SA Water Meter Reading', 'CGW Clearance Certificate (needed on every vendor matter)'],
      s4: ['VOI Signed', 'Client Authorisation Signed', 'Auth to Act Signed', 'T1 Signed', 'Match PEXA Statement with CATs', 'Balance of Deposit requested', 'Incoming Bank invited & accepted', 'MoT Bank invited & accepted', 'Email adjustment statement to Vendor'],
      s5: ['Our fees coming to our account', 'PEXA FSS matches CATs', 'PEXA T1 name matches CoS', 'GST applicable?', 'PEXA name matches VOI', 'PEXA DOB matches VOI', "Two documents in Vendor's name", 'Settlement email is in PEXA', 'All outstanding dues paid, including Form 1', ['Bank Details', ['Confirmed by phone', 'Test transfer to vendor confirmed', 'SMS vendor bank details']], "Check vendor's bank details"],
      s6: ['Sign Documents in PEXA', ['After Settlement Completion', ['Receipt in Trust Account', 'CATs Trust Account close', 'Close file in CATs', 'Pay ESL etc.', 'SMS client on completion', 'Settlement List Excel']], ['PEXA Folder', ['PEXA email', 'FSS and statement']], 'Archive Folder'],
    },
  };

  // Checklist library: what new installs start with. Everything here can be changed in Admin → Checklist library.
  const DEFAULT_LIBRARY = [
    { key: 'BC-P', name: 'BC - P (purchaser)', side: 'P' },
    { key: 'BC-V', name: 'BC - V (vendor)', side: 'V' },
    { key: 'LD', name: 'LD – Land division', side: 'P', copyOf: 'BC-P' },
    { key: 'SP', name: 'Spouse addition / removal', side: 'P', copyOf: 'BC-P' },
  ];
  const DEFAULT_TYPE_CHECKLIST = { P: 'BC-P', PA: 'BC-P', V: 'BC-V', VPA: 'BC-V', LD: 'LD', SP: 'SP', O: 'BC-P', TAX: 'DBS-ASH' };

  // Taxation library: the monday.com "DBS" bookkeeping templates (exported 11 Oct 2026). Due dates count back from the job's due date.
  const TAX_STAGES = [
    { key: 'docs', label: 'Document Upload Checks', from: 'settlement', days: -5, when: 'Due date − 5 days' },
    { key: 'bk_inv', label: 'Do Book Keeping - Invoices', from: 'settlement', days: -3, when: 'Due date − 3 days' },
    { key: 'bk_jv', label: 'Do Book Keeping - Manual JV', from: 'settlement', days: -2, when: 'Due date − 2 days' },
    { key: 'recon', label: 'Do Reconciliations', from: 'settlement', days: 0, when: 'On the due date' },
  ];
  const DBS_DOCS = ['PM Fresh - Invoices', 'PM Fresh Account Statement', 'DPE - Invoice - x 4 or x 5', 'DPE - Credit Notes x x 4 or x 5', 'DPE Sales Report Excel Files x 4 or x 5', 'DPE Payment Voucher x 4 or x 5', 'DPE Account Statement', 'Americo - Invoices', 'Americo - Account Statement'];
  const DBS_JV = ['POST Sales Journal Excel', 'POST Wages Journal with auto reverse', 'POST Closing Stock JV & Tips', 'POST Interest on Loan', 'POST GST JV Every end of quarter', 'POST Annual Leaves in $ Dollar Value'];
  const DBS_RECON_END = ['ATO - Integrated Client with ATO Portal', 'PAYG Withholding', 'Superannuation Payable', 'Wages Payable (Must be last weeks net pay amount)', 'Closing Stock', 'Clearing Accounts', 'A/c Payable - DPE', 'A/c Payable - Americo', 'A/c Payable - PM Fresh'];
  const TAX_LIBRARY = [
    { key: 'DBS-ASH', name: 'DBS - Ashapuri', area: 'tax', items: {
      docs: ['Credit Card CSV', 'Credit Card PDF', ...DBS_DOCS],
      bk_inv: ['POST PM Fresh Invoices', 'POST Americo Invoices', 'POST Dominos Invoices', 'POST DPE Credit Notes', 'Reconcile Bank Entries', 'Import Credit Card Entries'],
      bk_jv: DBS_JV,
      recon: ['West Pac #7066', 'West Pac Business Cash Reserver', 'CBA Loan Ac #0655', 'CBA Business A/c #21244', 'ANZ A/c', 'Credit Card', ...DBS_RECON_END] } },
    { key: 'DBS-NANO', name: 'DBS - Nanotech', area: 'tax', items: {
      docs: DBS_DOCS,
      bk_inv: ['POST PM Fresh Invoices', 'POST Americo Invoices', 'POST Dominos Invoices', 'POST DPE Credit Notes', 'Reconcile Bank Entries'],
      bk_jv: DBS_JV,
      recon: ['Nab Loan A/c 54199', 'Nab Current A/c 75874', ...DBS_RECON_END] } },
  ];
  const STAGE_FROM = [
    { key: 'opened', label: 'Matter opened' },
    { key: 'finance', label: 'Finance date' },
    { key: 'settlement', label: 'Settlement date' },
  ];

  // Repeating tasks
  const REPEATS = [
    { key: 'daily', label: 'Every day' },
    { key: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { key: 'weekly', label: 'Every week' },
    { key: 'fortnightly', label: 'Every 2 weeks' },
    { key: 'monthly', label: 'Every month' },
    { key: 'quarterly', label: 'Every 3 months' },
    { key: 'yearly', label: 'Every year' },
  ];
  // Next date in a repeating series (dates as YYYY-MM-DD)
  function nextRepeat(date, rule) {
    const [y, m, d] = date.split('-').map(Number);
    const p = n => String(n).padStart(2, '0');
    const fmt = dt => `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
    const addMonths = n => { const last = new Date(y, m - 1 + n + 1, 0).getDate(); return fmt(new Date(y, m - 1 + n, Math.min(d, last))); };
    switch (rule) {
      case 'daily': return fmt(new Date(y, m - 1, d + 1));
      case 'weekdays': { const dt = new Date(y, m - 1, d + 1); while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() + 1); return fmt(dt); }
      case 'weekly': return fmt(new Date(y, m - 1, d + 7));
      case 'fortnightly': return fmt(new Date(y, m - 1, d + 14));
      case 'monthly': return addMonths(1);
      case 'quarterly': return addMonths(3);
      case 'yearly': return addMonths(12);
      default: return null;
    }
  }

  // Readiness Board - Next Three Weeks. "ready" = the bold / finished labels.
  const READINESS = [
    { key: 'text', label: 'Text', hint: 'Short blocker note, e.g. "pot not there", "ip not accepted", "SDR"', kind: 'text', sides: ['P', 'V'] },
    { key: 'noti', label: 'Noti.Email', hint: 'Notification emails', sides: ['P', 'V'], labels: ['Working on it', 'Done', 'File cancel', 'Investment', 'Live in'], ready: ['Done'] },
    { key: 'cgw', label: 'Capital Gain Withholding', short: 'CGW', sides: ['P', 'V'], labels: ['Working on it', 'Done', 'Stuck', 'Requested', 'Not Required'], ready: ['Done', 'Not Required'] },
    { key: 'client_auth', label: 'Client Auth', sides: ['P', 'V'], labels: ['Requested', 'Done', 'Stuck', 'WIP', 'waiting for FIN', 'Prepared'], ready: ['Done'] },
    { key: 'auth_to_act', label: 'Auth to Act', sides: ['P', 'V'], labels: ['Requested', 'Done', 'Stuck'], ready: ['Done'] },
    { key: 'voi', label: 'VOI', sides: ['P', 'V'], labels: ['Requested', 'Received', 'Vir. DONE', 'Virtual requested', 'Waiting finance', 'WIP'], ready: ['Received', 'Vir. DONE'] },
    { key: 't1', label: 'T1', sides: ['P', 'V'], labels: ['Requested', 'Done', 'Stuck'], ready: ['Done'] },
    { key: 'participants', label: 'All Participants Accepted', short: 'All Participants', sides: ['P', 'V'], labels: ['Working on it', 'Done', 'Stuck'], ready: ['Done'] },
    { key: 'gst', label: 'GST', sides: ['P', 'V'], gstOnly: true, labels: ['Received', 'Done', 'Stuck', 'Working on it'], ready: ['Done'] },
    { key: 'adj', label: 'Adj Stat.', sides: ['P', 'V'], labels: ['Working on it', 'Done', 'Requested', 'Not Sure Sent', 'Estimated sent', 'Prepared', 'Doubt', 'Received', 'Calendar', 'Amended prepared', 'Asked to review', 'max loan amount', 'Draft send'], ready: ['Done', 'Received'] },
    { key: 'bank', label: 'Our Bank Accepted', short: 'Our Bank', sides: ['P', 'V'], labels: ['Invited', 'Accepted', 'Stuck', 'WIP', 'Email send', 'No BANK', 'Discharge Email Send', 'Unfinance - Email send', 'max loan amount'], ready: ['Accepted', 'Invited', 'No BANK'] },
    { key: 'funds', label: 'Funds into Trust/Shortfall', short: 'Funds', sides: ['P'], labels: ['Requested', 'Credit in A/c', 'SA', 'to request pending', 'Not Sure', 'Shortfall with Bank', 'Trust Account', 'Cash', 'Surplus Funds'], ready: ['Shortfall with Bank', 'Trust Account', 'Cash', 'Surplus Funds'] },
    { key: 'vendor_data', label: 'Vendor Data Complete', short: 'Vendor Data', sides: ['P'], labels: ['Working on it', 'Done', 'Stuck OR File Cancel', 'Requested', 'invitation received', 'Opinion applied', 'doubt', 'SDR Applied', 'SDR Confirm'], ready: ['Done', 'SDR Confirm'], readyIfSdr: ['SDR Confirm'] },
    { key: 'bod_amount', label: 'Text 1 (deposit / BOD amount)', short: 'BOD amount', kind: 'text', sides: ['V'] },
    { key: 'bod', label: 'BOD', hint: 'Balance of Deposit', sides: ['V'], labels: ['Requested', 'Done', 'NO BOD', 'Prepared', 'We have to Pay', 'asked for ss', 'working on it', 'Private cos'], ready: ['Done', 'NO BOD', 'Private cos'] },
    { key: 'purchaser_stmt', label: 'Purchaser Statement', short: 'Purch. Stmt', sides: ['V'], labels: ['Working on it', 'Done', 'Stuck', 'Ready', 'Prepared'], ready: ['Done'] },
    { key: 'saw', label: 'SAW', hint: 'SA Water', sides: ['V'], labels: ['Working on it', 'Ordered', 'Details yet not exists'], ready: ['Ordered'] },
    { key: 'form1', label: 'Form1', sides: ['V'], labels: ['Email Send', 'No Invoice (paid)', 'Stuck', 'Paid by Form1', 'Not Form1', 'Done', 'Form1 not received', 'WIP', 'invoice not raised', 'address is weird', 'Waiver'], ready: ['Done', 'Waiver'] },
    { key: 'rental', label: 'Rental Adjust.', sides: ['V'], labels: ['Email send', 'Same', 'Not Same', 'Asked on pexa', 'No Tenancy', 'Tenancies applicable', 'We need to do', 'They will do', 'self managed'], ready: ['No Tenancy'] },
    { key: 'text2', label: 'Text 2', kind: 'text', sides: ['P', 'V'] },
  ];

  // Blocker phrases in the Text note, spelled out
  const BLOCKERS = [
    { re: /\bpot\s+not\s+there\b/i, text: 'Proprietor on Title not yet in PEXA' },
    { re: /\bpot\s+not\s+accept/i, text: 'Proprietor on Title hasn’t accepted the PEXA invitation' },
    { re: /\bip\s+not\s+accept/i, text: 'Incoming Proprietor hasn’t accepted the PEXA invitation' },
    { re: /\bip\s+not\s+there\b/i, text: 'Incoming Proprietor not yet in PEXA' },
    { re: /\bpexa\s+not\s+there\b/i, text: 'PEXA workspace not there yet' },
  ];
  const GLOSSARY = {
    SDR: 'Stamp Duty Relief', POT: 'Proprietor on Title', IP: 'Incoming Proprietor', CoS: 'Contract of Sale', CATs: 'Trust accounting / practice management system',
    VOI: 'Verification of Identity', T1: 'Transfer', MoT: 'Mortgage (bank)', FSS: 'PEXA Financial Settlement Schedule', BOD: 'Balance of Deposit',
    CGW: 'Foreign resident Capital Gains Withholding (clearance certificate)', SAW: 'SA Water', ESL: 'Emergency Services Levy', PIR: 'Property Interest Report', FIRB: 'Foreign Investment Review Board',
  };

  function readinessColumns(side, gst) { return READINESS.filter(c => c.sides.includes(side) && (!c.gstOnly || gst)); }
  function blockersIn(text) { return BLOCKERS.filter(b => b.re.test(text || '')).map(b => b.text); }
  function sdrClaimed(matter, values) { return !!(matter && matter.sdr_claimed) || /\bSDR\b/.test((values && values.text) || ''); }

  // The two free-text note boxes kept on the Readiness Board (everything else comes from milestone items)
  const BOARD_NOTES = [
    { key: 'text', label: 'Text', hint: 'Short blocker note, e.g. "pot not there", "ip not accepted", "SDR"' },
    { key: 'text2', label: 'Text 2', hint: 'Any other note' },
  ];

  /* ---------- Milestones ----------
     A checklist item marked as a milestone shows as a column on the Readiness Board and a bar on the matter's Gantt chart,
     and gets its due date worked out automatically. Settings (stored as JSON on the item):
       label     – short column name on the board
       statuses  – the status labels to choose from (blank = the normal checklist labels)
       ready     – which of those count as finished (blank = the normal "complete" labels)
       readySdr  – finished labels when SDR (Stamp Duty Relief) is claimed (optional)
       gstOnly   – only applies when "GST applies" is ticked on the matter
       from/days – due date: N days from opened / finance / settlement (blank from = the stage's due date)
       lead      – how many days before the due date the work starts (for the Gantt bar; blank = when the stage window opens) */
  // Where the old board columns live in the standard checklists. "add" = a new item for that stage.
  const MILESTONE_HOME = {
    P: {
      noti: ['s4', 'Notification emails', true], cgw: ['s5', 'Capital Gain Withholding Certificate'], client_auth: ['s4', 'Client Authorisation Signed'],
      auth_to_act: ['s4', 'Auth to Act Signed'], voi: ['s4', 'VOI Signed'], t1: ['s4', 'T1 Signed'], participants: ['s4', 'All Participants Accepted', true],
      gst: ['s5', 'GST withholding', true], adj: ['s4', 'Email adjustment statement'], bank: ['s4', 'MoT Bank Accepted'],
      funds: ['s4', 'Funds into Trust Account / Shortfall Authority'], vendor_data: ['s5', 'Vendor Data Complete', true],
    },
    V: {
      noti: ['s4', 'Notification emails', true], cgw: ['s3', 'CGW Clearance Certificate (needed on every vendor matter)'], client_auth: ['s4', 'Client Authorisation Signed'],
      auth_to_act: ['s4', 'Auth to Act Signed'], voi: ['s4', 'VOI Signed'], t1: ['s4', 'T1 Signed'], participants: ['s4', 'All Participants Accepted', true],
      gst: ['s5', 'GST withholding', true], adj: ['s4', 'Email adjustment statement to Vendor'], bank: ['s4', 'MoT Bank invited & accepted'],
      bod: ['s4', 'Balance of Deposit requested'], purchaser_stmt: ['s4', 'Purchaser Statement', true], saw: ['s3', 'SA Water Meter Reading'],
      form1: ['s5', 'All outstanding dues paid, including Form 1'], rental: ['s4', 'Rental Adjustment', true],
    },
  };
  // Default milestones for a side, built from the monday.com board columns (same labels and ready states)
  function defaultMilestones(side) {
    const home = MILESTONE_HOME[side] || {};
    return READINESS.filter(c => c.kind !== 'text' && home[c.key]).map(c => ({
      rk: c.key, stage: home[c.key][0], title: home[c.key][1], add: !!home[c.key][2],
      ms: cleanMs({ label: c.short || c.label, statuses: c.labels, ready: c.ready, readySdr: c.readyIfSdr || [], gstOnly: !!c.gstOnly }),
    }));
  }
  const MS_FROM = ['', 'opened', 'finance', 'settlement'];
  function cleanMs(x) {
    if (!x || typeof x !== 'object') return null;
    const list = v => (Array.isArray(v) ? v : String(v || '').split(/\n|,/)).map(s => String(s).trim()).filter(Boolean).slice(0, 40);
    const int = v => (v === '' || v == null || isNaN(parseInt(v, 10))) ? null : parseInt(v, 10);
    const statuses = list(x.statuses);
    let ready = list(x.ready), readySdr = list(x.readySdr);
    if (statuses.length) { ready = ready.filter(s => statuses.includes(s)); readySdr = readySdr.filter(s => statuses.includes(s)); }
    return { label: String(x.label || '').trim().slice(0, 40), statuses, ready, readySdr, gstOnly: !!x.gstOnly,
      from: MS_FROM.includes(x.from) ? x.from : '', days: int(x.days), lead: int(x.lead) };
  }
  function parseMs(v) { if (!v) return null; if (typeof v === 'object') return cleanMs(v); try { return cleanMs(JSON.parse(v)); } catch { return null; } }
  // Status labels to offer for an item (milestones can have their own)
  function statusOptions(item, side, sub) {
    const ms = parseMs(item && item.ms);
    if (ms && ms.statuses.length) return ms.statuses;
    return ((sub ? SUB_STATUS : ITEM_STATUS)[side || 'P']) || [];
  }
  function readyLabels(ms, sdr) {
    if (!ms) return COMPLETE;
    if (sdr && ms.readySdr.length) return ms.readySdr;
    if (ms.ready.length) return ms.ready;
    return ms.statuses.length ? ms.statuses.filter(isComplete) : COMPLETE;
  }
  // Is a checklist item finished? (milestones use their own "ready" labels)
  function itemDone(item, sdr) {
    if (!item || !item.status) return false;
    const ms = parseMs(item.ms);
    return ms ? readyLabels(ms, sdr).includes(item.status) : isComplete(item.status);
  }
  function itemTone(item, sdr) {
    const s = item && item.status;
    if (!s) return 'gray';
    if (/stuck/i.test(s)) return 'red';
    if (itemDone(item, sdr)) return 'green';
    if (s === 'Issues Identified') return 'orange';
    if (s === 'Not Required') return 'gray';
    return 'yellow';
  }
  const msLabel = item => { const ms = parseMs(item && item.ms); return (ms && ms.label) || (item && item.title) || ''; };

  // Ready-to-settle check from a matter's milestone items. cells = [{ label, status, ms, applies }]
  function readinessOf(matter, values, cells) {
    values = values || {};
    cells = (cells || []).filter(c => c.applies !== false);
    const sdr = sdrClaimed(matter, values);
    const outstanding = [];
    let done = 0;
    for (const c of cells) {
      if (itemDone(c, sdr)) done++;
      else outstanding.push({ label: c.label, value: c.status || 'not started', due: c.due || null });
    }
    const blockers = blockersIn(values.text);
    const stuck = cells.filter(c => /stuck/i.test(c.status || '')).map(c => c.label);
    const applies = cells.length > 0;
    return { applies, ready: applies && outstanding.length === 0 && blockers.length === 0, total: cells.length, done, outstanding, blockers, stuck, sdr };
  }


  /* ---------- South Australian public holidays (Public Holidays Act 2023 (SA)) ----------
     Checked against SafeWork SA's published list for 2025–2028. Later years are worked out from the Act;
     the Governor can proclaim changes, so admins can add or remove days in Admin → Holidays & time. */
  function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
  const p2 = n => String(n).padStart(2, '0'), ds = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const nthMon = (y, m, n) => { const d = new Date(y, m, 1); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return d; };
  const nextDow = (d, dow) => { const x = add(d, 1); while (x.getDay() !== dow) x.setDate(x.getDate() + 1); return x; };
  function saHolidays(y) {
    const out = [], push = (d, name, part) => out.push({ date: ds(d), name, part: part || null });
    const ny = new Date(y, 0, 1); push(ny, "New Year's Day"); if ([0, 6].includes(ny.getDay())) push(nextDow(ny, 1), "New Year's Day (additional day)");
    const ad = new Date(y, 0, 26); push([0, 6].includes(ad.getDay()) ? nextDow(ad, 1) : ad, 'Australia Day');
    push(nthMon(y, 2, 2), 'Adelaide Cup Day');
    const e = easter(y); push(add(e, -2), 'Good Friday'); push(add(e, -1), 'Easter Saturday'); push(e, 'Easter Sunday'); push(add(e, 1), 'Easter Monday');
    push(new Date(y, 3, 25), 'ANZAC Day');
    push(nthMon(y, 5, 2), "King's Birthday");
    push(nthMon(y, 9, 1), 'Labour Day');
    push(new Date(y, 11, 24), 'Christmas Eve (public holiday from 7pm)', '19:00');
    const xm = new Date(y, 11, 25); push(xm, 'Christmas Day'); if ([0, 6].includes(xm.getDay())) push(nextDow(xm, 1), 'Christmas Day (additional day)');
    const pd = new Date(y, 11, 26); push(pd, 'Proclamation Day / Boxing Day');
    if (pd.getDay() === 6) push(nextDow(pd, 1), 'Proclamation Day (additional day)'); else if ([0, 1].includes(pd.getDay())) push(nextDow(pd, 2), 'Proclamation Day (additional day)');
    push(new Date(y, 11, 31), "New Year's Eve (public holiday from 7pm)", '19:00');
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Leave and time tracking
  const LEAVE_KINDS = ['Annual leave', 'Personal / sick leave', 'Training', 'Working elsewhere', 'Other'];
  const CHECKIN_CHOICES = [0, 30, 45, 60, 90, 120];
  const api = { saHolidays, LEAVE_KINDS, CHECKIN_CHOICES, MATTER_TYPES, TYPE, sideOf, areaOf, AREAS, TAX_STAGES, TAX_LIBRARY, STAGES, DEFAULT_LIBRARY, DEFAULT_TYPE_CHECKLIST, STAGE_FROM, REPEATS, nextRepeat, ITEM_STATUS, SUB_STATUS, COMPLETE, isComplete, statusTone, DEFAULT_CHECKLISTS, READINESS, BOARD_NOTES, BLOCKERS, GLOSSARY,
    readinessColumns, blockersIn, sdrClaimed, readinessOf, MILESTONE_HOME, defaultMilestones, cleanMs, parseMs, statusOptions, readyLabels, itemDone, itemTone, msLabel, MS_FROM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TFW = api;
})(typeof window !== 'undefined' ? window : globalThis);
