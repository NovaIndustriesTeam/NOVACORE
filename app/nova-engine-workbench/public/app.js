const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentStatus = null;
let sceneState = null;
let selectedEntityId = null;
let sceneProjectedPoints = [];
let sessionBlock = null;
let autoSaveTimer = null;
let autoSaveInFlight = null;
let autoSaveQueued = false;
const actionLabels = { configure: 'Configuration CMake', build: 'Compilation Nova Engine', test: 'Tests CTest', run: 'Lancement du moteur', stop: 'Arrêt du moteur', 'build-pipeline': 'Pipeline complet' };
function toast(message, type='info') { const el=document.createElement('div');el.className=`toast ${type==='error'?'error':''}`;el.textContent=message;$('#toasts').append(el);setTimeout(()=>el.remove(),4200); }
function sessionApi(){return window.NovaSession||null;}
function tokenInfo(){const api=sessionApi();if(!api)return{present:false,expired:false};try{return api.readToken(localStorage.getItem('novaToken'));}catch{return{present:false,expired:false};}}
function renderSessionChip(info=tokenInfo()){
  const chip=$('#session-chip'),label=$('#session-chip-label');if(!chip||!label)return;
  const signed=!!(info.present&&!info.expired);
  chip.hidden=!signed;
  chip.classList.toggle('warning',!signed&&!!localStorage.getItem('novaToken'));
  if(signed){label.textContent=info.email||info.name||'NovaID connecté';chip.title=`NovaID : ${info.email||'session active'}${info.expiresAt?` · expire le ${new Date(info.expiresAt).toLocaleString()}`:''}`;}
}
function showSessionBlock(kind,message=null){
  sessionBlock=kind||null;
  const banner=$('#session-banner');
  if(!banner)return;
  if(!kind){banner.hidden=true;return;}
  const view=sessionApi()?.bannerFor(kind)||{title:'Session requise',text:message||'',loginLabel:'Se connecter à NovaID',showLogin:true,showRetry:true};
  $('#session-banner-title').textContent=view.title;
  $('#session-banner-text').textContent=message||view.text;
  const login=$('#session-login');
  if(login){login.hidden=!view.showLogin;if(view.showLogin){login.textContent=view.loginLabel;login.href=`/?next=${encodeURIComponent(location.pathname+location.search)}`;}}
  const retry=$('#session-retry');if(retry)retry.hidden=!view.showRetry;
  banner.hidden=false;
}
function handleSessionError(error){
  if(!error)return false;
  if(error.kind==='expired'){showSessionBlock('expired',error.message);renderSessionChip({present:false});return true;}
  if(error.kind==='unverified'){showSessionBlock('unverified',error.message);renderSessionChip(tokenInfo());return true;}
  if(error.kind==='offline'){showSessionBlock('offline',error.message);return true;}
  if(error.kind==='server'){showSessionBlock('server',error.message);return true;}
  return false;
}
async function api(url,method='GET',payload=null){
  const token=localStorage.getItem('novaToken');
  const headers={'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})};
  const bodyPayload=payload!==null?JSON.stringify(payload):((method==='POST')?'{}':undefined);
  let res;
  try{res=await fetch(url,{method,headers,body:bodyPayload});}
  catch{const error=new Error('Serveur local injoignable. Vérifie que NovaCore et le Workbench sont démarrés.');error.kind='offline';throw error;}
  let data;try{data=await res.json()}catch{data={error:'Réponse illisible'}}
  if(!res.ok){
    const info=sessionApi()?.classifyApiFailure(res.status,data)||{kind:res.status===401?'expired':'error',code:data?.code||null,message:data?.error||`Erreur HTTP ${res.status}`};
    const error=new Error(info.message);error.status=res.status;error.code=info.code;error.kind=info.kind;throw error;
  }
  return data;
}
function setSaveState(mode,text){const el=$('#scene-save-state');if(!el)return;el.className=`scene-save-state ${mode}`;el.textContent=text;}
function view(name){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  $$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===name));
  const labels={overview:"Vue d'ensemble",scene:'Scene Lab',build:'Build & compilation',tests:'Tests & qualité',runtime:'Runtime',logs:'Console système'};
  $('#page-title').textContent=labels[name]||'Nova Engine';
  if(name==='scene')requestAnimationFrame(()=>{try{viewport3d?.resize();viewport3d?.requestRender();}catch{/* viewport pas encore prêt */}});
  if(name==='logs')loadLogs();
}
$$('.nav').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
$$('[data-view-jump]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.viewJump)));
function scheduleAutoSave(){
  if(!sceneState||sessionBlock==='expired'||sessionBlock==='unverified')return;
  setSaveState('saving','Modifié · autosave…');
  clearTimeout(autoSaveTimer);
  autoSaveTimer=setTimeout(()=>{saveScene({auto:true}).catch(()=>{});},1400);
}
function setText(id,text){const el=document.getElementById(id);if(el)el.textContent=text;}
function renderStatus(s){currentStatus=s;setText('server-status',s.active?`En cours : ${s.active.name}`:'Workbench actif');setText('env-state',s.cmake.ok&&s.compiler.ok?'Prêt':'À vérifier');setText('env-detail',`${s.cmake.ok?'CMake détecté':'CMake manquant'} · ${s.compiler.ok?'compilateur détecté':'compilateur manquant'}`);setText('config-state',s.configured?'Configuré':'À configurer');setText('exe-state',s.executableExists?'Disponible':'Absent');setText('last-state',s.lastAction.status==='running'?'En cours':s.lastAction.status==='success'?'Réussi':s.lastAction.status==='failed'?'Échec':'Prêt');setText('last-detail',s.lastAction.endedAt?`${s.lastAction.name} · ${new Date(s.lastAction.endedAt).toLocaleTimeString()}`:'Aucune action lancée');setText('runtime-path',s.executable);setText('runtime-version',s.project.version);setText('footer-env',`${s.platform} · ${s.arch} · ${s.cpuCores} cœurs`);const rows=[['Node.js',s.node,true],['CMake',s.cmake.version||'Non détecté',s.cmake.ok],['Compilateur C++',s.compiler.version||'Non détecté',s.compiler.ok],['Configuration CMake',s.configured?'Build configuré':'À configurer',s.configured],['Exécutable',s.executableExists?'NovaEngine disponible':'À compiler',s.executableExists]];$('#tool-list').innerHTML=rows.map(([n,v,ok])=>`<div class="tool-row"><span>${esc(n)}</span><small class="${ok?'tool-ok':'tool-bad'}">${esc(v)}</small></div>`).join('');syncRenderBackend();renderRuntimeState(s.runtime);}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadScene(){
  try {
    sceneState=await api('/nova-engine/api/scene');
    selectedEntityId=sceneState.entities[0]?.id||null;
    sceneHistory=[];sceneFuture=[];currentSnapshotId=null;markClean();
    showSessionBlock(null);
    renderSessionChip(tokenInfo());
    renderSceneLab();
    setSaveState('saved',sceneState.updatedAt?`Chargée · ${new Date(sceneState.updatedAt).toLocaleTimeString()}`:'Nouvelle scène');
  } catch(e) {
    if(sceneState)return;
    handleSessionError(e);
    const list=$('#scene-entity-list');
    if(list)list.innerHTML=`<p class="muted">${esc(e.message)}${e.kind==='expired'?' Utilise « Se connecter à NovaID » ci-dessus, puis « Réessayer ».':''}</p>`;
    const backend=$('#viewport-backend');if(backend)backend.textContent='Scène non chargée · session NovaID requise';
    const status=$('#scene-viewport-status');if(status)status.textContent='HORS SESSION';
    const summary=$('#scene-selected-summary');if(summary)summary.textContent='Aucune scène chargée';
    setSaveState('error','Scène indisponible');
  }
}
function sceneSnapshot(){return sceneState?JSON.stringify(sceneState):null;}
function pushHistory(){if(!sceneState)return;const snapshot=sceneSnapshot();if(sceneHistory[sceneHistory.length-1]!==snapshot){sceneHistory.push(snapshot);if(sceneHistory.length>40)sceneHistory.shift();sceneFuture=[];}}
function restoreScene(snapshot){if(!snapshot)return;try{sceneState=JSON.parse(snapshot);}catch{return}if(!sceneState.entities.some(entity=>entity.id===selectedEntityId))selectedEntityId=sceneState.entities[0]?.id||null;renderSceneLab();}
function undoScene(){if(!sceneHistory.length)return toast('Aucune modification à annuler.');const current=sceneSnapshot();const previous=sceneHistory.pop();sceneFuture.push(current);restoreScene(previous);markDirty();toast('Dernière modification annulée.');}
function redoScene(){if(!sceneFuture.length)return toast('Aucune modification à rétablir.');const current=sceneSnapshot();const next=sceneFuture.pop();sceneHistory.push(current);restoreScene(next);markDirty();toast('Modification rétablie.');}
function markDirty(){sceneDirty=true;const badge=$('#scene-dirty');if(badge)badge.hidden=false;scheduleAutoSave();}
function markClean(){sceneDirty=false;const badge=$('#scene-dirty');if(badge)badge.hidden=true;}
function sceneIdFrom(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80);}
function selectedSceneEntity(){return sceneState?.entities.find(entity=>entity.id===selectedEntityId)||null;}
const MATERIAL_PATTERNS=['none','checker','grid'];
const PRIMITIVES=['cube','sphere','plane','cylinder','cone','torus','capsule','pyramid'];
const LIGHT_TYPES=['directional','point','spot'];
const TEXTURE_PATH=/^(?!\/)(?!.*\.\.)[a-z0-9._\-/]+\.(png|jpe?g)$/i;
function entityMaterial(entity){
  const source=entity?.material&&typeof entity.material==='object'?entity.material:{};
  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  return {
    albedo:Array.isArray(source.albedo)&&source.albedo.length===3?source.albedo.slice(0,3).map(value=>Math.min(1,Math.max(0,finite(value,0.8)))):[0.82,0.85,0.90],
    metallic:Math.min(1,Math.max(0,finite(source.metallic,0))),
    roughness:Math.min(1,Math.max(0.04,finite(source.roughness,0.5))),
    tiling:Math.min(64,Math.max(1,finite(source.tiling,4))),
    pattern:MATERIAL_PATTERNS.includes(source.pattern)?source.pattern:'none',
    emissive:source.emissive===true,
    texture:typeof source.texture==='string'?source.texture:''
  };
}
function colourToHex(albedo){
  return '#'+albedo.map(value=>Math.round(Math.min(1,Math.max(0,value))*255).toString(16).padStart(2,'0')).join('');
}
function hexToColour(value){
  const match=/^#?([0-9a-f]{6})$/i.exec(String(value||''));
  if(!match)return [0.82,0.85,0.90];
  const number=parseInt(match[1],16);
  return [((number>>16)&255)/255,((number>>8)&255)/255,(number&255)/255];
}
function renderMaterialInspector(entity){
  const material=entityMaterial(entity);
  return `<div class="inspector-section"><b>Matériau PBR</b><div class="field"><label for="entity-material-albedo">Albedo · sRGB</label><input id="entity-material-albedo" type="color" value="${colourToHex(material.albedo)}"></div><div class="vector-fields">${[['metallic','Metallic',material.metallic,'0.05',0,1],['roughness','Roughness',material.roughness,'0.05',0.04,1],['tiling','Tiling',material.tiling,'1',1,64]].map(([key,label,value,step,min,max])=>`<label>${label}<input type="number" id="entity-material-${key}" min="${min}" max="${max}" step="${step}" value="${Number(value)}"></label>`).join('')}</div><div class="field"><label for="entity-material-texture">Texture PNG/JPEG · assets/</label><input id="entity-material-texture" maxlength="180" placeholder="textures/checker.png" value="${esc(material.texture)}"><small class="muted tiny">Chemin relatif au dossier <code>assets</code> du Workbench. Vide = motif procédural seul. Exemple fourni : <code>textures/checker.png</code>.</small></div><div class="field"><label for="entity-material-pattern">Motif procédural · UV</label><select id="entity-material-pattern">${MATERIAL_PATTERNS.map(pattern=>`<option value="${pattern}" ${material.pattern===pattern?'selected':''}>${pattern}</option>`).join('')}</select></div><label class="scene-toggle"><input id="entity-material-emissive" type="checkbox" ${material.emissive?'checked':''}> Émissif</label><small class="muted tiny">Albedo sRGB, texture, metallic/roughness/tiling et motifs checker/grid rendus dans le rastériseur logiciel, D3D12 et le viewport WebGL2.</small></div>`;
}
function renderPrimitiveInspector(entity){
  if(!['Mesh','Prefab'].includes(entity.type))return '';
  const value=PRIMITIVES.includes(entity.primitive)?entity.primitive:'';
  return `<div class="inspector-section"><b>Primitive</b><div class="field"><label for="entity-primitive">Maillage</label><select id="entity-primitive"><option value="" ${value?'':'selected'}>Auto · déduit du nom</option>${PRIMITIVES.map(primitive=>`<option value="${primitive}" ${value===primitive?'selected':''}>${primitive}</option>`).join('')}</select><small class="muted tiny">Auto conserve l’inférence historique (Cube, Sphere…) ; une primitive explicite est sérialisée en schéma 4 et prioritaire.</small></div></div>`;
}
function entityLight(entity){
  const source=entity?.light&&typeof entity.light==='object'?entity.light:{};
  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const type=typeof source.type==='string'&&LIGHT_TYPES.includes(source.type.toLowerCase())?source.type.toLowerCase():'directional';
  return {
    explicit:!!(entity?.light&&typeof entity.light==='object'),
    type,
    color:Array.isArray(source.color)&&source.color.length===3?source.color.slice(0,3).map(value=>Math.min(1,Math.max(0,finite(value,0.9)))):[1,0.94,0.84],
    intensity:Math.min(32,Math.max(0,finite(source.intensity,1))),
    range:Math.min(200,Math.max(0.1,finite(source.range,8))),
    spotAngle:Math.min(89,Math.max(1,finite(source.spotAngle,35))),
    castShadow:source.castShadow!==false
  };
}
function defaultLightFor(entity){
  const name=String(entity?.name||'').toLowerCase();
  const components=(entity?.components||[]).join(' ').toLowerCase();
  const type=components.includes('spot')||name.includes('spot')?'spot':components.includes('point')||name.includes('point')?'point':name.includes('sun')||components.includes('directional')?'directional':'point';
  return {type,color:[1,0.94,0.84],intensity:type==='directional'?1.15:1.5,range:8,spotAngle:35,castShadow:true};
}
function renderLightInspector(entity){
  if(entity.type!=='Light')return '';
  const light=entityLight(entity);
  if(!light.explicit){
    return `<div class="inspector-section"><b>Lumière</b><label class="scene-toggle"><input id="entity-light-explicit" type="checkbox"> Lumière explicite · schéma 4</label><small class="muted tiny">Sans lumière explicite, le type est déduit du nom et des composants (Directional Light, Sun, Point Light…).</small></div>`;
  }
  return `<div class="inspector-section"><b>Lumière · schéma 4</b><label class="scene-toggle"><input id="entity-light-explicit" type="checkbox" checked> Lumière explicite</label><div class="field"><label for="entity-light-type">Type</label><select id="entity-light-type">${LIGHT_TYPES.map(type=>`<option value="${type}" ${light.type===type?'selected':''}>${type}</option>`).join('')}</select></div><div class="field"><label for="entity-light-color">Couleur · sRGB</label><input id="entity-light-color" type="color" value="${colourToHex(light.color)}"></div><div class="vector-fields">${[['intensity','Intensité',light.intensity,'0.1',0,32],['range','Portée',light.range,'0.5',0.1,200],['spotAngle','Spot °',light.spotAngle,'1',1,89]].map(([key,label,value,step,min,max])=>`<label>${label}<input type="number" id="entity-light-${key}" min="${min}" max="${max}" step="${step}" value="${Number(value)}"></label>`).join('')}</div><label class="scene-toggle"><input id="entity-light-castshadow" type="checkbox" ${light.castShadow?'checked':''}> Projette une ombre · directionnelle/spot</label><small class="muted tiny">Jusqu’à 16 lumières par scène. Les ombres portées sont rendues pour la directionnelle et le spot ; les points n’ont pas d’ombre (documenté).</small></div>`;
}
function entityGameplay(entity){
  const box=value=>value&&typeof value==='object'?value:{};
  const rigid=box(entity?.rigidbody),controller=box(entity?.controller),spinner=box(entity?.spinner),collectible=box(entity?.collectible);
  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const axis=Array.isArray(spinner.axis)&&spinner.axis.length===3?spinner.axis.map(Number):[0,1,0];
  return {
    rigidbody:{enabled:!!entity?.rigidbody,velocity:Array.isArray(rigid.velocity)&&rigid.velocity.length===3?rigid.velocity.map(Number):[0,0,0],mass:Math.min(10000,Math.max(0.01,finite(rigid.mass,1))),bounciness:Math.min(1,Math.max(0,finite(rigid.bounciness,0.25))),gravity:rigid.gravity!==false},
    controller:{enabled:!!entity?.controller,speed:Math.min(60,Math.max(0.1,finite(controller.speed,4))),jumpSpeed:Math.min(40,Math.max(0,finite(controller.jumpSpeed,5)))},
    spinner:{enabled:!!entity?.spinner,axis:Math.abs(axis[0])>=Math.abs(axis[1])&&Math.abs(axis[0])>=Math.abs(axis[2])?'x':Math.abs(axis[2])>=Math.abs(axis[1])?'z':'y',degreesPerSecond:Math.min(1440,Math.max(-1440,finite(spinner.degreesPerSecond,45)))},
    collectible:{enabled:!!entity?.collectible,radius:Math.min(50,Math.max(0.1,finite(collectible.radius,1))),value:Math.min(1000,Math.max(1,Math.round(finite(collectible.value,1))))}
  };
}
function renderGameplayInspector(entity){
  const gameplay=entityGameplay(entity);
  const number=(id,label,value,step,min,max)=>`<label>${label}<input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${Number(value)}"></label>`;
  return `<div class="inspector-section"><b>Gameplay · Play</b><label class="scene-toggle"><input id="entity-rigidbody-enabled" type="checkbox" ${gameplay.rigidbody.enabled?'checked':''}> Rigidbody · gravité et rebond</label>${gameplay.rigidbody.enabled?`<div class="vector-fields">${['x','y','z'].map((axis,index)=>`<label>Vitesse ${axis.toUpperCase()}<input type="number" step="0.1" id="entity-rigidbody-velocity-${axis}" value="${Number(gameplay.rigidbody.velocity[index])}"></label>`).join('')}</div><div class="vector-fields">${number('entity-rigidbody-mass','Masse',gameplay.rigidbody.mass,'0.1',0.01,10000)}${number('entity-rigidbody-bounciness','Rebond',gameplay.rigidbody.bounciness,'0.05',0,1)}<label class="scene-toggle"><input id="entity-rigidbody-gravity" type="checkbox" ${gameplay.rigidbody.gravity?'checked':''}> Gravité</label></div>`:''}<label class="scene-toggle"><input id="entity-controller-enabled" type="checkbox" ${gameplay.controller.enabled?'checked':''}> Controller · première personne (WASD/ZQSD, souris, espace)</label>${gameplay.controller.enabled?`<div class="vector-fields">${number('entity-controller-speed','Vitesse',gameplay.controller.speed,'0.5',0.1,60)}${number('entity-controller-jumpspeed','Saut',gameplay.controller.jumpSpeed,'0.5',0,40)}</div>`:''}<label class="scene-toggle"><input id="entity-spinner-enabled" type="checkbox" ${gameplay.spinner.enabled?'checked':''}> Spinner · rotation continue</label>${gameplay.spinner.enabled?`<div class="vector-fields"><label>Axe<select id="entity-spinner-axis">${['x','y','z'].map(axis=>`<option value="${axis}" ${gameplay.spinner.axis===axis?'selected':''}>${axis.toUpperCase()}</option>`).join('')}</select></label>${number('entity-spinner-degreespersecond','°/s',gameplay.spinner.degreesPerSecond,'5',-1440,1440)}</div>`:''}<label class="scene-toggle"><input id="entity-collectible-enabled" type="checkbox" ${gameplay.collectible.enabled?'checked':''}> Collectible · score au contact</label>${gameplay.collectible.enabled?`<div class="vector-fields">${number('entity-collectible-radius','Rayon',gameplay.collectible.radius,'0.1',0.1,50)}${number('entity-collectible-value','Valeur',gameplay.collectible.value,'1',1,1000)}</div>`:''}<small class="muted tiny">Le mode Play simule la scène côté navigateur (même pas plafonné à 0,1 s) et restaure les transforms à l’arrêt.</small></div>`;
}
function applyMaterialEdit(id){
  const entity=selectedSceneEntity();if(!entity)return;
  const element=document.getElementById(id);if(!element)return;
  const previous=JSON.parse(JSON.stringify(entity.material||null));
  pushHistory();
  const material=entityMaterial(entity);
  if(id==='entity-material-albedo')material.albedo=hexToColour(element.value);
  else if(id==='entity-material-pattern')material.pattern=MATERIAL_PATTERNS.includes(element.value)?element.value:'none';
  else if(id==='entity-material-emissive')material.emissive=element.checked;
  else if(id==='entity-material-texture'){
    const value=element.value.trim();
    if(value&&!TEXTURE_PATH.test(value)){
      entity.material=previous;toast('Texture invalide : chemin relatif PNG/JPEG attendu (ex. textures/checker.png), sans .. ni chemin absolu.','error');renderSceneLab();return;
    }
    material.texture=value;
  }
  else {
    const key=id.replace('entity-material-','');
    const value=Number(element.value);
    const limits={metallic:[0,1],roughness:[0.04,1],tiling:[1,64]}[key];
    if(!limits||!Number.isFinite(value)||value<limits[0]||value>limits[1]){
      entity.material=previous;toast('Matériau invalide : metallic [0,1], roughness [0.04,1], tiling [1,64].','error');renderSceneLab();return;
    }
    material[key]=value;
  }
  entity.material=material;markDirty();renderSceneLab();
}
function applyPrimitiveEdit(){
  const entity=selectedSceneEntity();const element=document.getElementById('entity-primitive');if(!entity||!element)return;
  pushHistory();
  const value=String(element.value||'').toLowerCase();
  if(value&&!PRIMITIVES.includes(value)){toast('Primitive inconnue.','error');return;}
  entity.primitive=value||null;markDirty();renderSceneLab();
}
function applyLightEdit(id){
  const entity=selectedSceneEntity();if(!entity||entity.type!=='Light')return;
  const element=document.getElementById(id);if(!element)return;
  pushHistory();
  if(id==='entity-light-explicit'){
    entity.light=element.checked?defaultLightFor(entity):null;
    markDirty();renderSceneLab();return;
  }
  const light=entityLight(entity);
  if(!light.explicit)return;
  if(id==='entity-light-type'){
    light.type=LIGHT_TYPES.includes(element.value)?element.value:'directional';
  }else if(id==='entity-light-color'){
    light.color=hexToColour(element.value);
  }else if(id==='entity-light-castshadow'){
    light.castShadow=element.checked;
  }else{
    const key=id.replace('entity-light-','');
    const value=Number(element.value);
    const limits={intensity:[0,32],range:[0.1,200],spotAngle:[1,89]}[key];
    if(!limits||!Number.isFinite(value)||value<limits[0]||value>limits[1]){
      toast('Lumière invalide : intensité [0,32], portée [0.1,200], angle de spot [1,89].','error');renderSceneLab();return;
    }
    light[key]=value;
  }
  const {explicit,...value}=light;
  entity.light=value;markDirty();renderSceneLab();
}
function applyGameplayEdit(id){
  const entity=selectedSceneEntity();if(!entity)return;
  const element=document.getElementById(id);if(!element)return;
  pushHistory();
  const gameplay=entityGameplay(entity);
  const axisVectors={x:[1,0,0],y:[0,1,0],z:[0,0,1]};
  if(id==='entity-rigidbody-enabled')entity.rigidbody=element.checked?{velocity:gameplay.rigidbody.velocity,mass:gameplay.rigidbody.mass,bounciness:gameplay.rigidbody.bounciness,gravity:gameplay.rigidbody.gravity}:null;
  else if(id==='entity-controller-enabled')entity.controller=element.checked?{speed:gameplay.controller.speed,jumpSpeed:gameplay.controller.jumpSpeed}:null;
  else if(id==='entity-spinner-enabled')entity.spinner=element.checked?{axis:axisVectors[gameplay.spinner.axis],degreesPerSecond:gameplay.spinner.degreesPerSecond}:null;
  else if(id==='entity-collectible-enabled')entity.collectible=element.checked?{radius:gameplay.collectible.radius,value:gameplay.collectible.value}:null;
  else if(id==='entity-rigidbody-gravity'){if(entity.rigidbody)entity.rigidbody.gravity=element.checked;}
  else if(id==='entity-spinner-axis'){if(entity.spinner)entity.spinner.axis=axisVectors[element.value]||[0,1,0];}
  else{
    const velocityMatch=id.match(/^entity-rigidbody-velocity-([xyz])$/);
    if(velocityMatch){
      const value=Number(element.value);
      if(!entity.rigidbody||!Number.isFinite(value)){toast('Vitesse invalide.','error');renderSceneLab();return;}
      entity.rigidbody.velocity[{x:0,y:1,z:2}[velocityMatch[1]]]=value;
    }else if(id.startsWith('entity-rigidbody-')){
      const value=Number(element.value);
      const limits={mass:[0.01,10000],bounciness:[0,1]};
      const key=id.replace('entity-rigidbody-','');
      if(!entity.rigidbody||!limits[key]||!Number.isFinite(value)||value<limits[key][0]||value>limits[key][1]){toast('Rigidbody invalide : masse [0.01,10000], rebond [0,1].','error');renderSceneLab();return;}
      entity.rigidbody[key]=value;
    }else if(id.startsWith('entity-controller-')){
      const value=Number(element.value);
      const limits={speed:[0.1,60],jumpspeed:[0,40]};
      const key=id.replace('entity-controller-','');
      if(!entity.controller||!limits[key]||!Number.isFinite(value)||value<limits[key][0]||value>limits[key][1]){toast('Controller invalide : vitesse [0.1,60], saut [0,40].','error');renderSceneLab();return;}
      entity.controller[key]=value;
    }else if(id==='entity-spinner-degreespersecond'){
      const value=Number(element.value);
      if(!entity.spinner||!Number.isFinite(value)||value<-1440||value>1440){toast('Spinner invalide : rotation entre -1440 et 1440 °/s.','error');renderSceneLab();return;}
      entity.spinner.degreesPerSecond=value;
    }else if(id.startsWith('entity-collectible-')){
      const value=Number(element.value);
      const key=id.replace('entity-collectible-','');
      if(!entity.collectible){renderSceneLab();return;}
      if(key==='radius'){
        if(!Number.isFinite(value)||value<0.1||value>50){toast('Collectible invalide : rayon [0.1,50].','error');renderSceneLab();return;}
        entity.collectible.radius=value;
      }else if(key==='value'){
        if(!Number.isInteger(value)||value<1||value>1000){toast('Collectible invalide : valeur entière [1,1000].','error');renderSceneLab();return;}
        entity.collectible.value=value;
      }
    }
  }
  markDirty();renderSceneLab();
}
function renderSceneLab(){
  if(!sceneState)return;
  const name=$('#scene-name');if(name)name.value=sceneState.name||'Nouvelle scène';
  const count=$('#scene-entity-count');if(count)count.textContent=sceneState.entities.length;
  const list=$('#scene-entity-list');
  if(list){
    list.innerHTML=sceneState.entities.map(entity=>{
      const parent=entity.parentId?sceneState.entities.find(candidate=>candidate.id===entity.parentId):null;
      return `<button class="scene-entity ${entity.id===selectedEntityId?'active':''}" data-entity-id="${esc(entity.id)}"><span class="scene-type-icon type-${entity.type.toLowerCase()}">${({Mesh:'◇',Camera:'▣',Light:'☼',Empty:'·',Audio:'♫',Prefab:'▦'})[entity.type]||'◇'}</span><span class="scene-entity-copy"><b>${esc(entity.name)}</b><small>${esc(entity.type)} · ${entity.visible?'Visible':'Masqué'}${parent?` · sous ${esc(parent.name)}`:''}</small></span><span class="scene-visibility">${entity.visible?'◉':'○'}</span></button>`;
    }).join('')||'<p class="muted tiny">Cette scène est vide. Ajoute une entité pour commencer.</p>';
    list.querySelectorAll('[data-entity-id]').forEach(button=>button.addEventListener('click',()=>{selectedEntityId=button.dataset.entityId;renderSceneLab();}));
  }
  const entity=selectedSceneEntity(),inspector=$('#scene-inspector-body');
  if(inspector){
    if(!entity){
      inspector.innerHTML='<p class="muted">Sélectionne une entité dans la hiérarchie.</p>';
    } else {
      const parentChoices=sceneState.entities.filter(candidate=>candidate.id!==entity.id).map(candidate=>`<option value="${esc(candidate.id)}" ${candidate.id===entity.parentId?'selected':''}>${esc(candidate.name)}</option>`).join('');
      const components=entity.components.map((component,index)=>`<span class="component-pill">${esc(component)}<button type="button" class="component-remove" data-component-index="${index}" aria-label="Retirer ${esc(component)}">×</button></span>`).join('');
      const materialSection=['Mesh','Prefab'].includes(entity.type)?renderMaterialInspector(entity):'';
      const primitiveSection=renderPrimitiveInspector(entity);
      const lightSection=renderLightInspector(entity);
      const gameplaySection=renderGameplayInspector(entity);
      inspector.innerHTML=`<div class="field"><label>Nom de l’entité</label><input id="entity-name" maxlength="100" value="${esc(entity.name)}"></div><div class="field"><label>Type</label><select id="entity-type">${['Empty','Mesh','Camera','Light','Audio','Prefab'].map(type=>`<option ${entity.type===type?'selected':''}>${type}</option>`).join('')}</select></div><label class="scene-toggle"><input id="entity-visible" type="checkbox" ${entity.visible?'checked':''}> Visible dans le viewport</label><div class="inspector-section"><b>Position</b><div class="vector-fields">${['x','y','z'].map((axis,index)=>`<label>${axis.toUpperCase()}<input type="number" step="0.1" id="entity-pos-${axis}" value="${Number(entity.position[index])}"></label>`).join('')}</div></div><div class="inspector-section"><b>Rotation · degrés</b><div class="vector-fields">${['x','y','z'].map((axis,index)=>`<label>${axis.toUpperCase()}<input type="number" step="1" id="entity-rot-${axis}" value="${Number(entity.rotation[index])}"></label>`).join('')}</div></div><div class="inspector-section"><b>Échelle</b><div class="vector-fields">${['x','y','z'].map((axis,index)=>`<label>${axis.toUpperCase()}<input type="number" step="0.1" id="entity-scale-${axis}" value="${Number(entity.scale[index])}"></label>`).join('')}</div></div><div class="field"><label for="entity-parent">Parent dans la hiérarchie</label><select id="entity-parent"><option value="">Aucun · racine</option>${parentChoices}</select><small class="muted tiny">Les cycles sont refusés à l’enregistrement et par le moteur C++.</small></div>${primitiveSection}${materialSection}${lightSection}${gameplaySection}<div class="inspector-section"><b>Composants</b><div class="component-pills" id="entity-components">${components||'<small>Aucun composant</small>'}</div><div class="scene-component-add"><input id="entity-component-new" maxlength="80" placeholder="Mesh Renderer, Collider…"><button class="button secondary" type="button" id="entity-component-add">Ajouter</button></div></div><p class="muted tiny">ID : <code>${esc(entity.id)}</code></p>`;
      ['entity-name','entity-type','entity-visible',...['x','y','z'].flatMap(axis=>[`entity-pos-${axis}`,`entity-rot-${axis}`,`entity-scale-${axis}`])].forEach(id=>{document.getElementById(id)?.addEventListener('change',()=>applyEntityEdit(id));});
      document.getElementById('entity-parent')?.addEventListener('change',event=>{pushHistory();entity.parentId=event.target.value||null;markDirty();renderSceneLab();});
      ['entity-material-albedo','entity-material-metallic','entity-material-roughness','entity-material-tiling','entity-material-pattern','entity-material-emissive','entity-material-texture'].forEach(id=>{document.getElementById(id)?.addEventListener('change',()=>applyMaterialEdit(id));});
      document.getElementById('entity-primitive')?.addEventListener('change',applyPrimitiveEdit);
      ['entity-light-explicit','entity-light-type','entity-light-color','entity-light-intensity','entity-light-range','entity-light-spotAngle','entity-light-castshadow'].forEach(id=>{document.getElementById(id)?.addEventListener('change',()=>applyLightEdit(id));});
      ['entity-rigidbody-enabled','entity-rigidbody-gravity','entity-rigidbody-mass','entity-rigidbody-bounciness','entity-rigidbody-velocity-x','entity-rigidbody-velocity-y','entity-rigidbody-velocity-z','entity-controller-enabled','entity-controller-speed','entity-controller-jumpspeed','entity-spinner-enabled','entity-spinner-axis','entity-spinner-degreespersecond','entity-collectible-enabled','entity-collectible-radius','entity-collectible-value'].forEach(id=>{document.getElementById(id)?.addEventListener('change',()=>applyGameplayEdit(id));});
      document.getElementById('entity-component-add')?.addEventListener('click',addEntityComponent);
      document.getElementById('entity-component-new')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addEntityComponent();}});
      inspector.querySelectorAll('[data-component-index]').forEach(button=>button.addEventListener('click',()=>removeEntityComponent(Number(button.dataset.componentIndex))));
    }
  }
  const summary=$('#scene-selected-summary');if(summary)summary.textContent=entity?`${entity.name} · position ${entity.position.map(value=>Number(value).toFixed(1)).join(', ')}`:'Aucune sélection';
  drawSceneViewport();
}
function applyEntityEdit(id){
  const entity=selectedSceneEntity();if(!entity)return;
  const element=document.getElementById(id);if(!element)return;
  pushHistory();
  if(id==='entity-name')entity.name=element.value.trim()||'Entity';
  else if(id==='entity-type')entity.type=element.value;
  else if(id==='entity-visible')entity.visible=element.checked;
  else {
    const match=id.match(/^entity-(pos|rot|scale)-([xyz])$/);
    if(match){
      const key={pos:'position',rot:'rotation',scale:'scale'}[match[1]];
      const index={x:0,y:1,z:2}[match[2]];
      const value=Number(element.value);
      if(!Number.isFinite(value)||Math.abs(value)>1000000||(key==='scale'&&value===0)){
        toast('Transform invalide : nombre fini et échelle non nulle requise.','error');
        renderSceneLab();return;
      }
      entity[key][index]=value;
    }
  }
  markDirty();renderSceneLab();
}
function addEntityComponent(){
  const entity=selectedSceneEntity(),input=document.getElementById('entity-component-new');
  if(!entity||!input)return;
  const value=input.value.trim();
  if(!value)return toast('Saisis le nom d’un composant.','error');
  if(entity.components.length>=32)return toast('Limite de 32 composants atteinte.','error');
  if(entity.components.includes(value))return toast('Ce composant est déjà présent.','error');
  pushHistory();entity.components.push(value.slice(0,80));markDirty();renderSceneLab();
}
function removeEntityComponent(index){
  const entity=selectedSceneEntity();if(!entity||!Number.isInteger(index)||!entity.components[index])return;
  pushHistory();entity.components.splice(index,1);markDirty();renderSceneLab();
}
function addSceneEntity(){
  if(!sceneState)return;
  if(sceneState.entities.length>=250)return toast('Limite de 250 entités atteinte.','error');
  const type=$('#scene-new-type').value;
  const id=`entity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  pushHistory();
  const entity={id,name:`${type} ${sceneState.entities.length+1}`,type,position:[sceneState.entities.length%5-2,0,Math.floor(sceneState.entities.length/5)-2],rotation:[0,0,0],scale:[1,1,1],visible:true,components:type==='Mesh'?['Mesh Renderer','Collider']:type==='Camera'?['Camera']:type==='Light'?['Point Light']:[],parentId:null,primitive:null,material:(type==='Mesh'||type==='Prefab')?{albedo:[0.82,0.85,0.90],metallic:0,roughness:0.5,tiling:4,pattern:'none',emissive:false,texture:''}:null,light:type==='Light'?{type:'point',color:[1,0.94,0.84],intensity:1.5,range:8,spotAngle:35,castShadow:true}:null};
  sceneState.entities.push(entity);selectedEntityId=id;markDirty();renderSceneLab();
}
function duplicateSceneEntity(){
  const entity=selectedSceneEntity();if(!entity)return toast('Sélectionne une entité à dupliquer.','error');
  if(sceneState.entities.length>=250)return toast('Limite de 250 entités atteinte.','error');
  pushHistory();
  const copy=JSON.parse(JSON.stringify(entity));
  copy.id=`entity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  copy.name=`${entity.name} Copy`.slice(0,100);copy.position[0]+=1;
  sceneState.entities.push(copy);selectedEntityId=copy.id;markDirty();renderSceneLab();
}
function removeSceneEntity(){
  if(!selectedEntityId||!sceneState)return;
  pushHistory();
  sceneState.entities.forEach(entity=>{if(entity.parentId===selectedEntityId)entity.parentId=null;});
  sceneState.entities=sceneState.entities.filter(entity=>entity.id!==selectedEntityId);
  selectedEntityId=sceneState.entities[0]?.id||null;markDirty();renderSceneLab();
}
async function saveScene(options={}){
  if(!sceneState)return null;
  if(sessionBlock==='expired'||sessionBlock==='unverified'){showSessionBlock(sessionBlock);return null;}
  if(options.auto===true&&!sceneDirty)return null;
  if(autoSaveInFlight){autoSaveQueued=true;return autoSaveInFlight;}
  clearTimeout(autoSaveTimer);autoSaveTimer=null;
  sceneState.name=$('#scene-name')?.value.trim()||sceneState.name||'Nouvelle scène';
  setSaveState('saving',options.auto===true?'Autosave…':'Enregistrement…');
  autoSaveInFlight=(async()=>{
    try{
      const response=await api('/nova-engine/api/scene','PUT',sceneState);
      sceneState=response.scene;markClean();
      const time=new Date(sceneState.updatedAt||Date.now()).toLocaleTimeString();
      setSaveState('saved',`${options.auto===true?'Autosave':'Enregistré'} · ${time}`);
      const status=$('#scene-viewport-status');if(status)status.textContent=`SAUVÉ · ${time}`;
      renderSceneLab();
      if(options.auto!==true)toast('Scène enregistrée sur le disque.');
      return response;
    }catch(error){
      setSaveState('error','Échec de l’enregistrement');
      sceneDirty=true;const badge=$('#scene-dirty');if(badge)badge.hidden=false;
      if(!handleSessionError(error))toast(`Enregistrement impossible : ${error.message}`,'error');
      throw error;
    }finally{
      autoSaveInFlight=null;
      if(autoSaveQueued){autoSaveQueued=false;scheduleAutoSave();}
    }
  })();
  return autoSaveInFlight;
}
async function newScene(){
  if(sceneState&&sceneState.entities.length&&!confirm('Créer une nouvelle scène de démarrage ? Les modifications non enregistrées seront perdues.'))return;
  try{
    const template=await api('/nova-engine/api/scene/template');
    pushHistory();
    template.name='Nouvelle scène';template.updatedAt=null;
    sceneState=template;
    selectedEntityId=sceneState.entities.find(entity=>entity.type==='Mesh')?.id||sceneState.entities[0]?.id||null;
    currentSnapshotId=null;markDirty();renderSceneLab();
    toast('Scène de démarrage créée : sol, objets, lumières et caméra.');
  }catch(error){
    if(!handleSessionError(error))toast(error.message,'error');
  }
}
function exportScene(){
  if(!sceneState)return;
  sceneState.name=$('#scene-name').value.trim()||'Nouvelle scène';
  const blob=new Blob([JSON.stringify(sceneState,null,2)],{type:'application/json'});
  const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);
  anchor.download=(sceneState.name||'nova-scene').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.scene.json';
  anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);
  toast('Scène exportée en JSON.');
}

