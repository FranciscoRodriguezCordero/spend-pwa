
// ====== Storage ======
const LS_ENTRIES = 'spend.entries.v1';
const LS_SETTINGS = 'spend.settings.v1';

function loadEntries() { try { return JSON.parse(localStorage.getItem(LS_ENTRIES) || '[]'); } catch { return []; } }
function saveEntries(v) { localStorage.setItem(LS_ENTRIES, JSON.stringify(v)); }
function loadSettings() {
  try { const v = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null'); if (v) return v; } catch {}
  return { currency:'USD', budgetWarning:null, budgetPeriod:'month', income:null, saveTarget:null, savePeriod:'month' };
}
function saveSettings(v) { localStorage.setItem(LS_SETTINGS, JSON.stringify(v)); }

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function fmtCurrency(code, n) { try { return new Intl.NumberFormat(undefined,{style:'currency',currency:code}).format(n); } catch { return `${code} ${n.toFixed(2)}`; } }
function startOfPeriod(d, period) {
  const x = new Date(d);
  if (period==='day'){ x.setHours(0,0,0,0); return x; }
  if (period==='week'){ const diff=(x.getDay()+6)%7; x.setDate(x.getDate()-diff); x.setHours(0,0,0,0); return x; }
  if (period==='month'){ x.setDate(1); x.setHours(0,0,0,0); return x; }
  x.setMonth(0,1); x.setHours(0,0,0,0); return x;
}

let state = {
  tab: 'add',
  entries: loadEntries(),
  settings: loadSettings(),
};

// ====== App Shell ======
const root = document.getElementById('app');
function render() {
  root.innerHTML = '';
  const container = el('div',{class:'container'});

  const header = el('div',{class:'header'},
    el('h1',{},'Spending Tracker'),
    el('div',{class:'tabs'},
      tabBtn('Add','add'),
      tabBtn('Analytics','analytics'),
      tabBtn('Export','export'),
      tabBtn('Settings','settings'),
    )
  );
  container.appendChild(header);

  // Budget banner
  const now = new Date();
  const ps = startOfPeriod(now, state.settings.budgetPeriod || 'month');
  const within = state.entries.filter(e => new Date(e.timestamp) >= ps);
  const mtd = within.reduce((s,e)=>s+e.amount,0);
  const bw = state.settings.budgetWarning;
  if (bw != null) {
    const over = mtd > bw;
    container.appendChild(el('div',{class:`banner ${over?'warn':'ok'}`},
      over
        ? `Warning: ${state.settings.budgetPeriod.toUpperCase()} spend ${fmtCurrency(state.settings.currency, mtd)} exceeds ${fmtCurrency(state.settings.currency, bw)}`
        : `${state.settings.budgetPeriod.toUpperCase()} spend ${fmtCurrency(state.settings.currency, mtd)} / ${fmtCurrency(state.settings.currency, bw)}`
    ));
  }

  if (state.tab==='add') container.appendChild(viewAdd());
  if (state.tab==='analytics') container.appendChild(viewAnalytics());
  if (state.tab==='export') container.appendChild(viewExport());
  if (state.tab==='settings') container.appendChild(viewSettings());
  root.appendChild(container);
}

function tabBtn(label, key) {
  return el('button', {class:`tab ${state.tab===key?'active':''}`, onclick:()=>{state.tab=key; render();}}, label);
}

// ====== Views ======
function viewAdd() {
  const wrap = el('div', {class:'grid', style:'gap:12px;'});
  // input row
  const row = el('div',{class:'row'},
    input({placeholder:'Description', id:'desc'}),
    input({placeholder:'Amount', id:'amt', onkeydown:(e)=>{ if(e.key==='Enter') addEntry(); }}),
    button('Add', addEntry, 'primary')
  );
  wrap.appendChild(row);

  // table
  const card = el('div',{class:'card'},
    el('div',{class:'title'},'Recent Transactions'),
    el('div',{class:'body'},
      table(['Description','Amount','Timestamp',''], state.entries.map(e => [
        e.description,
        {html: fmtCurrency(state.settings.currency, e.amount), align:'right'},
        new Date(e.timestamp).toLocaleString(),
        {html: `<button class="tab" style="background:#1a1a1a" data-id="${e.id}">Delete</button>`, align:'right'}
      ]))
    )
  );
  wrap.appendChild(card);

  setTimeout(()=>{
    // Attach delete handlers
    document.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        state.entries = state.entries.filter(x => x.id !== id);
        saveEntries(state.entries); render();
      });
    });
  },0);

  return wrap;

  function addEntry() {
    const desc = document.getElementById('desc').value.trim();
    const amt = Number(document.getElementById('amt').value);
    if (!desc || !isFinite(amt) || amt <= 0) return;
    const entry = { id: uid(), description: desc, amount: amt, timestamp: new Date().toISOString() };
    state.entries = [entry, ...state.entries];
    saveEntries(state.entries);
    document.getElementById('desc').value = '';
    document.getElementById('amt').value = '';
    render();
  }
}

