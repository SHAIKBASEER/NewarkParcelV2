/* ═══════════════════════════════════════════════════════════════
   ui-enhancements.js  v4 — CLEAN ARCHITECTURE
   
   KEY PRINCIPLE: app.js is the ONLY filter engine.
   We do NOT intercept, duplicate, or conflict with any of its logic.
   We only handle: login animation, theme switcher, command palette 
   open/close shell, tab animations, counter animations, AI panel UI.
   All filter state, dropdowns, sliders, reset = app.js owns them.
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function qsa(sel) { return [...document.querySelectorAll(sel)]; }

  /* ───────────────────────────────────────────────────────────
     COUNTER ANIMATION
  ─────────────────────────────────────────────────────────── */
  function animateCounter(element, targetText) {
    const num = parseFloat(String(targetText).replace(/[^0-9.]/g, ''));
    if (isNaN(num) || num === 0) { element.textContent = targetText; return; }
    const prefix = String(targetText).match(/^[^0-9]*/)?.[0] || '';
    const suffix = String(targetText).match(/[^0-9.]*$/)?.[0] || '';
    const steps = 22; let step = 0;
    const iv = setInterval(() => {
      step++;
      const ease = 1 - Math.pow(1 - step / steps, 3);
      const cur = num * ease;
      let d = suffix.includes('B') ? `${prefix}${cur.toFixed(1)}${suffix}`
            : suffix.includes('M') ? `${prefix}${cur.toFixed(1)}${suffix}`
            : suffix.includes('K') ? `${prefix}${Math.round(cur)}${suffix}`
            : `${prefix}${Math.round(cur).toLocaleString()}${suffix}`;
      element.textContent = d;
      if (step >= steps) { clearInterval(iv); element.textContent = targetText; }
    }, 500 / steps);
  }

  /* ───────────────────────────────────────────────────────────
     THEMES
  ─────────────────────────────────────────────────────────── */
  const THEMES = {
    'dark-indigo': {
      label: 'Dark Indigo', swatch: '#6366f1',
      '--bg':'#080c14','--bg-2':'#0c1220','--bg-3':'#111827',
      '--surface':'#131d2e','--surface-2':'#192236','--surface-3':'#1e2a40',
      '--border':'rgba(99,102,241,0.12)','--border-2':'rgba(99,102,241,0.22)',
      '--border-3':'rgba(255,255,255,0.08)',
      '--text':'#f1f5f9','--text-2':'#cbd5e1','--muted':'#94a3b8','--soft':'#64748b',
      '--indigo':'#6366f1','--indigo-2':'#818cf8','--indigo-glow':'rgba(99,102,241,0.35)',
      '--violet':'#8b5cf6','--emerald':'#10b981','--crimson':'#f43f5e','--amber':'#f59e0b','--sky':'#0ea5e9',
      '--vac':'#f43f5e','--vac-soft':'rgba(244,63,94,0.12)',
      '--under':'#f59e0b','--under-soft':'rgba(245,158,11,0.12)',
      '--good':'#10b981','--good-soft':'rgba(16,185,129,0.12)',
      '--opp':'#6366f1','--opp-soft':'rgba(99,102,241,0.12)',
    },
    'dark-teal': {
      label: 'Dark Teal', swatch: '#14b8a6',
      '--bg':'#060e10','--bg-2':'#091418','--bg-3':'#0f1e22',
      '--surface':'#112028','--surface-2':'#162830','--surface-3':'#1a303a',
      '--border':'rgba(20,184,166,0.14)','--border-2':'rgba(20,184,166,0.28)',
      '--border-3':'rgba(255,255,255,0.08)',
      '--text':'#f0fdfa','--text-2':'#ccfbf1','--muted':'#5eead4','--soft':'#2dd4bf',
      '--indigo':'#14b8a6','--indigo-2':'#2dd4bf','--indigo-glow':'rgba(20,184,166,0.3)',
      '--violet':'#0ea5e9','--emerald':'#10b981','--crimson':'#f43f5e','--amber':'#f59e0b','--sky':'#38bdf8',
      '--vac':'#f43f5e','--vac-soft':'rgba(244,63,94,0.12)',
      '--under':'#f59e0b','--under-soft':'rgba(245,158,11,0.12)',
      '--good':'#10b981','--good-soft':'rgba(16,185,129,0.12)',
      '--opp':'#14b8a6','--opp-soft':'rgba(20,184,166,0.12)',
    },
    'dark-crimson': {
      label: 'Dark Crimson', swatch: '#f43f5e',
      '--bg':'#0f0608','--bg-2':'#160a0d','--bg-3':'#1e1014',
      '--surface':'#221318','--surface-2':'#2a1820','--surface-3':'#321e28',
      '--border':'rgba(244,63,94,0.14)','--border-2':'rgba(244,63,94,0.25)',
      '--border-3':'rgba(255,255,255,0.08)',
      '--text':'#fff1f2','--text-2':'#fecdd3','--muted':'#fda4af','--soft':'#fb7185',
      '--indigo':'#f43f5e','--indigo-2':'#fb7185','--indigo-glow':'rgba(244,63,94,0.3)',
      '--violet':'#e879f9','--emerald':'#10b981','--crimson':'#f43f5e','--amber':'#f59e0b','--sky':'#0ea5e9',
      '--vac':'#f43f5e','--vac-soft':'rgba(244,63,94,0.12)',
      '--under':'#f59e0b','--under-soft':'rgba(245,158,11,0.12)',
      '--good':'#10b981','--good-soft':'rgba(16,185,129,0.12)',
      '--opp':'#f43f5e','--opp-soft':'rgba(244,63,94,0.1)',
    },
    'dark-amber': {
      label: 'Dark Amber', swatch: '#f59e0b',
      '--bg':'#0c0a04','--bg-2':'#141006','--bg-3':'#1c1608',
      '--surface':'#211a0a','--surface-2':'#2a2210','--surface-3':'#332a16',
      '--border':'rgba(245,158,11,0.14)','--border-2':'rgba(245,158,11,0.26)',
      '--border-3':'rgba(255,255,255,0.08)',
      '--text':'#fffbeb','--text-2':'#fef3c7','--muted':'#fde68a','--soft':'#fbbf24',
      '--indigo':'#f59e0b','--indigo-2':'#fbbf24','--indigo-glow':'rgba(245,158,11,0.3)',
      '--violet':'#f97316','--emerald':'#10b981','--crimson':'#f43f5e','--amber':'#f59e0b','--sky':'#0ea5e9',
      '--vac':'#f43f5e','--vac-soft':'rgba(244,63,94,0.12)',
      '--under':'#f59e0b','--under-soft':'rgba(245,158,11,0.12)',
      '--good':'#10b981','--good-soft':'rgba(16,185,129,0.12)',
      '--opp':'#f59e0b','--opp-soft':'rgba(245,158,11,0.1)',
    },
    'light': {
      label: 'Light Mode', swatch: '#6366f1',
      '--bg':'#f8fafc','--bg-2':'#f1f5f9','--bg-3':'#e2e8f0',
      '--surface':'#ffffff','--surface-2':'#f8fafc','--surface-3':'#f1f5f9',
      '--border':'rgba(99,102,241,0.12)','--border-2':'rgba(99,102,241,0.22)',
      '--border-3':'rgba(0,0,0,0.06)',
      '--text':'#0f172a','--text-2':'#1e293b','--muted':'#475569','--soft':'#94a3b8',
      '--indigo':'#6366f1','--indigo-2':'#4f46e5','--indigo-glow':'rgba(99,102,241,0.2)',
      '--violet':'#7c3aed','--emerald':'#059669','--crimson':'#e11d48','--amber':'#d97706','--sky':'#0284c7',
      '--vac':'#e11d48','--vac-soft':'rgba(225,29,72,0.08)',
      '--under':'#d97706','--under-soft':'rgba(217,119,6,0.08)',
      '--good':'#059669','--good-soft':'rgba(5,150,105,0.08)',
      '--opp':'#6366f1','--opp-soft':'rgba(99,102,241,0.08)',
    },
  };

  let currentTheme = localStorage.getItem('npi-theme') || 'dark-indigo';

  function applyTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    currentTheme = name;
    localStorage.setItem('npi-theme', name);
    const root = document.documentElement;
    Object.entries(t).forEach(([k,v]) => { if (k.startsWith('--')) root.style.setProperty(k,v); });
    qsa('.theme-opt-btn').forEach(b => {
      b.style.outline = b.dataset.theme === name ? '2px solid var(--indigo)' : 'none';
    });
  }

  function injectThemeSwitcher() {
    // Button in topbar
    const btn = document.createElement('button');
    btn.className = 'btn-ghost';
    btn.id = 'themeSwitcherBtn';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Theme`;

    // Floating panel
    const panel = document.createElement('div');
    panel.id = 'themePanel';
    panel.innerHTML = `
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--soft);margin-bottom:10px;">UI Theme</div>
      ${Object.entries(THEMES).map(([key, t]) => `
        <button class="theme-opt-btn" data-theme="${key}" style="
          display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;
          border-radius:10px;border:1px solid var(--border-2);background:var(--surface-2);
          color:var(--text-2);font-size:12px;font-weight:500;font-family:inherit;
          cursor:pointer;text-align:left;margin-bottom:5px;transition:all .15s;
          outline-offset:2px;
        ">
          <span style="width:14px;height:14px;border-radius:50%;flex-shrink:0;background:${t.swatch};box-shadow:0 0 8px ${t.swatch}55"></span>
          ${t.label}
        </button>
      `).join('')}
    `;
    Object.assign(panel.style, {
      position:'fixed', top:'64px', right:'16px', zIndex:'9999',
      background:'var(--surface)', border:'1px solid var(--border-2)',
      borderRadius:'18px', padding:'16px', width:'220px',
      boxShadow:'0 20px 60px rgba(0,0,0,0.5)', display:'none',
      backdropFilter:'blur(20px)',
    });
    document.body.appendChild(panel);

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', e => {
      if (!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
    });
    panel.querySelectorAll('.theme-opt-btn').forEach(b => {
      b.addEventListener('click', () => { applyTheme(b.dataset.theme); panel.style.display = 'none'; });
    });

    const exportBtn = el('exportCsv');
    if (exportBtn) exportBtn.parentNode.insertBefore(btn, exportBtn);

    applyTheme(currentTheme);
  }

  /* ───────────────────────────────────────────────────────────
     LOGIN PARTICLES
  ─────────────────────────────────────────────────────────── */
  function initParticles() {
    const canvas = el('loginParticles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth, H = canvas.height = window.innerHeight;
    const pts = Array.from({length:55}, () => ({
      x:Math.random()*W, y:Math.random()*H, r:Math.random()*1.4+0.3,
      vx:(Math.random()-.5)*.28, vy:(Math.random()-.5)*.28, a:Math.random()*.4+.1
    }));
    function draw() {
      ctx.clearRect(0,0,W,H);
      pts.forEach(p => {
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(99,102,241,${p.a})`; ctx.fill();
      });
      for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++) {
        const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
        if(d<110){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
          ctx.strokeStyle=`rgba(99,102,241,${.06*(1-d/110)})`; ctx.lineWidth=.5; ctx.stroke(); }
      }
      requestAnimationFrame(draw);
    }
    draw();
    window.addEventListener('resize', ()=>{ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; });
  }

  /* ───────────────────────────────────────────────────────────
     LOGIN
  ─────────────────────────────────────────────────────────── */
  function initLogin() {
    initParticles();
    const pwInput = el('loginPassword');
    const pwToggle = el('pwToggle');
    const loginBtn = el('enterDashboard');
    const loginError = el('loginError');
    const loginScreen = el('loginScreen');
    const appEl = el('app');

    pwToggle?.addEventListener('click', () => {
      pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
    });
    pwInput?.addEventListener('keydown', e => { if(e.key==='Enter') loginBtn?.click(); });

    loginBtn?.addEventListener('click', () => {
      const pwd = (pwInput?.value||'').trim().toLowerCase();
      if(pwd !== 'newark') {
        if(loginError) loginError.textContent = 'Incorrect password. Hint: the city name.';
        loginBtn.classList.add('invalid');
        setTimeout(()=>loginBtn.classList.remove('invalid'), 400);
        return;
      }
      if(loginError) loginError.textContent = '';
      const span = loginBtn.querySelector('span');
      if(span) span.textContent = 'Entering Dashboard…';
      loginBtn.disabled = true;
      setTimeout(() => {
        if(loginScreen){ loginScreen.style.transition='opacity 0.5s ease,transform 0.5s ease'; loginScreen.style.opacity='0'; loginScreen.style.transform='scale(1.02)'; }
        setTimeout(() => { loginScreen?.classList.add('gone'); appEl?.classList.add('visible'); }, 500);
      }, 600);
    });
  }

  /* ───────────────────────────────────────────────────────────
     COMMAND PALETTE — shell only, NO filter logic
     app.js owns: data-filter buttons, geoMenuButton, zoningMenuButton,
                  all range sliders, resetFilters, searchInput
     We own: open/close the overlay shell, sync cmdSearch→searchInput
  ─────────────────────────────────────────────────────────── */
  function initCommandPalette() {
    const overlay = el('cmdOverlay');
    const openBtn = el('cmdPaletteToggle');
    const closeBtn = el('cmdClose');
    const applyBtn = el('cmdApply');
    const cmdSearch = el('cmdSearch');
    const searchInput = el('searchInput');
    let isOpen = false;

    function open() {
      if(isOpen) return;
      isOpen = true;
      overlay.classList.remove('gone');
      setTimeout(()=>cmdSearch?.focus(), 80);
    }
    function close() {
      if(!isOpen) return;
      isOpen = false;
      overlay.classList.add('gone');
    }

    openBtn?.addEventListener('click', open);
    closeBtn?.addEventListener('click', close);
    el('cmdBackdrop')?.addEventListener('click', close);
    applyBtn?.addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if((e.metaKey||e.ctrlKey)&&e.key==='k'){ e.preventDefault(); isOpen?close():open(); }
      if(e.key==='Escape'&&isOpen) close();
    });

    // Search: forward cmdSearch keystrokes → #searchInput (which app.js already listens to)
    cmdSearch?.addEventListener('input', () => {
      if(searchInput){ searchInput.value = cmdSearch.value; searchInput.dispatchEvent(new Event('input',{bubbles:true})); }
    });

    // Sync pill visual state after app.js updates filters (observe mapTabCount changes)
    new MutationObserver(() => {
      const cnt = el('cmdResultCount'), src = el('mapTabCount');
      if(cnt&&src) cnt.textContent = src.textContent||'—';
    }).observe(el('mapTabCount')||document.body, {childList:true,characterData:true,subtree:true});

    // Fix zoning/geo dropdown z-index: move menus to body level
    // app.js's toggleMenu positions them via getBoundingClientRect which is fine,
    // but the menus are inside cmd-overlay (z-index:8000) so they get clipped.
    // Solution: after app.js builds the menus (on first open), move them to body.
    function liftMenuToBody(menuId) {
      const menu = el(menuId);
      if(!menu || menu.parentElement === document.body) return;
      // Save original styles set by app.js
      document.body.appendChild(menu);
      // Ensure high z-index so it appears above everything
      menu.style.zIndex = '99999';
      menu.style.position = 'fixed';
    }

    // Lift menus when the palette opens (menus will be populated by app.js by then)
    openBtn?.addEventListener('click', () => {
      setTimeout(() => { liftMenuToBody('geoMenu'); liftMenuToBody('zoningMenu'); }, 100);
    });

    // Also lift immediately if data already loaded
    setTimeout(() => { liftMenuToBody('geoMenu'); liftMenuToBody('zoningMenu'); }, 2000);

    // app.js closes menus on document click — but its handler checks
    // !event.target.closest(".multi-select") && !event.target.closest(".multi-menu")
    // Since we moved menus to body, the .multi-select check still works.
    // But we need the menu buttons to still work with app.js toggleMenu.
    // app.js's geoMenuButton listener calls toggleMenu("geo") which does:
    //   menu.classList.toggle("gone")
    //   menu.style.left/top = calculated from button rect
    // This still works since we just moved the DOM node — the button ref is the same.
  }

  /* ───────────────────────────────────────────────────────────
     AI PANEL — enhanced UI shell, app.js handles actual responses
  ─────────────────────────────────────────────────────────── */
  function initAiPanel() {
    const fab = el('aiLauncher');
    const panel = el('aiPanel');
    const closeBtn = el('closeAi');
    const form = el('aiForm');
    const input = el('aiInput');
    const messages = el('aiMessages');
    let isOpen = false, isDragging = false;

    function openPanel(){ isOpen=true; panel.classList.remove('gone'); input?.focus(); }
    function closePanel(){ isOpen=false; panel.classList.add('gone'); }
    fab?.addEventListener('click', ()=>{ if(!isDragging) isOpen?closePanel():openPanel(); });
    closeBtn?.addEventListener('click', closePanel);

    // Drag
    if(fab){
      let sX,sY,fX,fY;
      fab.addEventListener('mousedown', e => {
        sX=e.clientX; sY=e.clientY; const r=fab.getBoundingClientRect(); fX=r.left; fY=r.top;
        isDragging=false; fab.classList.add('dragging');
        function mv(e2){
          const dx=e2.clientX-sX, dy=e2.clientY-sY;
          if(Math.abs(dx)>4||Math.abs(dy)>4) isDragging=true;
          if(isDragging){ fab.style.left=`${Math.max(0,Math.min(window.innerWidth-80,fX+dx))}px`; fab.style.top=`${Math.max(0,Math.min(window.innerHeight-80,fY+dy))}px`; fab.style.right='auto'; }
        }
        function up(){ fab.classList.remove('dragging'); setTimeout(()=>isDragging=false,80); document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); }
        document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
      });
    }

    // Dock
    qsa('[data-ai-dock]').forEach(b => {
      b.addEventListener('click', () => {
        const p={'top-left':{top:'100px',left:'20px',right:'auto',bottom:'auto'},'top-right':{top:'100px',right:'20px',left:'auto',bottom:'auto'},'mid-left':{top:'50%',left:'20px',right:'auto',bottom:'auto'},'mid-right':{top:'50%',right:'20px',left:'auto',bottom:'auto'},'bottom-left':{bottom:'80px',left:'20px',right:'auto',top:'auto'},'bottom-right':{bottom:'80px',right:'20px',left:'auto',top:'auto'}}[b.dataset.aiDock];
        if(p){ Object.assign(fab.style,p); Object.assign(panel.style,{top:p.top?`calc(${p.top} + 68px)`:'',right:p.right||'',bottom:p.bottom?`calc(${p.bottom} + 68px)`:'',left:p.left||''}); }
      });
    });

    // Suggestions
    el('aiSuggestions')?.addEventListener('click', e => {
      const btn=e.target.closest('[data-prompt]');
      if(btn&&input){ input.value=btn.dataset.prompt; form?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); }
    });

    // Enhanced message rendering — override window.addAiMessage used by app.js
    function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

    function formatBot(text) {
      let h = esc(text);
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // highlight standalone numbers
      h = h.replace(/\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b/g, '<em>$1</em>');
      h = h.replace(/\n/g, '<br>');
      return `<p>${h}</p>`;
    }

    const BOT_AVATAR = `<div class="ai-msg-avatar"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/><circle cx="9" cy="13" r="1" fill="white"/><circle cx="15" cy="13" r="1" fill="white"/></svg></div>`;

    window.addAiMessage = function(role, content) {
      const div = document.createElement('div');
      div.className = `ai-msg ${role==='bot'?'ai-msg--bot':'ai-msg--user'}`;
      if(role==='bot') div.innerHTML = `${BOT_AVATAR}<div class="ai-msg-bubble">${formatBot(content)}</div>`;
      else div.innerHTML = `<div class="ai-msg-bubble">${esc(content)}</div>`;
      messages?.appendChild(div);
      if(messages) messages.scrollTop = messages.scrollHeight;
      return div;
    };

    // Typing indicator: show when user submits, hide when app.js calls addAiMessage
    let typingEl = null;
    const origAddAiMsg = window.addAiMessage;
    window.addAiMessage = function(role, content) {
      // Remove typing indicator when a real message arrives
      if(typingEl){ typingEl.remove(); typingEl=null; }
      return origAddAiMsg(role, content);
    };

    // Listen for form submit to show typing indicator
    form?.addEventListener('submit', () => {
      // Remove old typing if any
      if(typingEl){ typingEl.remove(); typingEl=null; }
      // Show user message immediately (app.js will also call addAiMessage('user',...) but we let it)
      // Show typing after brief delay
      setTimeout(() => {
        if(!typingEl){
          typingEl = document.createElement('div');
          typingEl.className = 'ai-msg ai-msg--bot';
          typingEl.innerHTML = `${BOT_AVATAR}<div class="ai-msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
          messages?.appendChild(typingEl);
          if(messages) messages.scrollTop = messages.scrollHeight;
        }
      }, 100);
    }, true); // capture=true so we fire before app.js
  }

  /* ───────────────────────────────────────────────────────────
     TAB TRANSITIONS
  ─────────────────────────────────────────────────────────── */
  function initTabTransitions() {
    // app.js handles tab switching. We just add fade animation when a view becomes visible.
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        if(m.type==='attributes' && m.attributeName==='class'){
          const v = m.target;
          if(v.classList.contains('view') && !v.classList.contains('gone')){
            v.style.opacity = '0'; v.style.transform = 'translateY(6px)';
            requestAnimationFrame(()=>{
              v.style.transition = 'opacity 0.28s ease,transform 0.28s ease';
              v.style.opacity = '1'; v.style.transform = 'translateY(0)';
            });
          }
        }
      });
    });
    qsa('.view').forEach(v => obs.observe(v,{attributes:true,attributeFilter:['class']}));
  }

  /* ───────────────────────────────────────────────────────────
     COUNTER ANIMATIONS — observe KPI elements
  ─────────────────────────────────────────────────────────── */
  function initCounters() {
    // Do not animate primary dataset counters. They are filter truth labels and must
    // always match the current app.js filtered set exactly.
    const ids = ['mScore'];
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        const e = m.target;
        const t = e.textContent.trim();
        if(t && t!=='—' && !e.dataset.anim){
          e.dataset.anim='1'; animateCounter(e,t); setTimeout(()=>delete e.dataset.anim,600);
        }
      });
    });
    ids.forEach(id => { const e=el(id); if(e) obs.observe(e,{childList:true,characterData:true,subtree:true}); });
  }

  /* ───────────────────────────────────────────────────────────
     STATUS BAR SYNC
  ─────────────────────────────────────────────────────────── */
  function initStatusSync() {
    const top=el('statusText'), bot=el('statusTextBottom');
    if(!top||!bot) return;
    new MutationObserver(()=>{ bot.textContent=top.textContent; })
      .observe(top,{childList:true,characterData:true,subtree:true});
    bot.textContent = top.textContent;
  }

  /* ───────────────────────────────────────────────────────────
     CHART.JS DARK DEFAULTS
  ─────────────────────────────────────────────────────────── */
  function patchCharts() {
    if(!window.Chart) return;
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = 'rgba(99,102,241,0.1)';
    Chart.defaults.font.family = '"DM Sans",ui-sans-serif,system-ui,sans-serif';
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(19,29,46,0.97)';
    Chart.defaults.plugins.tooltip.titleColor = '#f1f5f9';
    Chart.defaults.plugins.tooltip.bodyColor = '#94a3b8';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(99,102,241,0.3)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 12;
  }

  /* ───────────────────────────────────────────────────────────
     RIPPLE
  ─────────────────────────────────────────────────────────── */
  function initRipples() {
    if(!document.getElementById('rpl-kf')){ const s=document.createElement('style'); s.id='rpl-kf'; s.textContent='@keyframes rpl{to{transform:scale(2.8);opacity:0}}'; document.head.appendChild(s); }
    document.addEventListener('click', e => {
      const btn=e.target.closest('.btn-primary,.login-btn,.sel-btn');
      if(!btn) return;
      const r=btn.getBoundingClientRect(), sz=Math.max(r.width,r.height);
      const rpl=document.createElement('span');
      rpl.style.cssText=`position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:rgba(255,255,255,0.2);transform:scale(0);left:${e.clientX-r.left-sz/2}px;top:${e.clientY-r.top-sz/2}px;animation:rpl 0.5s ease-out;pointer-events:none;`;
      btn.style.position='relative'; btn.style.overflow='hidden'; btn.appendChild(rpl); setTimeout(()=>rpl.remove(),550);
    });
  }

  /* ───────────────────────────────────────────────────────────
     KEYBOARD SHORTCUTS
  ─────────────────────────────────────────────────────────── */
  function initKeyboard() {
    document.addEventListener('keydown', e => {
      if((e.metaKey||e.ctrlKey)&&e.key>='1'&&e.key<='4'){
        const tabs=qsa('.tab'); const idx=parseInt(e.key)-1;
        if(tabs[idx]){ e.preventDefault(); tabs[idx].click(); }
      }
    });
  }

  /* ───────────────────────────────────────────────────────────
     MAIN INIT
  ─────────────────────────────────────────────────────────── */
  function init() {
    patchCharts();
    initLogin();
    injectThemeSwitcher();
    initCommandPalette();
    initAiPanel();
    initTabTransitions();
    initCounters();
    initStatusSync();
    initRipples();
    initKeyboard();
    window.uiEnhanced = true;
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else setTimeout(init,0);
})();