let sceneHistory=[];
let sceneFuture=[];
let sceneDirty=false;
let currentSnapshotId=null;
let sceneLibrary=[];

function renderSceneLibrary(){
  const list=$('#scene-library-list'),status=$('#scene-library-status');
  if(status)status.textContent=sceneLibrary.length?`${sceneLibrary.length} snapshot(s) enregistré(s) · ${currentSnapshotId?`scène active « ${currentSnapshotId} »`:'aucun snapshot chargé'}`:'Aucun snapshot. Enregistre la scène pour créer une version nommée.';
  if(!list)return;
  list.innerHTML=sceneLibrary.map(scene=>`<div class="scene-library-row ${scene.id===currentSnapshotId?'active':''}"><div class="scene-library-copy"><b>${esc(scene.name)}</b><small><code>${esc(scene.id)}</code> · ${scene.entityCount} entité(s) · ${new Date(scene.updatedAt).toLocaleString()}</small></div><div class="scene-library-actions"><button class="button secondary" type="button" data-library-action="load" data-scene-id="${esc(scene.id)}">Charger</button><button class="button secondary" type="button" data-library-action="rename" data-scene-id="${esc(scene.id)}">Renommer</button><button class="button secondary" type="button" data-library-action="export" data-scene-id="${esc(scene.id)}">Exporter</button><button class="button danger" type="button" data-library-action="delete" data-scene-id="${esc(scene.id)}">Supprimer</button></div></div>`).join('')||'<p class="muted tiny">La bibliothèque est vide. Utilise « Enregistrer un snapshot » après avoir composé ta scène.</p>';
  list.querySelectorAll('[data-library-action]').forEach(button=>button.addEventListener('click',()=>handleLibraryAction(button.dataset.libraryAction,button.dataset.sceneId)));
}
async function loadSceneLibrary(){
  try{const response=await api('/nova-engine/api/scenes');sceneLibrary=response.scenes||[];renderSceneLibrary();}
  catch(error){handleSessionError(error);const status=$('#scene-library-status');if(status)status.textContent=`Bibliothèque indisponible : ${error.message}`;}
}
function handleLibraryAction(action,id){
  if(action==='load')return loadNamedScene(id);
  if(action==='rename')return renameNamedScene(id);
  if(action==='export')return exportNamedScene(id);
  if(action==='delete')return deleteNamedScene(id);
}
async function saveNamedScene(){
  if(!sceneState)return;
  sceneState.name=$('#scene-name').value.trim()||'Nouvelle scène';
  const suggested=currentSnapshotId||sceneIdFrom(sceneState.name)||'nouvelle-scene';
  const id=prompt('Identifiant du snapshot (lettres, chiffres, tirets) :',suggested);
  if(!id?.trim())return;
  const safeId=sceneIdFrom(id);
  if(!safeId)return toast('Identifiant de snapshot invalide.','error');
  if(safeId!==currentSnapshotId&&sceneLibrary.some(scene=>scene.id===safeId)&&!confirm(`Le snapshot « ${safeId} » existe déjà. Le remplacer ?`))return;
  try{
    const response=await api('/nova-engine/api/scenes/save','PUT',{id:safeId,scene:sceneState});
    sceneState=response.scene;currentSnapshotId=response.id;markClean();renderSceneLab();await loadSceneLibrary();
    toast(`Snapshot « ${response.id} » enregistré.`);
  }catch(error){toast(error.message,'error');}
}
async function loadNamedScene(id){
  if(sceneDirty&&!confirm('Charger ce snapshot ? Les modifications non enregistrées seront perdues.'))return;
  try{
    sceneState=await api(`/nova-engine/api/scenes/load?id=${encodeURIComponent(id)}`);
    selectedEntityId=sceneState.entities[0]?.id||null;currentSnapshotId=id;
    sceneHistory=[];sceneFuture=[];markClean();renderSceneLab();
    toast('Snapshot chargé.');
  }catch(error){toast(error.message,'error');}
}
async function renameNamedScene(id){
  const current=sceneLibrary.find(scene=>scene.id===id);
  const name=prompt('Nouveau nom de la scène :',current?.name||id);
  if(!name?.trim())return;
  try{
    const response=await api('/nova-engine/api/scenes/rename','POST',{id,name:name.trim()});
    if(currentSnapshotId===id){sceneState.name=response.scene.name;sceneState.updatedAt=response.scene.updatedAt;currentSnapshotId=response.id;renderSceneLab();}
    await loadSceneLibrary();toast('Snapshot renommé.');
  }catch(error){toast(error.message,'error');}
}
async function deleteNamedScene(id){
  if(!confirm(`Supprimer définitivement le snapshot « ${id} » ?`))return;
  try{
    await api('/nova-engine/api/scenes/delete','POST',{id});
    if(currentSnapshotId===id)currentSnapshotId=null;
    await loadSceneLibrary();toast('Snapshot supprimé.');
  }catch(error){toast(error.message,'error');}
}
async function exportNamedScene(id){
  try{
    const token=localStorage.getItem('novaToken');
    const response=await fetch(`/nova-engine/api/scenes/export?id=${encodeURIComponent(id)}`,{cache:'no-store',headers:{...(token?{authorization:`Bearer ${token}`}:{})}});
    if(!response.ok)throw new Error(`Export impossible (${response.status})`);
    const blob=await response.blob();
    const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download=`${id}.scene.json`;
    anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);
    toast('Snapshot exporté.');
  }catch(error){toast(error.message,'error');}
}
async function importSceneFile(event){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(file.size>2_000_000)return toast('Choisis un fichier JSON de moins de 2 Mo.','error');
  try{
    const scene=JSON.parse(await file.text());
    if(!scene||!Array.isArray(scene.entities))throw new Error('le document ne contient pas de tableau entities.');
    if(sceneDirty&&!confirm('Importer ce fichier ? Les modifications non enregistrées seront perdues.'))return;
    const id=prompt('Identifiant du snapshot importé :',sceneIdFrom(scene.name||file.name.replace(/\.json$/i,''))||'scene-importee');
    if(!id?.trim())return;
    const safeId=sceneIdFrom(id);
    if(!safeId)throw new Error('identifiant invalide.');
    const token=localStorage.getItem('novaToken');
    let response=await fetch('/nova-engine/api/scenes/import',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({id:safeId,scene})});
    let data=await response.json();
    if(response.status===409){
      if(!confirm(`Le snapshot « ${safeId} » existe déjà. Le remplacer ?`))return;
      response=await fetch('/nova-engine/api/scenes/import',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({id:safeId,scene,overwrite:true})});
      data=await response.json();
    }
    if(!response.ok)throw new Error(data.error||'Import impossible.');
    sceneState=data.scene;selectedEntityId=sceneState.entities[0]?.id||null;currentSnapshotId=data.id;
    sceneHistory=[];sceneFuture=[];markClean();renderSceneLab();await loadSceneLibrary();
    toast(`Snapshot « ${data.id} » importé.`);
  }catch(error){toast(`Import refusé : ${error.message}`,'error');}
}
async function validateWithEngine(){
  if(!sceneState)return;
  sceneState.name=$('#scene-name').value.trim()||'Nouvelle scène';
  const output=$('#scene-engine-result');if(output)output.textContent='Validation par le binaire C++ en cours…';
  try{
    const token=localStorage.getItem('novaToken');
    const response=await fetch('/nova-engine/api/engine/validate',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({scene:sceneState})});
    const data=await response.json();
    if(output)output.textContent=data.ok?`✓ ${data.output||'Scène valide.'}`:`✗ ${data.error||data.output||'Validation refusée.'}`;
    if(data.ok)toast('Le moteur C++ a validé la scène.');
    else toast(data.error||'Le moteur C++ a refusé la scène.','error');
    await loadLogs();
  }catch(error){
    if(output)output.textContent=`✗ ${error.message}`;
    toast(error.message,'error');
  }
}

