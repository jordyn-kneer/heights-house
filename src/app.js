(() => {
  const $ = s => document.querySelector(s);
  function h(tag, attrs, ...kids){
    const el = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})){
      if (v==null || v===false) continue;
      if (k==='class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v===true ? '' : v);
    }
    for (const c of kids.flat()) if (c!=null && c!==false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const pad = n => String(n).padStart(2,'0');
  const toMin = t => { const [a,b] = String(t).split(':').map(Number); return a*60+(b||0); };
  const fmtT = m => { let hh=Math.floor(m/60), mm=m%60; const ap=hh>=12?'PM':'AM'; hh=hh%12||12; return hh+':'+pad(mm)+' '+ap; };
  const localISO = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const fmtD = iso => new Date(iso+'T00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const spaceOf = b => b.space || 'Conference room';
  const overlap = (a,b) => spaceOf(a)===spaceOf(b) && a.date===b.date && toMin(a.start) < toMin(b.start)+b.minutes && toMin(b.start) < toMin(a.start)+a.minutes;
  const say = (sel, text, err) => { const m=$(sel); m.textContent=text; m.className='msg '+(err?'err':'good'); };
  const DAY_START=7*60, DAY_END=21*60, SPAN=DAY_END-DAY_START;
  const TYPE_COLOR = {'Training':'var(--tomato)','Open work day':'var(--sun)','Coffee + lunch':'var(--sky)','Get-together':'var(--mint)','Other':'var(--lilac)'};

  // ---- storage helpers (per-browser: remembers what this visitor sent) ----
  const ls = { get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
               set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
               del(k){ try { localStorage.removeItem(k); } catch {} } };
  const MINE_KEY = 'hh-mine';
  const mineIds = () => ls.get(MINE_KEY, {request:[], ticket:[], proposal:[]});
  const remember = (kind, id) => { const m = mineIds(); (m[kind] ||= []).unshift(id); m[kind] = m[kind].slice(0,30); ls.set(MINE_KEY, m); };
  const me = ls.get('hh-me', {});
  const rememberMe = o => { Object.assign(me, Object.fromEntries(Object.entries(o).filter(([,v])=>v))); ls.set('hh-me', me); };

  // ---- API ----
  let adminKey = ls.get('hh-staff', '');
  async function api(a, {method='GET', body, admin=false}={}){
    const headers = {'Content-Type':'application/json'};
    if (admin) headers['x-admin-key'] = adminKey;
    const r = await fetch('/api/hh?a='+a, {method, headers, body: body ? JSON.stringify(body) : undefined});
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(data.error || 'Something went wrong. Try again in a moment.'); e.status = r.status; throw e; }
    return data;
  }

  let isAdmin=false, loaded=false, events=[], schedule=[], myItems=[], allItems=[], selDate=localISO(new Date());
  let myTk=[], allTk=[], myPr=[], allPr=[];

  for (let m=DAY_START; m<DAY_END; m+=30) $('#b-start').append(h('option',{value:pad(Math.floor(m/60))+':'+pad(m%60)}, fmtT(m)));
  $('#b-start').value='09:00'; $('#b-date').value=selDate; $('#b-date').min=selDate; $('#ev-date').value=selDate;
  ['b-date','b-start','b-len','b-space'].forEach(id => $('#'+id).addEventListener('change', () => { selDate=$('#b-date').value||selDate; renderTimeline(); }));
  // prefill contact fields this visitor used before
  [['b-name','name'],['b-phone','phone'],['b-email','email'],['b-company','company'],['tk-name','name'],['tk-phone','phone'],['pr-name','name'],['pr-phone','phone'],['pr-email','email'],['pr-biz','company']]
    .forEach(([id,k]) => { const el=$('#'+id); if (el && me[k] && !el.value) el.value=me[k]; });

  // ---- calendar ----
  let mcMonth = new Date(); mcMonth.setDate(1); mcMonth.setHours(0,0,0,0);
  let selDay = null;
  const fmtShort = t => { const m=toMin(t); let hh=Math.floor(m/60); const ap=hh>=12?'p':'a'; hh=hh%12||12; return hh+(m%60?':'+pad(m%60):'')+ap; };
  const fmtLong = iso => new Date(iso+'T00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  function renderMonth(){
    const g=$('#mcGrid'); g.replaceChildren();
    $('#mcTitle').textContent = mcMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>g.append(h('div',{class:'mc-dow'},d)));
    const offset=mcMonth.getDay();
    const days=new Date(mcMonth.getFullYear(), mcMonth.getMonth()+1, 0).getDate();
    const cells=Math.ceil((offset+days)/7)*7;
    const start=new Date(mcMonth); start.setDate(1-offset);
    const todayISO=localISO(new Date());
    for (let i=0;i<cells;i++){
      const d=new Date(start); d.setDate(start.getDate()+i); const iso=localISO(d);
      const evs=events.filter(e=>e.date===iso).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
      g.append(h('button',{type:'button',class:'mc-day'+(d.getMonth()===mcMonth.getMonth()?'':' out')+(iso===todayISO?' today':'')+(iso===selDay?' sel':''),'aria-label':fmtLong(iso)+(evs.length?', '+evs.length+(evs.length===1?' event':' events'):''),onclick:()=>{ selDay=iso; if (isAdmin) $('#ev-date').value=iso; renderEvents(); }},
        h('span',{class:'mc-num'},String(d.getDate())),
        evs.slice(0,3).map(e=>h('span',{class:'mc-chip',style:'background:'+(TYPE_COLOR[e.type]||TYPE_COLOR.Other)}, (e.start?fmtShort(e.start)+' ':'')+e.title)),
        evs.length>3 ? h('span',{class:'mc-more'},'+'+(evs.length-3)+' more') : null));
    }
  }
  $('#mcPrev').addEventListener('click',()=>{ mcMonth.setMonth(mcMonth.getMonth()-1); renderMonth(); });
  $('#mcNext').addEventListener('click',()=>{ mcMonth.setMonth(mcMonth.getMonth()+1); renderMonth(); });
  $('#mcToday').addEventListener('click',()=>{ mcMonth=new Date(); mcMonth.setDate(1); mcMonth.setHours(0,0,0,0); selDay=null; renderEvents(); });
  function renderNext(){
    const el=$('#nextUp'); if (!el) return;
    const today=localISO(new Date());
    const nx=[...events].filter(e=>e.date>=today).sort((a,b)=>(a.date+(a.start||'')).localeCompare(b.date+(b.start||'')))[0];
    if (!nx){ el.hidden=true; return; }
    const d=new Date(nx.date+'T00:00');
    const time = nx.start ? fmtT(toMin(nx.start))+(nx.end ? '–'+fmtT(toMin(nx.end)) : '') : 'All day';
    el.replaceChildren(
      h('span',{class:'eyebrow'},'Next up at the house'),
      h('div',{class:'nx-row'},
        h('div',{class:'dblock',style:'background:'+(TYPE_COLOR[nx.type]||TYPE_COLOR.Other)}, h('span',{},d.toLocaleDateString(undefined,{weekday:'short'})), h('b',{},String(d.getDate()))),
        h('div',{class:'evbody'}, h('span',{class:'evtype'}, nx.type||'Event'), h('h4',{}, nx.title), h('p',{class:'evmeta'}, [fmtLong(nx.date), time, nx.location].filter(Boolean).join(' · ')))));
    el.hidden=false;
  }
  function renderEvents(){
    renderMonth();
    renderNext();
    const box=$('#evList'); box.replaceChildren();
    const today=localISO(new Date());
    const sorted=[...events].sort((a,b)=>(a.date+(a.start||'')).localeCompare(b.date+(b.start||'')));
    const up = selDay ? sorted.filter(e=>e.date===selDay) : sorted.filter(e=>e.date>=today);
    $('#listTitle').replaceChildren(selDay ? fmtLong(selDay) : 'Coming up', selDay ? h('button',{class:'linkish',type:'button',style:'margin-left:.7rem;font-family:var(--body)',onclick:()=>{ selDay=null; renderEvents(); }},'Show all upcoming') : null);
    if (!up.length){ box.append(h('div',{class:'empty'}, !loaded ? 'Loading the calendar…' : selDay ? (isAdmin ? 'Nothing on this day yet. Use the form to add an event.' : 'Nothing on this day.') : (isAdmin ? 'Nothing on the calendar yet. Tap a day, then add the first event.' : 'Nothing on the calendar yet. Check back soon.'))); return; }
    let cur='';
    for (const e of up){
      const d=new Date(e.date+'T00:00');
      const mon=d.toLocaleDateString(undefined,{month:'long',year:'numeric'});
      if (mon!==cur){ cur=mon; box.append(h('h3',{class:'mon'},mon)); }
      const time = e.start ? fmtT(toMin(e.start))+(e.end ? '–'+fmtT(toMin(e.end)) : '') : 'All day';
      box.append(h('article',{class:'evc'},
        h('div',{class:'dblock',style:'background:'+(TYPE_COLOR[e.type]||TYPE_COLOR.Other)}, h('span',{},d.toLocaleDateString(undefined,{weekday:'short'})), h('b',{},String(d.getDate()))),
        h('div',{class:'evbody'}, h('span',{class:'evtype'}, e.type||'Event'), h('h4',{}, e.title), h('p',{class:'evmeta'}, [time, e.location].filter(Boolean).join(' · ')), e.details ? h('p',{}, e.details) : null),
        isAdmin ? h('button',{class:'linkish',type:'button',onclick:ev=>removeEvent(e, ev.currentTarget)},'Remove') : null));
    }
  }
  async function removeEvent(e, btn){
    if (btn.dataset.armed!=='1'){ btn.dataset.armed='1'; btn.textContent='Click again to remove'; return; }
    btn.disabled=true;
    try { await api('op',{method:'POST',admin:true,body:{op:'removeEvent',id:e.id}}); await refresh(); } catch { btn.disabled=false; btn.textContent='Remove'; }
  }
  $('#evForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const e = { title:$('#ev-title').value.trim(), type:$('#ev-type').value, date:$('#ev-date').value, start:$('#ev-start').value, end:$('#ev-end').value, location:$('#ev-loc').value, details:$('#ev-details').value.trim() };
    if (!e.title){ say('#ev-msg','Give the event a name.',true); return; }
    if (!e.date){ say('#ev-msg','Pick a date.',true); return; }
    if (e.start && e.end && toMin(e.end) <= toMin(e.start)){ say('#ev-msg','The end time needs to be after the start time.',true); return; }
    const btn=$('#ev-submit'); btn.disabled=true;
    try { await api('op',{method:'POST',admin:true,body:{op:'addEvent',event:e}}); $('#ev-title').value=''; $('#ev-details').value=''; say('#ev-msg','Added to the calendar.',false); await refresh(); }
    catch (x) { say('#ev-msg', x.message || 'That event didn\'t save. Try again in a moment.',true); }
    btn.disabled=false;
  });

  // ---- room booking ----
  function renderTimeline(){
    const space=$('#b-space').value;
    $('#tlTitle').textContent = space+' · next 14 days';
    const box=$('#timeline'); box.replaceChildren();
    const axis=h('div',{class:'tl-axis'});
    for (let m=DAY_START; m<=DAY_END; m+=120) axis.append(h('span',{style:'left:'+((m-DAY_START)/SPAN*100)+'%'}, fmtT(m).replace(':00','').replace(' ','').toLowerCase()));
    box.append(h('div',{class:'tl-row'}, h('span'), axis));
    const today=new Date(); today.setHours(0,0,0,0);
    const draft={space, date:$('#b-date').value, start:$('#b-start').value, minutes:+$('#b-len').value};
    for (let i=0;i<14;i++){
      const d=new Date(today); d.setDate(d.getDate()+i); const iso=localISO(d);
      const bar=h('div',{class:'tl-bar'});
      for (let m=DAY_START+120; m<DAY_END; m+=120) bar.append(h('span',{class:'tick',style:'left:'+((m-DAY_START)/SPAN*100)+'%'}));
      const place=(b,cls,title)=>{ const s=Math.max(toMin(b.start),DAY_START), e=Math.min(toMin(b.start)+b.minutes,DAY_END); if (e<=s) return; bar.append(h('span',{class:'blk '+cls,title,style:'left:'+((s-DAY_START)/SPAN*100)+'%;width:'+((e-s)/SPAN*100)+'%'})); };
      schedule.filter(b=>b.date===iso && spaceOf(b)===space).forEach(b=>place(b,'approved','Booked '+fmtT(toMin(b.start))+'–'+fmtT(toMin(b.start)+b.minutes)));
      myItems.filter(r=>r.date===iso && r.status==='pending' && spaceOf(r)===space).forEach(r=>place(r,'pending','Your pending request'));
      if (draft.date===iso) place(draft,'draft','Your selection');
      box.append(h('div',{class:'tl-row'}, h('button',{type:'button',class:'tl-day'+(iso===selDate?' sel':''),onclick:()=>{ selDate=iso; $('#b-date').value=iso; renderTimeline(); }}, i===0?'Today':fmtD(iso)), bar));
    }
  }
  function renderMine(){
    const ul=$('#mine'); ul.replaceChildren();
    const list=[...myItems].filter(r=>r.date).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
    if (!list.length){ ul.append(h('li',{class:'empty'}, 'No requests from this device yet. Pick a room and a time, then send one.')); return; }
    for (const r of list){
      ul.append(h('li',{}, h('span',{}, h('strong',{}, spaceOf(r)+' · '+fmtD(r.date)), ' · '+fmtT(toMin(r.start))+'–'+fmtT(toMin(r.start)+r.minutes)),
        h('span',{style:'display:flex;gap:.5rem;align-items:center'}, h('span',{class:'status '+r.status}, r.status), r.status==='pending' ? h('button',{class:'sbtn ghost small',type:'button',onclick:e=>cancelMine(r,e.currentTarget)},'Cancel') : null)));
    }
  }
  async function cancelMine(r, btn){
    btn.disabled=true;
    try { await api('cancel',{method:'POST',body:{id:r.id}}); await refresh(); } catch (x) { btn.disabled=false; say('#b-msg', x.message, true); }
  }
  function renderQueue(){
    if (!isAdmin) return;
    const pend=allItems.filter(r=>r.status==='pending').sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
    const c=$('#qcount'); c.hidden=!pend.length; c.textContent=pend.length;
    const q=$('#queue'); q.replaceChildren();
    if (!pend.length){ q.append(h('div',{class:'empty'},'Nothing waiting. New requests show up here.')); return; }
    for (const r of pend){
      const clash=schedule.find(b=>overlap(b,r));
      q.append(h('div',{class:'req'+(clash?' conflict':'')},
        h('div',{class:'meta'},
          h('strong',{}, r.name || 'Someone', r.company ? h('span',{style:'font-weight:400;color:var(--muted)'},' · '+r.company) : null),
          h('span',{class:'when'}, spaceOf(r)+' · '+fmtD(r.date)+' · '+fmtT(toMin(r.start))+'–'+fmtT(toMin(r.start)+r.minutes)+' · '+(r.people||1)+' people · '+(r.member?'member':'non-member')),
          r.purpose ? h('span',{}, r.purpose) : null,
          (r.phone||r.email) ? h('span',{style:'color:var(--muted)'}, [r.phone, r.email].filter(Boolean).join(' · ')) : null,
          clash ? h('span',{class:'warn'},'Overlaps a booking that is already approved') : null),
        h('div',{class:'actions'},
          h('button',{class:'sbtn ok small',type:'button',disabled:!!clash,onclick:e=>staffSet('setRequest',r.id,'approved',e.currentTarget,'#b-msg')},'Approve'),
          h('button',{class:'sbtn ghost small',type:'button',onclick:e=>staffSet('setRequest',r.id,'declined',e.currentTarget,'#b-msg')},'Decline'))));
    }
  }
  async function staffSet(op, id, status, btn, msgSel){
    btn.disabled=true;
    try { await api('op',{method:'POST',admin:true,body:{op,id,status}}); await refresh(); }
    catch (x) { btn.disabled=false; say(msgSel, x.message || 'That change did not save. Try again in a moment.', true); }
  }
  async function submit(kind, data, msgSel, btnSel, okText){
    const btn=$(btnSel); btn.disabled=true;
    try {
      const {id} = await api('submit',{method:'POST',body:{kind, data, hp: $('#hp-'+kind)?.value || ''}});
      remember(kind, id); say(msgSel, okText, false); await refresh(); btn.disabled=false; return true;
    } catch (x) { say(msgSel, x.message, true); btn.disabled=false; return false; }
  }
  $('#bookForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const r={ space:$('#b-space').value, name:$('#b-name').value.trim(), company:$('#b-company').value.trim(), phone:$('#b-phone').value.trim(), email:$('#b-email').value.trim(), date:$('#b-date').value, start:$('#b-start').value, minutes:+$('#b-len').value, people:+$('#b-people').value||1, purpose:$('#b-purpose').value.trim(), member:$('#b-member').checked };
    if (!r.name){ say('#b-msg','Add your name so we know who is coming.',true); return; }
    if (!r.phone && !r.email){ say('#b-msg','Add a phone number or email so we can confirm.',true); return; }
    if (!r.date || r.date < localISO(new Date())){ say('#b-msg','Pick today or a future date.',true); return; }
    if (toMin(r.start)+r.minutes > DAY_END){ say('#b-msg','That runs past 9 PM. Pick an earlier start or a shorter block.',true); return; }
    if (schedule.some(b=>overlap(b,r))){ say('#b-msg','That time overlaps a booking for this room. Pick another slot.',true); return; }
    rememberMe({name:r.name, phone:r.phone, email:r.email, company:r.company});
    if (await submit('request', r, '#b-msg', '#b-submit', 'Request sent. It shows as pending below until Jordyn or Jordan approves it.')) $('#b-purpose').value='';
  });

  // ---- help tickets ----
  const URG={'Whenever':'var(--sky)','This week':'var(--sun)','Today':'var(--tomato)'};
  const TK_LABEL={new:'new', working:'on it', done:'done'};
  const TK_CLASS={new:'declined', working:'pending', done:'approved'};
  function renderTickets(){
    const ul=$('#tkMine'); ul.replaceChildren();
    const mine=[...myTk].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    if (!mine.length) ul.append(h('li',{class:'empty'}, 'Nothing sent from this device yet.'));
    for (const t of mine) ul.append(h('li',{}, h('span',{style:'min-width:0'}, h('strong',{}, t.category), ' · '+(t.where||'')+(t.details ? ' · '+t.details : '')), h('span',{class:'status '+(TK_CLASS[t.status]||'declined')}, TK_LABEL[t.status]||'new')));
    if (!isAdmin) return;
    const rank={'Today':0,'This week':1,'Whenever':2};
    const open=allTk.filter(t=>t.status!=='done').sort((a,b)=>((rank[a.urgency]??3)-(rank[b.urgency]??3)) || (a.createdAt||'').localeCompare(b.createdAt||''));
    const c=$('#tkCount'); c.hidden=!open.length; c.textContent=open.length;
    const q=$('#tkQueue'); q.replaceChildren();
    if (!open.length){ q.append(h('div',{class:'empty'},'All caught up. New requests show up here.')); return; }
    for (const t of open){
      q.append(h('div',{class:'req',style:'border-left-color:'+(URG[t.urgency]||'var(--sun)')},
        h('div',{class:'meta'},
          h('strong',{}, t.category+' · '+(t.where||'')),
          h('span',{class:'when'}, [t.urgency, t.name||'Someone', t.phone, t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')),
          t.details ? h('span',{}, t.details) : null,
          t.status==='working' ? h('span',{class:'evtype'},'On it') : null),
        h('div',{class:'actions'},
          t.status!=='working' ? h('button',{class:'sbtn ghost small',type:'button',onclick:e=>staffSet('setTicket',t.id,'working',e.currentTarget,'#tk-msg')},'On it') : null,
          h('button',{class:'sbtn ok small',type:'button',onclick:e=>staffSet('setTicket',t.id,'done',e.currentTarget,'#tk-msg')},'Done'))));
    }
  }
  $('#tkForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const t={ category:$('#tk-cat').value, urgency:$('#tk-urg').value, where:$('#tk-where').value, details:$('#tk-details').value.trim(), name:$('#tk-name').value.trim(), phone:$('#tk-phone').value.trim() };
    if (!t.details){ say('#tk-msg','Tell us what is going on.',true); return; }
    rememberMe({name:t.name, phone:t.phone});
    if (await submit('ticket', t, '#tk-msg', '#tk-submit', 'Sent. You will see it update below.')) $('#tk-details').value='';
  });

  // ---- event pitches ----
  const SLOT={'Breakfast':['08:00','09:00'],'Lunch':['11:30','12:30'],'Afternoon':['14:00','15:00'],'Evening':['17:00','18:30']};
  const PR_EVTYPE={'Lunch and learn':'Training','Breakfast':'Coffee + lunch','Afternoon session':'Training','Workshop':'Training','Happy hour':'Get-together'};
  const PR_LABEL={new:'new', accepted:'on the calendar', declined:'not this time'};
  const PR_CLASS={new:'pending', accepted:'approved', declined:'declined'};
  function renderProposals(){
    const ul=$('#prMine'); ul.replaceChildren();
    const mine=[...myPr].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    if (!mine.length) ul.append(h('li',{class:'empty'}, 'No pitches from this device yet.'));
    for (const p of mine) ul.append(h('li',{}, h('span',{style:'min-width:0'}, h('strong',{}, p.title||p.type), p.date1 ? ' · '+fmtD(p.date1) : ''), h('span',{class:'status '+(PR_CLASS[p.status]||'pending')}, PR_LABEL[p.status]||'new')));
    if (!isAdmin) return;
    const open=allPr.filter(p=>p.status==='new').sort((a,b)=>(a.date1||'9').localeCompare(b.date1||'9'));
    const c=$('#prCount'); c.hidden=!open.length; c.textContent=open.length;
    const q=$('#prQueue'); q.replaceChildren();
    if (!open.length){ q.append(h('div',{class:'empty'},'No new pitches. They show up here when a business sends one.')); return; }
    for (const p of open){
      const clash = p.date1 && events.some(e=>e.date===p.date1);
      q.append(h('div',{class:'req'},
        h('div',{class:'meta'},
          h('strong',{}, (p.business||'A business')+' · '+p.type),
          h('span',{class:'when'}, [p.date1 ? fmtD(p.date1) : 'No date yet', p.date2 ? 'backup '+fmtD(p.date2) : '', p.slot, (p.audience||'')+(p.count ? ' · ~'+p.count+' people' : ''), p.food ? 'bringing food' : ''].filter(Boolean).join(' · ')),
          p.title ? h('span',{style:'font-weight:700'}, p.title) : null,
          p.topic ? h('span',{}, p.topic) : null,
          h('span',{style:'color:var(--muted)'}, [p.name, p.phone, p.email].filter(Boolean).join(' · ')),
          clash ? h('span',{class:'warn'},'Something is already on the calendar that day') : null),
        h('div',{class:'actions'},
          h('button',{class:'sbtn ok small',type:'button',disabled:!p.date1,onclick:e=>acceptPr(p,e.currentTarget)},'Add to calendar'),
          h('button',{class:'sbtn ghost small',type:'button',onclick:e=>staffSet('setProposal',p.id,'declined',e.currentTarget,'#pr-msg')},'Decline'))));
    }
  }
  async function acceptPr(p, btn){
    btn.disabled=true;
    const [s,e]=SLOT[p.slot]||['',''];
    try { await api('op',{method:'POST',admin:true,body:{op:'acceptProposal',id:p.id,event:{ title:(p.title||p.type)+(p.business ? ' with '+p.business : ''), type:PR_EVTYPE[p.type]||'Other', start:s, end:e }}}); await refresh(); }
    catch (x) { btn.disabled=false; say('#pr-msg', x.message || 'Could not add that one to the calendar. Try again in a moment.',true); }
  }
  $('#prForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const p={ business:$('#pr-biz').value.trim(), name:$('#pr-name').value.trim(), phone:$('#pr-phone').value.trim(), email:$('#pr-email').value.trim(), type:$('#pr-type').value, slot:$('#pr-slot').value, title:$('#pr-title').value.trim(), topic:$('#pr-topic').value.trim(), date1:$('#pr-date1').value, date2:$('#pr-date2').value, audience:$('#pr-aud').value, count:+$('#pr-count').value||null, food:$('#pr-food').checked };
    if (!p.business || !p.name){ say('#pr-msg','Add your business and your name.',true); return; }
    if (!p.phone && !p.email){ say('#pr-msg','Add a phone number or email so we can reach you.',true); return; }
    if (!p.topic){ say('#pr-msg','Tell us a little about what you would share.',true); return; }
    if (p.date1 && p.date1 < localISO(new Date())){ say('#pr-msg','Pick a date that has not passed yet.',true); return; }
    rememberMe({name:p.name, phone:p.phone, email:p.email, company:p.business});
    if (await submit('proposal', p, '#pr-msg', '#pr-submit', 'Pitch sent. We will reach out to plan it with you.')) { $('#pr-topic').value=''; $('#pr-title').value=''; }
  });

  // ---- staff sign-in ----
  function showStaff(on){
    isAdmin = on;
    ['#evAdmin','#adminQueue','#tkAdmin','#prAdmin','#staffBar'].forEach(s => { const el=$(s); if (el) el.hidden = !on; });
  }
  $('#staffForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    adminKey = $('#staff-key').value.trim();
    const btn=$('#staff-submit'); btn.disabled=true;
    try { await api('admin',{admin:true}); ls.set('hh-staff', adminKey); $('#staff-key').value=''; showStaff(true); await refresh(); location.hash='#book'; }
    catch (x) { adminKey=''; say('#staff-msg', x.status===401 ? 'That passcode did not work.' : x.message, true); }
    btn.disabled=false;
  });
  $('#staffOut')?.addEventListener('click', () => { adminKey=''; ls.del('hh-staff'); showStaff(false); refresh(); });

  // ---- load ----
  async function loadMine(){
    const ids = mineIds();
    if (!(ids.request?.length || ids.ticket?.length || ids.proposal?.length)) return;
    try {
      const out = await api('status',{method:'POST',body:{ids}});
      myItems = out.request || []; myTk = out.ticket || []; myPr = out.proposal || [];
    } catch {}
  }
  async function refresh(){
    try {
      if (isAdmin){
        const d = await api('admin',{admin:true});
        events=d.events; schedule=d.schedule; allItems=d.requests; allTk=d.tickets; allPr=d.proposals;
      } else {
        const d = await api('public');
        events=d.events; schedule=d.schedule;
      }
    } catch (x) { if (x.status===401){ adminKey=''; ls.del('hh-staff'); showStaff(false); return refresh(); } }
    await loadMine();
    loaded=true;
    renderEvents(); renderTimeline(); renderMine(); renderQueue(); renderTickets(); renderProposals();
  }
  renderTimeline(); renderMine(); renderMonth(); renderTickets(); renderProposals();
  showStaff(!!adminKey);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
})();
