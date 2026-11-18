const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
// HTTP sur une adresse LAN n'est pas toujours un contexte sécurisé : crypto.randomUUID peut y être indisponible.
const uid = () => (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') ? globalThis.crypto.randomUUID() : `nova-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const api = async (url, options={}) => {
  const token = localStorage.getItem('novaToken');
  const headers = { 'Content-Type':'application/json', ...(options.headers||{}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(body.error || 'Une erreur est survenue.');
  return body;
};
const defaultState = () => ({
  projects:[], tasks:[], notes:[], knowledge:[], novaiMemory:[], novaiSandbox:[], novaiChat:[],
  learnDatasets:[], learnExperiments:[], learnArtifacts:[],
  seriesStudio:{title:'',format:'Série animée 3D',genre:'',logline:'',episodes:[],characters:[],shots:[],boards:[],script:'',productionStatus:'Développement',targetDate:'',budget:0,assets:[],productionTasks:[],structuredScript:{schemaVersion:1,characters:[],scenes:[],activeSceneId:null}},
  storeDrafts:[], roadmap:[], automations:[], focusSessions:[], codeFiles:[],
  featureFlags:{}, favoritePrompts:[],
  preferences:{theme:'dark',accent:'purple',animations:true,glow:true,compact:false,fontScale:'normal',reducedTransparency:false,liquidGlass:true,supernova:true,highContrast:false,starfield:true,intro:true,sound:false,privateMode:false,microInteractions:true,performanceMode:false,tourVersion:0,novaiActions:true}
});
const DEFAULT_PREFERENCES={theme:'dark',accent:'purple',animations:true,glow:true,compact:false,fontScale:'normal',reducedTransparency:false,liquidGlass:true,supernova:true,highContrast:false,starfield:true,intro:true,sound:false,privateMode:false,microInteractions:true,performanceMode:false,tourVersion:0,novaiActions:true};
const WORKSPACE_PREFIX='novaWorkspace:';
function currentUserId(){const token=localStorage.getItem('novaToken');if(!token)return null;try{const part=token.split('.')[1];if(!part)return null;const payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));return typeof payload.sub==='string'?payload.sub:null}catch{return null}}
function workspaceKey(userId=currentUserId()){return userId?`${WORKSPACE_PREFIX}${userId}`:`${WORKSPACE_PREFIX}guest`}
// Migration unique de l'ancienne clé globale : elle revient au compte connecté au moment
// de la mise à jour, ou au mode invité si personne n'est connecté.
(function migrateLegacyWorkspace(){try{const legacy=localStorage.getItem('novaWorkspace');if(legacy===null)return;const key=workspaceKey();if(localStorage.getItem(key)===null){localStorage.setItem(key,legacy);try{localStorage.setItem(`novaWorkspace:legacy-backup:${new Date().toISOString()}`,legacy)}catch{}}localStorage.removeItem('novaWorkspace')}catch{}})();
function loadWorkspace(userId=currentUserId()){try{const raw=localStorage.getItem(workspaceKey(userId));const d=raw?JSON.parse(raw):null;if(!d)return defaultState();return {...defaultState(),...d,preferences:{...DEFAULT_PREFERENCES,...(d.preferences||{})}}}catch{return defaultState()}}
let state = loadWorkspace(), page='overview', plugins=[], chatHistory=[], analytics={totals:[],recent:[]}, toastTimer;
let cloudSyncTimer=null, cloudSyncSuppressed=false;
// Tant que la session n'est pas résolue, on n'écrit pas l'espace de travail : sinon le
// rendu initial (vide) serait horodaté et écraserait les données serveur à la restauration.
let workspaceReady=!localStorage.getItem('novaToken');
function setSyncLabel(text){const el=$('#syncState');if(el)el.textContent=text}
function scheduleCloudSync(){
 if(!workspaceReady||cloudSyncSuppressed||!currentUserId())return;
 if(state.preferences?.privateMode===true){setSyncLabel('Mode privé local');return;}
 clearTimeout(cloudSyncTimer);
 cloudSyncTimer=setTimeout(()=>{
  cloudSyncTimer=null;if(!currentUserId())return;
  const snapshot=JSON.stringify({data:state});
  api('/api/sync',{method:'PUT',body:snapshot}).then(()=>setSyncLabel('Synchronisé')).catch(()=>setSyncLabel('Synchronisation en attente'));
 },1500);
}
function loadLocal(){return loadWorkspace()}
function saveLocal(sync=true){if(!workspaceReady)return;try{state._novaUpdatedAt=new Date().toISOString();localStorage.setItem(workspaceKey(),JSON.stringify(state))}catch{}if(sync)scheduleCloudSync()}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);playUiSound()}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function applyPreferences(){
  const p=state.preferences||{};
  document.body.classList.toggle('light',p.theme==='light');
  document.body.dataset.theme=p.theme||'dark';
  document.body.dataset.accent=p.accent||'purple';
  document.body.classList.toggle('no-animations',p.animations===false);
  document.body.classList.toggle('no-glow',p.glow===false);
  document.body.classList.toggle('compact-ui',p.compact===true); document.body.dataset.fontScale=p.fontScale||'normal'; document.body.classList.toggle('reduced-transparency',p.reducedTransparency===true);
  document.body.classList.toggle('feature-liquid-glass',p.liquidGlass!==false);
  document.body.classList.toggle('feature-supernova',p.supernova!==false);
  document.body.classList.toggle('feature-high-contrast',p.highContrast===true);
  document.body.classList.toggle('feature-starfield',p.starfield!==false);
  document.body.classList.toggle('feature-micro',p.microInteractions!==false);
  document.body.classList.toggle('feature-private',p.privateMode===true);
  /* Mode performance : coupe la 3D de fond et les effets coûteux sans toucher aux données.
     La préférence est persistée et reprise au démarrage suivant. */
  const perfLite=p.performanceMode===true;
  document.body.classList.toggle('perf-lite',perfLite);
  if(perfLite){if(window.NovaFX)window.NovaFX.q='off';if(window.NovaScene?.setQuality)window.NovaScene.setQuality('off')}
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta)meta.content=p.theme==='light'?'#f4f6fb':'#080a12';
}
function setTheme(theme){state.preferences.theme=theme;applyPreferences();saveLocal();if(page==='account')render()}
function setFontScale(value){state.preferences.fontScale=['normal','large','xlarge'].includes(value)?value:'normal';applyPreferences();saveLocal();toast('Taille du texte mise à jour.')}
function setAccent(accent){state.preferences.accent=accent;applyPreferences();saveLocal();if(page==='account')render();toast('Couleur d’accent mise à jour.')}
function setVisualOption(key,value){state.preferences[key]=value;applyPreferences();saveLocal();if(key==='animations')toast(value?'Animations activées.':'Animations réduites.');else if(key==='glow')toast(value?'Effets lumineux activés.':'Effets lumineux désactivés.');else toast(value?'Mode compact activé.':'Mode confortable activé.')}
/* ------------------------------------------------------------------ Langue, tutoriel, performance */
const TOUR_VERSION=1;
function currentUiLang(){const value=(document.documentElement.lang||'fr').toLowerCase();return value.startsWith('en')?'en':'fr'}
function syncLanguageButton(){const btn=$('#languageBtn');if(!btn)return;btn.textContent=currentUiLang().toUpperCase();btn.title=currentUiLang()==='fr'?'Changer la langue (FR / EN)':'Change language (FR / EN)'}
function setLanguage(lang,options={}){
  const next=window.NovaI18n?window.NovaI18n.set(lang,{notify:options.notify!==false}):currentUiLang();
  try{localStorage.setItem('novaLang',next)}catch{}
  syncLanguageButton();
  if(options.toast!==false&&window.t)toast(window.t(next==='fr'?'toast.lang':'toast.langEn'));
  return next;
}
function setPerformanceMode(on,options={}){
  const lite=on===true;
  state.preferences.performanceMode=lite;
  applyPreferences();saveLocal();
  if(!lite){const q=window.NovaFX?.q==='off'?'normal':(window.NovaFX?.q||'normal');if(window.NovaScene?.setQuality)window.NovaScene.setQuality(q)}
  if(!options.silent){if(window.t)toast(window.t(lite?'toast.perfOn':'toast.perfOff'));if(page==='account')render()}
}
function setNovaiActions(on){
  state.preferences.novaiActions=on===true;saveLocal();
  if(page==='account')render();
  toast(on? 'NOVAI peut exécuter des actions whitelistées.' : 'NOVAI propose les actions sans les exécuter.');
}
function startTour(force=false){if(window.NovaTour)return window.NovaTour.start(force);toast('Tutoriel indisponible dans ce mode.')}
function maybeStartTour(){
  try{
    if(Number(state.preferences?.tourVersion||0)>=TOUR_VERSION)return;
    const blocked=()=>!!document.querySelector('#termsGate.visible,#authGate.visible');
    setTimeout(()=>{if(!blocked())startTour(false)},900);
  }catch{/* préférences indisponibles */}
}
window.setLanguage=setLanguage;window.setPerformanceMode=setPerformanceMode;window.setNovaiActions=setNovaiActions;window.startTour=startTour;
document.addEventListener('nova:tourdone',event=>{
  const version=Number(event.detail?.version)||TOUR_VERSION,skipped=!!event.detail?.skipped;
  /* Un « Passer » sans cocher « Ne plus afficher » ne marque pas le tutoriel comme vu :
     il sera reproposé à la prochaine connexion. Terminer coche toujours. */
  if(event.detail?.persist!==false){state.preferences.tourVersion=version;saveLocal()}
  const box=$('#novaTour');if(box){box.hidden=true;box.innerHTML=''}
  if(window.t)toast(window.t(skipped?'toast.tourSkipped':'toast.tourDone'));
});
document.addEventListener('nova:langchange',()=>{syncLanguageButton()});

