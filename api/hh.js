// Heights House API: one function, stores each record as a private JSON blob.
// Paths: data/<kind>/<id>.json  kinds: events, requests, tickets, proposals
import { put, get, list, del } from '@vercel/blob';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const KINDS = ['events', 'requests', 'tickets', 'proposals'];
const SUBMIT = { request: 'requests', ticket: 'tickets', proposal: 'proposals' };
const newId = () => Date.now().toString(36) + randomBytes(9).toString('hex');
const okId = id => typeof id === 'string' && /^[a-z0-9]{10,40}$/.test(id);
const path = (kind, id) => `data/${kind}/${id}.json`;

async function save(kind, id, obj) {
  await put(path(kind, id), JSON.stringify(obj), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
  });
}
async function load(kind, id) {
  try {
    const r = await get(path(kind, id), { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch { return null; }
}
async function all(kind) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: `data/${kind}/`, cursor, limit: 1000 });
    const items = await Promise.all(page.blobs.map(async b => {
      const id = b.pathname.slice(`data/${kind}/`.length, -5);
      const v = await load(kind, id);
      return v ? { ...v, id } : null;
    }));
    out.push(...items.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const toMin = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const SPACES = ['Conference room', 'The Garage', 'Podcast studio'];
const overlap = (a, b) => a.space === b.space && a.date === b.date &&
  toMin(a.start) < toMin(b.start) + b.minutes && toMin(b.start) < toMin(a.start) + a.minutes;

function clean(kind, d) {
  if (kind === 'requests') {
    const r = {
      space: SPACES.includes(d.space) ? d.space : 'Conference room', name: s(d.name, 80), company: s(d.company, 80),
      phone: s(d.phone, 30), email: s(d.email, 120), date: d.date, start: d.start, minutes: Number(d.minutes),
      people: Math.min(Math.max(Number(d.people) || 1, 1), 200), purpose: s(d.purpose, 600), member: !!d.member,
    };
    if (!r.name) throw 'Add your name so we know who is coming.';
    if (!r.phone && !r.email) throw 'Add a phone number or email so we can confirm.';
    if (!isDate(r.date) || !isTime(r.start) || ![30, 60, 90, 120, 180, 240].includes(r.minutes)) throw 'Pick a date, start time and length.';
    if (toMin(r.start) < 7 * 60 || toMin(r.start) + r.minutes > 21 * 60) throw 'Rooms can be booked 7 AM to 9 PM.';
    return r;
  }
  if (kind === 'tickets') {
    const t = { category: s(d.category, 60), urgency: s(d.urgency, 20), where: s(d.where, 60), details: s(d.details, 1200), name: s(d.name, 80), phone: s(d.phone, 30) };
    if (!t.details) throw 'Tell us what is going on.';
    return t;
  }
  const p = {
    business: s(d.business, 100), name: s(d.name, 80), phone: s(d.phone, 30), email: s(d.email, 120), type: s(d.type, 40),
    slot: s(d.slot, 20), title: s(d.title, 140), topic: s(d.topic, 1500), date1: isDate(d.date1) ? d.date1 : '',
    date2: isDate(d.date2) ? d.date2 : '', audience: s(d.audience, 40), count: Number(d.count) || null, food: !!d.food,
  };
  if (!p.business || !p.name) throw 'Add your business and your name.';
  if (!p.phone && !p.email) throw 'Add a phone number or email so we can reach you.';
  if (!p.topic) throw 'Tell us a little about what you would share.';
  return p;
}

function isAdmin(req) {
  const want = process.env.ADMIN_KEY || '';
  const got = String(req.headers['x-admin-key'] || '');
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function notify(kind, rec) {
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return;
  const label = { requests: 'Room request', tickets: 'Help request', proposals: 'Event pitch' }[kind];
  const who = rec.name || rec.business || 'Someone';
  const lines = Object.entries(rec).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join('\n');
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Heights House <onboarding@resend.dev>', to: to.split(','), subject: `${label} from ${who}`, text: `${lines}\n\nApprove it at ${process.env.SITE_URL || ''}/#staff` }),
    });
  } catch {}
}