let viewport3d = null;
let viewportUnavailable = false;
let lastRenderUrl = null;
let lastRuntimeCaptureUrl = null;
let runtimePreviewDismissed = false;

function updatePlayHud(stats){
  const hud=$('#viewport-play-hud'),button=$('#viewport-play');
  if(button){button.textContent=stats?.active?'■ Stop':'▶ Play';button.classList.toggle('active',!!stats?.active);button.setAttribute('aria-pressed',stats?.active?'true':'false');}
  if(!hud)return;
  hud.hidden=!stats?.active;
  if(!stats?.active)return;
  const position=Array.isArray(stats.playerPosition)?stats.playerPosition.map(value=>Number(value).toFixed(1)).join(', '):'—';
  hud.innerHTML=`<b>PLAY</b><span>Score ${stats.score??0}</span><span>Collectibles ${stats.collected??0}/${stats.totalCollectibles??0}</span><span>${stats.grounded?'Au sol':'En l’air'}</span><span>Joueur ${esc(position)}</span><span>Échap : arrêter</span>`;
}

function drawSceneViewport(){
  const canvas=$('#scene-viewport');if(!canvas||!sceneState)return;
  if(!viewportUnavailable){
    if(!window.NovaViewport3D){viewportUnavailable=true;}
    else if(!viewport3d){
      try{
        viewport3d=window.NovaViewport3D.create(canvas,{
          onSelect(id){if(id&&id!==selectedEntityId){selectedEntityId=id;renderSceneLab();}},
          onStats(stats){const backend=$('#viewport-backend');if(backend)backend.textContent=`${stats.backend} · ${stats.triangles} triangles · ${stats.meshes} maillage(s) · ${stats.lights} lumière(s)${stats.hdr?' · HDR':' · SDR'}${stats.bloom?' · bloom':''}`;},
          onPlayStats(stats){updatePlayHud(stats);}
        });
      }catch(error){viewportUnavailable=true;toast(`Viewport WebGL2 indisponible : ${error.message}`,'error');}
      if(!viewport3d)viewportUnavailable=true;
      window.__novaViewport3d=viewport3d||null;
    }
    if(viewport3d){
      const status=$('#scene-viewport-status');if(status)status.textContent='TEMPS RÉEL';
      viewport3d.setSelection(selectedEntityId);
      viewport3d.setScene(sceneState);
      return;
    }
  }
  const playButton=$('#viewport-play');if(playButton)playButton.disabled=true;
  updatePlayHud(null);
  const backend=$('#viewport-backend');if(backend)backend.textContent='Canvas 2D · secours (WebGL2 indisponible)';
  const status=$('#scene-viewport-status');if(status)status.textContent='SECOURS';
  // Un canvas ayant déjà obtenu un contexte WebGL refuse getContext('2d') : on le remplace
  // par un clone vierge pour que le mode de secours reste utilisable.
  let target=canvas;
  try{if(!target.getContext('2d'))target=resetViewportCanvas(target);}catch{target=resetViewportCanvas(target);}
  drawFallbackViewport(target);
}