function previewAIStatus(){refreshAIStatus()}
const NAV_PAGES=new Set(['overview','projects','tasks','notes','calendar','focus','knowledge','studio','novaengine','novaseries','novastore','retroedge','ai','learnlab','cloud','plugins','api','automation','analytics','account','roadmap','search','system','developer','featurelab','anim3d']);
let navHistoryReady=false;
function pageFromUrl(){const value=new URLSearchParams(location.search).get('page');return value&&NAV_PAGES.has(value)?value:'overview'}
function syncPageUrl(next,options={}){
 if(!navHistoryReady||options.history==='none')return;
 const url=new URL(location.href);
 if(next==='overview')url.searchParams.delete('page');else url.searchParams.set('page',next);
 url.searchParams.delete('verifyEmail');
 const target=url.pathname+(url.search||'')+url.hash;
 try{if(options.history==='push')history.pushState({page:next},'',target);else history.replaceState({page:next},'',target)}catch{}
}
function setPage(next,options={}){if(!NAV_PAGES.has(next))next='overview';const previous=page;page=next; $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));if(next!==previous&&next!=='overview')logDashboardActivity(`Ouverture de ${({projects:'Projets',tasks:'Tâches',notes:'Notes',calendar:'Calendrier',focus:'Nova Focus',knowledge:'Knowledge Base',studio:'Code Studio',novaengine:'Nova Engine',novaseries:'NovaSeries',cloud:'NovaCloud',ai:'Nova AI',roadmap:'Roadmap',search:'Recherche globale',analytics:'Analytics',system:'Centre système'}[next]||next)}`,'navigation','Navigation dans NovaCore');const labels={overview:['NovaOS · Centre de contrôle','Ton centre de commande : projets, outils, activité et prochaines actions.'],projects:['Projets','Chaque grande idée commence ici.'],tasks:['Tâches','Transformez vos objectifs en progrès.'],notes:['Notes','Capturez les idées qui comptent.'],calendar:['Calendrier','Planifiez vos échéances et vos prochaines étapes.'],focus:['Nova Focus','Concentrez-vous, une session à la fois.'],knowledge:['Knowledge Base','Construisez votre mémoire de travail consultable.'],studio:['Code Studio','Écrivez, sauvegardez et exportez vos snippets.'],novaengine:['Nova Engine Workbench','Configure, compile, teste et lance le socle C++ de Nova Engine directement depuis NovaCore.'],novaseries:['NovaSeries Studio','Atelier de préproduction pour séries animées 2D/3D : bible, personnages, épisodes, storyboard et plans.'],novastore:['NovaStore · En développement','Prépare tes idées, prototypes et fiches de présentation pour la future place de marché NovaStore.'],retroedge:['RetroEdge · The Future Is Edge','Projet de plateforme logicielle légère pour consoles portables d’émulation.'],ai:['NOVAI','L’intelligence NovaCore : assistant, développement, création et laboratoire d’apprentissage.'],learnlab:['Learn Lab Studio','Jeux de données versionnés, évaluations comparables, modèles et sandbox de prototypage.'],cloud:['NovaCloud Sync','Vos données, synchronisées entre appareils.'],plugins:['NovaPlugins','Personnalisez votre environnement.'],api:['API Explorer','Découvrez et testez les routes de NovaCore.'],automation:['Automations','Créez des routines et lancez-les manuellement.'],analytics:['Nova Analytics','Comprenez votre activité en un coup d’œil.'],account:['Compte & sécurité','Gérez votre identité NovaID.'],roadmap:['Roadmap & Releases','Pilote les prochaines étapes de NovaCore.'],search:['Recherche globale','Retrouve rapidement projets, tâches, notes et ressources.'],system:['Centre système','État du serveur, diagnostic et capacités disponibles.'],developer:['Mode développeur','Outils avancés de diagnostic et configuration de NovaCore.'],featurelab:['Nova Feature Lab','Explore, filtre et active les modules de ton écosystème.'],anim3d:['Studio 3D · Animations','Crée et personnalise l’animation 3D de chaque page.']};$('#crumb').textContent=labels[page][0];$('#pageTitle').innerHTML=esc(labels[page][0])+(page==='overview'?' <span class="spark">✦</span>':'');$('#pageSub').textContent=labels[page][1];document.title=`${labels[page][0]} · NovaCore`;$$('.nav').forEach(b=>{if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});syncPageUrl(next,options);render();if(previous!==next&&options.focus!==false)requestAnimationFrame(()=>{const heading=$('#pageTitle');if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true})}window.scrollTo({top:0,behavior:'auto'})})}
function stat(label,value,foot,icon,cls=''){return `<div class="card"><div class="card-head"><span class="stat-label">${label}</span><span class="stat-icon ${cls}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`}
function empty(title,desc){return `<div class="empty"><b>${title}</b><p>${desc}</p></div>`}
function projectCard(p){return `<div class="card project-card"><div class="project-top"><div class="project-symbol">${p.name.toLowerCase().includes('cloud')?'☁':p.name.toLowerCase().includes('ai')?'✧':p.name.toLowerCase().includes('series')?'▶':p.name.toLowerCase().includes('store')?'▦':p.name.toLowerCase().includes('technologie')?'⚙':'◈'}</div><span class="badge">${p.progress}%</span></div><h3>${esc(p.name)}</h3><p>${esc(p.description||'Aucune description.')}</p><div class="progress-meta"><span>Progression</span><span>${p.progress}%</span></div><div class="progress"><span style="width:${p.progress}%"></span></div><div class="actions"><button class="secondary" onclick="advanceProject('${p.id}')">+10 %</button><button class="secondary" onclick="deleteProject('${p.id}')">Supprimer</button></div></div>`}
function taskRow(t){return `<div class="task-row ${t.done?'completed':''}"><button class="check ${t.done?'done':''}" aria-label="${t.done?'Rouvrir':'Terminer'} : ${esc(t.title)}" onclick="toggleTask('${t.id}')">${t.done?'✓':''}</button><div class="task-copy"><b>${esc(t.title)}</b><small>${esc(t.project||'Sans projet')}</small></div><span class="badge ${t.priority==='Haute'?'red':t.priority==='Moyenne'?'orange':'green'}">${esc(t.priority)}</span></div>`}
const NOVAOS_WIDGETS=[
 {id:'brief',label:'Brief du jour',description:'Les priorités calculées depuis tes données réelles.'},
 {id:'pulse',label:'Indicateurs',description:'Les chiffres essentiels de ton espace.'},
 {id:'launchpad',label:'Accès rapides',description:'Les principaux outils NovaCore.'},
 {id:'tasks',label:'Prochaines actions',description:'Tes tâches ouvertes et prioritaires.'},
 {id:'projects',label:'Projets actifs',description:'L’avancement de tes univers de travail.'},
 {id:'notifications',label:'Centre de notifications',description:'Les éléments qui réclament ton attention.'},
 {id:'activity',label:'Activité récente',description:'Les dernières actions enregistrées localement.'},
 {id:'personalize',label:'Personnalisation',description:'Organise NovaOS à ta façon.'}
];
const NOVAOS_DEFAULT_ORDER=NOVAOS_WIDGETS.map(w=>w.id);
function logDashboardActivity(title,type='workspace',detail=''){
 state.dashboardActivity=Array.isArray(state.dashboardActivity)?state.dashboardActivity:[];
 state.dashboardActivity.unshift({id:uid(),title:String(title).slice(0,140),type,detail:String(detail||'').slice(0,180),at:new Date().toISOString()});
 state.dashboardActivity=state.dashboardActivity.slice(0,40);
 saveLocal(false);
}
function novaOSModuleCard(icon,title,subtitle,target,tag='OPEN'){
 return `<button class="novaos-launch" type="button" onclick="setPage('${target}')"><span class="novaos-launch-icon">${icon}</span><span class="novaos-launch-copy"><b>${esc(title)}</b><small>${esc(subtitle)}</small></span><span class="novaos-launch-tag">${esc(tag)}</span><span class="novaos-launch-arrow">↗</span></button>`;
}
function novaOSBriefData(){
 const tasks=Array.isArray(state.tasks)?state.tasks:[],projects=Array.isArray(state.projects)?state.projects:[],notes=Array.isArray(state.notes)?state.notes:[];
 const today=new Date();today.setHours(0,0,0,0);
 const open=tasks.filter(t=>!t.done);
 const overdue=open.filter(t=>taskDueKey(t)&&new Date(`${taskDueKey(t)}T23:59:59`)<today);
 const dueToday=open.filter(t=>taskDueKey(t)===calendarDayKey(today));
 const high=open.filter(t=>t.priority==='Haute');
 const active=projects.filter(p=>(Number(p.progress)||0)<100);
 const focusToday=(state.focusSessions||[]).filter(s=>{const d=new Date(s.completedAt);return !Number.isNaN(d.getTime())&&calendarDayKey(d)===calendarDayKey(today)}).reduce((a,s)=>a+(Number(s.minutes)||0),0);
 return {tasks,projects,notes,open,overdue,dueToday,high,active,focusToday};
}
function novaOSBriefItem(item){return `<button class="novaos-brief-item ${item.tone||''}" type="button" onclick="${item.action||`setPage('${item.target}')`}"><span class="novaos-brief-icon">${item.icon}</span><span><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></span><i>↗</i></button>`}
function novaOSBrief(){
 const d=novaOSBriefData();
 const hour=new Date().getHours(),moment=hour<12?'Bonjour':hour<18?'Bon après-midi':'Bonsoir';
 const firstName=($('#userName')?.textContent||'Créateur').trim().split(/\s+/)[0]||'Créateur';
 const dateLabel=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
 const items=[];
 if(d.overdue.length)items.push({icon:'!',tone:'urgent',title:`${d.overdue.length} tâche${d.overdue.length>1?'s':''} en retard`,detail:d.overdue.slice(0,2).map(t=>t.title).join(' · '),target:'tasks'});
 if(d.dueToday.length)items.push({icon:'◷',tone:'warn',title:`${d.dueToday.length} échéance${d.dueToday.length>1?'s':''} aujourd’hui`,detail:d.dueToday.slice(0,2).map(t=>t.title).join(' · '),target:'calendar'});
 if(d.high.length&&!d.overdue.length)items.push({icon:'▲',tone:'warn',title:`${d.high.length} priorité${d.high.length>1?'s':''} haute${d.high.length>1?'s':''}`,detail:d.high.slice(0,2).map(t=>t.title).join(' · '),target:'tasks'});
 d.active.slice(0,3).forEach(p=>items.push({icon:'◈',tone:'',title:p.name,detail:`Projet actif · ${Math.max(0,Math.min(100,Number(p.progress)||0))}% d’avancement`,target:'projects'}));
 if(d.projects.length&&!d.open.length)items.push({icon:'✓',tone:'good',title:'Toutes les tâches sont terminées',detail:'Tu peux avancer un projet ou capturer une nouvelle idée.',target:'projects'});
 if(!items.length&&!d.projects.length)items.push({icon:'＋',tone:'info',title:'Créer ton premier projet',detail:'Donne une structure à ton idée pour démarrer.',target:'projects'});
 if(!items.length)items.push({icon:'▤',tone:'info',title:'Capturer une idée',detail:'Ajoute une note rapide à ton workspace.',target:'notes'});
 const focus=d.focusToday>0?`${d.focusToday} min de focus aujourd’hui`:'Aucune session Focus aujourd’hui';
 const summary=d.open.length?`${d.open.length} tâche${d.open.length>1?'s':''} ouverte${d.open.length>1?'s':''} · ${d.active.length} projet${d.active.length>1?'s':''} actif${d.active.length>1?'s':''}`:`${d.active.length} projet${d.active.length>1?'s':''} actif${d.active.length>1?'s':''} · aucune tâche ouverte`;
 const headline=d.overdue.length?'On commence par rattraper le retard.':d.dueToday.length?'Les échéances du jour sont prêtes.':d.open.length?'Voici ce qui mérite ton attention.':'Ta journée est libre, choisis ton prochain mouvement.';
 return `<section class="novaos-brief" aria-label="Brief du jour"><div class="novaos-brief-head"><span class="novaos-brief-orb" aria-hidden="true">✦</span><div><span class="eyebrow">BRIEF DU JOUR · DONNÉES RÉELLES</span><h2>${moment} ${esc(firstName)}. <em>${esc(headline)}</em></h2><p>${esc(summary)} · ${esc(focus)}</p></div><time datetime="${new Date().toISOString().slice(0,10)}">${esc(dateLabel)}</time></div><div class="novaos-brief-items">${items.slice(0,4).map(novaOSBriefItem).join('')}</div></section>`;
}
function novaOSWidget(id,content,wide=true){
 const hidden=(state.preferences.dashboardHidden||[]).includes(id);
 return `<section class="novaos-widget ${wide?'novaos-widget-wide':''} ${hidden?'novaos-widget-hidden':''}" data-widget="${id}" draggable="true"><div class="novaos-widget-content">${content}</div></section>`;
}
function novaOSActivityMarkup(){
 const list=(state.dashboardActivity||[]).slice(0,6);
 if(!list.length)return `<div class="novaos-empty"><span>✦</span><div><b>Ton espace est prêt</b><small>Les actions importantes apparaîtront ici au fil de ton travail.</small></div></div>`;
 return `<div class="novaos-activity-list">${list.map((a,i)=>`<div class="novaos-activity-item"><span class="novaos-activity-orb">${a.type==='task'?'✓':a.type==='project'?'◈':a.type==='note'?'▤':a.type==='navigation'?'↗':'✦'}</span><div><b>${esc(a.title)}</b><small>${esc(a.detail||'Activité NovaCore')}</small></div><time>${Number.isFinite(Date.parse(a.at))?new Date(a.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):''}</time></div>`).join('')}</div>`;
}
function novaOSNotifications(){
 const open=state.tasks.filter(t=>!t.done),urgent=open.filter(t=>t.priority==='Haute');
 const items=[];
 urgent.slice(0,3).forEach(t=>items.push({icon:'!',tone:'urgent',title:t.title,detail:`Priorité haute${t.project?' · '+t.project:''}`,target:'tasks'}));
 if(!state.projects.length)items.push({icon:'＋',tone:'info',title:'Créer ton premier projet',detail:'Commence par donner une structure à ton idée.',target:'projects'});
 if(state.seriesStudio&&!(state.seriesStudio.title||'').trim())items.push({icon:'▶',tone:'info',title:'Compléter la bible NovaSeries',detail:'Ajoute un titre et un pitch de projet.',target:'novaseries'});
 if(!items.length)items.push({icon:'✓',tone:'good',title:'Aucune alerte prioritaire',detail:open.length?`${open.length} tâche(s) restent à traiter.`:'Tout est à jour dans ton espace.',target:open.length?'tasks':'overview'});
 return `<div class="novaos-notification-list">${items.slice(0,4).map(n=>`<button class="novaos-notification" type="button" onclick="setPage('${n.target}')"><span class="novaos-notification-icon ${n.tone}">${n.icon}</span><span><b>${esc(n.title)}</b><small>${esc(n.detail)}</small></span><i>↗</i></button>`).join('')}</div>`;
}
function novaOSQuickSearch(){const input=$('#novaosSearch');if(!input)return;const q=input.value.trim();if(!q)return toast('Écris un terme à rechercher.');setPage('search');setTimeout(()=>{const target=$('#globalSearchInput');if(target){target.value=q;runGlobalSearch();target.focus()}},100)}
const COMMAND_PAGE_ENTRIES=[
 ['overview','NovaOS','Centre de contrôle','accueil dashboard home'],
 ['projects','Projets','Univers de travail',''],
 ['tasks','Tâches','Actions et priorités','todo'],
 ['notes','Notes','Idées et captures',''],
 ['calendar','Calendrier','Échéances de la semaine','planning'],
 ['focus','Nova Focus','Minuteur de concentration','pomodoro'],
 ['knowledge','Knowledge Base','Ressources personnelles',''],
 ['studio','Code Studio','Snippets locaux','code'],
 ['novaengine','Nova Engine','Workbench C++','moteur'],
 ['novaseries','NovaSeries Studio','Préproduction audiovisuelle','série'],
 ['novastore','NovaStore','Boutique en préparation',''],
 ['ai','NOVAI','Assistant intelligent','ia intelligence'],
 ['learnlab','Learn Lab','Datasets et évaluations',''],
 ['cloud','NovaCloud','Synchronisation',''],
 ['analytics','Analytics','Activité du compte',''],
 ['automation','Automations','Routines du workspace',''],
 ['roadmap','Roadmap & Releases','Jalons et versions',''],
 ['account','Compte & sécurité','Apparence et préférences','paramètres'],
 ['system','Centre système','Diagnostic',''],
 ['search','Recherche globale','Projets, tâches, notes','']
];
function commandCatalog(){
 const actions=[
  {id:'new-project',label:'Nouveau projet',hint:'Créer un espace de travail',icon:'＋',group:'Actions',keywords:'créer projet',run:()=>openCreate('project')},
  {id:'new-task',label:'Nouvelle tâche',hint:'Ajouter une action à réaliser',icon:'✓',group:'Actions',keywords:'créer tâche todo',run:()=>openCreate('task')},
  {id:'new-note',label:'Capture rapide',hint:'Enregistrer une idée',icon:'▤',group:'Actions',keywords:'créer note idée',run:()=>openCreate('note')},
  {id:'new-focus',label:'Lancer une session Focus',hint:'Ouvrir le minuteur Pomodoro',icon:'◷',group:'Actions',keywords:'concentration pomodoro',run:()=>setPage('focus')},
  {id:'cycle-theme',label:'Changer de thème',hint:'Alterner les ambiances de NovaCore',icon:'◐',group:'Apparence',keywords:'thème sombre clair cosmos',run:()=>{const themes=['dark','light','midnight','emerald','sunset'];const current=state.preferences?.theme||'dark';setTheme(themes[(themes.indexOf(current)+1)%themes.length]);toast('Thème : '+state.preferences.theme)}},
  {id:'reset-layout',label:'Réinitialiser la disposition NovaOS',hint:'Revenir aux widgets par défaut',icon:'↺',group:'Apparence',keywords:'réinitialiser layout widgets',run:()=>novaOSResetLayout()},
  {id:'export-workspace',label:'Exporter le workspace',hint:'Télécharger une sauvegarde JSON',icon:'⇩',group:'Données',keywords:'sauvegarde export json',run:()=>exportData()}
 ];
 return [
  ...COMMAND_PAGE_ENTRIES.map(([target,label,hint,keywords])=>({id:'page-'+target,label,hint,icon:'↗',group:'Navigation',keywords:`${label} ${hint} ${keywords} ${target}`,run:()=>setPage(target)})),
  ...actions
 ];
}
let commandPaletteOpen=false, commandMatches=[], commandSelected=0, commandLastFocus=null;
function commandFold(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function commandScore(command,query){
 const label=commandFold(command.label);
 if(label.startsWith(query))return 0;
 if(label.includes(query))return 1;
 const keywords=commandFold(command.keywords);
 if(keywords.split(' ').includes(query))return 2;
 if(commandFold(command.hint).includes(query))return 3;
 if(keywords.includes(query))return 4;
 return 5;
}
function commandFilter(){
 const q=commandFold($('#commandInput')?.value);
 const all=commandCatalog();
 commandMatches=(q?all.map(c=>({c,score:commandScore(c,q)})).filter(x=>x.score<5).sort((a,b)=>a.score-b.score).map(x=>x.c):all).slice(0,40);
 commandSelected=Math.max(0,Math.min(commandSelected,commandMatches.length-1));
 renderCommandResults();
}
function renderCommandResults(){
 const box=$('#commandResults');if(!box)return;
 if(!commandMatches.length){box.innerHTML='<div class="command-empty">Aucune commande ne correspond.</div>';return}
 let lastGroup='';
 box.innerHTML=commandMatches.map((c,i)=>{
  const group=c.group!==lastGroup?`<div class="command-group">${esc(c.group)}</div>`:'';
  lastGroup=c.group;
  return group+`<button type="button" class="command-item ${i===commandSelected?'active':''}" role="option" aria-selected="${i===commandSelected}" data-command="${esc(c.id)}" onmouseenter="commandSelect(${i})" onclick="runCommand('${esc(c.id)}')"><span class="command-icon" aria-hidden="true">${c.icon}</span><span><b>${esc(c.label)}</b><small>${esc(c.hint)}</small></span><kbd>↵</kbd></button>`;
 }).join('');
 const active=box.querySelector('.command-item.active');if(active)active.scrollIntoView({block:'nearest'});
}
function commandSelect(index){commandSelected=index;$$('#commandResults .command-item').forEach((el,i)=>{el.classList.toggle('active',i===index);el.setAttribute('aria-selected',String(i===index))})}
function openCommandPalette(){
 if(commandPaletteOpen)return;
 const overlay=$('#commandPalette');if(!overlay)return;
 commandLastFocus=document.activeElement;commandPaletteOpen=true;commandSelected=0;
 overlay.hidden=false;
 const input=$('#commandInput');if(input)input.value='';
 commandFilter();
 setTimeout(()=>$('#commandInput')?.focus(),30);
}
function closeCommandPalette(){
 if(!commandPaletteOpen)return;
 commandPaletteOpen=false;
 const overlay=$('#commandPalette');if(overlay)overlay.hidden=true;
 if(commandLastFocus&&commandLastFocus!==document.body&&typeof commandLastFocus.focus==='function'){try{commandLastFocus.focus()}catch{}}
 else $('#commandBtn')?.focus();
}
function toggleCommandPalette(){commandPaletteOpen?closeCommandPalette():openCommandPalette()}
function runCommand(id){
 const command=commandCatalog().find(c=>c.id===id);if(!command)return;
 closeCommandPalette();
 command.run();
}
function commandKeydown(e){
 if(!commandPaletteOpen)return;
 if(e.key==='ArrowDown'){e.preventDefault();commandSelect(Math.min(commandSelected+1,commandMatches.length-1))}
 else if(e.key==='ArrowUp'){e.preventDefault();commandSelect(Math.max(commandSelected-1,0))}
 else if(e.key==='Enter'){e.preventDefault();const command=commandMatches[commandSelected];if(command)runCommand(command.id)}
 else if(e.key==='Escape'){e.preventDefault();closeCommandPalette()}
}
function novaOSSetAccent(value){if(!['purple','cyan','green','pink','orange'].includes(value))return;state.preferences.accent=value;applyPreferences();saveLocal();toast('Accent NovaOS mis à jour.');}
function novaOSToggleAnimations(checked){state.preferences.animations=!!checked;applyPreferences();saveLocal();toast(checked?'Animations activées.':'Animations réduites.');}
function novaOSToggleWidget(id,checked){state.preferences.dashboardHidden=Array.isArray(state.preferences.dashboardHidden)?state.preferences.dashboardHidden:[];state.preferences.dashboardHidden=checked?state.preferences.dashboardHidden.filter(x=>x!==id):[...new Set([...state.preferences.dashboardHidden,id])];saveLocal();render();}
function novaOSResetLayout(){state.preferences.dashboardOrder=[...NOVAOS_DEFAULT_ORDER];state.preferences.dashboardHidden=[];saveLocal();render();toast('Disposition NovaOS réinitialisée.');}
function bindNovaOSDashboard(){
 const grid=$('#novaosWidgetGrid');if(!grid)return;
 grid.querySelectorAll('.novaos-widget[draggable="true"]').forEach(widget=>{
  widget.addEventListener('dragstart',e=>{if(!e.target.closest('.novaos-drag-grip')){e.preventDefault();return}widget.classList.add('is-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',widget.dataset.widget)});
  widget.addEventListener('dragend',()=>{widget.classList.remove('is-dragging');grid.querySelectorAll('.is-drop-target').forEach(x=>x.classList.remove('is-drop-target'))});
  widget.addEventListener('dragover',e=>{e.preventDefault();if(!widget.classList.contains('is-dragging'))widget.classList.add('is-drop-target');e.dataTransfer.dropEffect='move'});
  widget.addEventListener('dragleave',()=>widget.classList.remove('is-drop-target'));
  widget.addEventListener('drop',e=>{e.preventDefault();widget.classList.remove('is-drop-target');const fromId=e.dataTransfer.getData('text/plain'),moving=grid.querySelector(`[data-widget="${CSS.escape(fromId)}"]`);if(!moving||moving===widget)return;const rect=widget.getBoundingClientRect();const after=(e.clientY-rect.top)>rect.height/2;grid.insertBefore(moving,after?widget.nextSibling:widget);state.preferences.dashboardOrder=[...grid.querySelectorAll('.novaos-widget')].map(x=>x.dataset.widget);saveLocal();toast('Disposition du tableau de bord enregistrée.')});
 });
 $('#novaosSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();novaOSQuickSearch()}});
}
function renderOverview(){
 const tasks=Array.isArray(state.tasks)?state.tasks:[],projects=Array.isArray(state.projects)?state.projects:[],notes=Array.isArray(state.notes)?state.notes:[];
 const done=tasks.filter(t=>t.done).length,open=tasks.filter(t=>!t.done),progress=projects.length?Math.round(projects.reduce((a,p)=>a+(Number(p.progress)||0),0)/projects.length):0;
 const focusMinutes=(state.focusSessions||[]).reduce((sum,x)=>sum+(Number(x.minutes)||0),0);
 const hidden=state.preferences.dashboardHidden||[];
 const order=(state.preferences.dashboardOrder||NOVAOS_DEFAULT_ORDER).filter(id=>NOVAOS_DEFAULT_ORDER.includes(id));
 const briefMissing=!order.includes('brief');
 NOVAOS_DEFAULT_ORDER.forEach(id=>{if(!order.includes(id))order.push(id)});
 if(briefMissing)order.unshift('brief');
 const modules={
  brief:novaOSWidget('brief',novaOSBrief(),true),
  pulse:novaOSWidget('pulse',`<div class="novaos-widget-head"><div><span class="eyebrow">LIVE WORKSPACE</span><h2>Vue d’ensemble</h2><p>Des indicateurs calculés à partir de tes données locales.</p></div><span class="novaos-drag-grip" title="Glisse ce widget pour le réorganiser">⠿ DÉPLACER</span></div><div class="novaos-kpis"><div><span class="novaos-kpi-icon">◈</span><small>Projets</small><b>${projects.length}</b><em>${projects.filter(p=>(Number(p.progress)||0)<100).length} actifs</em></div><div><span class="novaos-kpi-icon cyan">✓</span><small>Tâches accomplies</small><b>${done}<small class="novaos-kpi-total"> / ${tasks.length}</small></b><em>${open.length} restantes</em></div><div><span class="novaos-kpi-icon green">▤</span><small>Notes</small><b>${notes.length}</b><em>Dans cet espace</em></div><div><span class="novaos-kpi-icon orange">↗</span><small>Avancement moyen</small><b>${progress}%</b><em>Sur les projets</em></div><div><span class="novaos-kpi-icon blue">◷</span><small>Temps de focus</small><b>${Math.floor(focusMinutes/60)}<small class="novaos-kpi-total"> h ${focusMinutes%60} min</small></b><em>Sessions enregistrées</em></div></div>`,true),
  launchpad:novaOSWidget('launchpad',`<div class="novaos-widget-head"><div><span class="eyebrow">NOVA ECOSYSTEM</span><h2>Accès rapides</h2><p>Rejoins directement l’espace où tu veux travailler.</p></div><span class="novaos-drag-grip" title="Glisse ce widget pour le réorganiser">⠿ DÉPLACER</span></div><div class="novaos-launch-grid">${novaOSModuleCard('✧','Nova AI','Assistant et labo IA','ai','AI')}${novaOSModuleCard('▧','NovaEngine','Scènes et workbench C++','novaengine','ENGINE')}${novaOSModuleCard('▶','NovaSeries Studio','Préproduction audiovisuelle','novaseries','STUDIO')}${novaOSModuleCard('☁','NovaCloud','Sauvegarde et synchronisation','cloud','CLOUD')}${novaOSModuleCard('◈','Projets','Tous tes univers de travail','projects','WORK')}${novaOSModuleCard('▦','Calendrier','Planning et prochaines étapes','calendar','PLAN')}</div>`,true),
  tasks:novaOSWidget('tasks',`<div class="novaos-widget-head"><div><span class="eyebrow">NEXT ACTIONS</span><h2>À faire ensuite</h2><p>${open.length} tâche(s) encore ouvertes.</p></div><button class="secondary" onclick="openCreate('task')">＋ Ajouter</button></div><div class="novaos-task-list">${open.slice(0,5).map(taskRow).join('')||empty('Tout est terminé !','Tu peux créer une nouvelle tâche ou avancer un projet.')}</div><button class="novaos-text-link" onclick="setPage('tasks')">Voir toutes les tâches ↗</button>`,false),
  projects:novaOSWidget('projects',`<div class="novaos-widget-head"><div><span class="eyebrow">IN PROGRESS</span><h2>Projets actifs</h2><p>Reprends rapidement le fil de tes créations.</p></div><button class="secondary" onclick="setPage('projects')">Tous les projets ↗</button></div><div class="novaos-project-list">${projects.slice(0,4).map(p=>`<button class="novaos-project-line" type="button" onclick="setPage('projects')"><span class="novaos-project-symbol">${p.name.toLowerCase().includes('engine')?'▧':p.name.toLowerCase().includes('series')?'▶':p.name.toLowerCase().includes('cloud')?'☁':'◈'}</span><span class="novaos-project-info"><b>${esc(p.name)}</b><small>${esc(p.description||'Espace de travail NovaCore')}</small><span class="novaos-progress"><i style="width:${Math.max(0,Math.min(100,Number(p.progress)||0))}%"></i></span></span><strong>${Math.max(0,Math.min(100,Number(p.progress)||0))}%</strong></button>`).join('')||empty('Aucun projet','Crée ton premier espace de travail.')}</div>`,true),
  notifications:novaOSWidget('notifications',`<div class="novaos-widget-head"><div><span class="eyebrow">ATTENTION REQUIRED</span><h2>Centre de notifications</h2><p>Priorités et suggestions basées sur ton workspace.</p></div><span class="novaos-notification-badge">${open.filter(t=>t.priority==='Haute').length}</span></div>${novaOSNotifications()}`,false),
  activity:novaOSWidget('activity',`<div class="novaos-widget-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>Historique récent</h2><p>Les dernières actions de cette installation.</p></div><button class="secondary" onclick="exportData()">Sauvegarder ↗</button></div>${novaOSActivityMarkup()}`,false),
  personalize:novaOSWidget('personalize',`<div class="novaos-widget-head"><div><span class="eyebrow">YOUR WORKSPACE</span><h2>Personnaliser NovaOS</h2><p>Réglages enregistrés dans les préférences de cet espace.</p></div><button class="secondary" onclick="novaOSResetLayout()">Réinitialiser</button></div><div class="novaos-personalize-layout"><div class="novaos-setting-block"><b>Couleur d’accent</b><small>Change la couleur des éléments clés.</small><div class="novaos-accent-options">${[['purple','Violet'],['cyan','Cyan'],['green','Vert'],['pink','Rose'],['orange','Orange']].map(([val,label])=>`<button type="button" class="novaos-accent-chip ${state.preferences.accent===val?'selected':''}" data-accent-choice="${val}" onclick="novaOSSetAccent('${val}')" aria-label="Accent ${label}" title="${label}"><i></i><span>${label}</span></button>`).join('')}</div><label class="novaos-motion-option"><input type="checkbox" ${state.preferences.animations!==false?'checked':''} onchange="novaOSToggleAnimations(this.checked)"><span><b>Animations d’interface</b><small>Désactive-les pour privilégier le mouvement réduit.</small></span></label></div><div class="novaos-setting-block"><b>Widgets visibles</b><small>Coche les panneaux à afficher dans le tableau de bord.</small><div class="novaos-widget-toggles">${NOVAOS_WIDGETS.filter(w=>w.id!=='personalize').map(w=>`<label><input type="checkbox" ${hidden.includes(w.id)?'':'checked'} onchange="novaOSToggleWidget('${w.id}',this.checked)"><span>${esc(w.label)}</span></label>`).join('')}</div><p class="novaos-drag-help">Astuce : attrape « DÉPLACER » puis glisse un panneau sur un autre pour changer son ordre.</p></div></div>`,true)
 };
 const widgets=order.filter(id=>!hidden.includes(id)).map(id=>modules[id]).join('');
 const firstName=($('#userName')?.textContent||'Créateur').split(' ')[0];
 return `<div class="novaos-shell"><button class="novaos-retroedge-spotlight" onclick="setPage('retroedge')"><span class="re-spotlight-emblem">RE</span><span class="re-spotlight-copy"><small>NOVA INDUSTRIES · HANDHELD SYSTEMS</small><b>RETROEDGE</b><em>THE FUTURE IS EDGE. · OBJECTIF 2027</em></span><span class="re-spotlight-arrow">DÉCOUVRIR ↗</span></button><section class="novaos-hero"><div class="novaos-hero-copy"><span class="novaos-live"><i></i> NOVACORE · PORT 6300</span><p class="eyebrow">NOVAOS / CONTROL CENTER</p><h2>Bonjour ${esc(firstName)}.<br><span>Qu’est-ce qu’on construit aujourd’hui ?</span></h2><p class="novaos-hero-sub">Un point de départ unique pour tes projets, tes outils et tes prochaines actions.</p><div class="novaos-search-row"><span>⌕</span><input id="novaosSearch" type="search" placeholder="Rechercher un projet, une tâche, une note…" autocomplete="off" aria-label="Recherche globale NovaOS"><button class="primary" type="button" onclick="novaOSQuickSearch()">Rechercher ↗</button></div><div class="novaos-hero-shortcuts"><button type="button" onclick="openCreate('project')">＋ Nouveau projet</button><button type="button" onclick="openCreate('task')">✓ Ajouter une tâche</button><button type="button" onclick="openCreate('note')">▤ Capture rapide</button><button type="button" onclick="openCommandPalette()">⌘ Palette · Ctrl+K</button></div></div><div class="novaos-hero-visual" aria-hidden="true"><div class="novaos-planet-ring ring-one"></div><div class="novaos-planet-ring ring-two"></div><div class="novaos-planet">✦</div><span class="novaos-orbit-dot dot-one"></span><span class="novaos-orbit-dot dot-two"></span><div class="novaos-visual-caption"><b>NOVAOS</b><small>WORKSPACE ONLINE</small></div></div></section><div class="novaos-grid" id="novaosWidgetGrid">${widgets}</div></div>`;
}
function renderProjects(){return `<div class="section-title"><div><h2>Tous les projets</h2><p>${state.projects.length} espace(s) de travail</p></div><button class="primary" onclick="openCreate('project')">＋ Nouveau projet</button></div><div class="template-strip card"><b>Créer un univers Nova en un clic</b><div class="actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="secondary" onclick="createNovaProject('NovaSeries')">🎬 NovaSeries</button><button class="secondary" onclick="createNovaProject('NovaTechnologie')">⚙ NovaTechnologie</button><button class="secondary" onclick="createNovaProject('NovaEngine')">✧ NovaEngine</button><button class="secondary" onclick="createNovaProject('NovaStore')">▦ NovaStore</button></div></div><div class="grid project-grid">${state.projects.map(projectCard).join('')||empty('Prêt à commencer ?','Créez un projet pour organiser vos idées.')}</div>`}
function renderTasks(){return `<div class="section-title"><div><h2>Votre liste de tâches</h2><p>${state.tasks.filter(t=>!t.done).length} tâches restantes</p></div><button class="primary" onclick="openCreate('task')">＋ Nouvelle tâche</button></div><div class="card">${state.tasks.map(taskRow).join('')||empty('Aucune tâche','Ajoutez une tâche pour organiser votre journée.')}</div>`}
function renderNotes(){return `<div class="section-title"><div><h2>Vos notes</h2><p>Vos idées restent dans votre espace local, ou se synchronisent après connexion.</p></div><button class="primary" onclick="openCreate('note')">＋ Nouvelle note</button></div><div class="grid note-grid">${state.notes.map(n=>`<div class="card note-card"><div class="card-head"><span class="stat-icon">▤</span><button class="secondary" onclick="deleteNote('${n.id}')">Supprimer</button></div><h3>${esc(n.title)}</h3><p>${esc(n.content)}</p><small>${new Date(n.date).toLocaleString('fr-FR')}</small></div>`).join('')||empty('Aucune note','Capturez votre première idée.')}</div>`}
const NOVAI_SUGGESTIONS={
 assistant:['Résume mes priorités de la semaine','Aide-moi à planifier ma prochaine étape','Quel projet dois-je avancer en premier ?'],
 developer:['Explique ce bug JavaScript étape par étape','Propose un test API pour cette route','Comment sécuriser cette entrée utilisateur ?'],
 creative:['Développe le pitch de ma série','Imagine trois directions visuelles pour NovaEngine','Trouve un nom pour ce nouveau projet'],
 learn:['Explique ce concept avec un exemple simple','Crée un exercice sur ce sujet','Quelle notion dois-je réviser en priorité ?']
};
function novaiStoredChat(){return (Array.isArray(state.novaiChat)?state.novaiChat:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.trim()).slice(-24)}
function novaiLoadChat(){chatHistory=novaiStoredChat().map(m=>({role:m.role,content:String(m.content).slice(0,8000),at:m.at||''}))}
function novaiSaveChat(){state.novaiChat=chatHistory.slice(-24).map(m=>({role:m.role,content:String(m.content).slice(0,8000),at:m.at||new Date().toISOString()}));saveLocal()}
function novaiChatMarkup(){
 const greeting=`<div class="message">Bonjour, je suis NOVAI. Je peux t’aider à concevoir, coder, imaginer et apprendre avec toi. Le mode Learn Lab utilise une mémoire de projet que tu contrôles.</div>`;
 return greeting+chatHistory.map(m=>m.role==='user'?`<div class="message user">${esc(m.content)}</div>`:`<div class="message"><small class="muted">NOVAI${m.at?` · ${new Date(m.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`:''}</small><br>${esc(m.content)}</div>`).join('');
}
function novaiPromptChips(){const prompts=NOVAI_SUGGESTIONS[novaiMode]||NOVAI_SUGGESTIONS.assistant;return prompts.map(p=>`<button type="button" class="novai-suggestion" data-prompt="${esc(p)}" onclick="useNovaiPrompt(this.dataset.prompt)">${esc(p)}</button>`).join('')}
function useNovaiPrompt(text){const input=$('#chatInput');if(!input)return;input.value=String(text||'');input.focus();try{input.setSelectionRange(input.value.length,input.value.length)}catch{}}
function renderAI(){const memory=Array.isArray(state.novaiMemory)?state.novaiMemory:[],sandboxes=Array.isArray(state.novaiSandbox)?state.novaiSandbox:[];return `<div class="ai-hero card novai-hero"><div class="ai-orb novai-logo"><svg viewBox="0 0 64 64" aria-label="Logo NOVAI"><defs><linearGradient id="novaiG" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="#a8ddff"/><stop offset="1" stop-color="#2879ee"/></linearGradient></defs><circle cx="32" cy="32" r="24" fill="none" stroke="url(#novaiG)" stroke-width="2"/><path d="M17 43V21l30 22V21" fill="none" stroke="url(#novaiG)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 3v10M32 51v10M3 32h10M51 32h10" stroke="#8bd2ff" stroke-width="2"/></svg></div><div class="ai-hero-copy"><span class="eyebrow">NOVA INDUSTRIES · INTELLIGENCE</span><h2>NOVAI <span class="novai-pill">4 modes</span></h2><p>Une identité IA dédiée à NovaCore. Choisis un mode, ajoute une mémoire de projet et expérimente dans un espace de travail local.</p><div class="ai-status" id="aiConnectionStatus">Vérification de la connexion…</div></div><div class="ai-hero-badge">NOVAI / CORE</div></div><div class="novai-modes card"><button class="novai-mode active" data-mode="assistant" onclick="selectNovaiMode('assistant')"><b>01</b><span>Assistant</span><small>Questions générales</small></button><button class="novai-mode" data-mode="developer" onclick="selectNovaiMode('developer')"><b>02</b><span>Développeur</span><small>Code & débogage</small></button><button class="novai-mode" data-mode="creative" onclick="selectNovaiMode('creative')"><b>03</b><span>Créatif</span><small>Idées & univers</small></button><button class="novai-mode" data-mode="learn" onclick="selectNovaiMode('learn')"><b>04</b><span>Learn Lab</span><small>Mémoire & sandbox</small></button></div><div class="grid columns ai-layout"><div class="card ai-chat-card"><div class="card-head"><h3><span class="novai-mini-logo">N</span> Conversation NOVAI</h3><button class="secondary" onclick="clearChat()">Nouvelle conversation</button></div><div class="chat"><div class="chat-messages" id="chatMessages">${novaiChatMarkup()}</div><div class="novai-suggestions" id="novaiSuggestions" aria-label="Suggestions de prompts">${novaiPromptChips()}</div><div class="chat-compose"><textarea id="chatInput" placeholder="Pose ta question à NOVAI…" maxlength="8000" rows="2"></textarea><button class="primary" id="chatSend">Envoyer ↗</button></div></div><p class="muted tiny">NOVAI utilise le fournisseur IA configuré dans .env. Sans fournisseur connecté, le chat ne peut pas générer de réponse réelle.</p></div><div class="card"><div class="card-head"><h3>Learn Lab · mémoire de projet</h3><span class="badge">Local</span></div><p class="muted tiny">Ajoute des règles, notes ou exemples que NOVAI pourra recevoir comme contexte. Ce n’est pas un réentraînement des poids du modèle : la mémoire est réutilisée dans les requêtes.</p><div class="field"><label>Ce que NOVAI doit apprendre à propos de ton projet</label><textarea id="novaiMemoryInput" maxlength="2500" placeholder="Ex. NovaEngine utilise C++ et Vulkan. Préférer les explications étape par étape."></textarea></div><button class="primary full-width" onclick="saveNovaiMemory()">＋ Ajouter à la mémoire</button><div class="novai-memory-list">${memory.map((m,i)=>`<div class="memory-item"><span>${esc(m.text)}</span><button class="secondary" onclick="deleteNovaiMemory(${i})" aria-label="Supprimer la mémoire">×</button></div>`).join('')||'<p class="muted tiny">Aucune mémoire personnalisée pour le moment.</p>'}</div><hr class="glass-divider"><div class="card-head"><h3>Sandbox de prototypage</h3><span class="badge">Isolée · sans exécution</span></div><p class="muted tiny">Conserve des prompts, plans ou extraits de code pour expérimenter sans exécuter du code arbitraire sur ton ordinateur.</p><div class="field"><label>Nom du prototype</label><input id="sandboxName" maxlength="80" placeholder="Ex. système de particules"></div><div class="field"><label>Contenu / code</label><textarea id="sandboxContent" maxlength="8000" placeholder="Colle un prototype, un prompt ou des notes…"></textarea></div><button class="secondary full-width" onclick="saveNovaiSandbox()">Enregistrer dans la sandbox</button><div class="novai-memory-list">${sandboxes.map((x,i)=>`<div class="memory-item sandbox-item"><div><b>${esc(x.name)}</b><small>${esc(x.content.slice(0,110))}${x.content.length>110?'…':''}</small></div><button class="secondary" onclick="downloadNovaiSandbox(${i})">Exporter</button><button class="secondary" onclick="deleteNovaiSandbox(${i})">×</button></div>`).join('')||'<p class="muted tiny">Aucun prototype sauvegardé.</p>'}</div><div class="notice">La sandbox est un espace de stockage et de prototypage, pas une machine virtuelle. Le code n’est pas exécuté. N’y colle pas de mots de passe ou de clés API.</div><div class="ai-setup-steps"><div><b>01 · IA locale</b><p>Ollama avec <code>AI_LOCAL_MODEL</code>.</p></div><div><b>02 · IA cloud</b><p><code>AI_CLOUD_API_URL</code>, <code>AI_CLOUD_API_KEY</code>, <code>AI_CLOUD_MODEL</code>.</p></div><div class="field"><label>Fournisseur</label><select id="aiProviderSelect"><option value="auto">Auto — local puis cloud</option><option value="local">Ollama local</option><option value="cloud">Cloud uniquement</option></select></div><button class="secondary full-width" onclick="refreshAIStatus()">Vérifier les fournisseurs ↻</button><div id="aiProviderDetails" class="muted tiny">Vérification des fournisseurs…</div></div></div></div>`}
let novaiMode='assistant';
function selectNovaiMode(mode){novaiMode=['assistant','developer','creative','learn'].includes(mode)?mode:'assistant';$$('.novai-mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===novaiMode));const input=$('#chatInput');if(input)input.placeholder=({assistant:'Pose ta question à NOVAI…',developer:'Décris un bug ou demande du code…',creative:'Imagine un univers, une histoire ou un concept…',learn:'Explique ce que tu veux apprendre ou améliorer…'})[novaiMode];const suggestions=$('#novaiSuggestions');if(suggestions)suggestions.innerHTML=novaiPromptChips();toast('Mode NOVAI : '+({assistant:'Assistant',developer:'Développeur',creative:'Créatif',learn:'Learn Lab'})[novaiMode])}
function saveNovaiMemory(){const input=$('#novaiMemoryInput'),text=input?.value.trim();if(!text)return toast('Écris une note à mémoriser.');state.novaiMemory=Array.isArray(state.novaiMemory)?state.novaiMemory:[];state.novaiMemory.unshift({id:uid(),text,createdAt:new Date().toISOString()});state.novaiMemory=state.novaiMemory.slice(0,30);saveLocal();render();toast('Mémoire de projet ajoutée.');}
function deleteNovaiMemory(i){state.novaiMemory.splice(i,1);saveLocal();render();}
function saveNovaiSandbox(){const name=$('#sandboxName')?.value.trim(),content=$('#sandboxContent')?.value.trim();if(!name||!content)return toast('Ajoute un nom et un contenu.');state.novaiSandbox=Array.isArray(state.novaiSandbox)?state.novaiSandbox:[];state.novaiSandbox.unshift({id:uid(),name,content,createdAt:new Date().toISOString()});state.novaiSandbox=state.novaiSandbox.slice(0,40);saveLocal();render();toast('Prototype sauvegardé dans la sandbox locale.');}
function deleteNovaiSandbox(i){state.novaiSandbox.splice(i,1);saveLocal();render();}
function downloadNovaiSandbox(i){const x=state.novaiSandbox[i];if(!x)return;const blob=new Blob([x.content],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=x.name.replace(/[^a-z0-9._-]/gi,'-').slice(0,80)||'novai-prototype.txt';a.click();URL.revokeObjectURL(a.href);}
function createNovaProject(name){const descriptions={NovaSeries:'Univers de séries, films, scénarios, personnages et production.',NovaTechnologie:'Laboratoire d’idées, prototypes, recherches et technologies Nova.',NovaEngine:'Moteur graphique, rendu temps réel, outils et prototypes.',NovaStore:'Catalogue, fiches produits, collections et expérience boutique.'};if(state.projects.some(p=>p.name.toLowerCase()===name.toLowerCase()))return toast(`${name} existe déjà dans tes projets.`);state.projects.unshift({id:uid(),name,description:descriptions[name],progress:0,color:'cyan',createdAt:new Date().toISOString()});saveLocal();render();toast(`${name} ajouté à tes projets.`)}

async function renderCloud(){const signed=!!localStorage.getItem('novaToken');return `<div class="grid two-col"><div class="card"><div class="card-head"><h3>☁ État de synchronisation</h3><span class="badge ${signed?'green':'orange'}">${signed?'Connecté':'Mode local'}</span></div><div class="feature"><span class="stat-icon cyan">☁</span><div><h3>${signed?'NovaCloud est disponible':'Connectez-vous pour activer NovaCloud'}</h3><p>${signed?'Votre espace peut être envoyé au serveur et récupéré depuis un autre appareil avec le même compte.':'Les données restent dans ce navigateur jusqu’à la création d’un compte. Connectez-vous ou créez un compte NovaID pour synchroniser.'}</p></div></div><div class="actions"><button class="secondary" onclick="cloudPull()">Récupérer du cloud</button><button class="primary" onclick="cloudPush()">Synchroniser maintenant</button></div></div><div class="card"><div class="card-head"><h3>Protection des données</h3></div><div class="list"><div class="list-item"><span class="list-icon">🔐</span><div class="list-main"><b>Compte personnel</b><small>Les routes cloud nécessitent un jeton de session valide.</small></div></div><div class="list-item"><span class="list-icon">↻</span><div class="list-main"><b>Enregistrement explicite</b><small>Choisissez quand envoyer ou récupérer les données.</small></div></div><div class="list-item"><span class="list-icon">▣</span><div class="list-main"><b>Sauvegarde locale</b><small>Export JSON disponible sur la page Compte.</small></div></div></div></div></div>`}
function renderPlugins(){return `<div class="section-title"><div><h2>Catalogue d’extensions</h2><p>Contrôlez les modules activés dans votre environnement.</p></div></div><div class="card">${plugins.length?plugins.map(p=>`<div class="plugin-row"><div class="stat-icon">${p.id.includes('focus')?'◷':p.id.includes('export')?'⇩':'▤'}</div><div class="plugin-info"><b>${esc(p.name)} <span class="muted">v${esc(p.version)}</span></b><p>${esc(p.description)}</p><div>${p.permissions.map(x=>`<span class="permission">${esc(x)}</span>`).join('')}</div></div><button class="toggle ${p.enabled?'on':''}" aria-label="Activer ${esc(p.name)}" onclick="togglePlugin('${p.id}',${!p.enabled})"></button></div>`).join(''):empty('Connectez-vous','NovaPlugins charge le catalogue après connexion.')}</div><div class="notice">Sécurité : cette version gère le catalogue, les permissions déclarées et l’activation. Elle n’exécute volontairement pas de code tiers arbitraire.</div>`}
function renderAnalytics(){const total=analytics.totals.reduce((a,x)=>a+x.count,0);return `<div class="grid stats">${stat('Événements suivis',total,'Événements associés au compte','▥')}${stat('Types d’activité',analytics.totals.length,'Catégories distinctes','◈','cyan')}${stat('Projets',state.projects.length,'Dans cet appareil','▦','green')}${stat('Tâches terminées',state.tasks.filter(t=>t.done).length,'Progression personnelle','✓','orange')}</div><div class="grid columns"><div class="card"><div class="card-head"><h3>Événements du compte</h3><span class="badge">Données réelles</span></div>${analytics.totals.length?`<div class="list">${analytics.totals.map(x=>`<div class="list-item"><div class="list-main"><b>${esc(x.type)}</b><small>${x.count} événement(s)</small></div><span class="badge">${x.count}</span></div>`).join('')}</div>`:empty('Pas encore de données','Connectez-vous puis utilisez NovaCore pour enregistrer des événements.')}</div><div class="card"><div class="card-head"><h3>Activité récente</h3></div>${analytics.recent.length?`<div class="list">${analytics.recent.slice(0,12).map(x=>`<div class="list-item"><span class="list-icon">⌁</span><div class="list-main"><b>${esc(x.type)}</b><small>${new Date(x.createdAt).toLocaleString('fr-FR')}</small></div></div>`).join('')}</div>`:empty('Aucune activité','Les événements apparaîtront ici après connexion.')}</div></div>`}
function renderRoadmap(){
 const items=Array.isArray(state.roadmap)?state.roadmap:[];
 return `<div class="section-title"><div><h2>Feuille de route</h2><p>Transforme la vision NovaCore en jalons concrets. Les données restent dans ton workspace.</p></div><button class="primary" onclick="addRoadmapItem()">＋ Nouveau jalon</button></div><div class="grid stats">${stat('Jalons',items.length,'Dans cette feuille de route','◇')}${stat('En cours',items.filter(x=>x.status==='En cours').length,'Actuellement actifs','↗','cyan')}${stat('Terminés',items.filter(x=>x.status==='Terminé').length,'Livrés','✓','green')}${stat('Priorité haute',items.filter(x=>x.priority==='Haute').length,'À surveiller','!','orange')}</div><div class="grid roadmap-grid">${['À planifier','En cours','Terminé'].map(status=>`<div class="card roadmap-column"><div class="card-head"><h3>${status}</h3><span class="badge">${items.filter(x=>x.status===status).length}</span></div>${items.filter(x=>x.status===status).map(x=>`<article class="roadmap-item"><div class="roadmap-item-top"><span class="badge ${x.priority==='Haute'?'red':x.priority==='Moyenne'?'orange':'green'}">${esc(x.priority)}</span><button class="icon-btn" title="Supprimer le jalon" onclick="removeRoadmapItem('${x.id}')">×</button></div><h4>${esc(x.title)}</h4><small>${esc(x.area)}</small><p>${esc(x.detail)}</p><div class="field"><label>Statut</label><select onchange="updateRoadmapStatus('${x.id}',this.value)">${['À planifier','En cours','Terminé'].map(v=>`<option ${x.status===v?'selected':''}>${v}</option>`).join('')}</select></div></article>`).join('')||empty('Aucun jalon','Ajoute un jalon ou déplace-en un ici.')}</div>`).join('')}</div><div class="notice">Les jalons sont des données de planification : ils ne signifient pas que ces fonctions techniques sont déjà livrées.</div>`;
}
function addRoadmapItem(){const title=prompt('Titre du jalon :');if(!title||!title.trim())return;const detail=prompt('Description courte :')||'';state.roadmap=Array.isArray(state.roadmap)?state.roadmap:[];state.roadmap.unshift({id:uid(),title:title.trim().slice(0,120),detail:detail.slice(0,500),area:'NovaCore',status:'À planifier',priority:'Moyenne'});saveLocal();render();toast('Jalon ajouté.')}
function updateRoadmapStatus(id,status){const x=(state.roadmap||[]).find(x=>x.id===id);if(x&&['À planifier','En cours','Terminé'].includes(status)){x.status=status;saveLocal();render();toast('Jalon mis à jour.')}}
function removeRoadmapItem(id){state.roadmap=(state.roadmap||[]).filter(x=>x.id!==id);saveLocal();render();toast('Jalon supprimé.')}
function renderSearch(){return `<div class="card"><div class="card-head"><h3>Recherche dans ton workspace</h3><span class="badge">Recherche locale${localStorage.getItem('novaToken')?' + compte connecté':''}</span></div><div class="global-search-row"><input id="globalSearchInput" type="search" placeholder="Projet, tâche, note, ressource, code…" autocomplete="off" aria-label="Rechercher dans NovaCore"><button class="primary" id="globalSearchButton" type="button" onclick="runGlobalSearch()">Rechercher ↗</button></div><p class="muted">Recherche dans les projets, tâches, notes, connaissances, snippets et brouillons. Appuie sur Entrée pour lancer la recherche.</p><div id="globalSearchResults" class="search-results" aria-live="polite">Entre un terme pour commencer.</div></div>`}
function searchFold(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').trim()}
function runGlobalSearch(){
 const input=$('#globalSearchInput'),out=$('#globalSearchResults');if(!input||!out)return;
 const raw=input.value.trim(),q=searchFold(raw);if(!q){out.textContent='Entre un terme de recherche.';input.focus();return}
 const groups=[['Projet',state.projects,['name','description','status']],['Tâche',state.tasks,['title','project','priority','status']],['Note',state.notes,['title','content']],['Ressource',state.knowledge,['title','content','tags']],['Snippet',state.codeFiles,['name','content','language']],['Brouillon NovaStore',state.storeDrafts,['title','description','type']],['Jalon',state.roadmap,['title','detail','area','status']]];
 const found=[];for(const [type,items,fields] of groups)for(const item of Array.isArray(items)?items:[]){const hay=fields.map(f=>Array.isArray(item[f])?item[f].join(' '):String(item[f]??'')).join(' ');if(searchFold(hay).includes(q))found.push({type,title:item.name||item.title||item.label||'Sans titre',detail:String(item.description||item.content||item.detail||item.project||item.area||'').slice(0,220)});}
 const renderRows=rows=>rows.map(x=>`<div class="search-result"><span class="badge">${esc(x.type)}</span><div><b>${esc(x.title)}</b><p>${esc(x.detail||'')}</p></div></div>`).join('');
 out.innerHTML=found.length?`<p class="search-count">${found.length} résultat(s) sur cet appareil</p>${renderRows(found.slice(0,100))}`:`<div class="empty"><b>Aucun résultat local</b><p>Essaie un autre terme ou vérifie l’orthographe.</p></div>`;
 if(localStorage.getItem('novaToken')){out.insertAdjacentHTML('beforeend','<p class="search-cloud-heading">Recherche dans le compte…</p>');api('/api/search?q='+encodeURIComponent(raw)).then(r=>{const rows=r.results||[];const heading=out.querySelector('.search-cloud-heading');if(heading)heading.textContent=`${rows.length} résultat(s) dans les données du compte`;if(rows.length)out.insertAdjacentHTML('beforeend',renderRows(rows.map(x=>({type:`Compte · ${x.type}`,title:x.title,detail:x.preview||''}))));}).catch(e=>{const heading=out.querySelector('.search-cloud-heading');if(heading)heading.textContent=`Recherche du compte indisponible : ${e.message}`;});}
}
async function renderSystem(){let d={};try{d=await api('/api/diagnostics')}catch(e){d={error:e.message}}return `<div class="section-title"><div><h2>Centre système</h2><p>Informations de diagnostic sans exposer de secrets.</p></div><button class="primary" onclick="setPage('system')">Actualiser ↻</button></div><div class="grid stats">${stat('NovaCore',esc(d.version||'2.20.1'),'NovaOS Control Center','◈')}${stat('Serveur',d.error?'À vérifier':'En ligne',d.error||'API répond','●',d.error?'orange':'green')}${stat('Node.js',esc(d.node||'Inconnu'),'Runtime serveur','⌘','cyan')}${stat('Uptime',d.uptimeSeconds!=null?Math.floor(d.uptimeSeconds/60)+' min':'—','Depuis le dernier démarrage','◷')}</div><div class="grid columns"><div class="card"><div class="card-head"><h3>Capacités du système</h3><span class="badge">Diagnostic</span></div><div class="list">${(d.capabilities||[{name:'NovaID',status:'À vérifier'},{name:'Nova AI hybride',status:'À vérifier'},{name:'NovaCloud',status:'À vérifier'},{name:'NovaPlugins',status:'À vérifier'}]).map(c=>`<div class="list-item"><span class="list-icon">${c.status==='configured'||c.status==='ready'?'✓':'◌'}</span><div class="list-main"><b>${esc(c.name)}</b><small>${esc(c.status)}</small></div></div>`).join('')}</div></div><div class="card"><div class="card-head"><h3>Outils de maintenance</h3></div><div class="list"><div class="list-item"><span class="list-icon">⇩</span><div class="list-main"><b>Exporter workspace</b><small>Créer une copie JSON de tes données locales.</small></div><button class="secondary" onclick="exportData()">Exporter</button></div><div class="list-item"><span class="list-icon">⌁</span><div class="list-main"><b>Tester l’API</b><small>Vérifier l'accès au backend.</small></div><button class="secondary" onclick="setPage('api')">Tester</button></div><div class="list-item"><span class="list-icon">✧</span><div class="list-main"><b>État de Nova AI</b><small>Voir la disponibilité local/cloud.</small></div><button class="secondary" onclick="setPage('ai')">Ouvrir</button></div></div><pre class="api-result">${esc(JSON.stringify(d,null,2))}</pre></div></div><div class="notice">Les diagnostics indiquent la configuration et la disponibilité observées. Ils ne constituent pas un audit de sécurité complet.</div>`}
function renderAccount(){const signed=!!localStorage.getItem('novaToken');const p=state.preferences||{},lang=currentUiLang();return `<div class="section-title"><div><h2>Personnalisation de NovaCore</h2><p>Choisis ton ambiance, les couleurs et les effets visuels. Les réglages sont sauvegardés sur cet appareil.</p></div><span class="badge green">Préférences locales</span></div><div class="grid theme-grid"><div class="card theme-card"><div class="card-head"><h3>Thème de l’interface</h3><span class="badge">${esc(p.theme||'dark')}</span></div><div class="theme-options"><button class="theme-option ${p.theme==='dark'?'selected':''}" onclick="setTheme('dark')"><span class="theme-preview preview-dark"></span><b>Obsidienne</b><small>Sombre · violet</small></button><button class="theme-option ${p.theme==='light'?'selected':''}" onclick="setTheme('light')"><span class="theme-preview preview-light"></span><b>Clair</b><small>Lumineux · net</small></button><button class="theme-option ${p.theme==='midnight'?'selected':''}" onclick="setTheme('midnight')"><span class="theme-preview preview-midnight"></span><b>Cosmos</b><small>Bleu nuit</small></button><button class="theme-option ${p.theme==='emerald'?'selected':''}" onclick="setTheme('emerald')"><span class="theme-preview preview-emerald"></span><b>Émeraude</b><small>Vert néon</small></button><button class="theme-option ${p.theme==='sunset'?'selected':''}" onclick="setTheme('sunset')"><span class="theme-preview preview-sunset"></span><b>Sunset</b><small>Rose & orange</small></button></div><h4>Couleur d’accent</h4><div class="accent-options"><button aria-label="Violet" class="accent-swatch purple ${p.accent==='purple'?'selected':''}" onclick="setAccent('purple')"></button><button aria-label="Cyan" class="accent-swatch cyan ${p.accent==='cyan'?'selected':''}" onclick="setAccent('cyan')"></button><button aria-label="Vert" class="accent-swatch green ${p.accent==='green'?'selected':''}" onclick="setAccent('green')"></button><button aria-label="Rose" class="accent-swatch pink ${p.accent==='pink'?'selected':''}" onclick="setAccent('pink')"></button><button aria-label="Orange" class="accent-swatch orange ${p.accent==='orange'?'selected':''}" onclick="setAccent('orange')"></button></div></div><div class="card theme-card"><div class="card-head"><h3>Effets visuels</h3><span class="badge">Live</span></div><div class="setting-row"><div><b>Animations fluides</b><p>Transitions, apparition des cartes et micro-interactions.</p></div><label class="switch"><input type="checkbox" ${p.animations!==false?'checked':''} onchange="setVisualOption('animations',this.checked)"><span></span></label></div><div class="setting-row"><div><b>Halo néon & lueurs</b><p>Reflets lumineux et profondeur de l’interface.</p></div><label class="switch"><input type="checkbox" ${p.glow!==false?'checked':''} onchange="setVisualOption('glow',this.checked)"><span></span></label></div><div class="setting-row"><div><b>Mode compact</b><p>Réduit les espaces pour afficher plus d’informations.</p></div><label class="switch"><input type="checkbox" ${p.compact?'checked':''} onchange="setVisualOption('compact',this.checked)"><span></span></label></div><div class="setting-row"><div><b>Taille du texte</b><p>Choisis une lecture plus confortable.</p></div><select aria-label="Taille du texte" onchange="setFontScale(this.value)"><option value="normal" ${p.fontScale==='normal'||!p.fontScale?'selected':''}>Standard</option><option value="large" ${p.fontScale==='large'?'selected':''}>Grande</option><option value="xlarge" ${p.fontScale==='xlarge'?'selected':''}>Très grande</option></select></div><div class="setting-row"><div><b>Transparence réduite</b><p>Améliore le contraste sur les panneaux en verre.</p></div><label class="switch"><input type="checkbox" ${p.reducedTransparency?'checked':''} onchange="setVisualOption('reducedTransparency',this.checked)"><span></span></label></div><div class="motion-preview"><div class="motion-orbit"></div><div><b>Nova Motion</b><p>Interface dynamique adaptée à tes préférences.</p></div></div><button class="secondary" onclick="resetPreferences()">Réinitialiser l’apparence</button></div></div><div class="section-title"><div><h2>Langue, tutoriel & performance</h2><p>Adapte l’interface à ta langue, à ta machine et à ta façon de travailler.</p></div><span class="badge">${lang.toUpperCase()}</span></div><div class="card settings-card"><div class="settings-stack"><div class="settings-row"><div><b>Langue de l’interface</b><p>Bascule immédiatement toute la coque, les pages et le tutoriel entre le français et l’anglais. Le choix est conservé sur cet appareil.</p></div><div class="segmented" role="group" aria-label="Langue de l’interface"><button type="button" aria-pressed="${lang==='fr'}" onclick="setLanguage('fr')">Français</button><button type="button" aria-pressed="${lang==='en'}" onclick="setLanguage('en')">English</button></div></div><div class="settings-row"><div><b>Mode performance</b><p>Désactive la 3D de fond, les flous, les reflets et les animations décoratives. Recommandé sur les machines modestes ou pour économiser la batterie.</p></div><label class="switch"><input type="checkbox" ${p.performanceMode?'checked':''} onchange="setPerformanceMode(this.checked)"><span></span></label></div><div class="settings-row"><div><b>Tutoriel de bienvenue</b><p>Revois la visite guidée des modules, des raccourcis et des actions de NOVAI.</p><p class="settings-hint">${Number(p.tourVersion||0)>=TOUR_VERSION?'Tutoriel déjà consulté sur ce compte.':'Le tutoriel se lance automatiquement après ta prochaine connexion.'}</p></div><button class="secondary" type="button" onclick="startTour(true)">Revoir le tutoriel</button></div><div class="settings-row"><div><b>Capacités de NOVAI</b><p>Autorise NOVAI à exécuter des actions whitelistées dans ton espace. Les suppressions demandent toujours une confirmation explicite.</p><ul class="novai-actions-list"><li><span class="novai-chip ${p.novaiActions!==false?'on':'off'}">${p.novaiActions!==false?'Actif':'Proposé seulement'}</span><span>Navigation, projets, tâches, notes, ressources, roadmap, automatisations et réglages.</span></li></ul></div><label class="switch"><input type="checkbox" ${p.novaiActions!==false?'checked':''} onchange="setNovaiActions(this.checked)"><span></span></label></div></div></div><div class="section-title"><div><h2>Compte & données</h2><p>Gère ton NovaID et tes sauvegardes.</p></div></div><div class="grid account-grid"><div class="card"><div class="card-head"><h3>NovaID · Identité</h3><span class="badge ${signed?'green':'orange'}">${signed?'Session active':'Invité'}</span></div><div id="authPanel">${signed?`<p class="muted" style="font-size:12px;line-height:1.8">Tu es connecté. Les fonctions cloud, plugins et analytics sont disponibles pour ce compte.</p><button class="secondary" onclick="logout()">Se déconnecter</button>`:`<div class="field"><label>Nom affiché (inscription)</label><input id="displayName" placeholder="Ton nom" maxlength="50"></div><div class="field"><label>Adresse e-mail</label><input id="authEmail" type="email" placeholder="toi@exemple.fr"></div><div class="field"><label>Mot de passe (10 caractères minimum)</label><input id="authPassword" type="password" placeholder="••••••••••" minlength="10"></div><div class="actions"><button class="secondary" onclick="authAction('login')">Connexion</button><button class="primary" onclick="authAction('register')">Créer mon NovaID</button></div>`}</div></div><div class="card"><div class="card-head"><h3>Sauvegarde du workspace</h3></div><p class="muted" style="font-size:11px;line-height:1.7">Exporte tes projets, tâches, notes et préférences, ou importe une sauvegarde JSON.</p><div class="actions" style="justify-content:flex-start"><button class="secondary" onclick="exportData()">Exporter JSON</button><label class="secondary" style="cursor:pointer">Importer JSON<input id="importFile" type="file" accept="application/json" hidden onchange="importData(event)"></label></div><div class="notice">Les préférences d’apparence sont stockées localement dans ce navigateur. Ne partage jamais ton mot de passe.</div></div></div>`}
function resetPreferences(){const keep={performanceMode:state.preferences?.performanceMode===true,tourVersion:Number(state.preferences?.tourVersion||0),novaiActions:state.preferences?.novaiActions!==false};state.preferences={...DEFAULT_PREFERENCES,...keep};applyPreferences();saveLocal();render();toast('Apparence réinitialisée.')}
function clearChat(){chatHistory=[];novaiSaveChat();const box=$('#chatMessages');if(box)box.innerHTML=novaiChatMarkup();toast('Nouvelle conversation prête.')}

function startOfWeek(date){const d=new Date(date);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
function calendarDayKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function taskDueKey(task){return task.due?String(task.due).slice(0,10):''}
function formatDueDate(value){const d=new Date(`${String(value).slice(0,10)}T12:00:00`);return Number.isNaN(d.getTime())?'Date invalide':d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}
function renderCalendar(){
  const today=new Date();today.setHours(0,0,0,0);
  const start=startOfWeek(today);
  const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d});
  const tasks=Array.isArray(state.tasks)?state.tasks:[];
  const undated=tasks.filter(t=>!taskDueKey(t));
  const overdue=tasks.filter(t=>!t.done&&taskDueKey(t)&&new Date(`${taskDueKey(t)}T23:59:59`)<today);
  const weekTasks=days.map(day=>tasks.filter(t=>taskDueKey(t)===calendarDayKey(day)));
  const upcoming=tasks.filter(t=>!t.done);
  return `<div class="grid stats">${stat('Tâches planifiées',tasks.length,'Toutes les tâches','▦')}${stat('À terminer',upcoming.length,'Tâches ouvertes','◷','orange')}${stat('En retard',overdue.length,'Échéance dépassée','!','red')}${stat('Sans échéance',undated.length,'À planifier','◌')}</div><div class="card"><div class="card-head"><h3>Semaine du ${start.toLocaleDateString('fr-FR',{day:'2-digit',month:'long'})}</h3><button class="primary" onclick="openCreate('task')">＋ Ajouter une tâche</button></div><div class="calendar-grid">${days.map((day,i)=>`<div class="calendar-day ${calendarDayKey(day)===calendarDayKey(today)?'calendar-today':''}"><b>${day.toLocaleDateString('fr-FR',{weekday:'long'})}</b><small>${day.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</small>${weekTasks[i].map(t=>`<div class="calendar-event ${t.done?'event-done':''}" title="${esc(t.title)} · ${formatDueDate(t.due)}">${esc(t.title)}</div>`).join('')}</div>`).join('')}</div><p class="muted">Chaque tâche apparaît à sa date d’échéance réelle. Les tâches sans date restent listées séparément ci-dessous.</p></div><div class="card"><div class="card-head"><h3>Tâches sans échéance</h3><span class="badge">${undated.length}</span></div>${undated.length?`<div class="list">${undated.map(t=>`<div class="task-row ${t.done?'completed':''}"><button class="check ${t.done?'done':''}" aria-label="${t.done?'Rouvrir':'Terminer'} : ${esc(t.title)}" onclick="toggleTask('${t.id}')">${t.done?'✓':''}</button><div class="task-copy"><b>${esc(t.title)}</b><small>${esc(t.project||'Sans projet')}</small></div><span class="badge ${t.priority==='Haute'?'red':t.priority==='Moyenne'?'orange':'green'}">${esc(t.priority)}</span></div>`).join('')}</div>`:empty('Tout est planifié','Toutes tes tâches ont une date d’échéance.')}</div>`;
}
function renderFocus(){const total=state.focusSessions.reduce((a,s)=>a+(Number(s.minutes)||0),0);return `<div class="grid columns"><div class="card focus-card"><div class="card-head"><h3>Session de concentration</h3><span class="badge">Pomodoro</span></div><div class="timer-display" id="timerDisplay">25:00</div><div class="field"><label>Objectif de la session</label><input id="focusLabel" placeholder="Ex. Avancer NovaEngine" maxlength="80" value="Travail concentré"></div><div class="timer-presets"><button class="secondary" onclick="setTimer(15)">15 min</button><button class="secondary" onclick="setTimer(25)">25 min</button><button class="secondary" onclick="setTimer(45)">45 min</button></div><div class="actions"><button class="primary" id="focusStart" onclick="startTimer()">▶ Démarrer</button><button class="secondary" onclick="resetTimer()">↺ Réinitialiser</button></div><p class="muted">Le minuteur fonctionne dans cet onglet. Une session terminée est enregistrée dans votre historique local.</p></div><div class="card"><div class="card-head"><h3>Historique Focus</h3><span class="badge">${state.focusSessions.length} sessions</span></div><div class="stat-value">${total} min</div><div class="stat-foot">Temps de concentration cumulé</div><div class="list">${state.focusSessions.slice(0,8).map(s=>`<div class="feature"><span class="stat-icon green">✓</span><div><h3>${esc(s.label||'Concentration')}</h3><p>${s.minutes} minutes · ${new Date(s.completedAt).toLocaleString('fr-FR')}</p></div></div>`).join('')||empty('Aucune session terminée','Lancez votre première session pour la voir ici.')}</div></div></div>`}
function renderKnowledge(){return `<div class="section-title"><div><h2>Bibliothèque personnelle</h2><p>${state.knowledge.length} ressource(s) indexée(s) localement.</p></div><button class="primary" onclick="openKnowledge()">＋ Ajouter une ressource</button></div><div class="card search-card"><input id="knowledgeSearch" placeholder="Rechercher dans les ressources…" oninput="filterKnowledge(this.value)"><span class="muted">Recherche instantanée</span></div><div id="knowledgeList" class="grid note-grid">${knowledgeCards(state.knowledge)}</div>`}
function knowledgeCards(items){return items.map(n=>`<div class="card note-card knowledge-item"><div class="card-head"><span class="stat-icon cyan">⌕</span><button class="secondary" onclick="deleteKnowledge('${n.id}')">Supprimer</button></div><h3>${esc(n.title)}</h3><p>${esc(n.content)}</p><div class="tag-row">${(n.tags||[]).map(t=>`<span class="badge">${esc(t)}</span>`).join('')}</div><small>${new Date(n.date).toLocaleString('fr-FR')}</small></div>`).join('')||empty('Votre base est vide','Ajoutez des notes de recherche, des idées ou des extraits de documentation.')}
function renderStudio(){return `<div class="grid columns studio-layout"><div class="card"><div class="card-head"><h3>Fichiers locaux</h3><button class="primary" onclick="newCodeFile()">＋ Nouveau</button></div><div class="studio-files">${state.codeFiles.map(f=>`<button class="studio-file ${f.id===activeCodeId?'selected':''}" onclick="selectCodeFile('${f.id}')">▤ ${esc(f.name)}</button>`).join('')||empty('Aucun snippet','Créez un fichier pour commencer.')}</div></div><div class="card"><div class="card-head"><h3 id="codeFileTitle">Éditeur de code</h3><div class="actions"><button class="secondary" onclick="saveCodeFile()">Sauvegarder</button><button class="secondary" onclick="downloadCodeFile()">Exporter</button></div></div><input id="codeName" class="code-name" placeholder="nom-du-fichier.js" maxlength="80"><textarea id="codeEditor" class="code-editor" spellcheck="false" placeholder="// Écrivez votre code ici…"></textarea><p class="muted">Éditeur texte local : pas d’exécution de code dans le navigateur, par sécurité.</p></div></div>`}
function renderApi(){return `<div class="grid stats">${stat('API','REST','JSON · HTTP','⌁')}${stat('Routes documentées',apiDocsCache?.endpoints?.length||14,'Public + authentifiées','▤','cyan')}${stat('Authentification','JWT','Bearer token','◈','green')}${stat('État serveur',apiStatus||'Vérification…','GET /api/health','↗','orange')}</div><div class="grid columns"><div class="card"><div class="card-head"><h3>Tester la connexion</h3><button class="primary" onclick="testApi()">Tester l’API ↗</button></div><p class="muted">Le test interroge le vrai serveur NovaCore. Les routes privées nécessitent une connexion NovaID.</p><pre id="apiResult" class="api-result">Cliquez sur « Tester l’API » pour recevoir une réponse.</pre></div><div class="card"><div class="card-head"><h3>Exemple de requête</h3><span class="badge">cURL</span></div><pre class="api-result">curl http://localhost:6300/api/health

curl http://localhost:6300/api/docs</pre><div class="notice">Ne partagez jamais votre jeton NovaID. Les clés fournisseur IA restent côté serveur dans .env.</div></div></div><div class="card"><div class="card-head"><h3>Référence des endpoints</h3><button class="secondary" onclick="loadApiDocs()">Actualiser</button></div><div id="apiEndpointList" class="endpoint-list">Chargement de la documentation…</div></div>`}
function automationTriggerLabel(trigger){return trigger==='startup'?'Au démarrage':trigger==='focus'?'Fin de session Focus':'Manuel'}
function normalizeAutomationTrigger(trigger){const v=String(trigger||'').toLowerCase();if(v==='startup'||v.includes('démarrage'))return 'startup';if(v==='focus'||v.includes('session'))return 'focus';return 'manual'}
function renderAutomation(){const automations=Array.isArray(state.automations)?state.automations:[];return `<div class="section-title"><div><h2>Routines du workspace</h2><p>Des routines exécutées à la demande ou par un déclencheur réel.</p></div><button class="primary" onclick="openAutomation()">＋ Nouvelle automation</button></div><div class="grid project-grid">${automations.map(a=>`<div class="card"><div class="project-top"><div class="project-symbol">⟳</div><span class="badge ${a.enabled?'green':'orange'}">${a.enabled?'Activée':'En pause'}</span></div><h3>${esc(a.name)}</h3><p>${esc(a.description||'Aucune description')}</p><div class="stat-foot">Déclencheur : ${esc(automationTriggerLabel(normalizeAutomationTrigger(a.trigger)))}</div><div class="stat-foot">${a.lastRunAt?`Dernière exécution : ${new Date(a.lastRunAt).toLocaleString('fr-FR')} · ${Number(a.runCount)||0} fois`:'Jamais exécutée'}</div><div class="actions"><button class="primary" onclick="runAutomation('${a.id}')">▶ Exécuter</button><button class="secondary" onclick="toggleAutomation('${a.id}')">${a.enabled?'Mettre en pause':'Activer'}</button><button class="secondary" onclick="deleteAutomation('${a.id}')">Supprimer</button></div></div>`).join('')||empty('Aucune automation','Crée une routine pour accélérer ton workflow.')}</div><div class="notice">Déclencheurs réels : au démarrage de NovaCore et à la fin d’une session Focus. Chaque exécution est journalisée dans tes notes. Aucun script arbitraire ne s’exécute en arrière-plan.</div>`}
let focusSeconds=1500, focusDuration=25, focusInterval=null, apiStatus='Inconnu', apiDocsCache=null, activeCodeId=null;
function setTimer(minutes){if(focusInterval)clearInterval(focusInterval);focusInterval=null;focusDuration=minutes;focusSeconds=minutes*60;updateTimer();const b=$('#focusStart');if(b)b.textContent='▶ Démarrer'}
function updateTimer(){const el=$('#timerDisplay');if(el)el.textContent=`${String(Math.floor(focusSeconds/60)).padStart(2,'0')}:${String(focusSeconds%60).padStart(2,'0')}`}
function startTimer(){if(focusInterval){clearInterval(focusInterval);focusInterval=null;$('#focusStart').textContent='▶ Reprendre';return}$('#focusStart').textContent='Ⅱ Pause';focusInterval=setInterval(()=>{focusSeconds--;updateTimer();if(focusSeconds<=0){clearInterval(focusInterval);focusInterval=null;completeFocus()}},1000)}
function resetTimer(){setTimer(25)}
async function completeFocus(){const minutes=focusDuration;const label=$('#focusLabel')?.value.trim()||'Concentration';const session={id:uid(),minutes,label,completedAt:new Date().toISOString()};state.focusSessions.unshift(session);saveLocal();if(localStorage.getItem('novaToken')){try{await api('/api/focus/sessions',{method:'POST',body:JSON.stringify({minutes,label})})}catch{}}const triggered=runAutomationsFor('focus');toast(triggered?`Session terminée · ${triggered} automation(s) déclenchée(s).`:'Session terminée ! Bien joué.');render()}
function openKnowledge(){openModal('Ajouter une ressource',`<div class="field"><label>Titre</label><input id="kTitle" maxlength="120" placeholder="Ex. Notes Vulkan"></div><div class="field"><label>Contenu</label><textarea id="kContent" placeholder="Résumé, référence ou idées…"></textarea></div><div class="field"><label>Tags (séparés par des virgules)</label><input id="kTags" placeholder="code, moteur, recherche"></div><div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="primary" onclick="saveKnowledge()">Ajouter</button></div>`,'KNOWLEDGE BASE')}
function saveKnowledge(){const title=$('#kTitle').value.trim(),content=$('#kContent').value.trim();if(!title||!content)return toast('Le titre et le contenu sont requis.');state.knowledge.unshift({id:uid(),title,content,tags:$('#kTags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,10),date:new Date().toISOString()});saveLocal();closeModal();render();toast('Ressource ajoutée.')}
function deleteKnowledge(id){state.knowledge=state.knowledge.filter(n=>n.id!==id);saveLocal();render();toast('Ressource supprimée.')}
function filterKnowledge(q){const items=state.knowledge.filter(n=>`${n.title} ${n.content} ${(n.tags||[]).join(' ')}`.toLowerCase().includes(q.toLowerCase()));$('#knowledgeList').innerHTML=knowledgeCards(items)}
function newCodeFile(){const f={id:uid(),name:`snippet-${state.codeFiles.length+1}.js`,content:'// Nouveau snippet NovaCore\n\n'};state.codeFiles.unshift(f);activeCodeId=f.id;saveLocal();render();}
function selectCodeFile(id){saveCodeFile(false);activeCodeId=id;render();}
function saveCodeFile(show=true){const f=state.codeFiles.find(x=>x.id===activeCodeId);if(!f)return toast('Créez d’abord un fichier.');f.name=$('#codeName').value.trim()||'snippet.js';f.content=$('#codeEditor').value;saveLocal();$('#codeFileTitle').textContent=f.name;if(show)toast('Snippet sauvegardé localement.')}
function downloadCodeFile(){const f=state.codeFiles.find(x=>x.id===activeCodeId);if(!f){toast('Créez d’abord un fichier.');return}saveCodeFile(false);const blob=new Blob([f.content],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=f.name;a.click();URL.revokeObjectURL(a.href);toast('Fichier exporté.')}
function renderCodeEditor(){const f=state.codeFiles.find(x=>x.id===activeCodeId)||state.codeFiles[0];if(!f)return;activeCodeId=f.id;$('#codeName').value=f.name;$('#codeEditor').value=f.content;$('#codeFileTitle').textContent=f.name}
function openAutomation(){openModal('Nouvelle automation',`<div class="field"><label>Nom</label><input id="aName" maxlength="80" placeholder="Ex. Revue quotidienne"></div><div class="field"><label>Description</label><textarea id="aDesc" maxlength="300" placeholder="Que doit faire cette routine ?"></textarea></div><div class="field"><label>Déclencheur</label><select id="aTrigger"><option value="manual">Manuel</option><option value="startup">Au démarrage de NovaCore</option><option value="focus">À la fin d’une session Focus</option></select></div><div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="primary" onclick="createAutomation()">Créer</button></div>`,'AUTOMATIONS')}
function createAutomation(){const name=$('#aName').value.trim();if(!name)return toast('Donnez un nom à la routine.');state.automations=Array.isArray(state.automations)?state.automations:[];state.automations.unshift({id:uid(),name,description:$('#aDesc').value.trim(),trigger:normalizeAutomationTrigger($('#aTrigger').value),enabled:true,lastRunAt:null,runCount:0});saveLocal();closeModal();render();toast('Automation créée.')}
function toggleAutomation(id){const a=state.automations.find(x=>x.id===id);if(a)a.enabled=!a.enabled;saveLocal();render()}
function deleteAutomation(id){state.automations=state.automations.filter(x=>x.id!==id);saveLocal();render()}
function executeAutomationAction(a,source='manual'){
  if(!a)return false;
  a.lastRunAt=new Date().toISOString();a.runCount=(Number(a.runCount)||0)+1;
  if(source==='manual'&&a.name.toLowerCase().includes('sauvegarde'))exportData();
  else{state.notes=Array.isArray(state.notes)?state.notes:[];state.notes.unshift({id:uid(),title:`Automation : ${a.name}`,content:`Déclencheur : ${automationTriggerLabel(normalizeAutomationTrigger(a.trigger))} · ${new Date().toLocaleString('fr-FR')}. ${a.description||''}`,date:new Date().toISOString()});}
  return true;
}
function runAutomation(id){const a=(state.automations||[]).find(x=>x.id===id);if(!a)return;if(!a.enabled)return toast('Activez cette automation avant de la lancer.');executeAutomationAction(a,'manual');saveLocal();render();toast(`Routine exécutée : ${a.name}.`)}
function runAutomationsFor(trigger,{once=false}={}){
  const safe=normalizeAutomationTrigger(trigger);
  if(once){try{if(sessionStorage.getItem(`novaAutomationRun:${safe}`)==='1')return 0}catch{}}
  const list=(state.automations||[]).filter(a=>a.enabled&&normalizeAutomationTrigger(a.trigger)===safe);
  if(once){try{sessionStorage.setItem(`novaAutomationRun:${safe}`,'1')}catch{}}
  list.forEach(a=>executeAutomationAction(a,safe));
  if(list.length)saveLocal();
  return list.length;
}
async function testApi(){const box=$('#apiResult');box.textContent='Appel en cours…';try{const r=await fetch('/api/health');const data=await r.json();apiStatus=data.ok?'En ligne':'Erreur';box.textContent=JSON.stringify({status:r.status,...data},null,2);const stats=document.querySelectorAll('.stats .stat-value');if(stats[3])stats[3].textContent=apiStatus}catch(e){apiStatus='Hors ligne';box.textContent=e.message}}
async function loadApiDocs(){const el=$('#apiEndpointList');if(!el)return;el.textContent='Chargement…';try{apiDocsCache=await api('/api/docs');el.innerHTML=apiDocsCache.endpoints.map(e=>`<div class="endpoint-row"><span class="method method-${e.method.toLowerCase()}">${e.method}</span><code>${esc(e.path)}</code><span>${esc(e.description)}</span><span class="badge">${e.auth?'JWT':'Public'}</span></div>`).join('')}catch(e){el.textContent=e.message}}

async function renderDeveloper(){let d={enabled:false};try{d=await api('/api/developer/status')}catch(e){}const enabled=d.enabled||document.body.dataset.devmode==='1';return `<div class="dev-hero glass-panel"><div class="dev-mark">⌘</div><div><span class="eyebrow">NOVA INDUSTRIES · DEVELOPER TOOLS</span><h2>Mode développeur <span class="badge ${enabled?'green':'orange'}">${enabled?'ACTIF':'VERROUILLÉ'}</span></h2><p>Débloque l’interface technique, les diagnostics enrichis et les outils de développement. L’activation redémarre le serveur.</p></div></div><div class="grid two-col"><div class="card glass-panel"><div class="card-head"><h3>🔐 Activation développeur</h3><span class="badge">Code requis</span></div>${enabled?`<div class="notice">Mode développeur actif. Le serveur a redémarré avec NOVACORE_DEV_MODE=1.</div><button class="primary" onclick="setPage('system')">Ouvrir le Centre système ↗</button>`:`<p class="muted">Entre le code développeur fourni avec cette version. Le code ne donne pas accès à une console système et n’autorise pas l’exécution de commandes arbitraires.</p><div class="field"><label>Code développeur</label><input id="developerCode" type="password" autocomplete="off" maxlength="100" placeholder="NOVA-DEV-…"></div><button class="primary full-width" id="developerActivate" onclick="activateDeveloperMode()">Activer et redémarrer ↻</button><p id="developerResult" class="muted tiny" aria-live="polite"></p>`}</div><div class="card glass-panel"><div class="card-head"><h3>Outils disponibles</h3><span class="badge green">Sans exécution arbitraire</span></div><div class="list">${[['Diagnostics','Runtime, mémoire et état API'],['Learn Lab','Datasets, évaluations et expériences'],['Code Studio','Snippets, export et prototypage'],['API Explorer','Tester les routes exposées']].map(x=>`<div class="list-item"><span class="dev-icon-plate">⌘</span><div class="list-main"><b>${x[0]}</b><small>${x[1]}</small></div></div>`).join('')}</div><div class="notice">Conseil : garde le port 6300 sur un réseau privé de confiance et change NOVACORE_DEV_CODE dans .env avant de partager l’accès au Wi-Fi.</div></div></div>${enabled?`<div class="card glass-panel smtp-settings"><div class="card-head"><h3>✉️ Configuration SMTP</h3><span id="smtpStatus" class="badge">Chargement…</span></div><p class="muted">Configure l’envoi des e-mails NovaID. Le mot de passe reste côté serveur.</p><div class="grid two-col"><div class="field"><label>Serveur SMTP</label><input id="smtpHost" placeholder="smtp.example.com"></div><div class="field"><label>Port</label><input id="smtpPort" type="number" min=1 max=65535 value=587></div><div class="field"><label>Utilisateur</label><input id="smtpUser" autocomplete="username"></div><div class="field"><label>Mot de passe SMTP</label><input id="smtpPass" type="password" autocomplete="new-password" placeholder="Vide = conserver"></div><div class="field"><label>Adresse expéditeur (SMTP_FROM)</label><input id="smtpFrom" type="text" placeholder="NovaCore &lt;no-reply@example.com&gt;"></div><div class="field"><label>Sécurité</label><select id="smtpSecure"><option value="false">STARTTLS / port 587</option><option value="true">TLS implicite / port 465</option></select></div></div><div class="actions"><button class="primary" onclick="saveSmtpSettings()">Enregistrer SMTP</button><button class="secondary" onclick="testSmtpSettings()">Tester la connexion</button></div><p id="smtpResult" class="muted tiny" aria-live="polite"></p></div>`:''}`; }
async function loadSmtpSettings(){try{const r=await fetch('/api/developer/smtp');const d=await r.json();if(!r.ok)throw new Error(d.error||'Accès refusé');$('#smtpHost').value=d.host||'';$('#smtpPort').value=d.port||587;$('#smtpUser').value=d.user||'';$('#smtpFrom').value=d.from||'';$('#smtpSecure').value=String(!!d.secure);$('#smtpStatus').textContent=d.configured?'Configuré':'À configurer';$('#smtpStatus').className='badge '+(d.configured?'green':'orange')}catch(e){const x=$('#smtpStatus');if(x)x.textContent=e.message}}
async function saveSmtpSettings(){const result=$('#smtpResult');try{const body={host:$('#smtpHost').value.trim(),port:Number($('#smtpPort').value),user:$('#smtpUser').value.trim(),pass:$('#smtpPass').value,from:$('#smtpFrom').value.trim(),secure:$('#smtpSecure').value==='true'};const r=await fetch('/api/developer/smtp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Enregistrement impossible');$('#smtpPass').value='';result.textContent='Configuration enregistrée. Redémarre NovaCore pour appliquer les paramètres au service e-mail.';loadSmtpSettings()}catch(e){result.textContent=e.message}}
async function testSmtpSettings(){const result=$('#smtpResult');result.textContent='Test SMTP…';try{const r=await fetch('/api/developer/smtp/test',{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Test échoué');result.textContent=d.message||'Connexion SMTP réussie.'}catch(e){result.textContent=e.message}}
async function activateDeveloperMode(){const input=$('#developerCode'),out=$('#developerResult'),btn=$('#developerActivate');if(!input?.value.trim())return toast('Entre le code développeur.');if(btn)btn.disabled=true;if(out)out.textContent='Vérification du code…';try{const r=await fetch('/api/developer/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:input.value.trim()})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Activation refusée');if(out)out.textContent=d.restarting?'Mode accepté. Redémarrage du serveur…':'Mode développeur déjà actif.';if(d.restarting){setTimeout(()=>location.reload(),1800);setTimeout(()=>location.reload(),5000)}else{document.body.dataset.devmode='1';setPage('developer')}}catch(e){if(out)out.textContent=e.message;toast(e.message)}finally{if(btn)btn.disabled=false}}
function renderNovaSeriesStudio(){
 const ss=state.seriesStudio||(state.seriesStudio={title:'Nouvelle série',format:'Série animée 3D',genre:'Science-fiction',logline:'',episodes:[],characters:[],shots:[],boards:[],script:'',productionStatus:'Développement',targetDate:'',budget:0,assets:[],productionTasks:[]});
 ss.assets ||= []; ss.productionTasks ||= []; ss.script ||= ''; ss.productionStatus ||= 'Développement'; ss.budget ||= 0; ss.version ||= '0.1.0'; ss.targetAudience ||= 'Tout public'; ss.styleGuide ||= '';
 ss.episodes = Array.isArray(ss.episodes)?ss.episodes:[]; ss.characters = Array.isArray(ss.characters)?ss.characters:[]; ss.shots = Array.isArray(ss.shots)?ss.shots:[]; ss.boards = Array.isArray(ss.boards)?ss.boards:[];
 const tasks=[['Bible & univers','Définir le ton, les règles et le public'],['Scénario pilote','Finaliser le script du premier épisode'],['Design des personnages','Valider silhouettes et fiches'],['Storyboard','Découper les scènes en plans'],['Animatique','Tester rythme, durée et transitions'],['Pipeline de production','Préparer assets et exports']];
 const completed=ss.productionTasks.filter(t=>t.done).length; const percent=ss.productionTasks.length?Math.round(completed/ss.productionTasks.length*100):0;
 return `<div class="series-hero glass-panel"><div class="series-orb">✦</div><div><span class="eyebrow">NOVA INDUSTRIES · PRODUCTION STUDIO</span><h2>NovaSeries Studio <span class="badge">PRODUCTION</span></h2><p>Un espace de préproduction pour piloter une série 2D/3D : bible éditoriale, scénarios, casting, storyboard, plans, assets, budget et checklist de production. Les données restent dans ton workspace local.</p><div class="series-metrics"><span><b>${ss.episodes.length}</b> épisodes</span><span><b>${ss.characters.length}</b> personnages</span><span><b>${ss.shots.length}</b> plans</span><span><b>${ss.assets.length}</b> assets suivis</span><span><b>${percent}%</b> readiness checklist</span></div></div></div>
 <div class="grid stats">${stat('Production',ss.productionStatus,'Étape actuelle','◈')}${stat('Épisodes',ss.episodes.length,'Structure de saison','▤','cyan')}${stat('Budget indicatif',new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(ss.budget)||0),'Prévision non comptable','€','orange')}${stat('Échéance',ss.targetDate||'À définir','Objectif de production','◷')}</div>
 <div class="series-production-strip card"><div><span class="eyebrow">PRODUCTION CONTROL</span><h3>Tableau de pilotage</h3><p>Une vue claire sur les éléments structurants avant d’engager la production.</p></div><div class="production-kpis"><div><b>${ss.episodes.filter(e=>['Prêt','Validé','Terminé','Verrouillé'].includes(e.status)).length}</b><small>Épisodes validés</small></div><div><b>${ss.assets.filter(a=>['Terminé','Validé'].includes(a.status)).length}</b><small>Assets livrés</small></div><div><b>${ss.characters.length?ss.characters.filter(c=>c.visual&&c.visual!=='À définir').length:0}</b><small>Fiches avec design</small></div><div><b>${ss.shots.length}</b><small>Plans listés</small></div></div><div class="actions series-actions"><label class="secondary" style="cursor:pointer">Importer un projet<input hidden type="file" accept="application/json,.json" onchange="importSeriesProject(event)"></label><button class="secondary" onclick="createNewSeriesProject()">Nouveau projet</button><button class="secondary" onclick="exportSeriesMarkdown()">Dossier Markdown</button><button class="secondary" onclick="printSeriesDossier()">Imprimer / PDF</button><button class="secondary" onclick="exportSeriesProject()">Exporter JSON</button></div></div>
 ${seriesReadinessPanel()}
 <div class="grid two-col series-top-grid"><div class="card"><div class="card-head"><h3>📽 Bible de série</h3><span class="badge">Projet</span></div><div class="field"><label>Titre de la série</label><input id="seriesTitle" value="${esc(ss.title)}" maxlength="120"></div><div class="grid two-col"><div class="field"><label>Format</label><select id="seriesFormat">${['Série animée 3D','Série animée 2D','Série hybride','Mini-série','Long métrage'].map(x=>`<option ${ss.format===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Genre</label><select id="seriesGenre">${['Science-fiction','Fantasy','Aventure','Comédie','Drame','Documentaire','Action','Thriller'].map(x=>`<option ${ss.genre===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Pitch / logline</label><textarea id="seriesLogline" rows="3" maxlength="1600" placeholder="La promesse de la série…">${esc(ss.logline)}</textarea></div><div class="grid two-col"><div class="field"><label>Version de production</label><input id="seriesVersion" maxlength=30 value="${esc(ss.version)}" placeholder="0.1.0"></div><div class="field"><label>Public cible</label><select id="seriesAudience">${['Tout public','6+','10+','13+','16+','Adulte','À définir'].map(x=>`<option ${ss.targetAudience===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="grid two-col"><div class="field"><label>Étape de production</label><select id="seriesStatus">${['Développement','Préproduction','Production','Postproduction','Livré','En pause'].map(x=>`<option ${ss.productionStatus===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Échéance cible</label><input id="seriesTargetDate" type="date" value="${esc(ss.targetDate||'')}"></div></div><div class="field"><label>Guide de style / continuité</label><textarea id="seriesStyleGuide" rows="3" maxlength="4000" placeholder="Palette, références, ton, règles visuelles, continuité…">${esc(ss.styleGuide)}</textarea></div><div class="field"><label>Budget indicatif (€)</label><input id="seriesBudget" type="number" min="0" max="100000000" step="100" value="${Number(ss.budget)||0}"></div><button class="primary" onclick="saveSeriesBible()">Enregistrer la bible de production</button></div>
 <div class="card"><div class="card-head"><h3>🧭 Pipeline de production</h3><span class="badge green">${percent}% complété</span></div><div class="series-progress-track"><span style="width:${percent}%"></span></div><div class="series-checklist">${tasks.map((t,i)=>{const found=ss.productionTasks.find(x=>x.title===t[0]);return `<label class="series-check"><input type="checkbox" ${found?.done?'checked':''} onchange="toggleSeriesTask(${i},this.checked)"><span><b>${t[0]}</b><small>${t[1]}</small></span></label>`}).join('')}</div><div class="notice">Outil d'organisation : les coûts, échéances et statuts sont des estimations saisies par le créateur, pas une comptabilité automatisée.</div><button class="secondary full-width" onclick="exportSeriesProject()">Exporter le dossier de production (.json) ↗</button></div></div>
 <div class="grid two-col series-top-grid"><div class="card"><div class="card-head"><h3>📝 Atelier de scénario</h3><span class="badge">Écriture</span></div><p class="muted">Écris un synopsis développé, une scène ou un premier jet. Enregistre régulièrement pour conserver tes changements.</p><textarea id="seriesScript" rows="12" maxlength="50000" placeholder="ÉPISODE 01 — TITRE\n\nINT. / EXT. — LIEU — JOUR/NUIT\nDescription de l'action…\n\nPERSONNAGE\nDialogue…">${esc(ss.script)}</textarea><div class="actions"><button class="primary" onclick="saveSeriesScript()">Enregistrer le scénario</button><button class="secondary" onclick="exportSeriesScript()">Exporter le script .txt</button></div></div><div class="card"><div class="card-head"><h3>👤 Casting & personnages</h3><button class="secondary" onclick="addSeriesCharacter()">＋ Ajouter</button></div><div class="series-collection">${ss.characters.map((c,i)=>`<article class="series-item"><div class="series-item-mark">${esc((c.name||'?').slice(0,1).toUpperCase())}</div><div><b>${esc(c.name)}</b><small>${esc(c.role)} · ${esc(c.visual)}</small><p>${esc(c.motivation)}</p></div>${seriesItemActions('characters','character',i,ss.characters.length)}</article>`).join('')||empty('Aucun personnage','Crée des fiches de casting et de design visuel.')}</div></div></div>
 <div class="grid two-col series-top-grid"><div class="card"><div class="card-head"><h3>🎞 Saison & épisodes</h3><button class="secondary" onclick="addSeriesEpisode()">＋ Épisode</button></div><div class="series-collection">${ss.episodes.map((e,i)=>`<article class="episode-item"><span class="episode-number">${String(i+1).padStart(2,'0')}</span><div><b>${esc(e.title)}</b><small>${esc(e.duration)} min · statut de production</small><p>${esc(e.synopsis)}</p><select class="episode-status-select" aria-label="Statut de l’épisode" onchange="setSeriesEpisodeStatus(${i},this.value)">${['À écrire','En écriture','À relire','Réécriture','Validé','Prêt','En production','Terminé','En pause'].map(st=>`<option ${e.status===st?'selected':''}>${st}</option>`).join('')}</select></div>${seriesItemActions('episodes','episode',i,ss.episodes.length)}</article>`).join('')||empty('Aucun épisode','Structure ta saison, les synopsis et les durées.')}</div></div><div class="card"><div class="card-head"><h3>🧰 Asset tracker</h3><button class="secondary" onclick="addSeriesAsset()">＋ Asset</button></div><p class="muted">Suivi des fichiers à produire : concept art, modèles 3D, textures, rigging, sons et exports.</p><div class="series-collection">${ss.assets.map((a,i)=>`<article class="series-item"><div class="series-item-mark">${a.kind==='3D'?'◇':a.kind==='Audio'?'♫':'▧'}</div><div><b>${esc(a.name)}</b><small>${esc(a.kind)} · ${esc(a.status)} · ${esc(a.owner||'Sans responsable')}</small><p>${esc(a.note||'Aucune note')}</p></div>${seriesItemActions('assets','asset',i,ss.assets.length)}</article>`).join('')||empty('Aucun asset suivi','Ajoute les éléments à créer pour ta production.')}</div></div></div>
 <div class="grid two-col series-top-grid"><div class="card"><div class="card-head"><h3>🖼 Storyboard</h3><button class="secondary" onclick="addStoryboardPanel()">＋ Vignette</button></div><div class="storyboard-grid">${ss.boards.map((b,i)=>`<div class="storyboard-panel"><div class="storyboard-art">${esc(b.camera)}</div><b>${i+1}. ${esc(b.title)}</b><small>${esc(b.note)}</small>${seriesItemActions('boards','board',i,ss.boards.length)}</div>`).join('')||empty('Storyboard vide','Décris le cadrage et l’action de chaque vignette.')}</div></div><div class="card"><div class="card-head"><h3>🎥 Shot list & animatique</h3><button class="secondary" onclick="addSeriesShot()">＋ Plan</button></div><div class="table-scroll"><table class="learn-table"><thead><tr><th>Plan</th><th>Caméra</th><th>Durée</th><th>Notes</th><th></th></tr></thead><tbody>${ss.shots.map((x,i)=>`<tr><td>${esc(x.name)}</td><td>${esc(x.camera)}</td><td>${esc(x.duration)} s</td><td>${esc(x.note)}</td><td>${seriesItemActions('shots','shot',i,ss.shots.length)}</td></tr>`).join('')||'<tr><td colspan="5">Aucun plan enregistré.</td></tr>'}</tbody></table></div><div class="actions"><button class="secondary" onclick="exportSeriesProject()">Exporter le projet JSON</button><button class="secondary" onclick="exportSeriesCsv()">Exporter la shot list CSV</button></div><p class="muted tiny">Le studio organise la préproduction ; il ne remplace pas encore un logiciel d’animation, de montage ou de rendu 3D.</p></div></div>`;
}
function seriesModel(){return window.NovaSeriesModel}
function seriesReadiness(){
 return seriesModel().seriesReadiness(state.seriesStudio||{});
}
function seriesReadinessPanel(){
 const r=seriesReadiness();
 return `<div class="card series-readiness"><div class="card-head"><div><h3>🧪 Diagnostic de production</h3><p class="muted tiny">Contrôles déterministes calculés depuis la bible, les épisodes, les assets et le storyboard.</p></div><span class="badge ${r.percent===100?'green':'orange'}">${r.done}/${r.checks.length} · ${r.percent}%</span></div><div class="series-readiness-track"><span style="width:${r.percent}%"></span></div><div class="series-readiness-grid">${r.checks.map(c=>`<div class="series-readiness-item ${c.ok?'ok':'pending'}"><span aria-hidden="true">${c.ok?'✓':'○'}</span><div><b>${esc(c.label)}</b><small>${esc(c.detail)}</small></div></div>`).join('')}</div></div>`;
}
function normalizeStructuredScript(data){
 return seriesModel().normalizeStructuredScript(data);
}
function normalizeSeriesProject(data){
 if(data&&typeof data==='object'&&!Array.isArray(data)){
  if(data.projectFormat&&data.projectFormat!=='NovaSeriesProject')throw new Error('format inconnu.');
  if(data.format&&data.format!=='NovaSeriesProject'&&!seriesModel().isKnownFormat(data.format))throw new Error('format inconnu.');
 }
 return seriesModel().normalizeSeriesProject(data);
}
function importSeriesProjectData(data,options={}){
 let project;
 try{project=normalizeSeriesProject(data)}catch(e){toast('Import refusé : '+e.message);return false}
 if(!project.title){toast('Import refusé : le projet doit avoir un titre.');return false}
 const current=(state.seriesStudio?.title||'Sans titre');
 if(!options.skipConfirm&&!confirm(`Remplacer la série « ${current} » par « ${project.title} » ?`))return false;
 state.seriesStudio=project;saveLocal();render();toast('Projet NovaSeries importé.');return true;
}
function importSeriesProject(event){
 const file=event.target.files?.[0];event.target.value='';
 if(!file)return;
 if(file.size>2_000_000)return toast('Choisis un fichier JSON de moins de 2 Mo.');
 const reader=new FileReader();
 reader.onload=()=>{try{importSeriesProjectData(JSON.parse(reader.result))}catch{toast('Import refusé : JSON invalide.')}};
 reader.onerror=()=>toast('Lecture du fichier impossible.');
 reader.readAsText(file);
}
function saveSeriesBible(){const s=state.seriesStudio;s.title=$('#seriesTitle').value.trim()||'Série sans titre';s.format=$('#seriesFormat').value;s.genre=$('#seriesGenre').value;s.logline=$('#seriesLogline').value.trim();s.productionStatus=$('#seriesStatus').value;s.targetDate=$('#seriesTargetDate').value;s.version=$('#seriesVersion').value.trim()||'0.1.0';s.targetAudience=$('#seriesAudience').value;s.styleGuide=$('#seriesStyleGuide').value.trim();const budget=Number($('#seriesBudget').value);s.budget=Number.isFinite(budget)?Math.max(0,Math.min(100000000,budget)):0;saveLocal();render();toast('Bible et paramètres de production enregistrés.')}
function toggleSeriesTask(index,done){const labels=['Bible & univers','Scénario pilote','Design des personnages','Storyboard','Animatique','Pipeline de production'];const ss=state.seriesStudio;ss.productionTasks ||= [];const title=labels[index];let item=ss.productionTasks.find(t=>t.title===title);if(!item){item={title,done:false};ss.productionTasks.push(item)}item.done=!!done;saveLocal();render();}
function saveSeriesScript(){state.seriesStudio.script=$('#seriesScript').value;saveLocal();toast('Scénario enregistré dans le workspace local.')}
function exportSeriesScript(){const script=$('#seriesScript').value;state.seriesStudio.script=script;saveLocal();const blob=new Blob([script],{type:'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.seriesStudio.title||'nova-series').replace(/[^a-z0-9-_]+/gi,'-')+'-script.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function addSeriesAsset(){openSeriesEntry('asset')}
function exportSeriesCsv(){const csv=seriesModel().shotsCsv(state.seriesStudio||{});downloadSeriesBlob('\ufeff'+csv,'text/csv;charset=utf-8',seriesExportName('shot-list.csv'));toast('Shot list exportée en CSV.')}
const SERIES_KIND_MAP={character:'characters',episode:'episodes',asset:'assets',board:'boards',shot:'shots'};
function seriesItemActions(kind,type,index,total){const up=index<=0?'disabled':'',down=index>=total-1?'disabled':'';return `<div class="series-item-actions"><button class="icon-btn" onclick="openSeriesEntry('${type}',${index})" aria-label="Modifier" title="Modifier">✎</button><button class="icon-btn" onclick="duplicateSeriesItem('${kind}',${index})" aria-label="Dupliquer" title="Dupliquer">⧉</button><button class="icon-btn" onclick="moveSeriesItem('${kind}',${index},-1)" aria-label="Monter" title="Monter" ${up}>↑</button><button class="icon-btn" onclick="moveSeriesItem('${kind}',${index},1)" aria-label="Descendre" title="Descendre" ${down}>↓</button><button class="icon-btn" onclick="removeSeriesItem('${kind}',${index})" aria-label="Supprimer" title="Supprimer">×</button></div>`}
function openSeriesEntry(type,index){
 const existing=Number.isInteger(index)?state.seriesStudio?.[SERIES_KIND_MAP[type]]?.[index]:null;
 const forms={
 character:`<div class="field"><label>Nom du personnage</label><input id="entryName" maxlength="100" required placeholder="Nom complet"></div><div class="grid two-col"><div class="field"><label>Rôle</label><input id="entryRole" maxlength="100" placeholder="Personnage principal"></div><div class="field"><label>Design visuel</label><input id="entryVisual" maxlength="180" placeholder="Silhouette, couleurs, tenue…"></div></div><div class="field"><label>Motivation / conflit</label><textarea id="entryNote" maxlength="2000" rows="3"></textarea></div>`,
 episode:`<div class="field"><label>Titre de l’épisode</label><input id="entryName" maxlength="140" required value="Épisode ${state.seriesStudio.episodes.length+1}"></div><div class="field"><label>Synopsis</label><textarea id="entryNote" maxlength="4000" rows="4" placeholder="Objectif, conflit, tournant, fin d’épisode…"></textarea></div><div class="grid two-col"><div class="field"><label>Durée estimée (minutes)</label><input id="entryDuration" type="number" min="1" max="180" value="22"></div><div class="field"><label>Statut</label><select id="entryStatus">${['À écrire','En écriture','À relire','Réécriture','Validé','Prêt','En production','Terminé','En pause'].map(x=>`<option>${x}</option>`).join('')}</select></div></div>`,
 asset:`<div class="field"><label>Nom de l’asset</label><input id="entryName" maxlength="150" required placeholder="Ex. Character_Main_Model_v01"></div><div class="grid two-col"><div class="field"><label>Type</label><select id="entryKind">${['Concept art','3D','Texture','Rig','Audio','VFX','Montage','Autre'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>Statut</label><select id="entryStatus">${['À faire','En cours','À valider','Validé','Terminé','Bloqué'].map(x=>`<option>${x}</option>`).join('')}</select></div></div><div class="field"><label>Responsable</label><input id="entryOwner" maxlength="100" placeholder="Nom / équipe"></div><div class="field"><label>Notes de production</label><textarea id="entryNote" maxlength="2000" rows="3"></textarea></div>`,
 board:`<div class="field"><label>Titre de la vignette</label><input id="entryName" maxlength="140" required placeholder="Plan d’ouverture"></div><div class="field"><label>Cadrage caméra</label><select id="entryCamera">${['Plan général','Plan large','Plan moyen','Plan américain','Gros plan','Très gros plan','Vue aérienne','Contre-plongée','Plongée','POV'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>Action / ambiance</label><textarea id="entryNote" maxlength="1800" rows="3"></textarea></div>`,
 shot:`<div class="field"><label>Nom / numéro du plan</label><input id="entryName" maxlength="80" required value="SH-${String(state.seriesStudio.shots.length+1).padStart(3,'0')}"></div><div class="grid two-col"><div class="field"><label>Cadrage / mouvement</label><select id="entryCamera">${['Fixe','Panoramique','Travelling avant','Travelling arrière','Travelling latéral','Dolly','Steadicam','Caméra portée','Grue','Plan subjectif'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>Durée (secondes)</label><input id="entryDuration" type="number" min="0.1" max="3600" step="0.1" value="5"></div></div><div class="field"><label>Note de production</label><textarea id="entryNote" maxlength="1800" rows="3"></textarea></div>`
 };
 const editing=!!existing;
 const titles={character:['Nouvelle fiche personnage','Modifier la fiche personnage'],episode:['Planifier un épisode','Modifier l’épisode'],asset:['Ajouter un asset de production','Modifier l’asset'],board:['Ajouter une vignette storyboard','Modifier la vignette'],shot:['Ajouter un plan à la shot list','Modifier le plan']};
 openModal(titles[type][editing?1:0],`<div class="series-entry-form">${forms[type]}<div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="primary" onclick="saveSeriesEntry('${type}',${editing?index:'null'})">${editing?'Enregistrer les modifications':'Enregistrer'}</button></div></div>`, 'NOVASERIES · PRODUCTION');
 if(existing)setTimeout(()=>prefillSeriesEntry(type,existing),40);
 setTimeout(()=>$('#entryName')?.focus(),50);
}
function prefillSeriesEntry(type,item){
 const set=(id,value)=>{const el=$('#'+id);if(el)el.value=value??''};
 const camera=()=>{const el=$('#entryCamera');if(el&&[...el.options].some(option=>option.value===item.camera||option.textContent===item.camera))el.value=item.camera};
 if(type==='character'){set('entryName',item.name);set('entryRole',item.role);set('entryVisual',item.visual);set('entryNote',item.motivation)}
 if(type==='episode'){set('entryName',item.title);set('entryNote',item.synopsis);set('entryDuration',item.duration);set('entryStatus',item.status)}
 if(type==='asset'){set('entryName',item.name);set('entryKind',item.kind);set('entryStatus',item.status);set('entryOwner',item.owner);set('entryNote',item.note)}
 if(type==='board'){set('entryName',item.title);camera();set('entryNote',item.note)}
 if(type==='shot'){set('entryName',item.name);camera();set('entryDuration',item.duration);set('entryNote',item.note)}
}
function saveSeriesEntry(type,index){
 const root=state.seriesStudio,name=$('#entryName')?.value.trim();
 if(!name)return toast('Ajoute un titre ou un nom avant d’enregistrer.');
 const note=$('#entryNote')?.value.trim()||'';
 let item=null;
 if(type==='character')item={name,role:$('#entryRole').value.trim()||'À définir',visual:$('#entryVisual').value.trim()||'À définir',motivation:note||'À définir'};
 if(type==='episode')item={title:name,synopsis:note,duration:Math.max(1,Math.min(180,Number($('#entryDuration').value)||22)),status:$('#entryStatus').value};
 if(type==='asset')item={name,kind:$('#entryKind').value,status:$('#entryStatus').value,owner:$('#entryOwner').value.trim(),note};
 if(type==='board')item={title:name,camera:$('#entryCamera').value,note};
 if(type==='shot')item={name,camera:$('#entryCamera').value,duration:Math.max(.1,Math.min(3600,Number($('#entryDuration').value)||5)),note};
 if(!item)return;
 const collection=root[SERIES_KIND_MAP[type]];
 const editing=Number.isInteger(index)&&!!collection[index];
 if(editing)collection[index]={...collection[index],...item};else collection.push(item);
 saveLocal();closeModal();render();
 toast(editing?'Élément mis à jour dans le dossier de production.':'Élément ajouté au dossier de production.');
}
function addSeriesCharacter(){openSeriesEntry('character')}
function addSeriesEpisode(){openSeriesEntry('episode')}
function addStoryboardPanel(){openSeriesEntry('board')}
function addSeriesShot(){openSeriesEntry('shot')}
function moveSeriesItem(kind,index,delta){const list=state.seriesStudio?.[kind];const result=seriesModel().moveItem(list,index,delta);if(!result.moved)return;state.seriesStudio[kind]=result.items;saveLocal();render()}
function duplicateSeriesItem(kind,index){const key={characters:'name',episodes:'title',assets:'name',boards:'title',shots:'name'}[kind]||'name';const result=seriesModel().duplicateItem(state.seriesStudio?.[kind],index,key);if(!result.copied)return;state.seriesStudio[kind]=result.items;saveLocal();render();toast('Élément dupliqué.')}
function createNewSeriesProject(){const current=state.seriesStudio||{};const hasContent=!!String(current.title||'').trim()||['episodes','characters','assets','boards','shots'].some(kind=>Array.isArray(current[kind])&&current[kind].length>0)||!!String(current.script||'').trim();if(hasContent&&!confirm('Créer un nouveau projet NovaSeries ? Le projet actuel sera remplacé dans cet espace. Exporte-le d’abord si nécessaire.'))return;state.seriesStudio=seriesModel().createSeriesProject();saveLocal();render();toast('Nouveau projet NovaSeries créé.')}
function downloadSeriesBlob(content,type,filename){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function seriesExportName(suffix){return `${seriesModel().slug(state.seriesStudio?.title)}-${suffix}`}
function setSeriesEpisodeStatus(index,status){const e=state.seriesStudio.episodes[index];if(!e)return;e.status=status;saveLocal();render();toast('Statut de l’épisode mis à jour.');}
function removeSeriesItem(kind,index){if(!confirm('Supprimer cet élément ?'))return;state.seriesStudio[kind].splice(index,1);saveLocal();render()}
function exportSeriesProject(){const payload=seriesModel().exportPayload(state.seriesStudio||{});downloadSeriesBlob(JSON.stringify(payload,null,2),'application/json',seriesExportName('novaseries.json'));toast('Projet NovaSeries exporté en JSON.')}
function exportSeriesMarkdown(){const markdown=seriesModel().dossierMarkdown(state.seriesStudio||{});downloadSeriesBlob(markdown,'text/markdown;charset=utf-8',seriesExportName('dossier.md'));toast('Dossier Markdown exporté.')}
function printSeriesDossier(){const project=state.seriesStudio||{};const markdown=seriesModel().dossierMarkdown(project);let host=$('#seriesPrintDossier');if(!host){host=document.createElement('section');host.id='seriesPrintDossier';host.className='series-print-dossier';document.body.appendChild(host)}host.innerHTML=`<h1>${esc(project.title||'Série sans titre')}</h1><pre>${esc(markdown)}</pre>`;document.body.classList.add('printing-series');const cleanup=()=>{document.body.classList.remove('printing-series');window.removeEventListener('afterprint',cleanup)};window.addEventListener('afterprint',cleanup);window.print()}
function renderNovaStore(){const drafts=state.storeDrafts||[];return `<div class="store-hero glass-panel"><div class="store-orb">◇</div><div><span class="eyebrow">NOVA INDUSTRIES · CREATOR ECONOMY</span><h2>NovaStore <span class="badge orange">EN DÉVELOPPEMENT</span></h2><p>La future vitrine où les créateurs pourront présenter des idées, outils, extensions et prototypes réalisés avec NovaCore.</p></div></div><div class="notice">NovaStore n’accepte pas encore de paiements et ne publie pas de produits. Cette version permet de préparer des fiches de présentation localement, sans vente réelle.</div><div class="grid stats">${stat('Brouillons',drafts.length,'Fiches préparées','◇')}${stat('État','Prototype','Pas de publication publique','◷')}${stat('Paiements','Désactivés','Aucune transaction possible','⌑')}${stat('Prochaine étape','Validation','Modération et droits créateur','✓')}</div><div class="section-title"><div><h2>Mes fiches en préparation</h2><p>Présente une idée, un plugin, un outil ou un prototype à la future boutique.</p></div><button class="primary" onclick="createStoreDraft()">＋ Préparer une fiche</button></div><div class="grid project-grid">${drafts.map((d,i)=>`<article class="card"><div class="project-top"><div class="project-symbol">${d.type==='Plugin'?'⊞':d.type==='Asset 3D'?'◇':d.type==='Outil'?'⌘':'✧'}</div><span class="badge orange">Brouillon privé</span></div><h3>${esc(d.title)}</h3><p>${esc(d.description)}</p><div class="stat-foot">${esc(d.type)} · ${esc(d.license)} · ${esc(d.price)}</div><div class="actions"><button class="secondary" onclick="exportStoreDraft(${i})">Exporter</button><button class="secondary" onclick="deleteStoreDraft(${i})">Supprimer</button></div></article>`).join('')||empty('Aucun brouillon','Crée une fiche de présentation pour préparer ton futur produit.')}</div>`}
function renderRetroEdge(){return `<div class="retroedge-page">
<section class="retroedge-hero">
<div class="re-hero-grid" aria-hidden="true"></div><div class="retroedge-hero-glow"></div>
<div class="retroedge-kicker">NOVA INDUSTRIES <span>·</span> HANDHELD SYSTEMS</div>
<div class="re-hero-lockup"><img class="retroedge-logo" src="/retroedge-emblem-transparent.png" alt="Emblème tridimensionnel RetroEdge" loading="eager"><div class="retroedge-wordmark">RETROEDGE</div></div>
<div class="retroedge-rule"></div><div class="retroedge-coming">THE FUTURE IS EDGE.</div>
<p class="re-hero-description">Une expérience de jeu portable pensée autour de vos appareils.<br>Un projet ambitieux, une approche ouverte, une compatibilité validée appareil par appareil.</p>
<div class="re-hero-actions"><button class="re-primary" onclick="document.querySelector('#retroedge-vision').scrollIntoView({behavior:'smooth'})">Explorer le projet <span>↓</span></button><span class="re-status"><i></i> CONCEPT EN DÉVELOPPEMENT</span></div>
<div class="retroedge-year"><span>OBJECTIF DE PRÉ-VERSION</span><b>2027</b></div><div class="re-scroll-cue">DÉFILER POUR DÉCOUVRIR <span>⌄</span></div>
</section>
<div class="re-proofbar"><div><b>01</b><span>LIGHTWEIGHT<br><small>Priorité à la légèreté</small></span></div><div><b>02</b><span>OPEN APPROACH<br><small>Architecture modulaire</small></span></div><div><b>03</b><span>DEVICE FIRST<br><small>Tests par appareil</small></span></div><div><b>04</b><span>USER CONTROL<br><small>Expérience personnalisable</small></span></div></div>
<section class="retroedge-section re-reveal" id="retroedge-vision"><div class="retroedge-section-head"><span>01 / LA VISION</span><h2>Le jeu rétro.<br><em>À votre façon.</em></h2></div><p class="retroedge-lead">RetroEdge est un projet de plateforme logicielle légère pour consoles portables dédiées à l’émulation. L’ambition : proposer une interface rapide, lisible et personnalisable, avec une base technique adaptée au système de chaque appareil — sans promettre une compatibilité universelle avant les tests.</p><div class="retroedge-feature-grid"><article><b>01 / PERFORMANCE</b><h3>Léger par conception</h3><p>Limiter les services en arrière-plan, maîtriser l’usage mémoire et privilégier la réactivité sur du matériel compact.</p></article><article><b>02 / COHÉRENCE</b><h3>Une expérience unifiée</h3><p>Une identité et des usages cohérents, avec des adaptations natives pour Android et Linux.</p></article><article><b>03 / LIBERTÉ</b><h3>Personnalisable</h3><p>Bibliothèque, thèmes, commandes et réglages configurables, avec contrôle laissé à l’utilisateur.</p></article></div></section>
<section class="retroedge-section re-reveal"><div class="retroedge-section-head"><span>02 / COMPATIBILITÉ</span><h2>Chaque console<br><em>mérite ses propres tests.</em></h2></div><p class="retroedge-muted">Les appareils ci-dessous sont des cibles d’étude, pas des compatibilités certifiées. Le système d’exploitation, le SoC, les pilotes et les contrôleurs doivent être vérifiés pour chaque modèle précis.</p><div class="retroedge-device-grid"><article><span class="device-chip linux">LINUX · PORTAGE À ÉTUDIER</span><h3>R36S</h3><p>Appareil généralement livré avec un système Linux embarqué. Une édition Linux adaptée est nécessaire ; Android n’est pas présumé disponible.</p></article><article><span class="device-chip android">ANDROID · VALIDATION REQUISE</span><h3>AYN</h3><p>Plusieurs modèles Android selon la gamme. Vérifier versions, pilotes graphiques, contrôleurs, veille et performances par modèle.</p></article><article><span class="device-chip android">ANDROID · VALIDATION REQUISE</span><h3>Retroid</h3><p>Famille de consoles Android. Établir une matrice de compatibilité détaillée et tester chaque génération avant annonce de support.</p></article><article><span class="device-chip future">À ÉVALUER</span><h3>Autres appareils</h3><p>Extension envisagée selon les capacités techniques, la documentation disponible et les licences nécessaires.</p></article></div><div class="retroedge-notice">Aucune image système, ROM, BIOS ou firmware propriétaire n’est fourni. L’utilisateur devra utiliser des contenus et logiciels obtenus légalement.</div></section>
<section class="retroedge-section re-reveal"><div class="retroedge-section-head"><span>03 / EXPÉRIENCE PRODUIT</span><h2>Simple à parcourir.<br><em>Solide sous le capot.</em></h2></div><div class="retroedge-capabilities"><div><span>◈</span><b>Bibliothèque unifiée</b><small>Organisation des jeux, jaquettes et métadonnées locales.</small></div><div><span>⌘</span><b>Navigation manette</b><small>Parcours complet au contrôleur et profils de commandes.</small></div><div><span>◉</span><b>Interface personnalisable</b><small>Thèmes, dispositions, favoris et préférences.</small></div><div><span>↯</span><b>Optimisation mesurée</b><small>Profils de performance documentés par matériel.</small></div><div><span>▣</span><b>Gestion des systèmes</b><small>Intégration d’émulateurs compatibles, sans distribuer de contenu protégé.</small></div><div><span>⇧</span><b>Mises à jour sûres</b><small>Versions, notes, sauvegarde et retour arrière planifié.</small></div></div></section>
<section class="retroedge-section re-reveal"><div class="retroedge-section-head"><span>04 / ROADMAP PRODUIT</span><h2>Construire. Tester.<br><em>Prouver.</em></h2></div><p class="retroedge-muted">Jalons indicatifs : aucune phase n’est considérée comme terminée sans critères d’acceptation et preuves de test.</p><div class="retroedge-timeline re-roadmap"><article><b>PHASE 01 · FONDATIONS</b><span>Architecture & cadrage</span><p>Définir le socle commun, séparer les cibles Android/Linux, choisir les outils, documenter licences et menaces.</p><small>À PLANIFIER</small></article><article><b>PHASE 02 · PROTOTYPE</b><span>UX & navigation</span><p>Prototype contrôlable à la manette, bibliothèque locale, paramètres et accessibilité.</p><small>À VENIR</small></article><article><b>PHASE 03 · COMPATIBILITÉ</b><span>Ports & bancs de test</span><p>Matrice appareil/OS/SoC, tests de stabilité, températures, autonomie, veille et reprise.</p><small>À VENIR</small></article><article><b>PHASE 04 · PRÉ-VERSION</b><span>Release candidate</span><p>Tests utilisateurs, audit de sécurité, documentation, installateur signé et plan de restauration.</p><small>OBJECTIF 2027 · NON GARANTI</small></article></div></section>
<section class="retroedge-section re-launch-gates re-reveal"><div class="retroedge-section-head"><span>05 / CRITÈRES DE LANCEMENT</span><h2>Pas de lancement<br><em>sans garanties.</em></h2></div><div class="re-gates"><div><b>Stabilité</b><span>Tests automatisés et sessions longues sans crash bloquant.</span></div><div><b>Compatibilité</b><span>Chaque modèle annoncé dispose d’une fiche de test reproductible.</span></div><div><b>Sécurité</b><span>Analyse des dépendances, permissions minimales et mises à jour vérifiées.</span></div><div><b>Légalité</b><span>Licences validées, aucun jeu/BIOS/firmware propriétaire redistribué.</span></div><div><b>Récupération</b><span>Sauvegarde, migration et procédure de retour arrière documentées.</span></div><div><b>Support</b><span>Guide d’installation, FAQ, signalement de bugs et politique de versions.</span></div></div></section>
<footer class="retroedge-footer"><img src="/retroedge-emblem-transparent.png" alt="" loading="lazy"><div><b>RETROEDGE</b><span>THE FUTURE IS EDGE.</span></div><small>A NOVA INDUSTRIES PROJECT · CONCEPT / IN DEVELOPMENT</small></footer></div>`}

function createStoreDraft(){const title=prompt('Nom de la création :');if(!title?.trim())return;const type=prompt('Type : Plugin, Asset 3D, Outil ou Concept','Concept')||'Concept';const description=prompt('Description courte :','')||'';const license=prompt('Licence envisagée :','À définir')||'À définir';const price=prompt('Prix envisagé (ou gratuit) :','À définir')||'À définir';state.storeDrafts=state.storeDrafts||[];state.storeDrafts.push({title:title.trim(),type,description,license,price,createdAt:new Date().toISOString()});saveLocal();render();toast('Fiche enregistrée en brouillon privé.')}
function exportStoreDraft(index){const d=state.storeDrafts[index];if(!d)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));a.download=(d.title||'novastore-draft').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function deleteStoreDraft(index){if(!confirm('Supprimer ce brouillon ?'))return;state.storeDrafts.splice(index,1);saveLocal();render()}
let engineLiveStatus=null;
function engineCheckStorageKey(key){return `novaEngineCheck:${currentUserId()||'guest'}:${key}`}
async function loadEngineStatus(){
 const body=$('#engineLiveBody'),badge=$('#engineLiveBadge');
 if(!body||!badge)return;
 badge.textContent='Vérification…';badge.className='badge';
 try{
  const s=await api('/nova-engine/api/status');
  engineLiveStatus=s;
  const tool=t=>t&&t.ok?`Disponible`:'Absent';
  const toolDetail=t=>esc(t&&t.ok?(t.version||'détecté'):(t&&t.error?t.error:'non détecté'));
  const last=s.lastAction||{};
  const active=s.active||null;
  body.innerHTML=`<div class="engine-live-grid">
   <div><small>Workbench</small><b>${esc(s.version||'—')}</b><span>Nova Engine ${esc(s.project?.version||'—')} · ${esc(s.project?.language||'C++')}</span></div>
   <div><small>CMake</small><b class="${s.cmake?.ok?'engine-ok':'engine-off'}">${tool(s.cmake)}</b><span>${toolDetail(s.cmake)}</span></div>
   <div><small>Compilateur</small><b class="${s.compiler?.ok?'engine-ok':'engine-off'}">${tool(s.compiler)}</b><span>${toolDetail(s.compiler)}</span></div>
   <div><small>Build</small><b class="${s.configured?'engine-ok':'engine-off'}">${s.configured?'Configuré':'Non configuré'}</b><span>${s.executableExists?'Exécutable présent':'Exécutable absent'}</span></div>
   <div><small>Processus</small><b>${active?esc(active.name):'Aucun'}</b><span>${active?`PID ${esc(active.pid)}`:'Workbench au repos'}</span></div>
   <div><small>Dernière action</small><b>${esc(last.name||'Aucune')}</b><span>${esc(last.status||'idle')}${last.endedAt?` · ${esc(new Date(last.endedAt).toLocaleString('fr-FR'))}`:''}</span></div>
  </div>`;
  badge.textContent='En ligne';badge.className='badge green';
 }catch(e){
  engineLiveStatus=null;
  body.innerHTML=`<p class="muted tiny">Workbench indisponible : ${esc(e.message)}</p><p class="muted tiny">Vérifie que le service local démarre, puis actualise.</p>`;
  badge.textContent='Indisponible';badge.className='badge orange';
 }
}
function renderNovaEngineWorkbench(){return `<div class="engine-command-hero glass-panel"><div><span class="eyebrow">NOVA INDUSTRIES · ENGINE DIVISION</span><h2>Nova Engine <span class="badge green">WORKBENCH</span></h2><p>Centre de contrôle pour configurer, compiler, tester et lancer le moteur C++20. Scene Lab affiche la scène en 3D temps réel (WebGL2) et produit un rendu PNG par rastérisation logicielle déterministe ou par le backend GPU Direct3D 12 hors écran. Une fenêtre native, Metal, Vulkan, le ray tracing, le VPS et le NSR restent des étapes distinctes, non annoncées comme terminées.</p><div class="actions"><a class="primary" style="text-decoration:none;display:inline-flex;align-items:center" href="/nova-engine/" target="_blank" rel="noopener">Ouvrir l’atelier ↗</a><button class="secondary" onclick="document.getElementById('novaEngineFrame').src='/nova-engine/?reload='+Date.now()">Recharger ↻</button><button class="secondary" onclick="exportEngineBrief()">Exporter le brief moteur</button></div></div><div class="engine-command-orb">N<span>ENGINE</span></div></div><div class="card engine-live" id="engineLiveCard"><div class="card-head"><h3>État réel du Workbench</h3><span class="badge" id="engineLiveBadge">Vérification…</span><button class="secondary" type="button" onclick="loadEngineStatus()">Actualiser ↻</button></div><div id="engineLiveBody" class="engine-live-body"><p class="muted tiny">Interrogation du Workbench local…</p></div></div><div class="grid two-col engine-planning"><div class="card"><div class="card-head"><h3>Roadmap technique</h3><span class="badge">Local</span></div><div class="engine-roadmap">${[['01','Noyau C++20','Livré · API, cycle de vie, logs et tests'],['02','Scene graph','Livré · entités, composants, caméra, transforms'],['03','Rendu logiciel PNG','Livré · z-buffer, lumières, ombres, PNG déterministe'],['04','Viewport 3D temps réel','Livré · WebGL2, picking, gizmos, orbite'],['05','Rendu GPU Direct3D 12','Livré · device, PBR GGX, profondeur, readback PNG'],['06','Fenêtre native, Metal & Vulkan','À venir · swapchain, présentation, backends'],['07','Assets & matériaux','À venir · import glTF/OBJ, textures, shaders'],['08','Éditeur 3D avancé','À venir · édition dans le viewport et matériaux']].map(x=>`<div class="pipeline-row"><span>${x[0]}</span><div><b>${x[1]}</b><small>${x[2]}</small></div></div>`).join('')}</div></div><div class="card"><div class="card-head"><h3>Checklist de release</h3><span class="badge orange">Préparation</span></div><div class="series-checklist">${[['build','Compilation propre'],['tests','Tests CTest passés'],['docs','Documentation mise à jour'],['assets','Assets et licences vérifiés'],['backup','Sauvegarde du projet']].map(([k,label])=>`<label class="series-check"><input type="checkbox" data-engine-check="${k}"><span><b>${label}</b><small>État sauvegardé sur cet appareil</small></span></label>`).join('')}</div><p class="muted tiny">Ces contrôles sont une checklist de release ; ils ne remplacent pas les tests automatisés du moteur.</p></div></div><div class="card" style="padding:0;overflow:hidden"><iframe id="novaEngineFrame" title="Nova Engine Workbench" src="/nova-engine/" loading="lazy" style="display:block;width:100%;height:calc(100vh - 250px);min-height:650px;border:0;background:#08101e;border-radius:16px"></iframe></div>`}
function exportEngineBrief(){const live=engineLiveStatus||{};const checklist=$$('[data-engine-check]').map(el=>({key:el.dataset.engineCheck,label:el.closest('label')?.querySelector('b')?.textContent||el.dataset.engineCheck,done:el.checked}));const last=live.lastAction||{};const brief={project:'Nova Engine',version:live.project?.version||'0.6.0',workbenchVersion:live.version||null,language:live.project?.language||'C++20',build:live.project?.buildSystem||'CMake',tests:live.project?.tests||'CTest',configured:live.configured===true,executableExists:live.executableExists===true,toolchain:{cmake:live.cmake?{ok:live.cmake.ok===true,version:live.cmake.version||null}:null,compiler:live.compiler?{ok:live.compiler.ok===true,version:live.compiler.version||null}:null},lastAction:{name:last.name||null,status:last.status||null,endedAt:last.endedAt||null},checklist,createdAt:new Date().toISOString(),milestones:['Core lifecycle and logging (livré)','Scene graph and transforms (livré)','Software rasterizer and PNG output (livré)','WebGL2 real-time viewport (livré)','Direct3D 12 offscreen GPU backend (livré)','Native Win32/D3D12 window, free camera and swapchain capture (livré)','Metal and Vulkan backends (à venir)','Asset/material pipeline (à venir)','Advanced 3D editor (à venir)'],note:'Les six premiers jalons sont livrés et testés ; Metal/Vulkan, le ray tracing, le VPS/NSR, les assets et l’éditeur avancé restent à développer.'};const blob=new Blob([JSON.stringify(brief,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='nova-engine-development-brief.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Brief Nova Engine exporté.')}

let renderGeneration=0;
async function render(){
 saveLocal(false);
 const generation=++renderGeneration,pageAtStart=page,rawView=$('#view');
 // Une page lente (Cloud, Système, Développeur…) peut se terminer après un changement
 // de page : on ignore alors son écriture pour ne jamais écraser la vue courante.
 const stale=()=>generation!==renderGeneration||page!==pageAtStart;
 const view={get innerHTML(){return rawView.innerHTML},set innerHTML(value){if(!stale())rawView.innerHTML=value}};
 try{
  if(VERIFIED_TOOLS.has(pageAtStart)&&!isEmailVerified()){view.innerHTML=renderVerifiedToolGate(pageAtStart);return}
  if(pageAtStart==='overview'){view.innerHTML=renderOverview();if(!stale())bindNovaOSDashboard()}
  if(pageAtStart==='projects')view.innerHTML=renderProjects();
  if(pageAtStart==='tasks')view.innerHTML=renderTasks();
  if(pageAtStart==='notes')view.innerHTML=renderNotes();
  if(pageAtStart==='calendar')view.innerHTML=renderCalendar();
  if(pageAtStart==='focus'){view.innerHTML=renderFocus();if(!stale())updateTimer()}
  if(pageAtStart==='knowledge')view.innerHTML=renderKnowledge();
  if(pageAtStart==='studio'){view.innerHTML=renderStudio();if(!stale())renderCodeEditor()}
  if(pageAtStart==='api'){view.innerHTML=renderApi();if(!stale()){loadApiDocs();testApi()}}
  if(pageAtStart==='automation')view.innerHTML=renderAutomation();
  if(pageAtStart==='learnlab'){view.innerHTML=renderLearnLab();if(!stale())refreshLearnModels()}
  if(pageAtStart==='ai'){novaiLoadChat();view.innerHTML=renderAI();if(!stale()){const send=$('#chatSend');if(send)send.onclick=sendChat;selectNovaiMode(novaiMode);$('#chatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}});const box=$('#chatMessages');if(box)box.scrollTop=box.scrollHeight;previewAIStatus();refreshAIStatus()}}
  if(pageAtStart==='cloud')view.innerHTML=await renderCloud();
  if(pageAtStart==='plugins'){if(localStorage.getItem('novaToken')){try{plugins=(await api('/api/plugins')).plugins}catch(e){toast(e.message)}}view.innerHTML=renderPlugins()}
  if(pageAtStart==='analytics'){if(localStorage.getItem('novaToken')){try{analytics=await api('/api/analytics')}catch(e){}}view.innerHTML=renderAnalytics()}
  if(pageAtStart==='account')view.innerHTML=renderAccount();
  if(pageAtStart==='roadmap')view.innerHTML=renderRoadmap();
  if(pageAtStart==='search'){view.innerHTML=renderSearch();if(!stale())$('#globalSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runGlobalSearch()}})}
  if(pageAtStart==='system')view.innerHTML=await renderSystem();
  if(pageAtStart==='developer'){view.innerHTML=await renderDeveloper();if(!stale()&&(document.body.dataset.devmode==='1'||(await api('/api/developer/status').catch(()=>({enabled:false}))).enabled))loadSmtpSettings()}
  if(pageAtStart==='featurelab')view.innerHTML=renderFeatureLab();
  if(pageAtStart==='anim3d')view.innerHTML=window.NovaAnim?window.NovaAnim.render():'<div class="card"><p>Le Studio 3D est indisponible dans ce mode.</p></div>';
  if(pageAtStart==='novaengine'){view.innerHTML=renderNovaEngineWorkbench();if(!stale()){$$('[data-engine-check]').forEach(el=>{const key=engineCheckStorageKey(el.dataset.engineCheck),legacy='novaEngineCheck:'+el.dataset.engineCheck,stored=localStorage.getItem(key);el.checked=(stored!==null?stored:localStorage.getItem(legacy))==='1';if(stored===null&&localStorage.getItem(legacy)!==null)localStorage.setItem(key,el.checked?'1':'0');el.addEventListener('change',()=>localStorage.setItem(engineCheckStorageKey(el.dataset.engineCheck),el.checked?'1':'0'))});loadEngineStatus()}}
  if(pageAtStart==='novaseries')view.innerHTML=renderNovaSeriesStudio();
  if(pageAtStart==='novastore')view.innerHTML=renderNovaStore();
  if(pageAtStart==='retroedge'){view.innerHTML=renderRetroEdge();if(!stale())requestAnimationFrame(observeNovaReveals)}
 }catch(e){if(!stale())view.innerHTML=empty('Impossible de charger cette page',esc(e.message))}
}

function observeNovaReveals(){const nodes=$$('.re-reveal');if(!nodes.length)return;if(!('IntersectionObserver'in window)){nodes.forEach(n=>n.classList.add('is-visible'));return;}const io=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target)}}),{threshold:.12});nodes.forEach(n=>io.observe(n));}
function renderLearnLab(){
 const datasets=Array.isArray(state.learnDatasets)?state.learnDatasets:[], runs=Array.isArray(state.learnExperiments)?state.learnExperiments:[], artifacts=Array.isArray(state.learnArtifacts)?state.learnArtifacts:[];
 const latest=[...runs].slice(0,8);
 return `<div class="learn-hero card"><div class="learn-orb">🧬</div><div><span class="eyebrow">NOVA INDUSTRIES · NOVAI RESEARCH</span><h2>Learn Lab <span class="novai-pill">AI Studio</span></h2><p>Construis des jeux de données versionnés, lance des évaluations reproductibles et compare tes expériences. Les évaluations intégrées sont heuristiques et n’entraînent pas le modèle.</p><div class="learn-metrics"><span><b>${datasets.length}</b> jeux de données</span><span><b>${runs.length}</b> évaluations</span><span><b>${artifacts.length}</b> prototypes</span></div></div></div>
 <div class="grid columns learn-columns"><section class="card"><div class="card-head"><h3>01 · Jeux de données</h3><span class="badge">Versionnés</span></div><p class="muted tiny">Chaque enregistrement crée une version immuable. Format JSON : prompt, réponse attendue et tags. N’ajoute aucune donnée personnelle.</p><div class="field"><label>Nom du dataset</label><input id="learnDatasetName" maxlength="90" placeholder="Ex. NovaEngine QA"></div><div class="field"><label>Exemples JSON (tableau)</label><textarea id="learnDatasetJson" rows="5" maxlength="30000" placeholder='[{"prompt":"Que signifie PBR ?","expected":"Physically Based Rendering","tags":["graphics"]}]'></textarea></div><div class="actions"><button class="primary" onclick="createLearnDataset()">＋ Créer une version</button><button class="secondary" onclick="downloadLearnExport('datasets')">Exporter JSON</button></div><div class="learn-list">${datasets.map(d=>`<article class="learn-item"><div><b>${esc(d.name)}</b><small>v${d.version} · ${d.examples.length} exemples · ${new Date(d.createdAt).toLocaleString('fr-FR')}</small><small>${esc(d.description||'Dataset local')}</small></div><button class="secondary" onclick="evaluateLearnDataset('${d.id}')">Évaluer</button><button class="secondary" onclick="downloadLearnDataset('${d.id}')">JSON</button></article>`).join('')||'<p class="muted tiny">Aucun dataset. Tu peux commencer avec un petit tableau JSON.</p>'}</div></section>
 <section class="card"><div class="card-head"><h3>02 · Gestion des modèles</h3><button class="secondary" onclick="refreshLearnModels()">Actualiser ↻</button></div><p class="muted tiny">Inventaire Ollama vu depuis le PC serveur. Les modèles cloud ne sont pas listés ici et aucun modèle n’est téléchargé automatiquement.</p><div id="learnModelStatus" class="notice">Recherche des modèles Ollama…</div><div id="learnModelList" class="learn-list"></div><hr class="glass-divider"><h3>Configuration active</h3><p class="muted tiny">Le fournisseur NOVAI se configure dans le fichier <code>.env</code>. Évite de coller une clé API ici ou dans un dataset.</p><button class="secondary full-width" onclick="setPage('ai')">Ouvrir NOVAI ↗</button></section></div>
 <div class="grid columns learn-columns"><section class="card"><div class="card-head"><h3>03 · Comparer les évaluations</h3><button class="secondary" onclick="downloadLearnExport('experiments')">Exporter résultats</button></div><p class="muted tiny">Score heuristique = part des exemples dont la réponse attendue apparaît dans le prompt/jeu de référence simulé. Il ne mesure pas la qualité d’un modèle IA et ne fait aucun appel payant.</p>${latest.length?`<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>Expérience</th><th>Dataset</th><th>Score</th><th>Résultat</th></tr></thead><tbody>${latest.map(r=>`<tr><td>${esc(r.name)}<small>${new Date(r.createdAt).toLocaleString('fr-FR')}</small></td><td>${esc(r.datasetName)} · v${r.datasetVersion}</td><td><b>${r.score}%</b></td><td>${r.passed}/${r.total}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted tiny">Aucune évaluation pour le moment. Crée un dataset puis clique sur Évaluer.</p>'}</section>
 <section class="card"><div class="card-head"><h3>04 · Sandbox de prototypes</h3><span class="badge">Sans exécution</span></div><p class="muted tiny">Conserve des prompts système, fiches de modèles, plans de fine-tuning ou scripts à exporter. Rien n’est exécuté dans le navigateur ou le serveur.</p><div class="field"><label>Nom de l’expérience</label><input id="learnArtifactName" maxlength="90" placeholder="Ex. NOVAI v0.1 prompt"></div><div class="field"><label>Notes / configuration / code</label><textarea id="learnArtifactContent" rows="4" maxlength="20000" placeholder="Hypothèse, modèle visé, paramètres et critères…"></textarea></div><div class="actions"><button class="primary" onclick="saveLearnArtifact()">Enregistrer le prototype</button><button class="secondary" onclick="downloadLearnExport('artifacts')">Exporter tout</button></div><div class="learn-list">${artifacts.map(a=>`<article class="learn-item"><div><b>${esc(a.name)}</b><small>${new Date(a.createdAt).toLocaleString('fr-FR')} · ${a.content.length} caractères</small></div><button class="secondary" onclick="downloadLearnArtifact('${a.id}')">Exporter</button><button class="secondary" onclick="deleteLearnArtifact('${a.id}')">×</button></article>`).join('')||'<p class="muted tiny">Aucun prototype sauvegardé.</p>'}</div><div class="notice">Sécurité : une sandbox réellement isolée pour exécuter du code nécessiterait un conteneur/VM configuré séparément. Cette version reste volontairement non-exécutable.</div></section></div>`;
}
function createLearnDataset(){const name=$('#learnDatasetName')?.value.trim();if(!name)return toast('Donne un nom au dataset.');let examples;try{examples=JSON.parse($('#learnDatasetJson').value)}catch{return toast('Le JSON est invalide.')}if(!Array.isArray(examples)||!examples.length||examples.length>500)return toast('Il faut un tableau de 1 à 500 exemples.');if(examples.some(x=>!x||typeof x.prompt!=='string'||typeof x.expected!=='string'))return toast('Chaque exemple doit contenir prompt et expected en texte.');const prior=state.learnDatasets.filter(d=>d.name.toLowerCase()===name.toLowerCase());state.learnDatasets.unshift({id:uid(),name,version:prior.length?Math.max(...prior.map(d=>d.version))+1:1,description:'Version locale immuable',examples:examples.map(x=>({prompt:x.prompt.slice(0,5000),expected:x.expected.slice(0,5000),tags:Array.isArray(x.tags)?x.tags.slice(0,12):[]})),createdAt:new Date().toISOString()});saveLocal();render();toast('Nouvelle version du dataset enregistrée.');}
function evaluateLearnDataset(id){const d=state.learnDatasets.find(x=>x.id===id);if(!d)return toast('Dataset introuvable.');const scored=d.examples.map(x=>({expected:x.expected,matched:x.expected.trim().length>0&&x.prompt.toLowerCase().includes(x.expected.trim().toLowerCase())}));const passed=scored.filter(x=>x.matched).length;state.learnExperiments.unshift({id:uid(),name:`Évaluation ${d.name}`,datasetId:d.id,datasetName:d.name,datasetVersion:d.version,total:d.examples.length,passed,score:Math.round(100*passed/d.examples.length),createdAt:new Date().toISOString(),metric:'prompt-reference-overlap-heuristic'});saveLocal();render();toast('Évaluation heuristique terminée.');}
function saveLearnArtifact(){const name=$('#learnArtifactName')?.value.trim(),content=$('#learnArtifactContent')?.value||'';if(!name||!content.trim())return toast('Renseigne un nom et un contenu.');state.learnArtifacts=state.learnArtifacts||[];state.learnArtifacts.unshift({id:uid(),name,content,createdAt:new Date().toISOString()});saveLocal();render();toast('Prototype enregistré dans la sandbox.');}
function deleteLearnArtifact(id){state.learnArtifacts=(state.learnArtifacts||[]).filter(a=>a.id!==id);saveLocal();render();}
function downloadBlobFile(name,data,type='application/json'){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function downloadLearnDataset(id){const d=state.learnDatasets.find(x=>x.id===id);if(d)downloadBlobFile(`${d.name.replace(/[^a-z0-9_-]/gi,'-')}-v${d.version}.json`,JSON.stringify(d,null,2));}
function downloadLearnArtifact(id){const a=(state.learnArtifacts||[]).find(x=>x.id===id);if(a)downloadBlobFile(`${a.name.replace(/[^a-z0-9_-]/gi,'-')}.txt`,a.content,'text/plain;charset=utf-8');}
function downloadLearnExport(kind){const map={datasets:state.learnDatasets||[],experiments:state.learnExperiments||[],artifacts:state.learnArtifacts||[]};downloadBlobFile(`novai-learnlab-${kind}.json`,JSON.stringify(map[kind]||{},null,2));}
async function refreshLearnModels(){const status=$('#learnModelStatus'),list=$('#learnModelList');if(!status||!list)return;status.textContent='Recherche des modèles Ollama sur le PC serveur…';list.innerHTML='';try{const data=await api('/api/ai/models');if(!data.configured){status.textContent='Ollama non configuré dans .env. Configure AI_LOCAL_MODEL et vérifie AI_LOCAL_API_URL.';return}if(!data.models?.length){status.textContent=data.error||'Aucun modèle détecté. Vérifie qu’Ollama est lancé sur le PC serveur.';return}status.textContent=`${data.models.length} modèle(s) détecté(s) sur le PC serveur.`;list.innerHTML=data.models.map(m=>`<article class="learn-item"><div><b>${esc(m.name)}</b><small>${m.size?`${(m.size/1073741824).toFixed(2)} Go · `:''}${esc(m.modifiedAt||'')}</small></div><button class="secondary" onclick="toast('Modèle détecté : ${esc(m.name).replace(/'/g,'&#39;')}')">Détails</button></article>`).join('')}catch{status.textContent='Impossible de joindre le serveur. Vérifie NovaCore et la configuration Ollama.'}}

/* ==========================================================================
   Nova Feature Lab 3.2 — 50 modules réellement actionnables.
   Catalogue pur : /feature-lab-model.js (NovaFeatureLabModel).
   ========================================================================== */
const FL = window.NovaFeatureLabModel;
const FL_ICONS={'Apparence':'✦','Accessibilité':'◐','Productivité':'⚡','Intelligence':'🧠','Sécurité':'🛡','Développement':'⌘','Analyse':'📊','Cloud':'☁'};
const FL_ACCENTS=['purple','cyan','green','pink','orange'];
const FL_FILTER={query:'',category:'all'};

function featureFlags(){
  state.featureFlags=FL.normalizeFlags(state.featureFlags);
  return state.featureFlags;
}

function renderFeatureLab(){
  const flags=featureFlags();
  const stats=FL.completion();
  const active=FL.activeCount(flags);
  const categories=FL.categoryCounts();
  const percent=stats.total?Math.round(active/stats.total*100):0;
  return `<section class="fl-hero card">
    <div class="fl-hero-aura" aria-hidden="true"></div>
    <div class="fl-hero-copy">
      <span class="eyebrow">NOVA INDUSTRIES · FEATURE LAB 3.2</span>
      <h2>50 modules. <span>100 % opérationnels.</span></h2>
      <p>Chaque module possède une action réelle : ouvrir un outil, créer une note, lancer un Focus, tester le serveur ou appliquer un effet visuel. Plus aucun module « concept ».</p>
      <div class="fl-hero-actions">
        <button class="primary" onclick="runFeature('quick-search')">⌘ Ouvrir la palette</button>
        <button class="secondary" onclick="runFeature('personalization')">Personnaliser</button>
        <button class="secondary" onclick="runFeature('export-backup')">Exporter mes données</button>
      </div>
      <div class="fl-meter" aria-hidden="true"><span id="flMeter" style="width:${percent}%"></span></div>
      <div class="fl-stats">
        <span><b id="flActiveCount">${active}</b> modules actifs</span>
        <span><b>${stats.implemented}</b> actions réelles</span>
        <span><b>${categories.length}</b> catégories</span>
        <span><b>0</b> concept</span>
      </div>
    </div>
    <div class="fl-ring" style="--fl-fill:${stats.percent}" aria-label="${stats.percent} % des modules opérationnels">
      <div><b>${stats.percent}%</b><small>opérationnels</small></div>
    </div>
  </section>
  <div class="fl-toolbar card">
    <div class="fl-search"><span aria-hidden="true">⌕</span><input id="featureFilter" type="search" placeholder="Rechercher un module, une action…" aria-label="Rechercher un module" oninput="filterFeatureLab(this.value)"></div>
    <div class="fl-bulk"><button class="secondary" onclick="setAllFeatures(true)">Tout activer</button><button class="secondary" onclick="setAllFeatures(false)">Tout désactiver</button></div>
  </div>
  <div class="fl-chips" id="flChips" role="group" aria-label="Filtrer par catégorie">
    <button class="fl-chip active" data-cat="all" onclick="filterFeatureLab(undefined,'all')">✦ Toutes <b>${stats.total}</b></button>
    ${categories.map(c=>`<button class="fl-chip" data-cat="${esc(c.category)}" onclick="filterFeatureLab(undefined,'${esc(c.category)}')">${FL_ICONS[c.category]||'✦'} ${esc(c.category)} <b>${c.total}</b></button>`).join('')}
  </div>
  <p class="fl-result" id="flResult" aria-live="polite">${stats.total} modules affichés · ${stats.percent} % opérationnels</p>
  <div id="featureLabGrid" class="fl-grid">${FL.FEATURES.map(feature=>featureCard(feature,flags)).join('')}</div>`;
}

function featureCard(feature,flags){
  const on=flags[feature.id]!==false;
  const search=(feature.name+' '+feature.category+' '+feature.description).toLowerCase();
  return `<article class="featurelab-card fl-card ${on?'is-on':'is-off'}" data-feature-id="${esc(feature.id)}" data-category="${esc(feature.category)}" data-search="${esc(search)}">
    <div class="fl-card-top"><span class="fl-icon" aria-hidden="true">${FL_ICONS[feature.category]||'✦'}</span><label class="switch" title="${on?'Désactiver':'Activer'} ${esc(feature.name)}"><input type="checkbox" ${on?'checked':''} onchange="toggleFeature('${esc(feature.id)}',this.checked)"><span></span></label></div>
    <span class="fl-category">${esc(feature.category)}</span>
    <h3>${esc(feature.name)}</h3>
    <p>${esc(feature.description)}</p>
    <div class="fl-card-foot"><span class="fl-state ${on?'on':''}">${on?'Actif':'Inactif'}</span><button class="feature-action" onclick="runFeature('${esc(feature.id)}')">${esc(feature.verb)} <span aria-hidden="true">↗</span></button></div>
  </article>`;
}

function toggleFeature(id,on){setFeature(id,on)}

function setFeature(id,on,opts={}){
  const feature=FL.findFeature(id);
  if(!feature)return false;
  const flags=featureFlags();
  flags[id]=on===true;
  if(feature.preference){
    const p=state.preferences=state.preferences||{};
    if(feature.preference==='reducedMotion'){p.reducedMotion=on===true;p.animations=on!==true}
    else p[feature.preference]=on===true;
  }
  saveLocal(false);
  applyPreferences();
  const card=document.querySelector('[data-feature-id="'+id+'"]');
  if(card){
    card.classList.toggle('is-on',on===true);
    card.classList.toggle('is-off',on!==true);
    const input=card.querySelector('input[type="checkbox"]');
    if(input)input.checked=on===true;
    const badge=card.querySelector('.fl-state');
    if(badge){badge.textContent=on===true?'Actif':'Inactif';badge.classList.toggle('on',on===true)}
    const label=card.querySelector('.switch');
    if(label)label.title=(on===true?'Désactiver':'Activer')+' '+feature.name;
  }
  updateFeatureLabStats();
  if(!opts.silent)toast(feature.name+' : '+(on===true?'activé':'désactivé'));
  return true;
}

function updateFeatureLabStats(){
  const active=FL.activeCount(featureFlags());
  const total=FL.FEATURES.length;
  const count=document.getElementById('flActiveCount');
  if(count)count.textContent=String(active);
  const meter=document.getElementById('flMeter');
  if(meter)meter.style.width=(total?Math.round(active/total*100):0)+'%';
}

function setAllFeatures(on){
  const flags={};
  const p=state.preferences=state.preferences||{};
  FL.FEATURES.forEach(feature=>{
    flags[feature.id]=on===true;
    if(feature.preference&&feature.preference!=='privateMode'){
      if(feature.preference==='reducedMotion'){p.reducedMotion=on===true;p.animations=on!==true}
      else p[feature.preference]=on===true;
    }
  });
  state.featureFlags=flags;
  saveLocal(false);
  applyPreferences();
  render();
  toast(on===true?'Tous les modules sont activés.':'Tous les modules sont désactivés.');
}

function filterFeatureLab(query,category){
  if(typeof query==='string')FL_FILTER.query=query;
  if(typeof category==='string')FL_FILTER.category=category;
  const list=FL.filterFeatures(FL_FILTER.query,FL_FILTER.category);
  const visible=new Set(list.map(feature=>feature.id));
  let shown=0;
  document.querySelectorAll('.featurelab-card').forEach(card=>{
    const show=visible.has(card.dataset.featureId);
    card.hidden=!show;
    if(show)shown++;
  });
  document.querySelectorAll('#flChips .fl-chip').forEach(chip=>chip.classList.toggle('active',chip.dataset.cat===FL_FILTER.category));
  const result=document.getElementById('flResult');
  if(result)result.textContent=`${shown} module${shown>1?'s':''} affiché${shown>1?'s':''} · ${FL.completion().percent} % opérationnels`;
}

async function runFeature(id){
  const feature=FL.findFeature(id);
  if(!feature)return toast('Module introuvable.');
  const flags=featureFlags();
  const target=FL.actionTarget(feature);
  if(target.kind==='toggle')return setFeature(feature.id,flags[feature.id]===false);
  if(flags[feature.id]===false)setFeature(feature.id,true,{silent:true});
  const p=state.preferences=state.preferences||{};
  switch(target.kind){
    case 'page':
      setPage(target.value);
      return;
    case 'effect':
      if(target.value==='supernova'){
        const next=p.supernova===false;
        p.supernova=next;saveLocal(false);applyPreferences();
        toast(next?'Supernova orbitale activée.':'Supernova orbitale désactivée.');
      }else if(target.value==='starfield'){
        const next=p.starfield===false;
        p.starfield=next;saveLocal(false);applyPreferences();
        toast(next?'Fond étoilé activé.':'Fond étoilé désactivé.');
      }else toast('Effet visuel appliqué.');
      return;
    case 'cycle':return cycleAccent();
    case 'sound':return testUiSound();
    case 'intro':return startNovaIntro(true);
    case 'palette':return openCommandPalette();
    case 'note':return quickNote();
    case 'task':return quickTask();
    case 'focus':return startFeatureFocus();
    case 'journal':return writeJournal();
    case 'ai':return prefillFeatureAi(target.value);
    case 'modal':return openFeatureModal(target.value);
    case 'download':
      if(target.value==='backup')return exportData();
      if(target.value==='snippet')return exportActiveSnippet();
      return;
    case 'import':return openFeatureImport();
    case 'cloud':
      if(target.value==='push'){try{await cloudPush()}catch{}return}
      if(target.value==='pull'){await cloudPull();return}
      return;
    default:toast(feature.name+' : action disponible.');
  }
}

function cycleAccent(){
  const p=state.preferences=state.preferences||{};
  const index=FL_ACCENTS.indexOf(p.accent);
  const next=FL_ACCENTS[(index+1)%FL_ACCENTS.length];
  setAccent(next);
  return next;
}

let novaAudioCtx=null;
function playUiSound(force=false){
  try{
    if(typeof state==='undefined')return;
    const p=state.preferences||{};
    if(!force&&p.sound!==true)return;
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    novaAudioCtx=novaAudioCtx||new Ctx();
    const ctx=novaAudioCtx;
    if(ctx.state==='suspended')ctx.resume().catch(()=>{});
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(660,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(990,ctx.currentTime+.12);
    gain.gain.setValueAtTime(.0001,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.09,ctx.currentTime+.02);
    gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+.42);
  }catch{}
}
function testUiSound(){
  const p=state.preferences=state.preferences||{};
  p.sound=true;
  saveLocal(false);applyPreferences();
  playUiSound(true);
  toast('Ambiance sonore activée. Son de test joué.');
}

function quickNote(){openCreate('note');setTimeout(()=>document.getElementById('fName')?.focus(),80)}
function quickTask(){openCreate('task');setTimeout(()=>document.getElementById('fName')?.focus(),80)}
function startFeatureFocus(){
  setPage('focus');
  setTimeout(()=>{setTimer(25);startTimer();toast('Session Focus de 25 minutes lancée.');},260);
}
function writeJournal(){
  const now=new Date();
  const title='Journal — '+now.toLocaleDateString('fr-FR');
  if(state.notes.some(note=>note.title===title)){setPage('notes');toast('Le journal du jour existe déjà.');return}
  state.notes.unshift({id:uid(),title,content:'Aujourd’hui, j’ai…\n\nCe que je retiens :\n\nProchaine étape :',date:now.toISOString()});
  logDashboardActivity('Journal du jour créé','note','Feature Lab');
  saveLocal();
  setPage('notes');
  toast('Journal du jour créé.');
}
function prefillFeatureAi(kind){
  const prompts={
    code:'Agis comme un assistant de développement. Analyse ce code, explique les risques puis propose une version corrigée prête à tester.\n\nCode :\n',
    debug:'Agis comme un ingénieur de débogage. Voici le problème observé, les étapes de reproduction et les journaux utiles. Propose la cause la plus probable, une vérification et un correctif.\n\nProblème :\n'
  };
  setPage('ai');
  setTimeout(()=>{
    const input=document.getElementById('chatInput');
    if(input){input.value=prompts[kind]||'';input.focus()}
  },280);
}

function openFeatureImport(){
  openModal('Importer une sauvegarde',`<p class="muted tiny">Le fichier JSON remplace le workspace courant après validation. Exporte d’abord une sauvegarde si tu veux conserver l’état actuel.</p><div class="field"><label>Fichier JSON exporté par NovaCore</label><input id="importFile" type="file" accept="application/json" onchange="importData(event)"></div><div class="notice">Aucune donnée n’est envoyée sur Internet pendant l’import.</div><div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="secondary" onclick="runFeature('export-backup')">Exporter d’abord</button></div>`,'FEATURE LAB · SÉCURITÉ');
}

function exportActiveSnippet(){
  const file=(state.codeFiles||[]).find(item=>item.id===activeCodeId)||(state.codeFiles||[])[0];
  if(!file){setPage('studio');toast('Crée d’abord un snippet dans Code Studio.');return}
  activeCodeId=file.id;
  downloadBlobFile(file.name,file.content,'text/plain;charset=utf-8');
  toast('Snippet téléchargé : '+file.name);
}

function openFeatureModal(kind){
  const handlers={
    reminders:featureReminders,
    'notes-summary':featureNotesSummary,
    ideas:featureIdeas,
    ollama:featureOllama,
    prompts:featurePrompts,
    private:featurePrivate,
    health:featureHealth,
    'task-stats':featureTaskStats,
    'project-stats':featureProjectStats,
    'note-stats':featureNoteStats,
    'focus-stats':featureFocusStats,
    shortcuts:featureShortcuts
  };
  const handler=handlers[kind];
  if(handler)return handler();
  toast('Cette action est disponible.');
}

function featureReminders(){
  const open=state.tasks.filter(task=>!task.done);
  const today=new Date().toISOString().slice(0,10);
  const late=open.filter(task=>task.due&&task.due<today);
  const rows=open.slice(0,14).map(task=>`<div class="list-item"><span class="list-icon">${task.due&&task.due<today?'!':'•'}</span><div class="list-main"><b>${esc(task.title)}</b><small>${esc(task.project||'Sans projet')} · ${task.due?formatDueDate(task.due):'Sans échéance'} · ${esc(task.priority||'Moyenne')}</small></div></div>`).join('');
  openModal('Rappels visuels',`<p class="muted tiny">${open.length} tâche(s) ouverte(s), dont ${late.length} en retard.</p><div class="list">${rows||'<p class="muted tiny">Aucune tâche ouverte. Tout est à jour.</p>'}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('tasks')">Ouvrir les tâches</button></div>`,'FEATURE LAB · PRODUCTIVITÉ');
}

function featureNotesSummary(){
  const notes=Array.isArray(state.notes)?state.notes:[];
  if(!notes.length){openModal('Résumé de notes','<p class="muted tiny">Aucune note enregistrée. Crée une note puis reviens générer la synthèse.</p><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button></div>','FEATURE LAB · INTELLIGENCE');return}
  const words=notes.reduce((sum,note)=>sum+String(note.content||'').trim().split(/\s+/).filter(Boolean).length,0);
  const recent=[...notes].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6);
  const rows=recent.map(note=>`<div class="list-item"><span class="list-icon">✦</span><div class="list-main"><b>${esc(note.title)}</b><small>${esc(String(note.content||'').replace(/\s+/g,' ').slice(0,170)||'Note vide')}</small></div></div>`).join('');
  openModal('Résumé de notes',`<p class="muted tiny">${notes.length} note(s) · ${words} mot(s). Synthèse locale générée sans appel externe.</p><div class="list">${rows}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('notes')">Ouvrir les notes</button></div>`,'FEATURE LAB · INTELLIGENCE');
}

function featureIdeas(){
  const seeds=[...new Set([...state.projects.map(project=>project.name),...state.notes.slice(0,8).map(note=>note.title)])].filter(Boolean).slice(0,6);
  const rows=seeds.map((seed,index)=>`<div class="list-item"><span class="list-icon">${index+1}</span><div class="list-main"><b>Approfondir « ${esc(seed)} »</b><small>Définir une prochaine étape concrète, un livrable et une date de vérification.</small></div></div>`).join('');
  openModal('Générateur d’idées',`<p class="muted tiny">Idées dérivées de tes projets et notes réels, sans appel IA.</p><div class="list">${rows||'<p class="muted tiny">Crée d’abord un projet ou une note pour générer des idées contextuelles.</p>'}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('projects')">Ouvrir les projets</button></div>`,'FEATURE LAB · INTELLIGENCE');
}

async function featureOllama(){
  openModal('Modèles Ollama','<p class="muted tiny">Détection des modèles locaux sur le PC serveur…</p><div id="flOllamaResult" class="notice">Connexion à /api/ai/models…</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="secondary" onclick="featureOllama()">Actualiser</button></div>','FEATURE LAB · INTELLIGENCE');
  const box=document.getElementById('flOllamaResult');
  if(!box)return;
  try{
    const data=await api('/api/ai/models');
    if(!data.configured){box.innerHTML='<b>Ollama non configuré.</b><br>Renseigne AI_LOCAL_MODEL et AI_LOCAL_API_URL dans .env.';return}
    if(!data.models?.length){box.innerHTML='<b>Aucun modèle détecté.</b><br>'+esc(data.error||'Vérifie qu’Ollama est lancé sur le PC serveur.');return}
    box.innerHTML=data.models.map(model=>`<div><b>${esc(model.name)}</b>${model.size?' · '+(model.size/1073741824).toFixed(2)+' Go':''}</div>`).join('');
  }catch(error){
    const message=String(error.message||'');
    if(/connexion|session|jeton|token|autoris/i.test(message))box.innerHTML='<b>Connexion NovaID requise.</b><br>Connecte-toi pour interroger les modèles Ollama détectés par le serveur.';
    else box.innerHTML='<b>Serveur injoignable.</b><br>'+esc(message);
  }
}

function featurePrompts(){
  const prompts=Array.isArray(state.favoritePrompts)?state.favoritePrompts:[];
  const rows=prompts.map(prompt=>`<div class="list-item"><span class="list-icon">★</span><div class="list-main"><b>${esc(prompt.title)}</b><small>${esc(prompt.text.slice(0,150))}</small></div><button class="secondary" onclick="useFavoritePrompt('${prompt.id}')">Utiliser</button><button class="secondary" onclick="deleteFavoritePrompt('${prompt.id}')">×</button></div>`).join('');
  openModal('Prompts favoris',`<p class="muted tiny">Enregistre tes prompts réutilisables puis envoie-les à NOVAI en un clic.</p><div class="field"><label>Titre</label><input id="flPromptTitle" maxlength="80" placeholder="Ex. Revue de code"></div><div class="field"><label>Prompt</label><textarea id="flPromptText" rows="4" maxlength="4000" placeholder="Décris la mission, le contexte et le format attendu…"></textarea></div><div class="actions"><button class="primary" onclick="saveFavoritePrompt()">Enregistrer</button><button class="secondary" onclick="closeModal()">Fermer</button></div><div class="list">${rows||'<p class="muted tiny">Aucun prompt favori pour le moment.</p>'}</div>`,'FEATURE LAB · INTELLIGENCE');
}
function saveFavoritePrompt(){
  const title=document.getElementById('flPromptTitle')?.value.trim()||'Prompt sans titre';
  const text=document.getElementById('flPromptText')?.value.trim();
  if(!text)return toast('Écris le prompt avant de l’enregistrer.');
  state.favoritePrompts=Array.isArray(state.favoritePrompts)?state.favoritePrompts:[];
  state.favoritePrompts.unshift({id:uid(),title,text,createdAt:new Date().toISOString()});
  saveLocal();
  featurePrompts();
  toast('Prompt favori enregistré.');
}
function deleteFavoritePrompt(id){
  state.favoritePrompts=(state.favoritePrompts||[]).filter(prompt=>prompt.id!==id);
  saveLocal();
  featurePrompts();
  toast('Prompt favori supprimé.');
}
function useFavoritePrompt(id){
  const prompt=(state.favoritePrompts||[]).find(item=>item.id===id);
  if(!prompt)return toast('Prompt introuvable.');
  closeModal();
  setPage('ai');
  setTimeout(()=>{
    const input=document.getElementById('chatInput');
    if(input){input.value=prompt.text;input.focus()}
  },280);
}

function featurePrivate(){
  const p=state.preferences=state.preferences||{};
  const on=p.privateMode===true;
  openModal('Mode privé local',`<p class="muted tiny">${on?'La synchronisation cloud est actuellement suspendue.':'La synchronisation cloud est active.'} Le mode privé ne supprime aucune donnée : il bloque seulement l’envoi automatique vers NovaCloud.</p><div class="feature"><span class="stat-icon ${on?'green':'cyan'}">${on?'🔒':'☁'}</span><div><h3>${on?'Données gardées sur cet appareil':'Synchronisation cloud autorisée'}</h3><p>${on?'Les sauvegardes locales continuent de fonctionner normalement.':'Tes modifications peuvent être envoyées au serveur après connexion.'}</p></div></div><div class="actions"><button class="primary" onclick="togglePrivateMode()">${on?'Désactiver le mode privé':'Activer le mode privé'}</button><button class="secondary" onclick="closeModal()">Fermer</button></div>`,'FEATURE LAB · SÉCURITÉ');
}
function togglePrivateMode(){
  const p=state.preferences=state.preferences||{};
  p.privateMode=p.privateMode!==true;
  setFeature('private',p.privateMode,{silent:true});
  saveLocal();
  applyPreferences();
  setSyncLabel(p.privateMode?'Mode privé local':'Synchronisé');
  closeModal();
  toast(p.privateMode?'Mode privé local activé.':'Mode privé local désactivé.');
}

async function featureHealth(){
  openModal('Santé du serveur','<p class="muted tiny">Interrogation de /api/health…</p><div id="flHealthResult" class="notice">Connexion…</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="secondary" onclick="featureHealth()">Actualiser</button></div>','FEATURE LAB · ANALYSE');
  const box=document.getElementById('flHealthResult');
  if(!box)return;
  try{
    const data=await api('/api/health');
    box.innerHTML=`<div class="list"><div class="list-item"><span class="list-icon">●</span><div class="list-main"><b>État</b><small>${data.ok?'Opérationnel':'À vérifier'} · ${esc(data.name||'NovaCore API')}</small></div></div><div class="list-item"><span class="list-icon">◷</span><div class="list-main"><b>Uptime</b><small>${data.uptimeSeconds!=null?Math.floor(data.uptimeSeconds/60)+' min':'—'}</small></div></div><div class="list-item"><span class="list-icon">◫</span><div class="list-main"><b>Version</b><small>${esc(data.version||'—')} · ${esc(data.environment||'—')}</small></div></div><div class="list-item"><span class="list-icon">▤</span><div class="list-main"><b>Stockage</b><small>${esc(data.storage||'—')} · ${esc(data.journalMode||'—')}</small></div></div></div>`;
  }catch(error){box.innerHTML='<b>Serveur injoignable.</b><br>'+esc(error.message)}
}

function featureTaskStats(){
  const tasks=state.tasks||[];
  const done=tasks.filter(task=>task.done).length;
  const today=new Date().toISOString().slice(0,10);
  const late=tasks.filter(task=>!task.done&&task.due&&task.due<today).length;
  const high=tasks.filter(task=>!task.done&&task.priority==='Haute').length;
  openModal('Compteur de tâches',`<div class="grid stats">${stat('Tâches ouvertes',String(tasks.length-done),'À traiter','•','cyan')}${stat('Terminées',String(done),'Progression réelle','✓','green')}${stat('En retard',String(late),'Échéance dépassée','!',late?'orange':'')}${stat('Priorité haute',String(high),'Travail critique','↑','')}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('tasks')">Ouvrir les tâches</button></div>`,'FEATURE LAB · ANALYSE');
}
function featureProjectStats(){
  const projects=state.projects||[];
  const average=projects.length?Math.round(projects.reduce((sum,project)=>sum+(Number(project.progress)||0),0)/projects.length):0;
  const rows=projects.slice(0,8).map(project=>`<div class="list-item"><span class="list-icon">◇</span><div class="list-main"><b>${esc(project.name)}</b><small>${esc(project.description||'Sans description')}</small></div><b>${Number(project.progress)||0}%</b></div>`).join('');
  openModal('Progression projets',`<div class="grid stats">${stat('Projets',String(projects.length),'Espace local','◇','cyan')}${stat('Avancement moyen',average+'%','Tous projets','↗',average>=50?'green':'orange')}</div><div class="list">${rows||'<p class="muted tiny">Aucun projet pour le moment.</p>'}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('projects')">Ouvrir les projets</button></div>`,'FEATURE LAB · ANALYSE');
}
function featureNoteStats(){
  const notes=state.notes||[];
  const words=notes.reduce((sum,note)=>sum+String(note.content||'').trim().split(/\s+/).filter(Boolean).length,0);
  const rows=notes.slice(0,8).map(note=>`<div class="list-item"><span class="list-icon">▤</span><div class="list-main"><b>${esc(note.title)}</b><small>${new Date(note.date).toLocaleString('fr-FR')}</small></div></div>`).join('');
  openModal('Compteur de notes',`<div class="grid stats">${stat('Notes',String(notes.length),'Idées enregistrées','▤','cyan')}${stat('Mots',String(words),'Volume total','≈','green')}</div><div class="list">${rows||'<p class="muted tiny">Aucune note pour le moment.</p>'}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('notes')">Ouvrir les notes</button></div>`,'FEATURE LAB · ANALYSE');
}
function featureFocusStats(){
  const sessions=state.focusSessions||[];
  const total=sessions.reduce((sum,session)=>sum+(Number(session.minutes)||0),0);
  const todayKey=new Date().toISOString().slice(0,10);
  const todayMinutes=sessions.filter(session=>String(session.completedAt||'').slice(0,10)===todayKey).reduce((sum,session)=>sum+(Number(session.minutes)||0),0);
  const rows=sessions.slice(0,8).map(session=>`<div class="list-item"><span class="list-icon">◷</span><div class="list-main"><b>${esc(session.label||'Concentration')}</b><small>${new Date(session.completedAt).toLocaleString('fr-FR')}</small></div><b>${Number(session.minutes)||0} min</b></div>`).join('');
  openModal('Durée de concentration',`<div class="grid stats">${stat('Temps total',total+' min','Sessions terminées','◷','cyan')}${stat('Aujourd’hui',todayMinutes+' min','Depuis minuit','☀','green')}${stat('Sessions',String(sessions.length),'Historique local','✓','')}</div><div class="list">${rows||'<p class="muted tiny">Aucune session terminée pour le moment.</p>'}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button><button class="primary" onclick="closeModal();setPage('focus')">Ouvrir Nova Focus</button></div>`,'FEATURE LAB · ANALYSE');
}
function featureShortcuts(){
  const rows=[['Ctrl / ⌘ + K','Ouvrir ou fermer la palette de commandes'],['Échap','Fermer une fenêtre, la palette ou le menu mobile'],['Entrée','Envoyer un message dans NOVAI'],['Ctrl / ⌘ + S','Sauvegarder un snippet dans Code Studio'],['Clic sur le logo ×5','Activer ou quitter le mode néon']];
  openModal('Clavier rapide',`<p class="muted tiny">Raccourcis réellement disponibles dans cette version.</p><div class="list">${rows.map(row=>`<div class="list-item"><span class="list-icon">⌘</span><div class="list-main"><b>${esc(row[0])}</b><small>${esc(row[1])}</small></div></div>`).join('')}</div><div class="actions"><button class="secondary" onclick="closeModal()">Fermer</button></div>`,'FEATURE LAB · PRODUCTIVITÉ');
}

function openModal(title,body,eyebrow='NOVACORE'){ $('#modalTitle').textContent=title;$('#modalEyebrow').textContent=eyebrow;$('#modalBody').innerHTML=body;$('#modalBackdrop').classList.add('open')}
function closeModal(){$('#modalBackdrop').classList.remove('open')}
function openCreate(type){const forms={
 project:`<div class="field"><label>Nom du projet</label><input id="fName" placeholder="Ex. NovaEngine" maxlength="80"></div><div class="field"><label>Description</label><textarea id="fDesc" placeholder="Quel est l’objectif ?"></textarea></div><div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="primary" onclick="createItem('project')">Créer le projet</button></div>`,
 task:`<div class="field"><label>Intitulé</label><input id="fName" placeholder="La prochaine étape…" maxlength="160"></div><div class="field"><label>Projet</label><select id="fProject"><option value="">Sans projet</option>${state.projects.map(p=>`<option>${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label>Échéance (facultative)</label><input id="fDue" type="date"></div><div class="field"><label>Priorité</label><select id="fPriority"><option>Basse</option><option selected>Moyenne</option><option>Haute</option></select></div><div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="primary" onclick="createItem('task')">Créer la tâche</button></div>`,
 note:`<div class="field"><label>Titre</label><input id="fName" placeholder="Titre de la note" maxlength="120"></div><div class="field"><label>Contenu</label><textarea id="fDesc" placeholder="Écrivez votre idée…"></textarea></div><div class="actions"><button class="secondary" onclick="closeModal()">Annuler</button><button class="primary" onclick="createItem('note')">Enregistrer</button></div>`};
openModal(type==='project'?'Nouveau projet':type==='task'?'Nouvelle tâche':'Nouvelle note',forms[type],type==='project'?'PROJETS':type==='task'?'TÂCHES':'NOTES')}
function createItem(type){const name=$('#fName')?.value.trim();if(!name)return toast('Veuillez renseigner un titre.');if(type==='project'){state.projects.unshift({id:uid(),name,description:$('#fDesc').value.trim(),progress:0});logDashboardActivity('Projet créé : '+name,'project','Nouveau projet local')}if(type==='task'){state.tasks.unshift({id:uid(),title:name,project:$('#fProject').value,priority:$('#fPriority').value,due:$('#fDue')?.value||'',done:false});logDashboardActivity('Tâche créée : '+name,'task','Priorité '+$('#fPriority').value)}if(type==='note'){state.notes.unshift({id:uid(),title:name,content:$('#fDesc').value.trim(),date:new Date().toISOString()});logDashboardActivity('Note créée : '+name,'note','Nouvelle note locale')}saveLocal();closeModal();render();toast('Enregistré dans votre espace local.')}
function advanceProject(id){const p=state.projects.find(p=>p.id===id);if(p){p.progress=Math.min(100,p.progress+10);logDashboardActivity('Progression mise à jour : '+p.name,'project',p.progress+' % accompli');saveLocal();render();toast('Progression mise à jour.')}}
function deleteProject(id){state.projects=state.projects.filter(p=>p.id!==id);saveLocal();render();toast('Projet supprimé.')}
function toggleTask(id){const t=state.tasks.find(t=>t.id===id);if(t){t.done=!t.done;logDashboardActivity((t.done?'Tâche terminée : ':'Tâche rouverte : ')+t.title,'task',t.project||'Sans projet')}saveLocal();render()}
function deleteNote(id){state.notes=state.notes.filter(n=>n.id!==id);saveLocal();render();toast('Note supprimée.')}
function authAction(mode){showAuthGate(mode==='register'?'register':'login')}
// Outils avancés : l'accès exige une adresse e-mail vérifiée. La vérification reste facultative pour le reste de NovaCore.
const VERIFIED_TOOLS=new Set(['overview','novaengine','novaseries','ai','learnlab','retroedge']);
const VERIFIED_TOOL_LABELS={overview:'NovaOS',novaengine:'Nova Engine',novaseries:'Nova Series',ai:'Nova IA',learnlab:'Nova IA · Learn Lab',retroedge:'RetroEdge'};
let account=null;
function isEmailVerified(){return account?.emailVerified===true}
function renderVerifiedToolGate(target){
 const tool=VERIFIED_TOOL_LABELS[target]||'Cet outil',email=account?.email||'';
 return `<div class="verify-tool-gate">
  <div class="vtg-badge" aria-hidden="true">✦</div>
  <span class="eyebrow">NOVAID · VÉRIFICATION REQUISE</span>
  <h2>${esc(tool)} demande une adresse vérifiée.</h2>
  <p>Ton compte fonctionne déjà pour les projets, les tâches, les notes, le calendrier et Nova Focus. Pour ouvrir ${esc(tool)} — comme NovaEngine, NovaOS, NovaSeries, Nova IA et RetroEdge — confirme ton adresse e-mail.</p>
  ${email?`<p class="vtg-email">Adresse du compte : <b>${esc(email)}</b></p>`:''}
  <ol class="vtg-steps"><li>Ouvre le lien reçu par e-mail (valable 24 h).</li><li>Reviens ici et clique sur « J’ai vérifié — actualiser ».</li><li>Les cinq outils avancés se débloquent immédiatement.</li></ol>
  <div class="actions"><button class="primary" id="toolGateResend" type="button" onclick="resendVerificationForAccount()">Renvoyer le lien</button><button class="secondary" type="button" onclick="refreshVerificationState()">J’ai vérifié — actualiser</button><button class="text-button" type="button" onclick="setPage('projects')">Continuer vers Projets</button></div>
  <div class="verify-link-box" id="toolGateResult" hidden></div>
 </div>`;
}
async function resendVerificationForAccount(){
 const email=account?.email;if(!email)return toast('Reconnecte-toi pour demander un nouveau lien.');
 const btn=$('#toolGateResend');if(btn){btn.disabled=true;btn.textContent='Envoi…'}
 try{
  const r=await api('/api/auth/resend-verification',{method:'POST',body:JSON.stringify({email})});
  const box=$('#toolGateResult');
  if(box){box.hidden=false;box.innerHTML='';const p=document.createElement('p');p.textContent=r.message||'Nouveau lien envoyé.';box.appendChild(p);if(r.developmentVerificationUrl){const a=document.createElement('a');a.href=r.developmentVerificationUrl;a.target='_self';a.rel='noopener';a.className='primary';a.textContent='Vérifier l’adresse e-mail ↗';box.appendChild(a)}}
  toast('Demande de vérification envoyée.');
 }catch(e){toast(e.message)}
 finally{if(btn){btn.disabled=false;btn.textContent='Renvoyer le lien'}}
}
async function refreshVerificationState(){
 try{
  const me=await api('/api/me');
  account={...me,emailVerified:me.emailVerified===true};
  updateSignedInUI(me);
  if(account.emailVerified){toast('Adresse vérifiée : outils avancés débloqués.');render()}
  else toast('Adresse toujours non vérifiée. Ouvre le lien reçu par e-mail.');
 }catch(e){toast(e.message)}
}
function updateSignedInUI(user){if(user)account={...user,emailVerified:user.emailVerified===true};const name=user?.displayName||user?.display_name||'Nova User',email=user?.email||'';$('#userName').textContent=name;$('#userEmail').textContent=email;$('#avatar').textContent=(name[0]||'N').toUpperCase();$('#workspaceLabel').textContent=name+' · NovaID';$('#syncState').textContent='Session sécurisée'}
function logout(){saveLocal(false);if(cloudSyncTimer){clearTimeout(cloudSyncTimer);cloudSyncTimer=null}localStorage.removeItem('novaToken');account=null;state=loadWorkspace(null);workspaceReady=true;navHistoryReady=true;page='overview';try{const url=new URL(location.href);url.searchParams.delete('page');history.replaceState({},'',url.pathname+(url.search||'')+url.hash)}catch{}applyPreferences();$('#userName').textContent='Guest User';$('#userEmail').textContent='Mode invité';$('#avatar').textContent='G';$('#workspaceLabel').textContent='Accès verrouillé';setSyncLabel('Connexion requise');render();showAuthGate('login','Tu as été déconnecté. Connecte-toi pour accéder à NovaCore.');toast('Déconnexion effectuée.')}
async function cloudPush(){try{if(!localStorage.getItem('novaToken'))throw new Error('Connectez-vous à NovaID pour utiliser NovaCloud.');const r=await api('/api/sync',{method:'PUT',body:JSON.stringify({data:state})});saveLocal(false);setSyncLabel('Synchronisé');toast('NovaCloud : espace envoyé au serveur.');return r}catch(e){setSyncLabel('Synchronisation en attente');toast(e.message);throw e}}
async function cloudPull(){try{if(!localStorage.getItem('novaToken'))throw new Error('Connectez-vous à NovaID pour récupérer vos données.');const r=await api('/api/sync');if(r.data&&typeof r.data==='object'){cloudSyncSuppressed=true;state={...defaultState(),...r.data,preferences:{...DEFAULT_PREFERENCES,...(r.data.preferences||{})}};state._novaUpdatedAt=r.updatedAt||new Date().toISOString();localStorage.setItem(workspaceKey(),JSON.stringify(state));cloudSyncSuppressed=false;applyPreferences()}setSyncLabel('Synchronisé');render();toast('Espace récupéré depuis NovaCloud.')}catch(e){cloudSyncSuppressed=false;toast(e.message)}}
async function restoreUserWorkspace(user){
 const userId=user?.id||currentUserId();
 if(!userId)return;
 const targetKey=workspaceKey(userId),localState=loadWorkspace(userId);
 cloudSyncSuppressed=true;
 try{
  const remote=await api('/api/sync');
  const localStamp=Date.parse(localState._novaUpdatedAt||'')||0;
  const remoteStamp=Date.parse(remote.updatedAt||'')||0;
  const remoteHasData=remote.updatedAt!==null&&remote.data&&typeof remote.data==='object';
  if(remoteHasData&&remoteStamp>=localStamp){
   state={...defaultState(),...remote.data,preferences:{...DEFAULT_PREFERENCES,...(remote.data.preferences||{})}};
   state._novaUpdatedAt=remote.updatedAt||new Date().toISOString();
   localStorage.setItem(targetKey,JSON.stringify(state));
   setSyncLabel('Synchronisé');
  }else{
   state=localState;
   localStorage.setItem(targetKey,JSON.stringify(state));
   setSyncLabel('Envoi de l’espace local…');
   await api('/api/sync',{method:'PUT',body:JSON.stringify({data:state})}).catch(()=>{});
   setSyncLabel(remoteHasData?'Espace local conservé':'Espace synchronisé');
  }
 }catch{state=localState;setSyncLabel('Mode local')}
 finally{cloudSyncSuppressed=false}
}
async function togglePlugin(id,enabled){try{await api(`/api/plugins/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({enabled})});plugins=plugins.map(p=>p.id===id?{...p,enabled}:p);render();toast(enabled?'Extension activée.':'Extension désactivée.')}catch(e){toast(e.message)}}
async function refreshAIStatus(){const el=$('#aiProviderDetails');if(!el)return;el.textContent='Vérification…';try{const s=await api('/api/ai/status');el.innerHTML=`Local : ${s.local.reachable?'disponible':(s.local.configured?'configuré, serveur Ollama inaccessible':'non configuré')} (${esc(s.local.model)})<br>Cloud : ${s.cloud.configured?'configuré':'non configuré'} (${esc(s.cloud.model)})<br>Mode par défaut : ${esc(s.defaultProvider)}`;const top=$('#aiConnectionStatus');if(top)top.innerHTML=(s.local.reachable||s.cloud.configured)?`<span class="status-dot"></span> Hybride prêt · ${s.local.reachable?'local disponible':'cloud configuré'}`:`<span class="status-dot status-warn"></span> Aucun fournisseur prêt`}catch(e){el.textContent='Impossible de vérifier les fournisseurs : '+e.message}}
function novaiActionLabel(action){try{return window.NovaCommands?.label(action)||action?.type||'Action'}catch{return 'Action'}}
function applyNovaiActions(actions,box){
  const list=Array.isArray(actions)?actions.slice(0,3):[];
  if(!list.length||!box||!window.NovaCommands)return;
  const tr=(key,fallback)=>(window.t?window.t(key):fallback);
  const enabled=state.preferences?.novaiActions!==false;
  const panel=document.createElement('div');panel.className='message novai-actions';
  const head=document.createElement('b');head.textContent=tr('novai.actionsTitle','NOVAI peut agir sur l’application');panel.appendChild(head);
  const hint=document.createElement('p');hint.className='muted tiny';hint.textContent=tr(enabled?'novai.actionsOn':'novai.actionsOff',enabled?'Activé.':'Désactivé.');panel.appendChild(hint);
  const listEl=document.createElement('div');listEl.className='novai-action-list';panel.appendChild(listEl);
  list.forEach(action=>{
    const label=novaiActionLabel(action);
    const row=document.createElement('div');row.className='novai-action-row';
    const name=document.createElement('span');name.className='novai-action-name';name.textContent=label;row.appendChild(name);
    const status=document.createElement('span');status.className='novai-action-state';row.appendChild(status);
    listEl.appendChild(row);
    if(!enabled){status.textContent=tr('novai.proposed','Proposée');return}
    const result=window.NovaCommands.run(action);
    if(result.requiresConfirmation){
      status.textContent=tr('novai.confirmText','Confirmation requise : {action}').replace('{action}',label);
      const confirm=document.createElement('button');confirm.type='button';confirm.className='secondary novai-confirm';confirm.textContent=tr('novai.confirm','Confirmer');
      const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent=tr('novai.cancel','Annuler');
      confirm.addEventListener('click',()=>{
        confirm.disabled=true;cancel.disabled=true;
        const done=window.NovaCommands.run({...action,confirmed:true});
        status.textContent=done.ok?tr('novai.actionDone','Action effectuée : {action}').replace('{action}',label):tr('novai.actionFailed','Action impossible : {error}').replace('{error}',done.message||'');
        confirm.remove();cancel.remove();
        if(status.textContent)toast(status.textContent);
      });
      cancel.addEventListener('click',()=>{confirm.remove();cancel.remove();status.textContent=tr('action.cancel','Annulé')});
      row.appendChild(confirm);row.appendChild(cancel);
      return;
    }
    status.textContent=result.ok?tr('novai.actionDone','Action effectuée : {action}').replace('{action}',label):tr('novai.actionFailed','Action impossible : {error}').replace('{error}',result.message||'');
    if(result.ok&&status.textContent)toast(status.textContent);
  });
  box.appendChild(panel);
}
async function sendChat(){
  const input=$('#chatInput');if(!input)return;
  const text=input.value.trim();if(!text)return;
  if(!localStorage.getItem('novaToken'))return toast(window.t?window.t('novai.needLogin'):'Connecte-toi à NovaID pour utiliser Nova AI.');
  const sendButton=$('#chatSend');if(sendButton)sendButton.disabled=true;
  chatHistory.push({role:'user',content:text,at:new Date().toISOString()});novaiSaveChat();
  const box=$('#chatMessages');
  box.insertAdjacentHTML('beforeend',`<div class="message user">${esc(text)}</div><div class="message" id="thinking">${esc(window.t?window.t('novai.thinking'):'NOVAI réfléchit…')}</div>`);
  input.value='';box.scrollTop=box.scrollHeight;
  try{
    const result=await api('/api/ai/chat',{method:'POST',body:JSON.stringify({
      messages:chatHistory.slice(-20),
      provider:$('#aiProviderSelect')?.value||'auto',
      mode:novaiMode,
      novaiActions:state.preferences?.novaiActions!==false,
      novaiMemory:(state.novaiMemory||[]).map(x=>x.text).slice(0,20),
      novaiSandbox:(state.novaiSandbox||[]).slice(0,5).map(x=>({name:x.name,content:x.content.slice(0,1200)}))
    })});
    $('#thinking')?.remove();
    const chatReply=result.reply||(Array.isArray(result.actions)&&result.actions.length?(window.t?window.t('novai.actionsTitle'):'NOVAI peut agir sur l’application'):'');
    chatHistory.push({role:'assistant',content:chatReply,at:new Date().toISOString()});novaiSaveChat();
    box.insertAdjacentHTML('beforeend',`<div class="message"><small class="muted">${esc(result.provider||'IA')} · ${esc(result.model||'')}</small><br>${esc(chatReply)}</div>`);
    applyNovaiActions(result.actions,box);
  }catch(e){
    $('#thinking')?.remove();
    box.insertAdjacentHTML('beforeend',`<div class="message error-message">${esc(e.message)}</div>`);
  }finally{if(sendButton)sendButton.disabled=false}
  box.scrollTop=box.scrollHeight;
}
function exportData(){const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),data:state},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='novacore-backup.json';a.click();URL.revokeObjectURL(a.href);toast('Sauvegarde exportée.')}
function importData(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);const data=parsed.data||parsed;if(!Array.isArray(data.projects)||!Array.isArray(data.tasks)||!Array.isArray(data.notes))throw new Error('Structure invalide');state={...defaultState(),...data};saveLocal();render();toast('Sauvegarde importée.')}catch(err){toast('Fichier JSON invalide.')}};reader.readAsText(file);e.target.value=''}
function closeSidebar(){document.body.classList.remove('sidebar-open');$('#mobileMenuBtn')?.setAttribute('aria-expanded','false')}
function toggleSidebar(){const opened=document.body.classList.toggle('sidebar-open');$('#mobileMenuBtn')?.setAttribute('aria-expanded',String(opened))}
$('#mobileMenuBtn')?.addEventListener('click',toggleSidebar);$('#sidebarScrim')?.addEventListener('click',closeSidebar);document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSidebar();closeCommandPalette()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();toggleCommandPalette()}});
$('#commandBtn')?.addEventListener('click',openCommandPalette);
$('#commandInput')?.addEventListener('input',()=>{commandSelected=0;commandFilter()});
$('#commandInput')?.addEventListener('keydown',commandKeydown);
$('#commandPalette')?.addEventListener('click',e=>{if(e.target.id==='commandPalette')closeCommandPalette()});
$$('.nav').forEach(b=>b.addEventListener('click',()=>{setPage(b.dataset.page,{history:'push'});closeSidebar()}));
window.addEventListener('popstate',()=>{if(!navHistoryReady)return;setPage(pageFromUrl(),{history:'none'})});
$('#quickAdd').addEventListener('click',()=>openCreate(page==='projects'?'project':page==='tasks'?'task':'note'));
$('#themeBtn').addEventListener('click',()=>{const themes=['dark','light','midnight','emerald','sunset'];const current=state.preferences?.theme||'dark';setTheme(themes[(themes.indexOf(current)+1)%themes.length]);toast('Thème : '+state.preferences.theme) });
$('#languageBtn')?.addEventListener('click',()=>setLanguage(currentUiLang()==='fr'?'en':'fr'));
syncLanguageButton();
$('#modalClose').addEventListener('click',closeModal);$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
$('#authButton').addEventListener('click',()=>localStorage.getItem('novaToken')?logout():showAuthGate('login'));

const introFacts=[
'Le savais-tu ? Nova a été imaginé par un ado de 15 ans.',
'Le savais-tu ? NovaCore réunit plusieurs outils dans un seul espace.',
'Le savais-tu ? Tes notes locales restent dans le navigateur jusqu’à synchronisation.',
'Le savais-tu ? Ctrl + K ouvre la recherche globale.',
'Le savais-tu ? Nova AI peut fonctionner avec un modèle local si Ollama est configuré.',
'Le savais-tu ? Une sauvegarde JSON peut exporter ton workspace.',
'Le savais-tu ? NovaEngine est le projet moteur graphique de l’écosystème.',
'Le savais-tu ? Les modules du Feature Lab sont personnalisables.',
'Le savais-tu ? Le liquid glass utilise transparence, flou et reflets.',
'Le savais-tu ? Une grande idée commence souvent par un petit prototype.',
'Le savais-tu ? Les sessions Nova Focus sont enregistrées localement.',
'Le savais-tu ? Nova Industries vise un écosystème : engine, série et game.'
];
function startNovaIntro(force=false){
 const el=$('#novaIntro');if(!el)return;window.__novaIntroT0=performance.now();
 const finish=()=>{if(el.classList.contains('is-hidden'))return;el.classList.add('is-hidden');try{sessionStorage.setItem('novaIntroSeen','1')}catch{}if(!force)setTimeout(routeStartup,320)};
 $('#introSkip')?.addEventListener('click',finish,{once:true});
 if(!force&&sessionStorage.getItem('novaIntroSeen')){el.classList.add('is-hidden');setTimeout(routeStartup,150);return}
 el.classList.remove('is-hidden');
 if(force){const percent=$('#introPercent');if(percent)percent.textContent='08%';const fact=$('#introFact');if(fact)fact.textContent='Rediffusion de l’introduction NovaCore.'}
 const facts=['Un nouvel univers est en préparation.','NovaCore rassemble création, organisation et développement.','Nova vous guidera lors de votre première connexion.'];
 let pct=8,idx=0;$('#introFact').textContent=facts[0];
 const factTimer=setInterval(()=>{idx=(idx+1)%facts.length;const node=$('#introFact');if(node){node.textContent=facts[idx]}},1750);
 const pctTimer=setInterval(()=>{pct=Math.min(98,pct+Math.floor(Math.random()*5+2));const node=$('#introPercent');if(node)node.textContent=String(pct).padStart(2,'0')+'%'},220);
 setTimeout(()=>{clearInterval(factTimer);clearInterval(pctTimer);const node=$('#introPercent');if(node)node.textContent='100%';finish()},7600);
}

// Gate d'accès : acceptation, compte NovaID, vérification de l'e-mail, puis tutoriel.
const TERMS_KEY='novaTermsAcceptedV1';
let authMode='login',startupNotice='';
function showGate(id){const gate=$(id);if(gate){gate.classList.add('visible');gate.setAttribute('aria-hidden','false')}}
function hideGate(id){const gate=$(id);if(gate){gate.classList.remove('visible');gate.setAttribute('aria-hidden','true')}}
function showAuthGate(mode='login',notice=''){
 authMode=mode==='register'?'register':'login';
 $('#authGateError').textContent='';$('#verificationResult').hidden=true;$('#verificationResult').innerHTML='';
 $$('.auth-nav-item').forEach((nav,i)=>nav.classList.toggle('active',i===0));
 $('#authGateTitle').textContent=authMode==='register'?'Crée ton NovaID.':'Bienvenue.';
 $('#authGateSubtitle').textContent=authMode==='register'?'Un NovaID gratuit. La vérification e-mail est facultative et débloque les outils avancés.':'Connecte-toi pour continuer.';
 $('#authModeLogin').classList.toggle('active',authMode==='login');$('#authModeRegister').classList.toggle('active',authMode==='register');
 $('#displayNameField').hidden=authMode!=='register';$('#gatePassword').autocomplete=authMode==='register'?'new-password':'current-password';
 $('#gatePassword').value='';$('#authGateSubmit').textContent=authMode==='register'?'Créer mon compte ↗':'Se connecter ↗';
 $('#resendVerification').style.display='block';
 if(notice||startupNotice){const target=$('#verificationResult');target.hidden=false;target.textContent=notice||startupNotice;startupNotice='';}
 showGate('#authGate');
 setTimeout(()=>$('#gateEmail')?.focus(),80);
}
function acceptTerms(){if(!$('#termsConsent')?.checked){$('#termsError').textContent='Coche la case pour confirmer ton acceptation.';return}try{localStorage.setItem(TERMS_KEY,'1')}catch{}hideGate('#termsGate');routeAfterTerms()}
function safeNextPath(){const raw=new URLSearchParams(location.search).get('next')||'';if(!raw)return null;try{const url=new URL(raw,location.origin);if(url.origin!==location.origin)return null;const value=url.pathname+url.search+url.hash;return value.startsWith('/')&&!value.startsWith('//')?value:null}catch{return null}}
function followNextPath(){const next=safeNextPath();if(!next)return false;if(next===location.pathname+location.search+location.hash)return false;location.assign(next);return true}
async function routeAfterTerms(){
 const token=localStorage.getItem('novaToken');
 if(token){try{const user=await api('/api/me');state=loadWorkspace(user.id);await restoreUserWorkspace(user);workspaceReady=true;navHistoryReady=true;updateSignedInUI(user);hideGate('#authGate');if(followNextPath())return;setPage(pageFromUrl(),{history:'replace',focus:false});runAutomationsFor('startup',{once:true});maybeStartTour();return}catch{localStorage.removeItem('novaToken');state=loadWorkspace(null);workspaceReady=true}}
 showAuthGate('login',startupNotice);
}
async function routeStartup(){
 const params=new URLSearchParams(location.search),verificationToken=params.get('verifyEmail');
 if(verificationToken){
  try{const r=await fetch('/api/auth/verify-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:verificationToken})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Vérification impossible.');startupNotice=`Adresse ${data.email} vérifiée. Tu peux maintenant te connecter.`}
  catch(e){startupNotice=e.message}
  params.delete('verifyEmail');const query=params.toString();history.replaceState({},'',location.pathname+(query?'?'+query:'')+location.hash);
 }
 if(localStorage.getItem(TERMS_KEY)!=='1'){showGate('#termsGate');return}
 await routeAfterTerms();
}
function showVerificationResult(result,email){const box=$('#verificationResult');box.hidden=false;box.innerHTML='';const msg=document.createElement('p');msg.textContent=result.message||'Vérifie ta boîte e-mail.';box.appendChild(msg);if(email){const line=document.createElement('p');line.textContent=`Adresse : ${email}`;box.appendChild(line)}if(result.developmentVerificationUrl){const note=document.createElement('p');note.textContent='Mode développement : aucun e-mail n’a été envoyé. Utilise ce lien de test pour confirmer le compte :';box.appendChild(note);const link=document.createElement('a');link.href=result.developmentVerificationUrl;link.target='_self';link.rel='noopener';link.textContent='Vérifier l’adresse e-mail ↗';link.className='primary';box.appendChild(link)}else{const note=document.createElement('p');note.textContent='La vérification est facultative pour l’usage courant, mais elle est requise pour Nova Engine, NovaOS, Nova Series, Nova IA et RetroEdge. Le lien expire dans 24 heures.';box.appendChild(note)}
}
async function submitGateAuth(){
 const email=$('#gateEmail').value.trim(),password=$('#gatePassword').value,displayName=$('#gateDisplayName').value.trim();
 $('#authGateError').textContent='';$('#verificationResult').hidden=true;$('#verificationResult').innerHTML='';
 if(!email||!password)return $('#authGateError').textContent='Renseigne ton adresse e-mail et ton mot de passe.';
 if(authMode==='register'&&displayName.length<2)return $('#authGateError').textContent='Le nom affiché doit contenir au moins 2 caractères.';
 if(password.length<10)return $('#authGateError').textContent='Le mot de passe doit contenir au moins 10 caractères.';
 const btn=$('#authGateSubmit');btn.disabled=true;btn.textContent='Vérification…';
 try{
  const endpoint=authMode==='register'?'/api/auth/register':'/api/auth/login';
  const result=await api(endpoint,{method:'POST',body:JSON.stringify({email,password,displayName,termsAccepted:true})});
  if(authMode==='register'){
   showVerificationResult(result,result.email||email);
   authMode='login';
   $('#authGateTitle').textContent='Compte créé.';
   $('#authGateSubtitle').textContent='Connecte-toi pour entrer dans NovaCore. La vérification e-mail débloque les outils avancés.';
   $('#authModeLogin').classList.add('active');$('#authModeRegister').classList.remove('active');
   $('#displayNameField').hidden=true;
   btn.textContent='Se connecter ↗';
   toast('Compte créé. Tu peux te connecter dès maintenant.');
   return;
  }
  localStorage.setItem('novaToken',result.token);state=loadWorkspace(result.user.id);await restoreUserWorkspace(result.user);workspaceReady=true;navHistoryReady=true;updateSignedInUI(result.user);hideGate('#authGate');saveLocal(false);toast('Connexion NovaID réussie.');if(followNextPath())return;setPage(pageFromUrl(),{history:'replace',focus:false});runAutomationsFor('startup',{once:true});maybeStartTour();
  
 }catch(e){$('#authGateError').textContent=e.message;if(e.message.toLowerCase().includes('non vérifiée')||e.message.toLowerCase().includes('pas encore vérifiée'))$('#resendVerification').style.display='block'}
 finally{btn.disabled=false;if(!(authMode==='register'&&$('#verificationResult')&&!$('#verificationResult').hidden))btn.textContent=authMode==='register'?'Créer mon compte ↗':'Se connecter ↗'}
}
async function resendVerification(){const email=$('#gateEmail').value.trim();if(!email)return $('#authGateError').textContent='Saisis ton adresse e-mail avant de demander un nouveau lien.';const btn=$('#resendVerification');btn.disabled=true;try{const r=await api('/api/auth/resend-verification',{method:'POST',body:JSON.stringify({email})});showVerificationResult(r,email)}catch(e){$('#authGateError').textContent=e.message}finally{btn.disabled=false}}
$('#termsConsent')?.addEventListener('change',e=>{const b=$('#acceptTerms');if(b)b.disabled=!e.target.checked});$('#acceptTerms')?.addEventListener('click',acceptTerms);
$('#authModeLogin')?.addEventListener('click',()=>showAuthGate('login'));$('#authModeRegister')?.addEventListener('click',()=>showAuthGate('register'));
$$('.auth-nav-item').forEach(item=>item.addEventListener('click',()=>{
 const section=item.dataset.authSection;
 $$('.auth-nav-item').forEach(nav=>nav.classList.toggle('active',nav===item));
 if(section==='account'){$('#gateEmail')?.focus({preventScroll:true});$('#gateEmail')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 else if(section==='verification'){
  const box=$('#verificationResult');
  if(box.hidden){box.hidden=false;box.textContent='Après la création du compte, les instructions et le lien de vérification apparaîtront ici. Si tu ne reçois pas d’e-mail, vérifie les courriers indésirables puis utilise « Renvoyer un lien de vérification ». ';}
  box.scrollIntoView({block:'nearest',behavior:'smooth'});
 }else{$('.auth-form-side .gate-footnote')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
}));
$('#authGateSubmit')?.addEventListener('click',submitGateAuth);$('#resendVerification')?.addEventListener('click',resendVerification);
$('#gatePassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')submitGateAuth()});$('#gateEmail')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('#gatePassword').focus()});


// Le guide Noxa et son tutoriel ont été retirés en 3.0 : navigation directe et interface sans mascotte.
// Le mini-jeu « Supernova Breach » (mode STYLE HACKER, déclencheur clavier et 5 clics sur le logo)
// a été supprimé en 3.10.0 : code, interface, stockage `novaStyleHacker` et styles associés.

applyPreferences();
setPage('overview');
startNovaIntro();

// Structured scripts coexist with the legacy free-text draft to preserve existing workspaces.
const legacyRenderNovaSeriesStudio = renderNovaSeriesStudio;
function scriptModel(){const studio=state.seriesStudio||(state.seriesStudio={});if(!studio.structuredScript)studio.structuredScript={schemaVersion:1,characters:[],scenes:[],activeSceneId:null};const model=studio.structuredScript;model.characters=Array.isArray(model.characters)?model.characters:[];model.scenes=Array.isArray(model.scenes)?model.scenes:[];if(!model.activeSceneId&&model.scenes[0])model.activeSceneId=model.scenes[0].id;return model;}
function activeScriptScene(){const model=scriptModel();return model.scenes.find(scene=>scene.id===model.activeSceneId)||null;}
function scriptFileName(){return (state.seriesStudio.title||'nova-series').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'nova-series';}
function addStructuredScene(){const model=scriptModel();const scene={id:uid(),heading:`SCÈNE ${model.scenes.length+1}`,location:'',timeOfDay:'JOUR',summary:'',blocks:[]};model.scenes.push(scene);model.activeSceneId=scene.id;saveLocal();render();}
function selectStructuredScene(id){scriptModel().activeSceneId=id;saveLocal();render();}
function removeStructuredScene(id){const model=scriptModel();model.scenes=model.scenes.filter(scene=>scene.id!==id);model.activeSceneId=model.scenes[0]?.id||null;saveLocal();render();}
function addStructuredCharacter(){const name=prompt('Nom du personnage :');if(!name?.trim())return;scriptModel().characters.push({id:uid(),name:name.trim().slice(0,100),role:'Personnage',notes:''});saveLocal();render();}
function updateStructuredCharacter(id,key,value){const character=scriptModel().characters.find(item=>item.id===id);if(character){character[key]=String(value).slice(0,key==='notes'?1000:120);saveLocal();}}
function removeStructuredCharacter(id){const model=scriptModel();model.characters=model.characters.filter(character=>character.id!==id);model.scenes.forEach(scene=>scene.blocks.forEach(block=>{if(block.characterId===id)block.characterId='';}));saveLocal();render();}
function updateStructuredScene(key,value){const scene=activeScriptScene();if(scene){scene[key]=String(value).slice(0,1600);saveLocal();}}
function addStructuredBlock(kind){const scene=activeScriptScene();if(!scene)return;scene.blocks.push({id:uid(),kind,characterId:'',text:''});saveLocal();render();}
function updateStructuredBlock(id,key,value){const block=activeScriptScene()?.blocks.find(item=>item.id===id);if(block){block[key]=String(value).slice(0,key==='text'?5000:120);saveLocal();}}
function removeStructuredBlock(id){const scene=activeScriptScene();if(scene){scene.blocks=scene.blocks.filter(block=>block.id!==id);saveLocal();render();}}
function downloadStructuredScript(extension,content,type){const anchor=document.createElement('a');anchor.href=URL.createObjectURL(new Blob([content],{type}));anchor.download=`${scriptFileName()}-structured-script.${extension}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);}
function exportStructuredScript(){const model=scriptModel();saveLocal();downloadStructuredScript('json',JSON.stringify({format:'NovaSeriesScript',exportedAt:new Date().toISOString(),...model},null,2),'application/json');toast('Script structuré exporté en JSON.');}
function exportStructuredScriptText(){const model=scriptModel();const names=Object.fromEntries(model.characters.map(character=>[character.id,character.name]));const text=model.scenes.map((scene,index)=>`${index+1}. ${scene.heading}${scene.location?` — ${scene.location}`:''}${scene.timeOfDay?` — ${scene.timeOfDay}`:''}\n${scene.summary}\n\n${scene.blocks.map(block=>block.kind==='dialogue'?`${names[block.characterId]||'PERSONNAGE'}\n${block.text}`:block.text).join('\n\n')}`).join('\n\n');downloadStructuredScript('txt',text,'text/plain;charset=utf-8');}
function importStructuredScript(event){const file=event.target.files?.[0];event.target.value='';if(!file||file.size>2_000_000)return toast('Choisis un fichier JSON de moins de 2 Mo.');const reader=new FileReader();reader.onload=()=>{try{state.seriesStudio.structuredScript=normalizeStructuredScript(JSON.parse(reader.result));scriptModel();saveLocal();render();toast('Script structuré importé.');}catch{toast('Import refusé : structure de script invalide.');}};reader.readAsText(file);}
function structuredScriptPanel(){const model=scriptModel(),scene=activeScriptScene();return `<section class="card glass-panel" style="margin-top:18px"><div class="card-head"><div><h3>✍ NovaScript · scènes structurées</h3><p class="muted tiny">Scènes, personnages, actions et dialogues · sauvegarde locale immédiate.</p></div><div class="actions"><button class="secondary" onclick="exportStructuredScript()">JSON</button><button class="secondary" onclick="exportStructuredScriptText()">TXT</button><label class="secondary" style="cursor:pointer">Importer<input hidden type="file" accept="application/json,.json" onchange="importStructuredScript(event)"></label></div></div><div class="grid three-col" style="grid-template-columns:minmax(170px,.65fr) minmax(320px,1.6fr) minmax(210px,.8fr);align-items:start"><div class="list"><div class="card-head"><b>Scènes</b><button class="secondary" onclick="addStructuredScene()">＋</button></div>${model.scenes.map((item,index)=>`<button class="list-item" style="width:100%;text-align:left;${item.id===model.activeSceneId?'outline:1px solid var(--accent,#8b6cff)':''}" onclick="selectStructuredScene('${item.id}')"><span class="list-icon">${index+1}</span><div class="list-main"><b>${esc(item.heading)}</b><small>${esc(item.location||'Lieu à définir')}</small></div></button>`).join('')||'<p class="muted tiny">Ajoute une scène.</p>'}</div><div>${scene?`<div class="card-head"><b>Édition de scène</b><button class="secondary" onclick="removeStructuredScene('${scene.id}')">Supprimer</button></div><div class="field"><label>En-tête</label><input value="${esc(scene.heading)}" oninput="updateStructuredScene('heading',this.value)"></div><div class="grid two-col"><div class="field"><label>Lieu</label><input value="${esc(scene.location)}" oninput="updateStructuredScene('location',this.value)"></div><div class="field"><label>Moment</label><select onchange="updateStructuredScene('timeOfDay',this.value)">${['JOUR','NUIT','AUBE','CRÉPUSCULE','CONTINU'].map(value=>`<option ${scene.timeOfDay===value?'selected':''}>${value}</option>`).join('')}</select></div></div><div class="field"><label>Résumé / intention</label><textarea rows="2" oninput="updateStructuredScene('summary',this.value)">${esc(scene.summary)}</textarea></div><div class="actions"><button class="secondary" onclick="addStructuredBlock('action')">＋ Action</button><button class="secondary" onclick="addStructuredBlock('dialogue')">＋ Dialogue</button></div><div class="list">${scene.blocks.map((block,index)=>`<article class="list-item" style="display:block"><div class="card-head"><b>${block.kind==='dialogue'?'Dialogue':'Action'} ${index+1}</b><button class="text-button" onclick="removeStructuredBlock('${block.id}')">×</button></div>${block.kind==='dialogue'?`<select onchange="updateStructuredBlock('${block.id}','characterId',this.value)"><option value="">Personnage…</option>${model.characters.map(character=>`<option value="${character.id}" ${character.id===block.characterId?'selected':''}>${esc(character.name)}</option>`).join('')}</select>`:''}<textarea rows="2" placeholder="${block.kind==='dialogue'?'Réplique':'Action et mise en scène'}" oninput="updateStructuredBlock('${block.id}','text',this.value)">${esc(block.text)}</textarea></article>`).join('')||'<p class="muted tiny">Ajoute un bloc d’écriture.</p>'}</div>`:'<p class="muted">Sélectionne ou crée une scène.</p>'}</div><div><div class="card-head"><b>Personnages</b><button class="secondary" onclick="addStructuredCharacter()">＋</button></div><div class="list">${model.characters.map(character=>`<article class="list-item" style="display:block"><div class="card-head"><input value="${esc(character.name)}" oninput="updateStructuredCharacter('${character.id}','name',this.value)"><button class="text-button" onclick="removeStructuredCharacter('${character.id}')">×</button></div><input value="${esc(character.role)}" placeholder="Rôle" oninput="updateStructuredCharacter('${character.id}','role',this.value)"><textarea rows="2" placeholder="Notes" oninput="updateStructuredCharacter('${character.id}','notes',this.value)">${esc(character.notes)}</textarea></article>`).join('')||'<p class="muted tiny">Ajoute le casting.</p>'}</div><div class="notice"><b>Inclus :</b> format structuré, import/export et sauvegarde navigateur. <b>À venir :</b> PDF de scénario, commentaires collaboratifs et suivi de versions cloud.</div></div></div></section>`;}
renderNovaSeriesStudio=()=>legacyRenderNovaSeriesStudio()+structuredScriptPanel();

// Source unique de version : le footer suit l'API au lieu d'une valeur codée en dur.
async function refreshAppVersion(){try{const r=await fetch('/api/version',{cache:'no-store'});if(!r.ok)return;const info=await r.json();const el=document.getElementById('appVersion');if(el&&info.version)el.textContent=info.version}catch{/* hors ligne : la valeur de secours reste affichée */}}
refreshAppVersion();
