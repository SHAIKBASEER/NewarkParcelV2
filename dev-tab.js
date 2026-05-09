/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   dev-tab.js â€” Data Explorer + SQL Developer Console
   Newark Parcel Intelligence
   
   Reads window.allFeatures and window.filtered from app.js.
   SQL results can be applied globally to re-filter the dashboard.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
(function () {
  'use strict';

  /* â”€â”€ wait for app.js to populate data â”€â”€ */
  function waitForData(cb) {
    if (window.allFeatures && window.allFeatures.length) { cb(); return; }
    const iv = setInterval(() => {
      if (window.allFeatures && window.allFeatures.length) { clearInterval(iv); cb(); }
    }, 300);
  }

  /* â”€â”€ helpers â”€â”€ */
  function el(id) { return document.getElementById(id); }
  function qsa(s) { return [...document.querySelectorAll(s)]; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function money(v) { const n=Number(v||0); if(n>=1e9) return `$${(n/1e9).toFixed(1)}B`; if(n>=1e6) return `$${(n/1e6).toFixed(1)}M`; if(n>=1e3) return `$${(n/1e3).toFixed(0)}K`; return `$${Math.round(n)}`; }
  function fmt(v) { return Number(v||0).toLocaleString(); }

  /* â”€â”€ FIELD DEFINITIONS â”€â”€ */
  const FIELDS = [
    { key: 'id',               label: 'Parcel ID',        type: 'string',  mono: true  },
    { key: 'address',          label: 'Address',          type: 'string'               },
    { key: 'owner',            label: 'Owner',            type: 'string'               },
    { key: 'vacancy',          label: 'Vacancy Status',   type: 'string'               },
    { key: 'ownership',        label: 'Ownership Type',   type: 'string'               },
    { key: 'ownerSubtype',     label: 'Owner Subtype',    type: 'string'               },
    { key: 'ownerConfidence',  label: 'Owner Confidence', type: 'string'               },
    { key: 'opportunity',      label: 'Opp. Score',       type: 'number',  score: true },
    { key: 'assessed',         label: 'Assessed Value',   type: 'number',  money: true },
    { key: 'landValue',        label: 'Land Value',       type: 'number',  money: true },
    { key: 'improvementValue', label: 'Improv. Value',    type: 'number',  money: true },
    { key: 'lotAcres',         label: 'Lot Acres',        type: 'number'               },
    { key: 'zoning',           label: 'Zoning',           type: 'string',  mono: true  },
    { key: 'lbcsFunction',     label: 'LBCS Function',    type: 'string'               },
    { key: 'lbcsOwnership',    label: 'LBCS Ownership',   type: 'string'               },
    { key: 'landUse',          label: 'Land Use',         type: 'string'               },
    { key: 'ward',             label: 'Ward',             type: 'string'               },
    { key: 'neighborhood',     label: 'Neighborhood',     type: 'string'               },
    { key: 'block',            label: 'Block',            type: 'string',  mono: true  },
    { key: 'lot',              label: 'Lot',              type: 'string',  mono: true  },
    { key: 'censusTract',      label: 'Census Tract',     type: 'string',  mono: true  },
    { key: 'censusZcta',       label: 'ZCTA',             type: 'string',  mono: true  },
    { key: 'qoz',              label: 'QOZ',              type: 'string'               },
    { key: 'lat',              label: 'Latitude',         type: 'number'               },
    { key: 'lon',              label: 'Longitude',        type: 'number'               },
    { key: 'vacancyMethod',    label: 'Vacancy Method',   type: 'string'               },
    { key: 'assessedSource',   label: 'Value Source',     type: 'string'               },
  ];

  function titleizeField(key) {
    return String(key || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function inferFieldType(key) {
    const sample = (window.allFeatures || [])
      .map(f => f.properties?.[key])
      .find(v => v !== null && v !== undefined && v !== '');
    return typeof sample === 'number' ? 'number' : 'string';
  }

  function enrichFieldsFromDataset() {
    const schema = window.NEWARK_COMPACT?.schema
      || window.NEWARK_COMPACT_SHARDS?.find(shard => Array.isArray(shard.schema))?.schema
      || Object.keys(window.allFeatures?.[0]?.properties || {});
    const known = new Set(FIELDS.map(f => f.key));
    schema.forEach(key => {
      if (known.has(key)) return;
      const type = inferFieldType(key);
      FIELDS.push({
        key,
        label: titleizeField(key),
        type,
        mono: /id|path|parcel|block|lot|tract|zcta|key/i.test(key),
        money: /value|assessed|income|parval|landval|improv/i.test(key),
        score: /score|opportunity/i.test(key),
      });
      known.add(key);
    });
  }

  const SQL_OPS_STRING  = ['=', '!=', 'LIKE', 'NOT LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
  const SQL_OPS_NUMBER  = ['=', '!=', '>', '<', '>=', '<=', 'IS NULL', 'IS NOT NULL'];

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     DATA EXPLORER
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  let deData = [];        // current filtered rows (from window.filtered)
  let deSorted = [];      // after sort applied
  let dePage = 1;
  let dePageSize = 50;
  let deSortField = '';
  let deSortDir = 'asc';
  let deSelectedIds = new Set();
  let deVisibleCols = new Set(FIELDS.map(f => f.key)); // show full available parcel record by default

  function deGetData() {
    // Always read from the live app.js filter result. Fall back to all parcels before the first filter pass.
    const source = Array.isArray(window.filtered) ? window.filtered : (window.allFeatures || []);
    return source.map(f => f.properties || f);
  }

  function deRefresh() {
    deData = deGetData();
    if (deSortField) {
      const field = FIELDS.find(f => f.key === deSortField);
      deSorted = [...deData].sort((a, b) => {
        let va = a[deSortField], vb = b[deSortField];
        if (field?.type === 'number') { va = Number(va||0); vb = Number(vb||0); }
        else { va = String(va||'').toLowerCase(); vb = String(vb||'').toLowerCase(); }
        return deSortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      });
    } else {
      deSorted = [...deData];
    }
    const total = deSorted.length;
    const pages = Math.max(1, Math.ceil(total / dePageSize));
    dePage = Math.min(dePage, pages);
    const start = (dePage - 1) * dePageSize;
    const slice = deSorted.slice(start, start + dePageSize);

    // Update count badges
    const dtc = el('dataTabCount');
    if (dtc) dtc.textContent = fmt(total);
    const mtc = el('mapTabCount');
    if (mtc && mtc.textContent !== fmt(total)) mtc.textContent = fmt(total);
    const sc = el('sidebarCount');
    if (sc && sc.textContent !== fmt(total)) sc.textContent = fmt(total);
    const sub = el('dataExplorerSub');
    if (sub) sub.textContent = `Showing ${fmt(Math.min(dePageSize, slice.length))} of ${fmt(total)} filtered parcels. Sorted by ${deSortField || 'default'}.`;

    renderDeTable(slice);
    renderDePagination(total, pages);
  }

  function syncCounts(total) {
    const text = fmt(total);
    const dtc = el('dataTabCount');
    const mtc = el('mapTabCount');
    const sc = el('sidebarCount');
    if (dtc) dtc.textContent = text;
    if (mtc) mtc.textContent = text;
    if (sc) sc.textContent = text;
  }

  function renderDeTable(rows) {
    const head = el('dataTableHead');
    const body = el('dataTableBody');
    const empty = el('dataEmpty');
    if (!head || !body) return;

    const cols = FIELDS.filter(f => deVisibleCols.has(f.key));

    // Header
    head.innerHTML = `<tr>
      <th style="width:36px"><input type="checkbox" id="deSelectAll" style="accent-color:var(--indigo)"/></th>
      ${cols.map(f => `
        <th class="${deSortField===f.key?(deSortDir==='asc'?'sort-asc':'sort-desc'):''}"
            data-col="${f.key}" title="Sort by ${f.label}">${esc(f.label)}</th>
      `).join('')}
    </tr>`;

    el('deSelectAll')?.addEventListener('change', e => {
      rows.forEach(r => { if (e.target.checked) deSelectedIds.add(r.id); else deSelectedIds.delete(r.id); });
      qsa('.de-row-cb').forEach(cb => { cb.checked = e.target.checked; });
    });

    head.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        if (deSortField === th.dataset.col) deSortDir = deSortDir === 'asc' ? 'desc' : 'asc';
        else { deSortField = th.dataset.col; deSortDir = 'asc'; }
        deRefresh();
      });
    });

    if (!rows.length) {
      body.innerHTML = '';
      empty?.classList.remove('gone');
      return;
    }
    empty?.classList.add('gone');

    body.innerHTML = rows.map(r => {
      const vacClass = r.vacancy === 'Vacant' || r.vacancy === 'Vacant land' ? 'td-vacant'
                     : r.vacancy === 'Likely underutilized' ? 'td-under' : 'td-active';
      const sel = deSelectedIds.has(r.id);
      return `<tr class="${sel?'selected-row':''}" data-id="${esc(r.id)}">
        <td><input type="checkbox" class="de-row-cb" data-id="${esc(r.id)}" ${sel?'checked':''} style="accent-color:var(--indigo)"/></td>
        ${cols.map(f => {
          let val = r[f.key];
          let cls = '';
          if (f.key === 'vacancy') cls = vacClass;
          else if (f.score) cls = 'td-score';
          else if (f.money) cls = 'td-money';
          let display = val === null || val === undefined || val === '' ? '<span style="color:var(--soft)">â€”</span>' : esc(f.money ? money(val) : f.key === 'lotAcres' ? Number(val).toFixed(3) : String(val));
          return `<td class="${cls}" title="${esc(String(val??''))}">${display}</td>`;
        }).join('')}
      </tr>`;
    }).join('');

    body.querySelectorAll('.de-row-cb').forEach(cb => {
      cb.addEventListener('change', e => {
        const id = cb.dataset.id;
        if (e.target.checked) deSelectedIds.add(id); else deSelectedIds.delete(id);
        cb.closest('tr')?.classList.toggle('selected-row', e.target.checked);
      });
    });
  }

  function renderDePagination(total, pages) {
    const info = el('pagInfo');
    const pp = el('pagPages');
    if (!info || !pp) return;

    info.textContent = `Page ${dePage} of ${pages} Â· ${fmt(total)} rows`;

    const first = el('pagFirst'), prev = el('pagPrev'), next = el('pagNext'), last = el('pagLast');
    if (first) first.disabled = dePage <= 1;
    if (prev) prev.disabled = dePage <= 1;
    if (next) next.disabled = dePage >= pages;
    if (last) last.disabled = dePage >= pages;

    // Page buttons: show window around current page
    const range = [];
    for (let p = Math.max(1, dePage-2); p <= Math.min(pages, dePage+2); p++) range.push(p);
    pp.innerHTML = range.map(p => `<button class="pag-page ${p===dePage?'active':''}" data-page="${p}">${p}</button>`).join('');
    pp.querySelectorAll('.pag-page').forEach(btn => {
      btn.addEventListener('click', () => { dePage = parseInt(btn.dataset.page); deRefresh(); });
    });
  }

  function initDataExplorer() {
    // Pagination controls
    el('pagFirst')?.addEventListener('click', () => { dePage=1; deRefresh(); });
    el('pagPrev')?.addEventListener('click', () => { dePage=Math.max(1,dePage-1); deRefresh(); });
    el('pagNext')?.addEventListener('click', () => { const pages=Math.ceil(deGetData().length/dePageSize); dePage=Math.min(pages,dePage+1); deRefresh(); });
    el('pagLast')?.addEventListener('click', () => { dePage=Math.ceil(deGetData().length/dePageSize); deRefresh(); });
    el('pagSize')?.addEventListener('change', e => { dePageSize=parseInt(e.target.value); dePage=1; deRefresh(); });

    // Column selector
    const panel = el('colSelectorPanel');
    if (panel) {
      panel.innerHTML = `<h4>Visible Columns</h4>${FIELDS.map(f=>`
        <label class="col-toggle-row">
          <input type="checkbox" ${deVisibleCols.has(f.key)?'checked':''} data-col="${f.key}"/>
          ${esc(f.label)}
        </label>`).join('')}`;
      panel.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) deVisibleCols.add(cb.dataset.col); else deVisibleCols.delete(cb.dataset.col);
          deRefresh();
        });
      });
    }
    el('dataColToggle')?.addEventListener('click', e => {
      e.stopPropagation();
      panel?.classList.toggle('gone');
    });
    document.addEventListener('click', e => {
      if (!panel?.contains(e.target) && e.target !== el('dataColToggle')) panel?.classList.add('gone');
    });

    // Exports
    el('dataExportPage')?.addEventListener('click', () => {
      const start=(dePage-1)*dePageSize;
      exportCsvData(deSorted.slice(start,start+dePageSize), 'parcels-page.csv');
    });
    el('dataExportAll')?.addEventListener('click', () => {
      exportCsvData(deSorted, 'parcels-filtered.csv');
    });

    // Refresh when app.js updates filtered (observe mapTabCount)
    const tabCount = el('mapTabCount');
    if (tabCount) {
      new MutationObserver(() => {
        if (el('view-data') && !el('view-data').classList.contains('gone')) deRefresh();
      }).observe(tabCount, { childList:true, characterData:true, subtree:true });
    }

    // Refresh when data tab becomes visible
    const viewData = el('view-data');
    if (viewData) {
      new MutationObserver(() => {
        if (!viewData.classList.contains('gone')) deRefresh();
      }).observe(viewData, { attributes:true, attributeFilter:['class'] });
    }
  }

  function exportCsvData(rows, filename) {
    const cols = FIELDS.filter(f => deVisibleCols.has(f.key));
    const header = cols.map(f => f.label).join(',');
    const lines = rows.map(r => cols.map(f => {
      let v = String(r[f.key] ?? '');
      if (v.includes(',') || v.includes('"') || v.includes('\n')) v = `"${v.replace(/"/g,'""')}"`;
      return v;
    }).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     SQL DEVELOPER
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  let sqlConditions = [];  // [{join,field,op,value}]
  let sqlResults = [];
  let sqlMode = 'visual'; // 'visual' | 'raw'

  function initSqlDev() {
    // Populate field dropdowns
    const orderSel = el('sqlOrderField');
    if (orderSel) {
      orderSel.innerHTML = '<option value="">â€” none â€”</option>' +
        FIELDS.map(f=>`<option value="${f.key}">${f.label}</option>`).join('');
    }

    // Field chips reference
    const chips = el('sqlFieldChips');
    if (chips) {
      chips.innerHTML = FIELDS.map(f =>
        `<span class="sql-field-chip" data-field="${f.key}" title="${f.type}">${f.key}</span>`
      ).join('');
      chips.querySelectorAll('.sql-field-chip').forEach(chip => {
        chip.addEventListener('click', () => addSqlCondition(chip.dataset.field));
      });
    }

    // Add condition button
    el('sqlAddCondition')?.addEventListener('click', () => addSqlCondition());

    // Mode toggle
    el('sqlModeVisual')?.addEventListener('click', () => switchSqlMode('visual'));
    el('sqlModeRaw')?.addEventListener('click', () => switchSqlMode('raw'));

    // Run button
    el('sqlRun')?.addEventListener('click', runSqlQuery);

    // Clear
    el('sqlClear')?.addEventListener('click', () => {
      sqlConditions = [];
      renderSqlConditions();
      updateSqlPreview();
      sqlResults = [];
      renderSqlResults([]);
      el('sqlResultCount').textContent = 'â€”';
    });

    // Reset all filters
    el('sqlReset')?.addEventListener('click', () => {
      el('resetFilters')?.click(); // delegate to app.js, which also clears SQL/external scope
      sqlConditions = [];
      sqlResults = [];
      renderSqlConditions();
      updateSqlPreview();
      renderSqlResults([]);
      const cnt = el('sqlResultCount');
      if (cnt) cnt.textContent = '—';
      deRefresh();
    });

    // Apply to dashboard
    el('sqlApplyGlobal')?.addEventListener('click', applySqlToDashboard);

    // Export results
    el('sqlExportResults')?.addEventListener('click', () => {
      if (!sqlResults.length) return;
      const cols = FIELDS.filter(f => deVisibleCols.has(f.key));
      exportCsvData(sqlResults, 'sql-results.csv');
    });

    // Raw SQL input
    el('sqlRawInput')?.addEventListener('input', updateSqlPreviewFromRaw);

    // Order field change
    el('sqlOrderField')?.addEventListener('change', updateSqlPreview);
    el('sqlOrderDir')?.addEventListener('change', updateSqlPreview);
    el('sqlLimit')?.addEventListener('change', updateSqlPreview);

    updateSqlPreview();
  }

  function switchSqlMode(mode) {
    sqlMode = mode;
    el('sqlModeVisual')?.classList.toggle('active', mode==='visual');
    el('sqlModeRaw')?.classList.toggle('active', mode==='raw');
    el('sqlVisualMode')?.classList.toggle('gone', mode!=='visual');
    el('sqlRawMode')?.classList.toggle('gone', mode!=='raw');
    updateSqlPreview();
  }

  function addSqlCondition(fieldKey) {
    const field = fieldKey ? FIELDS.find(f=>f.key===fieldKey) : FIELDS[0];
    sqlConditions.push({
      id: Date.now(),
      join: sqlConditions.length === 0 ? 'WHERE' : 'AND',
      field: field?.key || FIELDS[0].key,
      op: field?.type === 'number' ? '>=' : '=',
      value: '',
    });
    renderSqlConditions();
    updateSqlPreview();
  }

  function renderSqlConditions() {
    const container = el('sqlConditions');
    if (!container) return;
    container.innerHTML = '';
    sqlConditions.forEach((cond, idx) => {
      const field = FIELDS.find(f=>f.key===cond.field) || FIELDS[0];
      const ops = field.type==='number' ? SQL_OPS_NUMBER : SQL_OPS_STRING;
      const div = document.createElement('div');
      div.className = 'sql-condition';
      div.innerHTML = `
        <button class="sql-condition-join" data-idx="${idx}" title="Toggle AND/OR">
          ${idx===0?'WHERE':cond.join}
        </button>
        <select class="sql-select-ctrl cond-field" data-idx="${idx}">
          ${FIELDS.map(f=>`<option value="${f.key}" ${f.key===cond.field?'selected':''}>${f.label}</option>`).join('')}
        </select>
        <select class="sql-select-ctrl cond-op" data-idx="${idx}">
          ${ops.map(o=>`<option value="${o}" ${o===cond.op?'selected':''}>${o}</option>`).join('')}
        </select>
        ${['IS NULL','IS NOT NULL'].includes(cond.op) ? '<span></span>' :
          `<input class="sql-text-input cond-val" data-idx="${idx}" placeholder="valueâ€¦" value="${esc(cond.value)}" />`
        }
        <button class="sql-del-btn" data-idx="${idx}" title="Remove condition">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      `;
      container.appendChild(div);

      div.querySelector('.sql-condition-join')?.addEventListener('click', () => {
        if (idx > 0) { cond.join = cond.join==='AND'?'OR':'AND'; renderSqlConditions(); updateSqlPreview(); }
      });
      div.querySelector('.cond-field')?.addEventListener('change', e => {
        cond.field = e.target.value;
        const f = FIELDS.find(f=>f.key===cond.field);
        cond.op = f?.type==='number' ? '>=' : '=';
        renderSqlConditions(); updateSqlPreview();
      });
      div.querySelector('.cond-op')?.addEventListener('change', e => {
        cond.op = e.target.value; renderSqlConditions(); updateSqlPreview();
      });
      div.querySelector('.cond-val')?.addEventListener('input', e => {
        cond.value = e.target.value; updateSqlPreview();
      });
      div.querySelector('.sql-del-btn')?.addEventListener('click', () => {
        sqlConditions.splice(idx,1);
        if (sqlConditions.length>0) sqlConditions[0].join='WHERE';
        renderSqlConditions(); updateSqlPreview();
      });
    });
  }

  function buildSqlString() {
    if (sqlMode === 'raw') return el('sqlRawInput')?.value?.trim() || 'SELECT * FROM parcels';
    const orderField = el('sqlOrderField')?.value;
    const orderDir = el('sqlOrderDir')?.value || 'asc';
    const limit = el('sqlLimit')?.value || '100';

    let sql = 'SELECT * FROM parcels';
    if (sqlConditions.length) {
      const clauses = sqlConditions.map((c,i) => {
        const prefix = i===0?'WHERE':c.join;
        if (c.op==='IS NULL') return `${prefix} ${c.field} IS NULL`;
        if (c.op==='IS NOT NULL') return `${prefix} ${c.field} IS NOT NULL`;
        if (c.op==='IN') return `${prefix} ${c.field} IN (${c.value})`;
        if (c.op==='LIKE'||c.op==='NOT LIKE') return `${prefix} ${c.field} ${c.op} '%${c.value}%'`;
        const field = FIELDS.find(f=>f.key===c.field);
        const quoted = field?.type==='string' ? `'${c.value}'` : c.value;
        return `${prefix} ${c.field} ${c.op} ${quoted}`;
      });
      sql += '\n  ' + clauses.join('\n  ');
    }
    if (orderField) sql += `\nORDER BY ${orderField} ${orderDir.toUpperCase()}`;
    if (limit && limit!=='0') sql += `\nLIMIT ${limit}`;
    return sql;
  }

  function updateSqlPreview() {
    const pre = el('sqlPreview');
    if (pre) pre.textContent = buildSqlString();
  }

  function updateSqlPreviewFromRaw() {
    const pre = el('sqlPreview');
    if (pre) pre.textContent = el('sqlRawInput')?.value || '';
  }

  function executeSqlQuery(sql) {
    const allRows = (window.allFeatures || []).map(f => f.properties);
    let rows = [...allRows];

    try {
      // Parse WHERE conditions from SQL string
      const upper = sql.toUpperCase();
      let whereStr = '';
      const whereIdx = upper.indexOf('WHERE');
      const orderIdx = upper.indexOf('ORDER BY');
      const limitIdx = upper.indexOf('LIMIT');

      if (whereIdx !== -1) {
        const end = orderIdx !== -1 ? orderIdx : limitIdx !== -1 ? limitIdx : sql.length;
        whereStr = sql.slice(whereIdx + 5, end).trim();
      }

      // Apply WHERE filter
      if (whereStr) {
        rows = rows.filter(row => evaluateWhere(row, whereStr));
      }

      // ORDER BY
      if (orderIdx !== -1) {
        const orderPart = sql.slice(orderIdx + 8, limitIdx !== -1 ? limitIdx : sql.length).trim();
        const parts = orderPart.split(/\s+/);
        const orderField = parts[0];
        const orderDir = (parts[1]||'asc').toLowerCase();
        const fDef = FIELDS.find(f=>f.key===orderField);
        if (fDef) {
          rows.sort((a,b) => {
            let va=a[orderField], vb=b[orderField];
            if(fDef.type==='number'){va=Number(va||0);vb=Number(vb||0);}
            else{va=String(va||'').toLowerCase();vb=String(vb||'').toLowerCase();}
            return orderDir==='desc'?(va<vb?1:-1):(va>vb?1:-1);
          });
        }
      }

      // LIMIT
      if (limitIdx !== -1) {
        const limitStr = sql.slice(limitIdx + 5).trim().split(/\s+/)[0];
        const lim = parseInt(limitStr);
        if (!isNaN(lim) && lim > 0) rows = rows.slice(0, lim);
      }

    } catch(e) {
      console.warn('SQL parse error:', e);
    }

    return rows;
  }

  function evaluateWhere(row, whereStr) {
    // Tokenize and evaluate simple conditions
    // Supports: field OP 'value', AND, OR, IN(...), LIKE, IS NULL, IS NOT NULL
    try {
      // Split on AND/OR (simple, no nested parens)
      const parts = whereStr.split(/\b(AND|OR)\b/i);
      let result = evaluateCondition(row, parts[0].trim());
      for (let i = 1; i < parts.length; i += 2) {
        const op = parts[i].toUpperCase();
        const nextResult = evaluateCondition(row, parts[i+1]?.trim() || '');
        result = op === 'AND' ? result && nextResult : result || nextResult;
      }
      return result;
    } catch(e) { return true; }
  }

  function evaluateCondition(row, condStr) {
    if (!condStr) return true;
    const s = condStr.trim();

    // IS NULL / IS NOT NULL
    const isNullMatch = s.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
    if (isNullMatch) { const v=row[isNullMatch[1]]; return v!==null&&v!==undefined&&v!==''; }
    const isNullMatch2 = s.match(/^(\w+)\s+IS\s+NULL$/i);
    if (isNullMatch2) { const v=row[isNullMatch2[1]]; return v===null||v===undefined||v===''; }

    // IN (a,b,c)
    const inMatch = s.match(/^(\w+)\s+(?:NOT\s+)?IN\s*\(([^)]+)\)/i);
    if (inMatch) {
      const field=inMatch[1], vals=inMatch[2].split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,'').toLowerCase());
      const rv=String(row[field]||'').toLowerCase();
      const isIn=vals.includes(rv);
      return s.toUpperCase().includes('NOT IN') ? !isIn : isIn;
    }

    // LIKE / NOT LIKE
    const likeMatch = s.match(/^(\w+)\s+(NOT\s+)?LIKE\s+['"]?%?([^'"]+?)%?['"]?$/i);
    if (likeMatch) {
      const field=likeMatch[1], notLike=!!likeMatch[2], pattern=likeMatch[3].toLowerCase();
      const rv=String(row[field]||'').toLowerCase();
      return notLike ? !rv.includes(pattern) : rv.includes(pattern);
    }

    // Standard comparison: field OP value
    const cmpMatch = s.match(/^(\w+)\s*(=|!=|>=|<=|>|<)\s*['"]?([^'"]+?)['"]?$/i);
    if (cmpMatch) {
      const field=cmpMatch[1], op=cmpMatch[2], rawVal=cmpMatch[3].trim();
      const fDef=FIELDS.find(f=>f.key===field);
      let rv=row[field], cv=rawVal;
      if (fDef?.type==='number') { rv=Number(rv||0); cv=Number(rawVal); }
      else { rv=String(rv||'').toLowerCase(); cv=rawVal.toLowerCase(); }
      switch(op) {
        case '=':  return rv==cv;
        case '!=': return rv!=cv;
        case '>':  return rv>cv;
        case '<':  return rv<cv;
        case '>=': return rv>=cv;
        case '<=': return rv<=cv;
      }
    }
    return true;
  }

  function runSqlQuery() {
    const sql = buildSqlString();
    try {
      sqlResults = executeSqlQuery(sql);
      renderSqlResults(sqlResults);
      const cnt = el('sqlResultCount');
      if (cnt) cnt.textContent = sqlResults.length.toLocaleString();
    } catch(e) {
      console.error('SQL Error:', e);
    }
  }

  function renderSqlResults(rows) {
    const head = el('sqlResultHead');
    const body = el('sqlResultBody');
    const empty = el('sqlResultEmpty');
    if (!head || !body) return;

    if (!rows.length) {
      head.innerHTML=''; body.innerHTML='';
      empty?.classList.remove('gone');
      return;
    }
    empty?.classList.add('gone');

    // Show the full parcel field set. The wrapper scrolls horizontally for wide records.
    const cols = FIELDS;
    head.innerHTML = `<tr>${cols.map(f=>`<th>${esc(f.label)}</th>`).join('')}</tr>`;
    body.innerHTML = rows.slice(0,500).map(r => `<tr>${cols.map(f=>{
      let v=r[f.key]; 
      const vacClass = f.key==='vacancy' ? (v==='Vacant'||v==='Vacant land'?'td-vacant':v==='Likely underutilized'?'td-under':'td-active') : '';
      const display = v===null||v===undefined||v==='' ? '<span style="color:var(--soft)">â€”</span>' : esc(f.money?money(v):String(v));
      return `<td class="${vacClass}">${display}</td>`;
    }).join('')}</tr>`).join('');
  }

  function applySqlToDashboard() {
    if (!sqlResults.length) runSqlQuery();
    if (!sqlResults.length) return;
    const idSet = new Set(sqlResults.map(r=>r.id));
    if (typeof window.applyExternalFeatureFilter === 'function') {
      window.applyExternalFeatureFilter(idSet, `SQL query (${sqlResults.length.toLocaleString()} rows)`);
    } else {
      window.filtered = (window.allFeatures || []).filter(f => idSet.has(f.properties.id));
      if (typeof window.renderAll === 'function') window.renderAll();
    }
    dePage = 1;
    deRefresh();
    // Show feedback
    const btn = el('sqlApplyGlobal');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Applied ${sqlResults.length.toLocaleString()} rows`;
      btn.style.background = 'var(--emerald)';
      btn.style.color = 'white';
      btn.style.border = 'none';
      setTimeout(()=>{ btn.innerHTML=orig; btn.style.background=''; btn.style.color=''; btn.style.border=''; }, 3000);
    }
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     MAP SYNC FIX
     The map tab shows stale counts because app.js only calls
     renderMap() when dashboardEntered=true AND state.tab==="map".
     When filters change on another tab, map data is correct in
     window.filtered but the map layer isn't re-rendered when you
     switch back. We fix this by triggering renderMap on tab switch.
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function fixMapSync() {
    const mapTab = document.querySelector('[data-tab="map"]');
    if (!mapTab) return;
    mapTab.addEventListener('click', () => {
      setTimeout(() => {
        if (typeof window.renderAll === 'function') window.renderAll();
        if (typeof window.renderMap === 'function') window.renderMap();
      }, 100);
    });
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     TAB WIRING â€” add data & dev tabs to app.js tab system
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function wireNewTabs() {
    document.querySelectorAll('.tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        // Show/hide the two new views (app.js handles the original ones)
        const viewData = el('view-data');
        const viewDev  = el('view-dev');
        if (viewData) viewData.classList.toggle('gone', target !== 'data');
        if (viewDev)  viewDev.classList.toggle('gone',  target !== 'dev');
        // Also hide original views when our tabs are active
        if (target === 'data' || target === 'dev') {
          ['view-map','view-charts','view-insights','view-docs'].forEach(id => {
            el(id)?.classList.add('gone');
          });
          // Update tab visual state
          document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t===tab));
        }
        // Refresh data explorer when tab opens
        if (target === 'data') setTimeout(deRefresh, 50);
      });
    });
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     BOOT
  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function boot() {
    enrichFieldsFromDataset();
    deVisibleCols = new Set(FIELDS.map(f => f.key));
    fixMapSync();
    wireNewTabs();
    initDataExplorer();
    initSqlDev();
    // Initial data load
    deRefresh();
    // Expose for external use
    window.devTab = { deRefresh, syncCounts, runSqlQuery, applySqlToDashboard };
  }

  waitForData(boot);

})();