function resetViewportCanvas(canvas){
  const clone=canvas.cloneNode(false);
  clone.removeAttribute('id');
  clone.id='scene-viewport';
  canvas.replaceWith(clone);
  return clone;
}

function drawFallbackViewport(canvas){
  const context=canvas.getContext('2d');const width=canvas.width,height=canvas.height;
  if(!context){const backend=$('#viewport-backend');if(backend)backend.textContent='Viewport indisponible · ni WebGL2 ni Canvas 2D';return;}
  context.clearRect(0,0,width,height);
  const background=context.createLinearGradient(0,0,width,height);background.addColorStop(0,'#101b30');background.addColorStop(1,'#080e1b');
  context.fillStyle=background;context.fillRect(0,0,width,height);
  context.strokeStyle='rgba(150,190,255,.11)';context.lineWidth=1;
  const centerX=width*.5,centerY=height*.61,step=34;
  for(let index=-18;index<=18;index++){
    context.beginPath();context.moveTo(centerX+index*step,centerY-18*step*.5);context.lineTo(centerX+index*step,centerY+18*step*.5);context.stroke();
    context.beginPath();context.moveTo(centerX-18*step,centerY+index*step*.5);context.lineTo(centerX+18*step,centerY+index*step*.5);context.stroke();
  }
  context.strokeStyle='#90bfff99';context.beginPath();context.moveTo(centerX-180,centerY);context.lineTo(centerX+180,centerY);context.moveTo(centerX,centerY-120);context.lineTo(centerX,centerY+120);context.stroke();
  sceneProjectedPoints=[];
  const visible=sceneState.entities.filter(entity=>entity.visible).sort((a,b)=>a.position[1]-b.position[1]);
  for(const entity of visible){
    const x=centerX+(entity.position[0]-entity.position[2])*(step*.82),y=centerY+(entity.position[0]+entity.position[2])*(step*.37)-entity.position[1]*step*.8;
    sceneProjectedPoints.push({id:entity.id,x,y});
    const selected=entity.id===selectedEntityId;
    context.save();context.translate(x,y);context.shadowBlur=selected?25:12;context.shadowColor=entity.type==='Light'?'#ffd58b':entity.type==='Camera'?'#81c9ff':'#a99dff';
    context.fillStyle=entity.type==='Light'?'#f2c477':entity.type==='Camera'?'#77c7fa':entity.type==='Mesh'?'#a89cff':'#92a9c6';
    context.strokeStyle=selected?'#f3f8ff':'rgba(230,240,255,.65)';context.lineWidth=selected?3:1.3;
    if(entity.type==='Light'){
      context.beginPath();context.arc(0,0,11,0,Math.PI*2);context.fill();
      context.beginPath();for(let ray=0;ray<8;ray++){const angle=ray*Math.PI/4;context.moveTo(Math.cos(angle)*15,Math.sin(angle)*15);context.lineTo(Math.cos(angle)*23,Math.sin(angle)*23);}context.stroke();
    }else if(entity.type==='Camera'){
      context.beginPath();context.moveTo(-15,-9);context.lineTo(8,-9);context.lineTo(15,0);context.lineTo(8,9);context.lineTo(-15,9);context.closePath();context.fill();context.stroke();
    }else{
      context.beginPath();context.moveTo(0,-18);context.lineTo(17,-8);context.lineTo(17,10);context.lineTo(0,20);context.lineTo(-17,10);context.lineTo(-17,-8);context.closePath();context.fill();context.stroke();
    }
    context.restore();
    if(selected){context.fillStyle='#f3f8ff';context.font='12px sans-serif';context.textAlign='center';context.fillText(entity.name,x,y-27);}
  }
  if(!visible.length){context.fillStyle='rgba(200,215,240,.55)';context.font='16px sans-serif';context.textAlign='center';context.fillText('Scène vide · ajoute une entité ou charge un snapshot',width/2,height/2);}
}

