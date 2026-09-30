/* =========================================================================
   COFKI · REPORTE DE CALIFICACIONES — app.js
   Organización:
     Utils   -> helpers genéricos
     Store   -> capa de persistencia (localStorage hoy, API async-friendly
                para poder sustituirse por Supabase sin tocar el resto)
     Calc    -> lógica pura de negocio (sin tocar storage ni DOM)
     Seed    -> datos de demostración iniciales
     Views.* -> un renderer por sección
     App     -> arranque, navegación y wiring de eventos
   ========================================================================= */

(function(){
"use strict";

/* =============================== UTILS ================================= */

const Utils = {
  uid(prefix){
    const rnd = (crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0,8) : Math.random().toString(36).slice(2,10);
    return `${prefix}_${rnd}`;
  },
  clamp(n, min, max){ return Math.max(min, Math.min(max, n)); },
  round(n, decimals){
    const f = Math.pow(10, decimals);
    return Math.round((n + Number.EPSILON) * f) / f;
  },
  fmt(n, decimals){
    if(n === null || n === undefined || Number.isNaN(n)) return "N/D";
    return n.toFixed(decimals);
  },
  fmtSigned(n, decimals){
    if(n === null || n === undefined || Number.isNaN(n)) return "";
    const s = n > 0 ? "+" : (n < 0 ? "" : "±");
    return `${s}${n.toFixed(decimals)}`;
  },
  todayISO(){
    const d = new Date();
    return d.toISOString().slice(0,10);
  },
  parseISO(dateStr){
    // avoid timezone drift: construct as local date at noon
    const [y,m,d] = dateStr.split("-").map(Number);
    return new Date(y, m-1, d, 12, 0, 0);
  },
  fmtWeekLabel(dateStr){
    if(!dateStr) return "";
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const d = Utils.parseISO(dateStr);
    return `Semana del ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  },
  fmtDateShort(dateStr){
    if(!dateStr) return "";
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    const d = Utils.parseISO(dateStr);
    return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
  },
  escapeHtml(str){
    if(str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  },
  initials(name){
    if(!name) return "?";
    return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");
  },
  fileToDataUrl(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
  downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  },
  toast(msg, type){
    const el = document.createElement("div");
    el.className = "toast" + (type ? ` toast-${type}` : "");
    el.textContent = msg;
    document.getElementById("toastContainer").appendChild(el);
    setTimeout(()=>{ el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(()=>el.remove(), 300); }, 2600);
  }
};

/* =============================== SEED ==================================
   Datos de demostración iniciales. Se define antes de Store porque Store
   la invoca de inmediato si no hay datos guardados en localStorage.
   ========================================================================= */

const Seed = {
  build(){
    const apps = [
      { id: "a_ubereats", name: "Uber Eats", active: true, order: 1 },
      { id: "a_didifood", name: "DiDi Food", active: true, order: 2 },
      { id: "a_rappi",    name: "Rappi",     active: true, order: 3 }
    ];
    const branches = [
      { id: "b_gm3",     name: "GM3",            active: true, order: 1 },
      { id: "b_aurora",  name: "Aurora",         active: true, order: 2 },
      { id: "b_serena",  name: "Pueblo Serena",  active: true, order: 3 }
    ];
    const brands = [
      { id: "m_breakfast", name: "Breakfast & Lunch Cofki",  shortName: "Breakfast & Lunch", color: "#FFA726", logo: null, active: true, order: 1 },
      { id: "m_benditos",  name: "Los Benditos Chilaquiles", shortName: "Los Benditos",      color: "#FF5252", logo: null, active: true, order: 2 },
      { id: "m_michilakil",name: "MiChilakil",                shortName: "MiChilakil",        color: "#00BFA5", logo: null, active: true, order: 3 },
      { id: "m_district",  name: "District",                  shortName: "District",          color: "#424242", logo: null, active: true, order: 4 },
      { id: "m_spaghetto", name: "Spaghetto",                 shortName: "Spaghetto",         color: "#757575", logo: null, active: true, order: 5 }
    ];
    const weeks = [
      { id: "w_prev", date: "2026-08-15" },
      { id: "w_curr", date: "2026-08-22" }
    ];

    const gm3 = { prev: { m_breakfast:4.7, m_benditos:4.5, m_michilakil:4.6, m_district:4.1, m_spaghetto:4.1 },
                  curr: { m_breakfast:4.7, m_benditos:4.5, m_michilakil:4.6, m_district:4.1, m_spaghetto:4.0 } };
    const aurora = { prev: { m_breakfast:4.5, m_benditos:3.9, m_michilakil:3.9, m_district:3.4, m_spaghetto:3.7 },
                      curr: { m_breakfast:4.4, m_benditos:4.0, m_michilakil:3.9, m_district:3.4, m_spaghetto:3.7 } };

    const ratings = [];
    function pushSet(branchId, weekId, set){
      Object.entries(set).forEach(([brandId, value])=>{
        ratings.push({ id: Utils.uid("r"), appId: "a_ubereats", branchId, brandId, weekId, value });
      });
    }
    pushSet("b_gm3", "w_prev", gm3.prev);
    pushSet("b_gm3", "w_curr", gm3.curr);
    pushSet("b_aurora", "w_prev", aurora.prev);
    pushSet("b_aurora", "w_curr", aurora.curr);
    // Pueblo Serena: catálogo listo, sin calificaciones históricas todavía.

    return {
      meta: { version: 1, decimals: { rating: 1, variation: 1 } },
      apps, branches, brands, weeks, ratings
    };
  }
};

/* =============================== STORE =================================
   Capa de persistencia. Cada método regresa una Promise para que, en el
   futuro, baste con reemplazar la implementación interna por llamadas a
   Supabase (u otra API) sin cambiar el resto de la aplicación.
   ========================================================================= */

const DB_KEY = "cofki_ratings_db_v1";

const Store = (function(){

  function read(){
    try{
      const raw = localStorage.getItem(DB_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){
      console.error("Error leyendo la base de datos local", e);
      return null;
    }
  }
  function write(db){
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  let db = read();
  if(!db){
    db = Seed.build();
    write(db);
  }

  function persist(){ write(db); }

  return {
    // ---- lectura completa (síncrona internamente, expuesta como Promise) ----
    all(){ return Promise.resolve(db); },
    replaceAll(newDb){ db = newDb; persist(); return Promise.resolve(db); },
    resetToDemo(){ db = Seed.build(); persist(); return Promise.resolve(db); },
    clearRatingsHistory(){ db.ratings = []; db.weeks = []; persist(); return Promise.resolve(db); },

    // ---- catálogos ----
    getApps(){ return Promise.resolve(db.apps); },
    getBranches(){ return Promise.resolve(db.branches); },
    getBrands(){ return Promise.resolve(db.brands); },
    getWeeks(){ return Promise.resolve(db.weeks); },
    getRatings(){ return Promise.resolve(db.ratings); },
    getPrefs(){ return Promise.resolve(db.meta.decimals); },

    savePrefs(prefs){ db.meta.decimals = prefs; persist(); return Promise.resolve(db.meta.decimals); },

    addApp(name){
      const item = { id: Utils.uid("a"), name, active: true, order: (db.apps.length ? Math.max(...db.apps.map(x=>x.order))+1 : 1) };
      db.apps.push(item); persist(); return Promise.resolve(item);
    },
    addBranch(name){
      const item = { id: Utils.uid("b"), name, active: true, order: (db.branches.length ? Math.max(...db.branches.map(x=>x.order))+1 : 1) };
      db.branches.push(item); persist(); return Promise.resolve(item);
    },
    addBrand(data){
      const item = {
        id: Utils.uid("m"), name: data.name, shortName: data.shortName || "", color: data.color || "#00BFA5",
        logo: data.logo || null, active: true,
        order: (db.brands.length ? Math.max(...db.brands.map(x=>x.order))+1 : 1)
      };
      db.brands.push(item); persist(); return Promise.resolve(item);
    },

    updateCatalogItem(kind, id, patch){
      const list = db[kind];
      const item = list.find(x=>x.id===id);
      if(item) Object.assign(item, patch);
      persist();
      return Promise.resolve(item);
    },
    reorderCatalogItem(kind, id, dir){
      const list = db[kind].slice().sort((a,b)=>a.order-b.order);
      const idx = list.findIndex(x=>x.id===id);
      const swapIdx = dir === "up" ? idx-1 : idx+1;
      if(idx<0 || swapIdx<0 || swapIdx>=list.length) return Promise.resolve(false);
      const a = list[idx], b = list[swapIdx];
      const tmp = a.order; a.order = b.order; b.order = tmp;
      persist();
      return Promise.resolve(true);
    },
    deleteCatalogItem(kind, id, cascadeField){
      db[kind] = db[kind].filter(x=>x.id!==id);
      if(cascadeField){
        db.ratings = db.ratings.filter(r=>r[cascadeField]!==id);
      }
      persist();
      return Promise.resolve(true);
    },

    // ---- semanas ----
    findOrCreateWeek(dateStr){
      let w = db.weeks.find(x=>x.date===dateStr);
      if(!w){ w = { id: Utils.uid("w"), date: dateStr }; db.weeks.push(w); persist(); }
      return Promise.resolve(w);
    },

    // ---- calificaciones ----
    upsertRatings(records){
      // records: [{appId, branchId, brandId, weekId, value}]
      records.forEach(rec=>{
        const existing = db.ratings.find(r=>r.appId===rec.appId && r.branchId===rec.branchId && r.brandId===rec.brandId && r.weekId===rec.weekId);
        if(existing){ existing.value = rec.value; }
        else { db.ratings.push({ id: Utils.uid("r"), ...rec }); }
      });
      persist();
      return Promise.resolve(true);
    }
  };
})();

/* =============================== CALC ===================================
   Lógica de negocio pura. No toca storage ni DOM: recibe datos, regresa datos.
   ========================================================================= */

const Calc = {
  // Busca, dentro de `ratings`, el registro más reciente ANTERIOR a `beforeDate`
  // para la combinación app+sucursal+marca (sin importar si es la semana
  // calendario inmediata: es la última captura disponible antes de esa fecha).
  obtenerSemanaAnterior(ratings, weeksById, appId, branchId, brandId, beforeDate){
    const candidatos = ratings
      .filter(r => r.appId===appId && r.branchId===branchId && r.brandId===brandId)
      .map(r => ({ ...r, date: weeksById[r.weekId] && weeksById[r.weekId].date }))
      .filter(r => r.date && r.date < beforeDate && r.value !== null && r.value !== undefined)
      .sort((a,b)=> a.date < b.date ? 1 : -1);
    return candidatos.length ? candidatos[0] : null;
  },

  calcularVariacion(actual, anterior, decimals){
    if(actual === null || actual === undefined) return null;
    if(anterior === null || anterior === undefined) return null;
    return Utils.round(actual - anterior, decimals);
  },

  determinarTendencia(actual, anterior, variacion){
    if(actual === null || actual === undefined) return "nd";
    if(anterior === null || anterior === undefined) return "new";
    if(variacion > 0) return "up";
    if(variacion < 0) return "down";
    return "neutral";
  },

  calcularPromedio(values, decimals){
    const nums = values.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    if(!nums.length) return null;
    const sum = nums.reduce((a,b)=>a+b, 0);
    return Utils.round(sum / nums.length, decimals);
  },

  // Cuenta cuántos items subieron / bajaron / se mantuvieron / son nuevos,
  // dado un arreglo de variaciones (puede contener null = "nuevo"/"nd").
  calcularCrecimiento(items){
    const out = { up: 0, down: 0, neutral: 0, nuevo: 0 };
    items.forEach(it=>{
      if(it.tendencia === "up") out.up++;
      else if(it.tendencia === "down") out.down++;
      else if(it.tendencia === "neutral") out.neutral++;
      else if(it.tendencia === "new") out.nuevo++;
    });
    return out;
  },

  obtenerMejorDesempeno(items){
    const validos = items.filter(it => it.actual !== null && it.actual !== undefined);
    if(!validos.length) return null;
    return validos.reduce((best, it) => (it.actual > best.actual ? it : best), validos[0]);
  },

  obtenerPeorDesempeno(items){
    const validos = items.filter(it => it.actual !== null && it.actual !== undefined);
    if(!validos.length) return null;
    return validos.reduce((worst, it) => (it.actual < worst.actual ? it : worst), validos[0]);
  },

  // Construye la lista "enriquecida" de items (app,branch,brand) para una
  // semana dada, ya con anterior/variación/tendencia resueltos.
  buildWeekItems(db, weekDate, filter){
    const weeksById = Object.fromEntries(db.weeks.map(w=>[w.id, w]));
    const week = db.weeks.find(w=>w.date===weekDate);
    const dec = db.meta.decimals;
    const apps = db.apps.filter(a => a.active && (!filter.appId || filter.appId==="all" || a.id===filter.appId));
    const branches = db.branches.filter(b => b.active && (!filter.branchId || filter.branchId==="all" || b.id===filter.branchId));
    const brands = db.brands.filter(m => m.active);

    const items = [];
    apps.forEach(app=>{
      branches.forEach(branch=>{
        brands.forEach(brand=>{
          const rec = week ? db.ratings.find(r=>r.appId===app.id && r.branchId===branch.id && r.brandId===brand.id && r.weekId===week.id) : null;
          const actual = rec ? rec.value : null;
          const anteriorRec = Calc.obtenerSemanaAnterior(db.ratings, weeksById, app.id, branch.id, brand.id, weekDate);
          const anterior = anteriorRec ? anteriorRec.value : null;
          const variacion = Calc.calcularVariacion(actual, anterior, dec.variation);
          const tendencia = Calc.determinarTendencia(actual, anterior, variacion);
          items.push({ app, branch, brand, actual, anterior, variacion, tendencia });
        });
      });
    });
    return items;
  }
};

/* =============================== STATE ================================== */

const State = {
  db: null,
  currentView: "dashboard",
  reportData: null // último reporte generado, para poder exportarlo
};

async function loadDb(){ State.db = await Store.all(); }
async function persistAndReload(){ await loadDb(); renderAll(); }

/* =============================== HELPERS DE DOMINIO ===================== */

function activeSorted(list){ return list.filter(x=>x.active).slice().sort((a,b)=>a.order-b.order); }
function allSorted(list){ return list.slice().sort((a,b)=>a.order-b.order); }
function byId(list, id){ return list.find(x=>x.id===id); }

function fillSelect(select, items, opts){
  opts = opts || {};
  const keepFirst = opts.keepFirst; // conserva la 1a opción (ej. "Todas")
  const first = keepFirst ? select.querySelector("option") : null;
  select.innerHTML = "";
  if(first) select.appendChild(first);
  items.forEach(it=>{
    const o = document.createElement("option");
    o.value = it.id; o.textContent = it.name;
    select.appendChild(o);
  });
}

function fillWeekSelect(select, weeks, opts){
  opts = opts || {};
  select.innerHTML = "";
  const sorted = weeks.slice().sort((a,b)=> a.date < b.date ? 1 : -1);
  sorted.forEach(w=>{
    const o = document.createElement("option");
    o.value = w.date; o.textContent = Utils.fmtDateShort(w.date);
    select.appendChild(o);
  });
  if(opts.selectLatest && sorted.length) select.value = sorted[0].date;
}

function brandLogoHtml(brand, size){
  size = size || 34;
  if(brand.logo){
    return `<div class="report-brand-logo" style="width:${size}px;height:${size}px;"><img src="${brand.logo}" alt=""></div>`;
  }
  return `<div class="report-brand-logo" style="width:${size}px;height:${size}px;background:${brand.color};">${Utils.escapeHtml(Utils.initials(brand.shortName||brand.name))}</div>`;
}

function scorePairHtml(item, dec){
  const prevTxt = item.anterior === null || item.anterior === undefined ? "–" : Utils.fmt(item.anterior, dec.rating);
  const currTxt = item.actual === null || item.actual === undefined ? "N/D" : Utils.fmt(item.actual, dec.rating);
  const currClass = item.actual === null || item.actual === undefined ? "score-badge nd" : "score-badge";

  let arrowSlot = `<div class="score-arrow-wrap"></div>`;
  if(item.tendencia === "up" || item.tendencia === "down"){
    arrowSlot = `
      <div class="score-arrow-wrap">
        <span class="score-arrow ${item.tendencia}">${item.tendencia === "up" ? "▲" : "▼"}</span>
        <span class="score-delta-mini ${item.tendencia}">${Utils.fmtSigned(item.variacion, dec.variation)}</span>
      </div>`;
  } else if(item.tendencia === "new"){
    arrowSlot = `<div class="score-arrow-wrap"><span class="score-new-tag">Nueva</span></div>`;
  }

  return `
    <div class="score-pair">
      <span class="score-badge">${prevTxt}</span>
      <span class="${currClass}">${currTxt}</span>
      ${arrowSlot}
    </div>`;
}

/* =============================== NAV ===================================== */

function switchView(view){
  State.currentView = view;
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("is-active", b.dataset.view===view));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("is-active", v.id === `view-${view}`));
  if(view === "dashboard") Views.dashboard.render();
  if(view === "captura") Views.captura.render();
  if(view === "reporte") Views.reporte.refreshSelectors();
  if(view === "historial") Views.historial.render();
  if(view === "config") Views.config.render();
}

/* =============================== VIEWS: DASHBOARD ========================= */

const Views = {};

Views.dashboard = {
  init(){
    document.getElementById("dashApp").addEventListener("change", ()=>Views.dashboard.render());
    document.getElementById("dashBranch").addEventListener("change", ()=>Views.dashboard.render());
    document.getElementById("dashWeek").addEventListener("change", ()=>Views.dashboard.render());
  },
  refreshSelectors(){
    const db = State.db;
    fillSelect(document.getElementById("dashApp"), activeSorted(db.apps), {keepFirst:true});
    fillSelect(document.getElementById("dashBranch"), activeSorted(db.branches), {keepFirst:true});
    fillWeekSelect(document.getElementById("dashWeek"), db.weeks, {selectLatest:true});
  },
  render(){
    const db = State.db;
    if(!document.getElementById("dashWeek").options.length) this.refreshSelectors();
    const appId = document.getElementById("dashApp").value || "all";
    const branchId = document.getElementById("dashBranch").value || "all";
    const weekDate = document.getElementById("dashWeek").value;
    if(!weekDate){ return; }

    const items = Calc.buildWeekItems(db, weekDate, { appId, branchId });
    const dec = db.meta.decimals;

    const promedioActual = Calc.calcularPromedio(items.map(i=>i.actual), dec.rating);
    const promedioAnterior = Calc.calcularPromedio(items.map(i=>i.anterior), dec.rating);
    const variacionProm = (promedioActual !== null && promedioAnterior !== null) ? Utils.round(promedioActual - promedioAnterior, dec.variation) : null;
    const crecimiento = Calc.calcularCrecimiento(items);
    const mejor = Calc.obtenerMejorDesempeno(items);
    const peor = Calc.obtenerPeorDesempeno(items);

    const kpis = [
      { label: "Calificación promedio", value: promedioActual===null?"—":Utils.fmt(promedioActual, dec.rating), foot: "Semana seleccionada" },
      { label: "Semana anterior", value: promedioAnterior===null?"—":Utils.fmt(promedioAnterior, dec.rating), foot: "Promedio de comparación" },
      { label: "Variación promedio", value: variacionProm===null?"—":Utils.fmtSigned(variacionProm, dec.variation), foot: variacionProm>0?"Mejora general":(variacionProm<0?"Descenso general":"Sin cambio"), cls: variacionProm>0?"up":(variacionProm<0?"down":"") },
      { label: "Marcas evaluadas", value: items.filter(i=>i.actual!==null).length, foot: `${crecimiento.nuevo} sin comparación previa` }
    ];
    document.getElementById("kpiGrid").innerHTML = kpis.map(k=>`
      <div class="kpi">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls||''}">${k.value}</div>
        <div class="kpi-foot">${k.foot}</div>
      </div>`).join("") +
      `<div class="kpi">
        <div class="kpi-label">Subieron / bajaron / sin cambio</div>
        <div class="kpi-value" style="font-size:19px;display:flex;gap:10px;">
          <span class="up">${crecimiento.up}↑</span><span class="down">${crecimiento.down}↓</span><span class="muted">${crecimiento.neutral}→</span>
        </div>
        <div class="kpi-foot">de ${items.filter(i=>i.actual!==null).length} calificaciones con comparación</div>
      </div>`;

    const bestHtml = mejor ? `
      <div class="bw-row">
        <div>
          <div class="bw-name">${Utils.escapeHtml(mejor.brand.name)}</div>
          <div class="bw-meta">${Utils.escapeHtml(mejor.branch.name)} · ${Utils.escapeHtml(mejor.app.name)}</div>
        </div>
        <div class="bw-score" style="color:var(--up)">${Utils.fmt(mejor.actual, dec.rating)}</div>
      </div>` : `<div class="empty-hint">Sin datos para esta selección.</div>`;
    const worstHtml = peor ? `
      <div class="bw-row">
        <div>
          <div class="bw-name">${Utils.escapeHtml(peor.brand.name)}</div>
          <div class="bw-meta">${Utils.escapeHtml(peor.branch.name)} · ${Utils.escapeHtml(peor.app.name)}</div>
        </div>
        <div class="bw-score" style="color:var(--down)">${Utils.fmt(peor.actual, dec.rating)}</div>
      </div>` : `<div class="empty-hint">Sin datos para esta selección.</div>`;
    document.getElementById("bestCard").innerHTML = bestHtml;
    document.getElementById("worstCard").innerHTML = worstHtml;
  }
};

/* =============================== VIEWS: CAPTURA ============================ */

Views.captura = {
  init(){
    document.getElementById("capApp").addEventListener("change", ()=>this.renderTable());
    document.getElementById("capDate").addEventListener("change", ()=>this.renderTable());
    document.getElementById("capBranch").addEventListener("change", ()=>this.renderTable());
    document.getElementById("btnSaveWeek").addEventListener("click", ()=>this.save());
  },
  render(){
    const db = State.db;
    fillSelect(document.getElementById("capApp"), activeSorted(db.apps));
    fillSelect(document.getElementById("capBranch"), activeSorted(db.branches));
    const dateInput = document.getElementById("capDate");
    if(!dateInput.value){
      const latest = db.weeks.slice().sort((a,b)=> a.date < b.date ? 1 : -1)[0];
      dateInput.value = latest ? latest.date : Utils.todayISO();
    }
    this.renderTable();
  },
  renderTable(){
    const db = State.db;
    const appId = document.getElementById("capApp").value;
    const branchId = document.getElementById("capBranch").value;
    const dateStr = document.getElementById("capDate").value;
    const wrap = document.getElementById("capTableWrap");
    const app = byId(db.apps, appId), branch = byId(db.branches, branchId);

    if(!app || !branch || !dateStr){
      wrap.innerHTML = `<div class="empty-hint">Selecciona aplicación, sucursal y fecha para comenzar a capturar.</div>`;
      document.getElementById("capTitle").textContent = "Selecciona aplicación, semana y sucursal";
      document.getElementById("capSubtitle").textContent = "";
      return;
    }
    document.getElementById("capTitle").textContent = `${branch.name} · ${app.name}`;
    document.getElementById("capSubtitle").textContent = Utils.fmtWeekLabel(dateStr);

    const week = db.weeks.find(w=>w.date===dateStr);
    const brands = activeSorted(db.brands);
    const weeksById = Object.fromEntries(db.weeks.map(w=>[w.id,w]));
    const dec = db.meta.decimals;

    if(!brands.length){
      wrap.innerHTML = `<div class="empty-hint">No hay marcas activas. Agrégalas en Configuración → Marcas.</div>`;
      return;
    }

    const rows = brands.map(brand=>{
      const existing = week ? db.ratings.find(r=>r.appId===app.id && r.branchId===branch.id && r.brandId===brand.id && r.weekId===week.id) : null;
      const anteriorRec = Calc.obtenerSemanaAnterior(db.ratings, weeksById, app.id, branch.id, brand.id, dateStr);
      const prevTxt = anteriorRec ? Utils.fmt(anteriorRec.value, dec.rating) : "Sin dato previo";
      return `
        <tr data-brand-id="${brand.id}">
          <td><div class="cap-brand">${brandLogoHtml(brand,26)}<span>${Utils.escapeHtml(brand.name)}</span></div></td>
          <td class="cap-prev">${prevTxt}</td>
          <td><input type="number" class="cap-input" min="0" max="5" step="0.1" placeholder="0.0" value="${existing && existing.value!==null && existing.value!==undefined ? existing.value : ''}"></td>
        </tr>`;
    }).join("");

    wrap.innerHTML = `
      <table class="cap-table">
        <thead><tr><th>Marca</th><th>Semana anterior</th><th>Calificación</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Enter avanza al siguiente campo; valida rango 0.0–5.0
    const inputs = Array.from(wrap.querySelectorAll(".cap-input"));
    inputs.forEach((inp, idx)=>{
      inp.addEventListener("keydown", e=>{
        if(e.key==="Enter"){ e.preventDefault(); (inputs[idx+1]||inputs[0]).focus(); (inputs[idx+1]||inputs[0]).select(); }
      });
      inp.addEventListener("input", ()=>{
        const v = parseFloat(inp.value);
        inp.classList.toggle("is-invalid", inp.value!=="" && (Number.isNaN(v) || v<0 || v>5));
      });
    });
    if(inputs[0]) setTimeout(()=>inputs[0].focus(), 30);
  },
  async save(){
    const db = State.db;
    const appId = document.getElementById("capApp").value;
    const branchId = document.getElementById("capBranch").value;
    const dateStr = document.getElementById("capDate").value;
    if(!appId || !branchId || !dateStr){ Utils.toast("Completa aplicación, sucursal y semana.", "error"); return; }

    const wrap = document.getElementById("capTableWrap");
    const rows = Array.from(wrap.querySelectorAll("tr[data-brand-id]"));
    let hasInvalid = false;
    const records = [];
    rows.forEach(row=>{
      const brandId = row.dataset.brandId;
      const input = row.querySelector(".cap-input");
      const raw = input.value.trim();
      if(raw === "") return; // sin captura esta semana -> N/D, no se guarda
      let v = parseFloat(raw);
      if(Number.isNaN(v) || v<0 || v>5){ hasInvalid = true; input.classList.add("is-invalid"); return; }
      v = Utils.round(v, db.meta.decimals.rating);
      records.push({ brandId, value: v });
    });
    if(hasInvalid){ Utils.toast("Hay calificaciones fuera de rango (0.0–5.0).", "error"); return; }
    if(!records.length){ Utils.toast("No hay calificaciones para guardar.", "error"); return; }

    const week = await Store.findOrCreateWeek(dateStr);
    await Store.upsertRatings(records.map(r=>({ appId, branchId, weekId: week.id, brandId: r.brandId, value: r.value })));
    await persistAndReload();
    switchView("captura"); // re-render manteniendo selección
    document.getElementById("capApp").value = appId;
    document.getElementById("capBranch").value = branchId;
    document.getElementById("capDate").value = dateStr;
    Views.captura.renderTable();
    document.getElementById("saveHint").textContent = `Guardado: ${records.length} marca(s) · ${Utils.fmtWeekLabel(dateStr)}`;
    Utils.toast("Semana guardada correctamente.", "ok");
  }
};

/* =============================== VIEWS: REPORTE ============================ */

Views.reporte = {
  init(){
    document.getElementById("btnGenerateReport").addEventListener("click", ()=>this.generate());
    document.getElementById("btnDownloadPng").addEventListener("click", ()=>Export.toPng());
    document.getElementById("btnDownloadPdf").addEventListener("click", ()=>Export.toPdf());
    document.getElementById("btnCopyReport").addEventListener("click", ()=>Export.copy());
  },
  refreshSelectors(){
    const db = State.db;
    fillSelect(document.getElementById("repApp"), activeSorted(db.apps));
    fillSelect(document.getElementById("repBranch"), activeSorted(db.branches), {keepFirst:true});
    fillWeekSelect(document.getElementById("repWeek"), db.weeks, {selectLatest:true});
  },
  generate(){
    const db = State.db;
    const appId = document.getElementById("repApp").value;
    const branchId = document.getElementById("repBranch").value;
    const weekDate = document.getElementById("repWeek").value;
    if(!appId || !weekDate){ Utils.toast("Selecciona aplicación y semana.", "error"); return; }

    const html = ReportBuilder.build(db, appId, weekDate, branchId);
    document.getElementById("reportStage").innerHTML = html;
    document.getElementById("reportToolbar").classList.remove("hidden");
    State.reportData = { appId, branchId, weekDate };
  }
};

const ReportBuilder = {
  build(db, appId, weekDate, branchId){
    const app = byId(db.apps, appId);
    if(!app) return `<div class="report-placeholder">Aplicación no encontrada.</div>`;
    const branches = (branchId && branchId!=="all") ? [byId(db.branches, branchId)] : activeSorted(db.branches);
    const dec = db.meta.decimals;
    const brands = activeSorted(db.brands);
    const weeksById = Object.fromEntries(db.weeks.map(w=>[w.id,w]));
    const week = db.weeks.find(w=>w.date===weekDate);
    const visibleBranches = branches.filter(Boolean);

    const columns = visibleBranches.map(branch=>{
      const rows = brands.map(brand=>{
        const rec = week ? db.ratings.find(r=>r.appId===app.id && r.branchId===branch.id && r.brandId===brand.id && r.weekId===week.id) : null;
        const actual = rec ? rec.value : null;
        const anteriorRec = Calc.obtenerSemanaAnterior(db.ratings, weeksById, app.id, branch.id, brand.id, weekDate);
        const anterior = anteriorRec ? anteriorRec.value : null;
        const variacion = Calc.calcularVariacion(actual, anterior, dec.variation);
        const tendencia = Calc.determinarTendencia(actual, anterior, variacion);
        return `
          <div class="report-row">
            <div class="report-brand-id">
              ${brandLogoHtml(brand)}
              <div class="report-brand-text">
                <div class="report-brand-name">${Utils.escapeHtml(brand.shortName || brand.name)}</div>
              </div>
            </div>
            ${scorePairHtml({actual, anterior, variacion, tendencia}, dec)}
          </div>`;
      }).join("");
      return `
        <div class="report-branch-col">
          <div class="report-branch-name">${Utils.escapeHtml(branch.name)}</div>
          <div class="report-col-head"><span>Semana pasada</span><span>Semana Actual</span><span class="arrow-spacer"></span></div>
          ${rows}
        </div>`;
    }).join("");

    // hasta 3 columnas lado a lado como en el reporte de referencia; con más
    // sucursales, la cuadrícula reparte el espacio y ajusta el ancho del documento.
    const colCount = Math.max(1, Math.min(visibleBranches.length, 3));
    const docWidth = visibleBranches.length <= 1 ? 420 : Math.min(1180, colCount * 280 + (colCount - 1) * 30 + 68);
    const gridStyle = visibleBranches.length > 1 ? `style="grid-template-columns:repeat(${colCount},1fr);"` : "";

    return `
      <div class="report-doc" id="reportDoc" style="width:${docWidth}px;">
        <div class="report-doc-header">
          <div class="report-eyebrow">Cofki</div>
          <div class="report-title">Reporte de Calificaciones</div>
          <div class="report-app">${Utils.escapeHtml(app.name)}</div>
          <div class="report-week">${Utils.fmtWeekLabel(weekDate)}</div>
        </div>
        <div class="report-columns" ${gridStyle}>${columns || '<div class="empty-hint">No hay sucursales activas.</div>'}</div>
        <div class="report-doc-footer">
          <span>Cofki · Reporte de Calificaciones</span>
          <span>${Utils.fmtDateShort(weekDate)}</span>
        </div>
      </div>`;
  }
};

/* =============================== EXPORT (PNG / PDF / COPIAR) ============== */

const Export = {
  async renderCleanCopy(){
    const original = document.getElementById("reportDoc");
    if(!original){ Utils.toast("Genera un reporte primero.", "error"); return null; }
    const root = document.getElementById("exportRoot");
    root.innerHTML = "";
    const clone = original.cloneNode(true);
    clone.style.width = "680px";
    root.appendChild(clone);
    // esperar a que fuentes/imagenes carguen
    await new Promise(r=>setTimeout(r, 60));
    return clone;
  },
  async captureCanvas(){
    const clone = await this.renderCleanCopy();
    if(!clone) return null;
    const canvas = await html2canvas(clone, { scale: 2.5, backgroundColor: "#ffffff", useCORS: true });
    document.getElementById("exportRoot").innerHTML = "";
    return canvas;
  },
  fileBaseName(){
    const rd = State.reportData;
    if(!rd) return "reporte-cofki";
    const app = byId(State.db.apps, rd.appId);
    return `reporte-cofki-${(app?app.name:'app').toLowerCase().replace(/\s+/g,'-')}-${rd.weekDate}`;
  },
  async toPng(){
    try{
      const canvas = await this.captureCanvas();
      if(!canvas) return;
      canvas.toBlob(blob=>{
        Utils.downloadBlob(blob, `${this.fileBaseName()}.png`);
        Utils.toast("PNG descargado.", "ok");
      }, "image/png", 1);
    }catch(e){
      console.error(e);
      Utils.toast("No se pudo generar el PNG.", "error");
    }
  },
  async toPdf(){
    try{
      const canvas = await this.captureCanvas();
      if(!canvas) return;
      const { jsPDF } = window.jspdf;
      const pxToMm = 0.2645833333;
      const wMm = canvas.width * pxToMm / 2.5; // /scale usado en captureCanvas
      const hMm = canvas.height * pxToMm / 2.5;
      const pdf = new jsPDF({ orientation: wMm > hMm ? "l" : "p", unit: "mm", format: [wMm, hMm] });
      pdf.addImage(canvas.toDataURL("image/png", 1), "PNG", 0, 0, wMm, hMm);
      pdf.save(`${this.fileBaseName()}.pdf`);
      Utils.toast("PDF descargado.", "ok");
    }catch(e){
      console.error(e);
      Utils.toast("No se pudo generar el PDF.", "error");
    }
  },
  async copy(){
    try{
      const canvas = await this.captureCanvas();
      if(!canvas) return;
      if(!navigator.clipboard || !window.ClipboardItem){
        Utils.toast("Tu navegador no permite copiar imágenes. Usa Descargar PNG.", "error");
        return;
      }
      canvas.toBlob(async blob=>{
        try{
          await navigator.clipboard.write([ new ClipboardItem({ "image/png": blob }) ]);
          Utils.toast("Reporte copiado al portapapeles.", "ok");
        }catch(err){
          console.error(err);
          Utils.toast("No se pudo copiar. Usa Descargar PNG.", "error");
        }
      }, "image/png", 1);
    }catch(e){
      console.error(e);
      Utils.toast("No se pudo copiar el reporte.", "error");
    }
  }
};

/* =============================== VIEWS: HISTORIAL ========================== */

Views.historial = {
  init(){
    document.getElementById("evoApp").addEventListener("change", ()=>this.renderEvo());
    document.getElementById("evoBranch").addEventListener("change", ()=>this.renderEvo());
    document.getElementById("evoBrand").addEventListener("change", ()=>this.renderEvo());
    document.getElementById("snapshotApp").addEventListener("change", ()=>this.renderSnapshot());
  },
  render(){
    const db = State.db;
    const list = document.getElementById("weekList");
    const weeks = db.weeks.slice().sort((a,b)=> a.date < b.date ? 1 : -1);
    if(!weeks.length){
      list.innerHTML = `<div class="empty-hint">Aún no hay semanas capturadas.</div>`;
    } else {
      list.innerHTML = weeks.map(w=>`
        <div class="week-list-item" data-date="${w.date}">
          <span>${Utils.fmtWeekLabel(w.date)}</span><small>${w.date}</small>
        </div>`).join("");
      list.querySelectorAll(".week-list-item").forEach(el=>{
        el.addEventListener("click", ()=>{
          list.querySelectorAll(".week-list-item").forEach(x=>x.classList.remove("is-active"));
          el.classList.add("is-active");
          this.showSnapshot(el.dataset.date);
        });
      });
    }

    fillSelect(document.getElementById("evoApp"), activeSorted(db.apps));
    fillSelect(document.getElementById("evoBranch"), activeSorted(db.branches));
    fillSelect(document.getElementById("evoBrand"), activeSorted(db.brands));
    this.renderEvo();

    if(weeks.length){
      document.getElementById("weekSnapshotCard").style.display = "";
      fillSelect(document.getElementById("snapshotApp"), activeSorted(db.apps));
      if(!list.querySelector(".is-active")){
        list.querySelector(".week-list-item").classList.add("is-active");
        this.showSnapshot(weeks[0].date);
      }
    } else {
      document.getElementById("weekSnapshotCard").style.display = "none";
    }
  },
  showSnapshot(dateStr){
    this._snapshotDate = dateStr;
    document.getElementById("weekSnapshotTitle").textContent = `Reporte de la semana · ${Utils.fmtWeekLabel(dateStr)}`;
    this.renderSnapshot();
  },
  renderSnapshot(){
    if(!this._snapshotDate) return;
    const db = State.db;
    const appId = document.getElementById("snapshotApp").value || activeSorted(db.apps)[0]?.id;
    if(!appId) return;
    document.getElementById("weekSnapshotStage").innerHTML = ReportBuilder.build(db, appId, this._snapshotDate, "all");
  },
  renderEvo(){
    const db = State.db;
    const appId = document.getElementById("evoApp").value;
    const branchId = document.getElementById("evoBranch").value;
    const brandId = document.getElementById("evoBrand").value;
    const el = document.getElementById("evoChart");
    if(!appId || !branchId || !brandId){ el.innerHTML = `<div class="evo-empty">Selecciona aplicación, sucursal y marca.</div>`; return; }

    const weeksById = Object.fromEntries(db.weeks.map(w=>[w.id,w]));
    const points = db.ratings
      .filter(r=>r.appId===appId && r.branchId===branchId && r.brandId===brandId && r.value!==null && r.value!==undefined)
      .map(r=>({ date: weeksById[r.weekId].date, value: r.value }))
      .sort((a,b)=> a.date < b.date ? -1 : 1);

    if(!points.length){ el.innerHTML = `<div class="evo-empty">Sin historial todavía para esta combinación.</div>`; return; }
    if(points.length===1){
      el.innerHTML = `<div class="evo-empty">Solo hay una semana registrada (${Utils.fmt(points[0].value, db.meta.decimals.rating)}). Se necesitan al menos dos para ver evolución.</div>`;
      return;
    }

    const dec = db.meta.decimals.rating;
    const w = 560, h = 160, pad = 24;
    const min = Math.min(...points.map(p=>p.value), 0);
    const max = Math.max(...points.map(p=>p.value), 5);
    const range = (max - min) || 1;
    const stepX = (w - pad*2) / (points.length - 1);
    const xy = points.map((p,i)=>{
      const x = pad + i*stepX;
      const y = h - pad - ((p.value - min) / range) * (h - pad*2);
      return {x, y, p};
    });
    const path = xy.map((pt,i)=> (i===0? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`)).join(" ");
    const dots = xy.map(pt=>`<circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#00BFA5"></circle>`).join("");

    el.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">
        <polyline points="${xy.map(pt=>`${pt.x},${pt.y}`).join(' ')}" fill="none" stroke="#00BFA5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
      <div class="evo-points">
        ${points.map(p=>`<div><div class="evo-point-value">${Utils.fmt(p.value, dec)}</div><div class="evo-point-label">${Utils.fmtDateShort(p.date)}</div></div>`).join("")}
      </div>`;
  }
};

/* =============================== VIEWS: CONFIG ============================= */

Views.config = {
  init(){
    document.querySelectorAll("#configTabs .tab").forEach(tab=>{
      tab.addEventListener("click", ()=>{
        document.querySelectorAll("#configTabs .tab").forEach(t=>t.classList.remove("is-active"));
        tab.classList.add("is-active");
        document.querySelectorAll(".config-panel").forEach(p=>p.classList.remove("is-active"));
        document.getElementById(`panel-${tab.dataset.tab}`).classList.add("is-active");
      });
    });

    document.getElementById("formAddApp").addEventListener("submit", async e=>{
      e.preventDefault();
      const input = document.getElementById("newAppName");
      if(!input.value.trim()) return;
      await Store.addApp(input.value.trim());
      input.value = "";
      await persistAndReload(); switchView("config"); Utils.toast("Aplicación agregada.", "ok");
    });
    document.getElementById("formAddBranch").addEventListener("submit", async e=>{
      e.preventDefault();
      const input = document.getElementById("newBranchName");
      if(!input.value.trim()) return;
      await Store.addBranch(input.value.trim());
      input.value = "";
      await persistAndReload(); switchView("config"); Utils.toast("Sucursal agregada.", "ok");
    });
    document.getElementById("formAddBrand").addEventListener("submit", async e=>{
      e.preventDefault();
      const name = document.getElementById("newBrandName");
      const short = document.getElementById("newBrandShort");
      const color = document.getElementById("newBrandColor");
      const logoInput = document.getElementById("newBrandLogo");
      if(!name.value.trim()) return;
      let logo = null;
      if(logoInput.files && logoInput.files[0]) logo = await Utils.fileToDataUrl(logoInput.files[0]);
      await Store.addBrand({ name: name.value.trim(), shortName: short.value.trim(), color: color.value, logo });
      name.value = ""; short.value = ""; logoInput.value = "";
      await persistAndReload(); switchView("config"); Utils.toast("Marca agregada.", "ok");
    });

    document.getElementById("btnSavePrefs").addEventListener("click", async ()=>{
      const rating = parseInt(document.getElementById("prefDecRating").value, 10);
      const variation = parseInt(document.getElementById("prefDecVariation").value, 10);
      await Store.savePrefs({ rating, variation });
      await persistAndReload();
      Utils.toast("Preferencias guardadas.", "ok");
    });
    document.getElementById("btnClearHistory").addEventListener("click", async ()=>{
      if(!confirm("Esto borrará TODAS las calificaciones y semanas guardadas (incluyendo las de ejemplo), pero conservará tus aplicaciones, sucursales y marcas tal como están configuradas. ¿Continuar?")) return;
      await Store.clearRatingsHistory();
      await persistAndReload(); switchView("captura");
      Utils.toast("Historial de calificaciones borrado. Catálogos intactos.", "ok");
    });
    document.getElementById("btnResetDemo").addEventListener("click", async ()=>{
      if(!confirm("Esto reemplazará TODOS los datos actuales por los datos de demostración originales. ¿Continuar?")) return;
      await Store.resetToDemo();
      await persistAndReload(); switchView("dashboard");
      Utils.toast("Datos de demostración restaurados.", "ok");
    });
  },
  render(){
    this.renderList("apps", "listApps", "apps");
    this.renderList("branches", "listBranches", "branches");
    this.renderBrandList();
    const dec = State.db.meta.decimals;
    document.getElementById("prefDecRating").value = String(dec.rating);
    document.getElementById("prefDecVariation").value = String(dec.variation);
  },
  renderList(kind, elId, cascadeKindLabel){
    const db = State.db;
    const list = allSorted(db[kind]);
    const el = document.getElementById(elId);
    const cascadeField = kind === "apps" ? "appId" : "branchId";
    if(!list.length){ el.innerHTML = `<div class="empty-hint">Sin registros todavía.</div>`; return; }
    el.innerHTML = list.map(item=>`
      <div class="catalog-row ${item.active ? '' : 'is-inactive'}" data-id="${item.id}">
        <div class="order-btns">
          <button data-act="up" title="Subir">▲</button>
          <button data-act="down" title="Bajar">▼</button>
        </div>
        <div class="catalog-row-name"><input type="text" value="${Utils.escapeHtml(item.name)}" data-field="name"></div>
        <button class="chip-toggle ${item.active?'on':'off'}" data-act="toggle">${item.active?'Activa':'Inactiva'}</button>
        <div class="catalog-row-actions"><button class="btn btn-danger-ghost btn-sm" data-act="delete">Eliminar</button></div>
      </div>`).join("");

    el.querySelectorAll(".catalog-row").forEach(row=>{
      const id = row.dataset.id;
      row.querySelector('input[data-field="name"]').addEventListener("change", async e=>{
        await Store.updateCatalogItem(kind, id, { name: e.target.value.trim() || "Sin nombre" });
        await persistAndReload(); switchView("config");
      });
      row.querySelector('[data-act="toggle"]').addEventListener("click", async ()=>{
        const item = byId(db[kind], id);
        await Store.updateCatalogItem(kind, id, { active: !item.active });
        await persistAndReload(); switchView("config");
      });
      row.querySelector('[data-act="up"]').addEventListener("click", async ()=>{ await Store.reorderCatalogItem(kind, id, "up"); await persistAndReload(); switchView("config"); });
      row.querySelector('[data-act="down"]').addEventListener("click", async ()=>{ await Store.reorderCatalogItem(kind, id, "down"); await persistAndReload(); switchView("config"); });
      row.querySelector('[data-act="delete"]').addEventListener("click", async ()=>{
        if(!confirm("Esto eliminará el registro y todo su historial de calificaciones asociado. ¿Continuar?")) return;
        await Store.deleteCatalogItem(kind, id, cascadeField);
        await persistAndReload(); switchView("config"); Utils.toast("Eliminado.", "ok");
      });
    });
  },
  renderBrandList(){
    const db = State.db;
    const list = allSorted(db.brands);
    const el = document.getElementById("listBrands");
    if(!list.length){ el.innerHTML = `<div class="empty-hint">Sin marcas todavía.</div>`; return; }
    el.innerHTML = list.map(item=>`
      <div class="catalog-row ${item.active ? '' : 'is-inactive'}" data-id="${item.id}" style="grid-template-columns:auto auto 1fr auto auto auto;">
        <div class="order-btns">
          <button data-act="up" title="Subir">▲</button>
          <button data-act="down" title="Bajar">▼</button>
        </div>
        ${brandLogoHtml(item, 30)}
        <div class="catalog-row-name">
          <input type="text" value="${Utils.escapeHtml(item.name)}" data-field="name" style="margin-bottom:4px;">
          <input type="text" value="${Utils.escapeHtml(item.shortName||'')}" data-field="shortName" placeholder="Nombre corto" style="font-weight:500;font-size:12px;">
        </div>
        <input type="color" value="${item.color}" data-field="color" title="Color">
        <button class="chip-toggle ${item.active?'on':'off'}" data-act="toggle">${item.active?'Activa':'Inactiva'}</button>
        <div class="catalog-row-actions"><button class="btn btn-danger-ghost btn-sm" data-act="delete">Eliminar</button></div>
      </div>`).join("");

    el.querySelectorAll(".catalog-row").forEach(row=>{
      const id = row.dataset.id;
      row.querySelector('input[data-field="name"]').addEventListener("change", async e=>{
        await Store.updateCatalogItem("brands", id, { name: e.target.value.trim() || "Sin nombre" });
        await persistAndReload(); switchView("config");
      });
      row.querySelector('input[data-field="shortName"]').addEventListener("change", async e=>{
        await Store.updateCatalogItem("brands", id, { shortName: e.target.value.trim() });
        await persistAndReload(); switchView("config");
      });
      row.querySelector('input[data-field="color"]').addEventListener("change", async e=>{
        await Store.updateCatalogItem("brands", id, { color: e.target.value });
        await persistAndReload(); switchView("config");
      });
      row.querySelector('[data-act="toggle"]').addEventListener("click", async ()=>{
        const item = byId(db.brands, id);
        await Store.updateCatalogItem("brands", id, { active: !item.active });
        await persistAndReload(); switchView("config");
      });
      row.querySelector('[data-act="up"]').addEventListener("click", async ()=>{ await Store.reorderCatalogItem("brands", id, "up"); await persistAndReload(); switchView("config"); });
      row.querySelector('[data-act="down"]').addEventListener("click", async ()=>{ await Store.reorderCatalogItem("brands", id, "down"); await persistAndReload(); switchView("config"); });
      row.querySelector('[data-act="delete"]').addEventListener("click", async ()=>{
        if(!confirm("Esto eliminará la marca y todo su historial de calificaciones asociado. ¿Continuar?")) return;
        await Store.deleteCatalogItem("brands", id, "brandId");
        await persistAndReload(); switchView("config"); Utils.toast("Eliminada.", "ok");
      });
    });
  }
};

/* =============================== IMPORT / EXPORT GLOBAL ==================== */

const DataIO = {
  exportJson(){
    const db = State.db;
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    Utils.downloadBlob(blob, `cofki-respaldo-${Utils.todayISO()}.json`);
    Utils.toast("Respaldo JSON descargado.", "ok");
  },
  exportCsv(){
    const db = State.db;
    const weeksById = Object.fromEntries(db.weeks.map(w=>[w.id,w]));
    const appsById = Object.fromEntries(db.apps.map(a=>[a.id,a]));
    const branchesById = Object.fromEntries(db.branches.map(b=>[b.id,b]));
    const brandsById = Object.fromEntries(db.brands.map(m=>[m.id,m]));
    const header = ["fecha_semana","aplicacion","sucursal","marca","calificacion"];
    const rows = db.ratings
      .slice()
      .sort((a,b)=> (weeksById[a.weekId]?.date||"").localeCompare(weeksById[b.weekId]?.date||""))
      .map(r=>[
        weeksById[r.weekId]?.date || "",
        appsById[r.appId]?.name || "",
        branchesById[r.branchId]?.name || "",
        brandsById[r.brandId]?.name || "",
        r.value ?? ""
      ]);
    const csv = [header, ...rows].map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF"+csv], { type: "text/csv;charset=utf-8" });
    Utils.downloadBlob(blob, `cofki-historial-${Utils.todayISO()}.csv`);
    Utils.toast("Historial CSV descargado.", "ok");
  },
  openImportDialog(){ document.getElementById("importFileInput").click(); },
  async handleImportFile(file){
    if(!file) return;
    try{
      const text = await file.text();
      const parsed = JSON.parse(text);
      const requiredKeys = ["apps","branches","brands","weeks","ratings","meta"];
      const ok = requiredKeys.every(k=>Object.prototype.hasOwnProperty.call(parsed, k));
      if(!ok) throw new Error("Estructura inválida");
      if(!confirm("Esto reemplazará todos los datos actuales con el archivo importado. ¿Continuar?")) return;
      await Store.replaceAll(parsed);
      await persistAndReload(); switchView("dashboard");
      Utils.toast("Datos importados correctamente.", "ok");
    }catch(e){
      console.error(e);
      Utils.toast("El archivo no es un respaldo válido.", "error");
    }
  }
};

/* =============================== RENDER ALL ================================ */

function renderAll(){
  Views.reporte.refreshSelectors();
  if(State.currentView === "dashboard") Views.dashboard.render();
  if(State.currentView === "captura") Views.captura.render();
  if(State.currentView === "historial") Views.historial.render();
  if(State.currentView === "config") Views.config.render();
}

/* =============================== APP INIT =================================== */

async function init(){
  await loadDb();

  document.querySelectorAll(".nav-item").forEach(btn=>{
    btn.addEventListener("click", ()=>switchView(btn.dataset.view));
  });

  Views.dashboard.init();
  Views.dashboard.refreshSelectors();
  Views.captura.init();
  Views.reporte.init();
  Views.reporte.refreshSelectors();
  Views.historial.init();
  Views.config.init();

  document.getElementById("btnExportJson").addEventListener("click", ()=>DataIO.exportJson());
  document.getElementById("btnExportJson2").addEventListener("click", ()=>DataIO.exportJson());
  document.getElementById("btnExportCsv").addEventListener("click", ()=>DataIO.exportCsv());
  document.getElementById("btnImportOpen").addEventListener("click", ()=>DataIO.openImportDialog());
  document.getElementById("btnImportOpen2").addEventListener("click", ()=>DataIO.openImportDialog());
  document.getElementById("importFileInput").addEventListener("change", e=>{
    const f = e.target.files[0];
    DataIO.handleImportFile(f);
    e.target.value = "";
  });

  Views.dashboard.render();
}

document.addEventListener("DOMContentLoaded", init);

})();