function viewAnalytics() {
  const wrap = el('div', {class:'grid', style:'gap:12px;'});
  // stats
  const monthStart = startOfPeriod(new Date(),'month');
  const mtd = state.entries.filter(e => new Date(e.timestamp) >= monthStart).reduce((s,e)=>s+e.amount,0);
  const daysElapsed = Math.max(1, new Date().getDate());
  const dailyAvg = mtd / daysElapsed;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const projected = dailyAvg * daysInMonth;

  const stats = el('div',{class:'grid cols-2'},
    stat('Entries', String(state.entries.length)),
    stat('MTD', fmtCurrency(state.settings.currency, mtd)),
    stat('Daily Avg (MTD)', fmtCurrency(state.settings.currency, dailyAvg)),
    stat('Projected (Month)', fmtCurrency(state.settings.currency, projected)),
  );
  wrap.appendChild(stats);

  // simple SVG line chart of daily spend
  const series = groupByDay(state.entries);
  const chart = el('div',{class:'card'},
    el('div',{class:'title'},'Daily Spend'),
    el('div',{class:'body'}, svgLineChart(series))
  );
  wrap.appendChild(chart);

  // savings goal
  const s = state.settings;
  if (s.income != null && s.saveTarget != null) {
    const saveStart = startOfPeriod(new Date(), s.savePeriod || 'month');
    const spent = state.entries.filter(e => new Date(e.timestamp) >= saveStart).reduce((x,e)=>x+e.amount,0);
    const targetSave = s.income * (s.saveTarget/100);
    const allowed = s.income - targetSave;
    const on = spent <= allowed;
    wrap.appendChild(el('div',{class:`banner ${on?'ok':'warn'}`},
      on
        ? `On track: spent ${fmtCurrency(s.currency, spent)} of allowed ${fmtCurrency(s.currency, allowed)} to hit your savings goal.`
        : `Over spend: spent ${fmtCurrency(s.currency, spent)} > allowed ${fmtCurrency(s.currency, allowed)} for your savings goal.`
    ));
  } else {
    wrap.appendChild(el('div',{class:'small'},'Set income and % to save in Settings to see savings status.'));
  }

  return wrap;
}