function syncRenderControls(){
  const gpu=$('#render-backend')?.value==='gpu';
  // The D3D12 backend now shares shadows, textures, HDR bloom and ACES with the
  // software path; only the CPU grid and supersampling remain CPU-specific.
  for(const id of ['render-supersample','render-grid']){const el=document.getElementById(id);if(el)el.disabled=gpu;}
}
function renderOptionValues(){
  return {
    shadows:$('#render-shadows')?.checked!==false,
    bloom:$('#render-bloom')?.checked!==false,
    bloomIntensity:Number($('#render-bloom-intensity')?.value||0.45),
    shadowResolution:Number($('#render-shadow-resolution')?.value||1024),
    exposure:Number($('#render-exposure')?.value||1)
  };
}
function syncRenderBackend(){
  const select=$('#render-backend');if(!select)return;
  const gpuOption=select.querySelector('option[value="gpu"]');
  const supported=!!(currentStatus?.project?.renderer?.backends||[]).includes('d3d12');
  if(gpuOption)gpuOption.disabled=!supported;
  if(!supported)select.value='software';
  syncRenderControls();
}

function closeRenderPreview(){
  const output=$('#scene-render-output'),image=$('#scene-render-image'),download=$('#scene-render-download');
  if(output)output.hidden=true;
  if(image){image.removeAttribute('src');}
  if(download)download.hidden=true;
  if(lastRenderUrl){URL.revokeObjectURL(lastRenderUrl);lastRenderUrl=null;}
}