const publicSchedule = reqs => reqs.filter(r => r.status === 'approved')
  .map(r => ({ space: r.space, date: r.date, start: r.start, minutes: r.minutes }));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const a = req.query.a;
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const send = (code, obj) => res.status(code).json(obj);
  try {
    if (req.method === 'GET' && a === 'public') {
      const [events, reqs] = await Promise.all([all('events'), all('requests')]);
      return send(200, { events, schedule: publicSchedule(reqs) });
    }
    if (req.method === 'POST' && a === 'submit') {
      const kind = SUBMIT[body.kind];
      if (!kind) return send(400, { error: 'Unknown form.' });
      if (body.hp) return send(200, { id: newId() }); // honeypot: pretend success
      let rec;
      try { rec = clean(kind, body.data || {}); } catch (m) { return send(400, { error: String(m) }); }
      if (kind === 'requests') {
        const sched = publicSchedule(await all('requests'));
        if (sched.some(b => overlap(b, rec))) return send(409, { error: 'That time overlaps a booking for this room. Pick another slot.' });
      }
      rec.status = 'new'; if (kind === 'requests') rec.status = 'pending';
      rec.createdAt = new Date().toISOString();
      const id = newId();
      await save(kind, id, rec);
      await notify(kind, rec);
      return send(200, { id });
    }
    if (req.method === 'POST' && a === 'status') {
      // Visitors see the status of their own items by id (ids are unguessable).
      const out = {};
      for (const [k, ids] of Object.entries(body.ids || {})) {
        const kind = SUBMIT[k]; if (!kind || !Array.isArray(ids)) continue;
        out[k] = (await Promise.all(ids.filter(okId).slice(0, 30).map(async id => {
          const v = await load(kind, id);
          if (!v) return null;
          const pick = { id, status: v.status };
          for (const f of ['space', 'date', 'start', 'minutes', 'category', 'where', 'details', 'title', 'type', 'date1', 'createdAt']) if (v[f] != null) pick[f] = v[f];
          return pick;
        }))).filter(Boolean);
      }
      return send(200, out);
    }
    if (req.method === 'POST' && a === 'cancel') {
      if (!okId(body.id)) return send(400, { error: 'Bad id.' });
      const v = await load('requests', body.id);
      if (!v || v.status !== 'pending') return send(400, { error: 'Only pending requests can be cancelled.' });
      await save('requests', body.id, { ...v, status: 'cancelled', decidedAt: new Date().toISOString() });
      return send(200, { ok: true });
    }

    // ---- staff only ----
    if (a === 'admin' || a === 'op') {
      if (!isAdmin(req)) return send(401, { error: 'That passcode did not work.' });
      if (req.method === 'GET' && a === 'admin') {
        const [events, requests, tickets, proposals] = await Promise.all(KINDS.map(all));
        return send(200, { events, requests, tickets, proposals, schedule: publicSchedule(requests) });
      }
      if (req.method === 'POST' && a === 'op') {
        const { op, id } = body; const now = new Date().toISOString();
        if (op === 'addEvent') {
          const e = body.event || {};
          const ev = { title: s(e.title, 140), type: s(e.type, 40), date: e.date, start: isTime(e.start) ? e.start : '', end: isTime(e.end) ? e.end : '', location: s(e.location, 60), details: s(e.details, 1500) };
          if (!ev.title || !isDate(ev.date)) return send(400, { error: 'Give the event a name and a date.' });
          await save('events', newId(), ev); return send(200, { ok: true });
        }
        if (!okId(id)) return send(400, { error: 'Bad id.' });
        if (op === 'removeEvent') { await del(path('events', id)); return send(200, { ok: true }); }
        const kind = { setRequest: 'requests', setTicket: 'tickets', setProposal: 'proposals', acceptProposal: 'proposals' }[op];
        if (!kind) return send(400, { error: 'Unknown action.' });
        const v = await load(kind, id); if (!v) return send(404, { error: 'Not found.' });
        const status = op === 'acceptProposal' ? 'accepted' : s(body.status, 20);
        if (op === 'setRequest' && status === 'approved') {
          const sched = publicSchedule(await all('requests'));
          if (sched.some(b => overlap(b, v))) return send(409, { error: 'That overlaps a booking that is already approved.' });
        }
        if (op === 'acceptProposal') {
          const e = body.event || {};
          await save('events', newId(), { title: s(e.title, 140), type: s(e.type, 40), date: v.date1, start: isTime(e.start) ? e.start : '', end: isTime(e.end) ? e.end : '', location: 'Heights House', details: s(v.topic, 1500) });
        }
        await save(kind, id, { ...v, status, decidedAt: now });
        return send(200, { ok: true });
      }
    }
    return send(404, { error: 'Not found.' });
  } catch (e) {
    console.error(e);
    return send(500, { error: 'Something went wrong on our end. Try again in a moment.' });
  }
}