function viewExport() {
  const wrap = el('div', {class:'grid', style:'gap:12px;'});
  const controls = el('div',{class:'grid cols-2'},
    button('Export CSV', exportCSV),
    button('Export JSON', exportJSON),
  );
  wrap.appendChild(controls);

  const card = el('div',{class:'card'},
    el('div',{class:'title'},'Data Preview'),
    el('div',{class:'body'},
      table(['Description','Amount','Timestamp'], state.entries.map(e => [
        e.description, fmtCurrency(state.settings.currency, e.amount), new Date(e.timestamp).toLocaleString()
      ]))
    )
  );
  wrap.appendChild(card);

  // import
  const importWrap = el('div',{}, 
    el('input',{type:'file', id:'file', accept:'.csv,.json'}),
    button('Import', importFile, 'block')
  );
  wrap.appendChild(importWrap);

  return wrap;

  function exportCSV() {
    const header = 'description,amount,timestamp\n';
    const body = state.entries.map(e => `${csvEscape(e.description)},${e.amount},${e.timestamp}`).join('\n');
    const blob = new Blob([header+body], {type:'text/csv'});
    if (navigator.share && navigator.canShare?.({ files: [new File([], 'x.csv')] })) {
      const file = new File([blob], `spending_${new Date().toISOString().slice(0,10)}.csv`, { type: 'text/csv' });
      navigator.share({ files: [file], title: 'Spending CSV' }).catch(()=>downloadBlob(blob, 'spending.csv'));
    } else {
      downloadBlob(blob, 'spending.csv');
    }
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state.entries,null,2)], {type:'application/json'});
    downloadBlob(blob, 'spending.json');
  }
  function importFile() {
    const f = document.getElementById('file').files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        if (f.name.endsWith('.json')) {
          const arr = JSON.parse(text);
          if (!Array.isArray(arr)) throw new Error('Invalid JSON');
          state.entries = arr.map(x => ({ id: x.id || uid(), description: String(x.description), amount: Number(x.amount), timestamp: x.timestamp || new Date().toISOString() }));
        } else {
          const lines = text.trim().split(/\r?\n/);
          const out = [];
          for (let i=1;i<lines.length;i++) {
            const row = parseCsvLine(lines[i]);
            if (!row) continue;
            const [d,a,t] = row;
            const amt = Number(a);
            if (!d || !isFinite(amt)) continue;
            out.push({ id: uid(), description: d, amount: amt, timestamp: t || new Date().toISOString() });
          }
          state.entries = out;
        }
        saveEntries(state.entries); render();
      } catch(e) { alert('Import failed: '+e.message); }
    };
    reader.readAsText(f);
  }
}

function viewSettings() {
  const s = state.settings;
  const wrap = el('div', {class:'grid', style:'gap:12px;'});
  const budget = el('div',{class:'card'},
    el('div',{class:'title'},'Budget warning'),
    el('div',{class:'body'},
      label('Amount'), input({id:'bw', type:'number', value:s.budgetWarning ?? ''}),
      label('Period'), select({id:'bwPeriod', value:s.budgetPeriod}, ['day','week','month','year']),
      label('Currency code'), input({id:'cur', value:s.currency})
    )
  );
  wrap.appendChild(budget);

  const save = el('div',{class:'card'},
    el('div',{class:'title'},'Savings goal (optional)'),
    el('div',{class:'body'},
      label('Income (after tax)'), input({id:'inc', type:'number', value:s.income ?? ''}),
      label('Target % to save'), input({id:'target', type:'number', value:s.saveTarget ?? ''}),
      label('Savings period'), select({id:'savePeriod', value:s.savePeriod}, ['day','week','month','year']),
      el('div',{class:'small', style:'margin-top:6px;'}, 'Compares spend vs allowed (income − target savings) for chosen period.')
    )
  );
  wrap.appendChild(save);

  wrap.appendChild(button('Save settings', () => {
    const bw = val('bw'); const inc = val('inc'); const t = val('target');
    state.settings = {
      currency: val('cur') || 'USD',
      budgetWarning: bw === '' ? null : Number(bw),
      budgetPeriod: val('bwPeriod'),
      income: inc === '' ? null : Number(inc),
      saveTarget: t === '' ? null : Number(t),
      savePeriod: val('savePeriod')
    };
    saveSettings(state.settings);
    alert('Saved');
    render();
  }, 'primary'));

  return wrap;
}