async function renderEngineImage(){
  if(!sceneState)return;
  const button=$('#scene-render'),status=$('#scene-render-status');
  const backend=$('#render-backend')?.value==='gpu'?'gpu':'software';
  const resolution=($('#render-resolution')?.value||'960x540').split('x').map(Number);
  const width=resolution[0]||960,height=resolution[1]||540;
  const supersample=Number($('#render-supersample')?.value||2);
  const options={backend,width,height,supersample,grid:$('#render-grid')?.checked!==false,wireframe:$('#render-wireframe')?.checked===true,selectedId:selectedEntityId||'',...renderOptionValues()};
  if(button)button.disabled=true;
  if(status)status.textContent=backend==='gpu'?`Rendu GPU D3D12 ${width} × ${height} en cours…`:`Rendu C++ ${width} × ${height} (${supersample}×) en cours…`;
  closeRenderPreview();
  try{
    const token=localStorage.getItem('novaToken');
    const response=await fetch('/nova-engine/api/engine/render',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({scene:sceneState,options})});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||`Rendu refusé (${response.status})`);
    const imageResponse=await fetch(data.url,{cache:'no-store',headers:{...(token?{authorization:`Bearer ${token}`}:{})}});
    if(!imageResponse.ok)throw new Error(`Image indisponible (${imageResponse.status})`);
    const blob=await imageResponse.blob();
    lastRenderUrl=URL.createObjectURL(blob);
    const image=$('#scene-render-image');
    if(image)image.src=lastRenderUrl;
    const output=$('#scene-render-output');if(output)output.hidden=false;
    const download=$('#scene-render-download');
    if(download){download.href=lastRenderUrl;download.download=`nova-engine-${data.id}.png`;download.hidden=false;}
    const stats=data.stats||{};
    const kilobytes=stats.bytes?`${Math.round(stats.bytes/1024)} Ko`:'PNG';
    if(status)status.textContent=backend==='gpu'
      ? `✓ Rendu GPU ${stats.backend||'D3D12'} · ${stats.adapter||'adaptateur inconnu'} · ${stats.width||width} × ${stats.height||height} · ${stats.triangles??0} triangles · ${stats.drawCalls??0} draw calls · ${stats.shadowMaps??0} ombre(s) · ${stats.textures??0} texture(s) · bloom ${stats.bloom?'actif':'inactif'} · ${Math.round(stats.milliseconds??0)} ms · ${kilobytes}`
      : `✓ Rendu ${stats.width||width} × ${stats.height||height} · ${stats.triangles??0} triangles · ${stats.meshes??0} maillage(s) · ${stats.lights??0} lumière(s) · ${stats.shadowMaps??0} ombre(s) · ${stats.textures??0} texture(s) · bloom ${stats.bloom?'actif':'inactif'} · ${Math.round(stats.milliseconds??stats.wallMs??0)} ms · ${kilobytes}`;
    toast(backend==='gpu'?'Rendu GPU Direct3D 12 du moteur C++ généré.':'Rendu 3D du moteur C++ généré.');
    await loadLogs();
  }catch(error){
    if(status)status.textContent=`✗ Rendu impossible : ${error.message}`;
    toast(error.message,'error');
    await loadLogs();
  }finally{if(button)button.disabled=false;}
}

function renderRuntimeState(rt){
  const state=$('#runtime-state');
  const launch=$('#runtime-launch'),stop=$('#runtime-stop');
  if(state){
    if(rt?.running){
      state.classList.add('running');
      state.textContent=`Fenêtre ouverte · PID ${rt.pid} · scène « ${rt.sceneName||'runtime'} » · ${rt.width} × ${rt.height}${rt.wireframe?' · filaire':''}`;
    }else{
      state.classList.remove('running');
      state.textContent=rt?.error?`Fenêtre fermée · dernière erreur : ${rt.error}`:'Fenêtre fermée.';
    }
  }
  if(launch)launch.disabled=!!rt?.running;
  if(stop)stop.disabled=!rt?.running;
  if(rt?.lastCapture){
    const status=$('#runtime-capture-status');
    if(status&&!lastRuntimeCaptureUrl)status.textContent=`Dernière capture : ${rt.lastCapture.stats?.width||'?'} × ${rt.lastCapture.stats?.height||'?'} · ${rt.lastCapture.frames||'?'} frame(s) · ${Math.round((rt.lastCapture.bytes||0)/1024)} Ko · ${new Date(rt.lastCapture.at).toLocaleTimeString()}`;
    const image=$('#runtime-capture-image'),output=$('#runtime-capture-output');
    if(image&&!image.getAttribute('src')&&output&&output.hidden&&!runtimePreviewDismissed){image.src=`${rt.lastCapture.url}?t=${Date.now()}`;output.hidden=false;}
  }
}
async function refreshRuntime(){
  try{renderRuntimeState(await api('/nova-engine/api/runtime/status'));}
  catch(error){toast(error.message,'error');}
}
async function launchRuntimeWindow(){
  if(!sceneState)return;
  const button=$('#runtime-launch');if(button)button.disabled=true;
  try{
    await api('/nova-engine/api/runtime/window','POST',{scene:sceneState,options:{width:1280,height:720,wireframe:$('#runtime-capture-wireframe')?.checked===true,...renderOptionValues()}});
    toast('Fenêtre native Direct3D 12 ouverte.');
    view('runtime');await refreshRuntime();await loadLogs();
  }catch(error){toast(error.message,'error');await refreshRuntime();}
}
async function stopRuntimeWindow(){
  try{
    await api('/nova-engine/api/runtime/window/stop','POST');
    toast('Fermeture de la fenêtre demandée.');await refreshRuntime();await loadLogs();
  }catch(error){toast(error.message,'error');await refreshRuntime();}
}
function closeRuntimeCapture(){
  runtimePreviewDismissed=true;
  const output=$('#runtime-capture-output'),image=$('#runtime-capture-image');
  if(output)output.hidden=true;
  if(image)image.removeAttribute('src');
  if(lastRuntimeCaptureUrl){URL.revokeObjectURL(lastRuntimeCaptureUrl);lastRuntimeCaptureUrl=null;}
}
async function captureRuntimeImage(){
  if(!sceneState)return;
  const button=$('#runtime-capture'),status=$('#runtime-capture-status');
  const resolution=($('#runtime-capture-resolution')?.value||'960x540').split('x').map(Number);
  const width=resolution[0]||960,height=resolution[1]||540;
  const frames=Number($('#runtime-capture-frames')?.value||2);
  const wireframe=$('#runtime-capture-wireframe')?.checked===true;
  if(button)button.disabled=true;
  if(status)status.textContent=`Capture D3D12 ${width} × ${height} · ${frames} frame(s) en cours…`;
  closeRuntimeCapture();
  runtimePreviewDismissed=false;
  try{
    const token=localStorage.getItem('novaToken');
    const data=await api('/nova-engine/api/engine/runtime/capture','POST',{scene:sceneState,options:{width,height,frames,wireframe,...renderOptionValues()}});
    const imageResponse=await fetch(data.url,{cache:'no-store',headers:{...(token?{authorization:`Bearer ${token}`}:{})}});
    if(!imageResponse.ok)throw new Error(`Image indisponible (${imageResponse.status})`);
    const blob=await imageResponse.blob();
    lastRuntimeCaptureUrl=URL.createObjectURL(blob);
    const image=$('#runtime-capture-image');if(image)image.src=lastRuntimeCaptureUrl;
    const output=$('#runtime-capture-output');if(output)output.hidden=false;
    const stats=data.stats||{};
    const kilobytes=data.bytes?`${Math.round(data.bytes/1024)} Ko`:'PNG';
    if(status)status.textContent=`✓ Capture ${stats.backend||'D3D12'} · ${stats.adapter||'adaptateur inconnu'} · ${stats.width||width} × ${stats.height||height} · ${data.frames||frames} frame(s) · ${stats.triangles??0} triangles · ${stats.drawCalls??0} draw calls · ${stats.shadowMaps??0} ombre(s) · ${stats.textures??0} texture(s) · bloom ${stats.bloom?'actif':'inactif'} · ${Math.round(stats.wallMs??0)} ms · ${kilobytes}`;
    toast('Capture runtime lue depuis le swapchain Direct3D 12.');
    await loadLogs();await refreshRuntime();
  }catch(error){
    if(status)status.textContent=`✗ Capture impossible : ${error.message}`;
    toast(error.message,'error');await loadLogs();
  }finally{if(button)button.disabled=false;}
}