// ====== Helpers ======
function label(text){ return el('div',{class:'small', style:'margin:6px 0 4px;'}, text); }
function input(attrs){ const i = el('input', attrs); return i; }
function select(attrs, list){ const s = el('select', attrs, ...list.map(x => el('option',{value:x}, x))); return s; }
function button(text, onclick, cls=''){ return el('button',{class:`tab ${cls} ${cls==='primary'?'primary':''}`, onclick}, text); }
function table(headers, rows) {
  const thead = el('thead',{}, el('tr',{}, ...headers.map(h => el('th',{},h))));
  const tbody = el('tbody',{}, ...(rows.length? rows.map(r => el('tr',{}, ...r.map(c => {
    if (typeof c==='object' && c.html) { const td = el('td', {style:`text-align:${c.align||'left'}`}); td.innerHTML = c.html; return td; }
    return el('td',{}, c);
  }))): [el('tr',{}, el('td',{colspan:headers.length},'No data'))]));
  return el('table',{class:'table'}, thead, tbody);
}
function groupByDay(entries) {
  const m = new Map();
  for (const e of entries) {
    const d = e.timestamp.slice(0,10);
    m.set(d, (m.get(d)||0)+e.amount);
  }
  const arr = [...m.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([date,amount])=>({date,amount}));
  return arr;
}
function svgLineChart(series){
  const w = 800, h = 240, pad = 28;
  const svg = elNS('svg',{viewBox:`0 0 ${w} ${h}`});
  if (series.length === 0) { svg.appendChild(elNS('text',{x:12,y:24,fill:'#9ca3af'},'No data. Add entries.')); return svg; }
  const xs = series.map((_,i)=>i); const ys = series.map(p=>p.amount);
  const xmin=0,xmax=xs.length-1, ymin=0, ymax=Math.max(...ys)*1.1 || 1;
  const sx = (i)=> pad + (w-2*pad) * ((i-xmin)/(Math.max(1,xmax-xmin)));
  const sy = (v)=> h-pad - (h-2*pad) * ((v-ymin)/(Math.max(1,ymax-ymin)));
  // grid
  for (let i=0;i<=4;i++){ const y = pad + i*(h-2*pad)/4; svg.appendChild(elNS('line',{x1:pad,y1:y,x2:w-pad,y2:y,stroke:'#1f2937'})); }
  // path
  let d='';
  series.forEach((p,i)=>{ const x=sx(i), y=sy(p.amount); d += (i?'L':'M')+x+','+y; });
  svg.appendChild(elNS('path',{d, fill:'none', stroke:'#10b981', 'stroke-width':2}));
  // axes labels (dates)
  const step = Math.ceil(series.length/6);
  for (let i=0;i<series.length;i+=step){ const x=sx(i); svg.appendChild(elNS('text',{x, y:h-6, fill:'#9ca3af', 'font-size':'10', 'text-anchor':'middle'}, series[i].date.slice(5))); }
  // y max label
  svg.appendChild(elNS('text',{x: w-pad, y: pad-6, fill:'#9ca3af','font-size':'10','text-anchor':'end'}, String(Math.round(ymax))));
  return svg;
}
function csvEscape(s){ return /[\",\n]/.test(s) ? '\"'+s.replace(/\"/g,'\"\"')+'\"' : s; }
function parseCsvLine(line){
  const out=[]; let cur=''; let q=false;
  for(let i=0;i<line.length;i++){ const ch=line[i];
    if(q){ if(ch==='\"' && line[i+1]==='\"'){ cur+='\"'; i++; } else if(ch==='\"'){ q=false; } else { cur+=ch; } }
    else { if(ch===','){ out.push(cur); cur=''; } else if(ch==='\"'){ q=true; } else { cur+=ch; } }
  } out.push(cur); return out;
}
function downloadBlob(blob, filename){
  const a=document.createElement('a'); const url=URL.createObjectURL(blob);
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  URL.revokeObjectURL(url); a.remove();
}
function el(tag, attrs={}, ...children){
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (k==='style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const ch of children) node.appendChild(typeof ch==='string' ? document.createTextNode(ch) : ch);
  return node;
}
function elNS(tag, attrs={}, text){
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k,v] of Object.entries(attrs||{})) node.setAttribute(k, v);
  if (text) node.appendChild(document.createTextNode(text));
  return node;
}

// initial render
render();