$('#scene-add')?.addEventListener('click',addSceneEntity);
$('#scene-duplicate')?.addEventListener('click',duplicateSceneEntity);
$('#scene-remove')?.addEventListener('click',removeSceneEntity);
$('#scene-save')?.addEventListener('click',()=>saveScene());
$('#scene-new')?.addEventListener('click',newScene);
$('#scene-export')?.addEventListener('click',exportScene);
$('#scene-save-snapshot')?.addEventListener('click',()=>saveNamedScene());
$('#scene-save-snapshot-top')?.addEventListener('click',()=>saveNamedScene());
$('#scene-import-input')?.addEventListener('change',importSceneFile);
$('#scene-validate')?.addEventListener('click',validateWithEngine);
$('#scene-undo')?.addEventListener('click',undoScene);
$('#scene-redo')?.addEventListener('click',redoScene);
$('#scene-name')?.addEventListener('input',markDirty);
$('#viewport-frame')?.addEventListener('click',()=>{if(viewport3d)viewport3d.frameScene();else toast('Le viewport WebGL2 n’est pas disponible sur ce navigateur.','error');});
$('#viewport-play')?.addEventListener('click',()=>{
  if(!viewport3d)return toast('Le mode Play nécessite le viewport WebGL2.','error');
  const started=viewport3d.setPlaying(!viewport3d.isPlaying());
  updatePlayHud(viewport3d.getPlayStats());
  toast(started?'Play : WASD/ZQSD, souris et espace. Échap arrête.':'Play arrêté, scène restaurée.');
});
$('#scene-render')?.addEventListener('click',renderEngineImage);
$('#render-backend')?.addEventListener('change',syncRenderControls);
syncRenderControls();
$('#scene-render-close')?.addEventListener('click',closeRenderPreview);
$('#runtime-launch')?.addEventListener('click',launchRuntimeWindow);
$('#runtime-stop')?.addEventListener('click',stopRuntimeWindow);
$('#runtime-refresh')?.addEventListener('click',async()=>{await refreshRuntime();toast('État runtime actualisé.');});
$('#runtime-capture')?.addEventListener('click',captureRuntimeImage);
$('#runtime-capture-close')?.addEventListener('click',closeRuntimeCapture);
$('#scene-viewport')?.addEventListener('click',event=>{
  if(viewport3d)return;
  const rect=event.currentTarget.getBoundingClientRect();
  const x=(event.clientX-rect.left)*event.currentTarget.width/rect.width;
  const y=(event.clientY-rect.top)*event.currentTarget.height/rect.height;
  let best=null,distance=Infinity;
  for(const point of sceneProjectedPoints){const candidate=Math.hypot(point.x-x,point.y-y);if(candidate<distance){distance=candidate;best=point;}}
  if(best&&distance<60){selectedEntityId=best.id;renderSceneLab();}
});
document.addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey))return;
  const tag=event.target?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(event.key.toLowerCase()==='s'){event.preventDefault();saveScene().catch(()=>{});return;}
  if(event.key.toLowerCase()==='z'&&!event.shiftKey){event.preventDefault();undoScene();}
  else if(event.key.toLowerCase()==='y'||(event.key.toLowerCase()==='z'&&event.shiftKey)){event.preventDefault();redoScene();}
});
$('#session-retry')?.addEventListener('click',async()=>{
  const button=$('#session-retry');if(button)button.disabled=true;
  try{
    await refreshStatus();
    await loadLogs();
    await loadScene();
    await loadSceneLibrary();
    if(!sessionBlock)showSessionBlock(null);
    toast('Session vérifiée.');
  }finally{if(button)button.disabled=false;}
});
window.addEventListener('storage',event=>{
  if(event.key!=='novaToken')return;
  renderSessionChip(tokenInfo());
  const info=tokenInfo();
  if(info.present&&!info.expired){
    showSessionBlock(null);
    loadScene().then(()=>loadSceneLibrary()).catch(()=>{});
  }else if(!info.present){
    showSessionBlock('expired');
    renderSessionChip(info);
  }
});
window.addEventListener('focus',()=>{
  if(!sessionBlock)return;
  const info=tokenInfo();
  renderSessionChip(info);
  if(info.present&&!info.expired){showSessionBlock(null);loadScene().then(()=>loadSceneLibrary()).catch(()=>{});}
});
window.addEventListener('beforeunload',event=>{if(sceneDirty){event.preventDefault();event.returnValue='';}});

async function refreshStatus(){
  try{renderStatus(await api('/nova-engine/api/status'));if(sessionBlock==='offline'||sessionBlock==='server')showSessionBlock(null);}
  catch(error){handleSessionError(error);}
}
function renderLogs(data){
  const recent=data.logs.slice(-6).reverse();
  $('#mini-logs').innerHTML=recent.length?recent.map(entry=>`<div class="mini-log"><time>${new Date(entry.time).toLocaleTimeString()}</time><span>${esc(entry.message)}</span></div>`).join(''):'<p>En attente d’activité…</p>';
  const full=$('#full-console');
  if(full){full.innerHTML=data.logs.map(entry=>`<div class="console-line ${esc(entry.type)}"><time>${new Date(entry.time).toLocaleTimeString()}</time><span class="kind">${esc(entry.type)}</span><span>${esc(entry.message)}</span></div>`).join('')||'<div class="console-line muted">Journal vide.</div>';full.scrollTop=full.scrollHeight;}
  const build=$('#build-preview');if(build)build.textContent=data.logs.slice(-24).map(entry=>`[${new Date(entry.time).toLocaleTimeString()}] ${entry.message}`).join('\n')||'Aucune sortie disponible.';
  const test=$('#test-result');if(test&&data.lastAction?.name==='Run tests')test.textContent=`${data.lastAction.status==='success'?'SUCCÈS':data.lastAction.status==='failed'?'ÉCHEC':'EN COURS'} — ${data.lastAction.name}${data.lastAction.code!==null?` (code ${data.lastAction.code})`:''}`;
}
async function loadLogs(){try{renderLogs(await api('/nova-engine/api/logs'));}catch(error){if(!handleSessionError(error))toast(error.message,'error');}}
async function action(name){
  if(name==='build-pipeline'){await action('configure');await waitForIdle();if(currentStatus?.lastAction?.status!=='success')return;await action('build');await waitForIdle();if(currentStatus?.lastAction?.status==='success')await action('test');return;}
  if(name==='run'){await launchRuntimeWindow();return;}
  try{
    const endpoint={configure:'/nova-engine/api/configure',build:'/nova-engine/api/build',test:'/nova-engine/api/test',run:'/nova-engine/api/run',stop:'/nova-engine/api/stop'}[name];
    if(!endpoint)return;
    await api(endpoint,'POST');
    toast(name==='stop'?'Arrêt demandé.':`${actionLabels[name]||name} démarré.`);
    if(name==='configure')view('build');if(name==='test')view('tests');if(name==='run')view('runtime');
    await refreshStatus();await loadLogs();pollUntilIdle();
  }catch(error){if(!handleSessionError(error))toast(error.message,'error');await refreshStatus();}
}
function waitForIdle(){
  return new Promise(resolve=>{
    let attempts=0;
    const timer=setInterval(async()=>{attempts++;await refreshStatus();await loadLogs();if(!currentStatus?.active||attempts>240){clearInterval(timer);resolve();}},500);
  });
}
let polling=false;
function pollUntilIdle(){
  if(polling)return;
  polling=true;let attempts=0;
  const timer=setInterval(async()=>{attempts++;await refreshStatus();await loadLogs();if(!currentStatus?.active||attempts>180){clearInterval(timer);polling=false;await loadSceneLibrary();}},850);
}
$$('[data-action]').forEach(button=>button.addEventListener('click',()=>action(button.dataset.action)));
$('#refresh').addEventListener('click',async()=>{await refreshStatus();await loadLogs();await loadScene();await loadSceneLibrary();toast('État actualisé.');});
$('#refresh-logs').addEventListener('click',loadLogs);
$('#clear-logs').addEventListener('click',async()=>{try{await api('/nova-engine/api/clear-logs','POST');await loadLogs();toast('Journal effacé.');}catch(error){if(!handleSessionError(error))toast(error.message,'error');}});

(async()=>{
  renderSessionChip(tokenInfo());
  // Sonde légère : distingue l'accès direct au Workbench (5201, sans NovaID) du proxy
  // NovaCore (/nova-engine, authentification requise) avant de lancer les appels lourds.
  try{
    await api('/nova-engine/api/ping');
    showSessionBlock(null);
  }catch(error){
    handleSessionError(error);
    if(sessionBlock==='expired'||sessionBlock==='unverified'){
      const list=$('#scene-entity-list');if(list)list.innerHTML=`<p class="muted">${esc(error.message)} Connecte-toi avec NovaID, puis clique « Réessayer ».</p>`;
      const backend=$('#viewport-backend');if(backend)backend.textContent='Scène non chargée · session NovaID requise';
      setSaveState('error','Scène indisponible');
      return;
    }
  }
  await refreshStatus();
  await loadLogs();
  await loadScene();
  await loadSceneLibrary();
  if(currentStatus?.active)pollUntilIdle();
  setInterval(async()=>{if(sessionBlock==='expired'||sessionBlock==='unverified')return;await refreshStatus();if(currentStatus?.active)await loadLogs();},4000);
})();
