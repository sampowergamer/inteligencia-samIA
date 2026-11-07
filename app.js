/* MinhaIA - Central de Conhecimento
   Armazenamento: IndexedDB no navegador. Nenhum dado é enviado a servidores.
   PDF.js, Mammoth e Tesseract são bibliotecas externas opcionais carregadas pelo HTML.
*/
(() => {
  "use strict";
  const DB_NAME = "minhaia_central_conhecimento";
  const DB_VERSION = 1;
  const STORE_K = "knowledge", STORE_F = "folders", STORE_A = "agents", STORE_M = "media";
  const DEFAULT_AGENTS = [
    {id:"jose",name:"José",role:"Administração e gerenciamento"},
    {id:"esther",name:"Esther",role:"Marketing e comunicação"},
    {id:"bezalel",name:"Bezalel",role:"Design e criação"},
    {id:"neemias",name:"Neemias",role:"Projetos, etapas e planejamento"},
    {id:"samuel",name:"Samuel",role:"Organização e estruturação"},
    {id:"pesquisa",name:"Pesquisador",role:"Pesquisa e comparação de documentos"}
  ];
  let db;
  let currentFiles = [];
  let cloudClient = null;
  let cloudUser = null;
  let cloudWorkspaceId = null;
  let cloudBusy = false;
  const $ = id => document.getElementById(id);
  const now = () => new Date().toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const tx = (store, mode="readonly") => db.transaction(store, mode).objectStore(store);
  const req = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2800);}
  function openDB(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{const d=request.result;
      if(!d.objectStoreNames.contains(STORE_K)){const s=d.createObjectStore(STORE_K,{keyPath:"id"});s.createIndex("updatedAt","updatedAt");}
      if(!d.objectStoreNames.contains(STORE_F))d.createObjectStore(STORE_F,{keyPath:"id"});
      if(!d.objectStoreNames.contains(STORE_A))d.createObjectStore(STORE_A,{keyPath:"id"});
      if(!d.objectStoreNames.contains(STORE_M))d.createObjectStore(STORE_M,{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });}
  async function all(store){return req(tx(store).getAll());}
  async function putLocal(store,value){return req(tx(store,"readwrite").put(value));}
  async function put(store,value){
    await putLocal(store,value);
    if(cloudClient && cloudUser && !cloudBusy){try{await cloudUpsert(store,value);}catch(err){console.warn("Sincronização pendente:",err);queueCloudOp("upsert",store,value.id);setCloudStatus("Alteração salva localmente; sincronização pendente.",false);}}
    return value;
  }
  async function remove(store,id){
    await req(tx(store,"readwrite").delete(id));
    if(cloudClient && cloudUser && !cloudBusy){try{await cloudDelete(store,id);}catch(err){console.warn("Exclusão pendente na nuvem:",err);queueCloudOp("delete",store,id);setCloudStatus("Exclusão salva localmente; sincronização pendente.",false);}}
  }
  const CLOUD_STORES = {[STORE_K]:"knowledge",[STORE_F]:"folders",[STORE_A]:"agents",[STORE_M]:"media"};
  function setCloudStatus(message,online){const el=$("storageStatus");if(el)el.textContent=message;const badge=$("connectionBadge");if(badge){badge.textContent=online?"● NUVEM SINCRONIZADA":"● LOCAL / PENDENTE";badge.style.color=online?"#80d7b9":"#f0c674";}const status=$("cloudAccountStatus");if(status)status.textContent=message;}
  function getCloudConfig(){try{return JSON.parse(localStorage.getItem("minhaia_supabase_config")||"null");}catch{return null;}}
  async function ensureWorkspace(){
    const {data,error}=await cloudClient.rpc("get_or_create_workspace");
    if(error)throw error;
    cloudWorkspaceId=data;
    if(!cloudWorkspaceId)throw new Error("Não foi possível localizar o espaço de trabalho.");
    const wi=$("workspaceInfo");if(wi)wi.textContent="Espaço de trabalho: "+cloudWorkspaceId;
  }
  async function cloudUpsert(store,value){
    if(!cloudClient||!cloudWorkspaceId)return;
    let payload={...value};
    if(store===STORE_M && value.blob){
      const path=`${cloudWorkspaceId}/${value.id}/${safeName(value.name||"arquivo")}`;
      const {error:uploadError}=await cloudClient.storage.from("knowledge-files").upload(path,value.blob,{upsert:true,contentType:value.type||"application/octet-stream"});
      if(uploadError)throw uploadError;
      payload={...value,blob:undefined,storagePath:path,cloudStored:true};
    }
    const row={workspace_id:cloudWorkspaceId,record_type:CLOUD_STORES[store],record_id:String(value.id),payload,updated_at:now()};
    const {error}=await cloudClient.from("knowledge_records").upsert(row,{onConflict:"workspace_id,record_type,record_id"});
    if(error)throw error;
  }
  async function cloudDelete(store,id){if(!cloudClient||!cloudWorkspaceId)return;const {error}=await cloudClient.from("knowledge_records").delete().eq("workspace_id",cloudWorkspaceId).eq("record_type",CLOUD_STORES[store]).eq("record_id",String(id));if(error)throw error;}
  function queueCloudOp(op,store,id){try{const q=JSON.parse(localStorage.getItem("minhaia_pending_sync")||"[]");q.push({op,store,id:String(id),at:now()});localStorage.setItem("minhaia_pending_sync",JSON.stringify(q.slice(-2000)));}catch(e){console.warn("Não foi possível registrar a fila offline",e);}}
  async function flushCloudQueue(){
    const q=JSON.parse(localStorage.getItem("minhaia_pending_sync")||"[]");if(!q.length)return;
    const remaining=[];
    for(const item of q){try{if(item.op==="delete")await cloudDelete(item.store,item.id);else{const value=await req(tx(item.store).get(item.id));if(value)await cloudUpsert(item.store,value);}}catch(e){remaining.push(item);}}
    localStorage.setItem("minhaia_pending_sync",JSON.stringify(remaining));
    return remaining;
  }
  async function syncFromCloud(){
    if(!cloudClient||!cloudWorkspaceId)return;
    cloudBusy=true;
    try{
      const pending = await flushCloudQueue();
      const {data,error}=await cloudClient.from("knowledge_records").select("record_type,record_id,payload,updated_at").eq("workspace_id",cloudWorkspaceId);
      if(error)throw error;
      const remote=data||[];
      const local=await getData();
      if(remote.length===0){
        for(const [store,items] of [[STORE_K,local.knowledge],[STORE_F,local.folders],[STORE_A,local.agents],[STORE_M,local.media]])for(const item of items)await cloudUpsert(store,item);
      }else{
        // Merge local-only records into the shared workspace instead of silently discarding them.
        const remoteKeys=new Set(remote.map(row=>row.record_type+":"+String(row.record_id)));
        for(const [store,items] of [[STORE_K,local.knowledge],[STORE_F,local.folders],[STORE_A,local.agents],[STORE_M,local.media]]){
          for(const item of items){
            const key=CLOUD_STORES[store]+":"+String(item.id);
            const isPending=pending.some(op=>op.store===store&&op.id===String(item.id));
            if(!remoteKeys.has(key)&&!isPending)await cloudUpsert(store,item);
          }
        }
        const {data:merged,error:mergeError}=await cloudClient.from("knowledge_records").select("record_type,record_id,payload,updated_at").eq("workspace_id",cloudWorkspaceId);
        if(mergeError)throw mergeError;
        for(const store of [STORE_K,STORE_F,STORE_A,STORE_M])await req(tx(store,"readwrite").clear());
        for(const row of (merged||[])){const store=Object.keys(CLOUD_STORES).find(k=>CLOUD_STORES[k]===row.record_type);if(!store||!row.payload)continue;const hasPending=pending.some(op=>op.store===store&&op.id===String(row.record_id));if(hasPending)continue;await putLocal(store,row.payload);}
        for(const op of pending.filter(x=>x.op==="upsert")){const collection=local[op.store];const pendingValue=collection?.find(x=>String(x.id)===op.id);if(pendingValue)await putLocal(op.store,pendingValue);}
      }
      setCloudStatus("Supabase conectado · dados sincronizados",true);
    }finally{cloudBusy=false;}
  }
  async function connectSupabase(){
    const cfg=getCloudConfig();
    if(!cfg?.url||!cfg?.key){setCloudStatus("Configure URL e chave publishable do Supabase.",false);return;}
    if(!window.supabase?.createClient){setCloudStatus("Biblioteca Supabase não carregou. Verifique a internet.",false);return;}
    cloudClient=window.supabase.createClient(cfg.url,cfg.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data,error}=await cloudClient.auth.getSession();if(error)throw error;
    cloudUser=data.session?.user||null;
    if(cloudUser){await ensureWorkspace();await syncFromCloud();await refresh();$("signOutBtn").hidden=false;document.querySelector(".app-shell")?.classList.remove("locked");}
    else {setCloudStatus("Supabase configurado · entre na sua conta para sincronizar.",false);document.querySelector(".app-shell")?.classList.add("locked");if(!$("accountDialog").open)$("accountDialog").showModal();}
  }
  async function initCloudControls(){
    const cfg=getCloudConfig();if(cfg){$("supabaseUrl").value=cfg.url||"";$("supabaseAnonKey").value=cfg.key||"";}
    $("accountBtn").onclick=()=>$("accountDialog").showModal();
    $("accountDialog").addEventListener("cancel",e=>{if(document.querySelector(".app-shell")?.classList.contains("locked"))e.preventDefault();});
    $("saveCloudConfigBtn").onclick=async()=>{const url=$("supabaseUrl").value.trim(),key=$("supabaseAnonKey").value.trim();if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!key){toast("Informe uma URL Supabase válida e a chave publishable.");return;}localStorage.setItem("minhaia_supabase_config",JSON.stringify({url,key}));try{await connectSupabase();toast("Configuração Supabase salva.");}catch(e){console.error(e);toast("Falha ao conectar: "+e.message);}};
    $("signInBtn").onclick=async()=>{if(!cloudClient){toast("Salve primeiro a configuração Supabase.");return;}const {data,error}=await cloudClient.auth.signInWithPassword({email:$("authEmail").value.trim(),password:$("authPassword").value});if(error){toast(error.message);return;}cloudUser=data.user;try{await ensureWorkspace();await syncFromCloud();await refresh();$("signOutBtn").hidden=false;document.querySelector(".app-shell")?.classList.remove("locked");toast("Conta conectada e biblioteca sincronizada.");}catch(e){console.error(e);toast("Erro na sincronização: "+e.message);}};
    $("signUpBtn").onclick=async()=>{if(!cloudClient){toast("Salve primeiro a configuração Supabase.");return;}const {data,error}=await cloudClient.auth.signUp({email:$("authEmail").value.trim(),password:$("authPassword").value});if(error){toast(error.message);return;}toast(data.session?"Conta criada. Entre para sincronizar.":"Cadastro enviado. Confirme o e-mail e depois entre.");};
    $("signOutBtn").onclick=async()=>{if(cloudClient)await cloudClient.auth.signOut();cloudUser=null;cloudWorkspaceId=null;setCloudStatus("Sessão encerrada · entre novamente para abrir o painel",false);$("signOutBtn").hidden=true;$("workspaceInfo").textContent="";document.querySelector(".app-shell")?.classList.add("locked");if(!$("accountDialog").open)$("accountDialog").showModal();};
    $("createApiKeyBtn").onclick=async()=>{
      if(!cloudClient||!cloudUser){toast("Entre na conta antes de gerar uma API key.");return;}
      const name=$("apiKeyName").value.trim()||"Integração MinhaIA";
      const permissions=$("apiKeyPermissions").value.split(",");
      const {data,error}=await cloudClient.rpc("create_my_api_key",{p_name:name,p_permissions:permissions});
      if(error){toast("Não foi possível gerar a chave: "+error.message);return;}
      $("generatedApiKey").textContent=data;$("apiKeyResult").hidden=false;
      const cfg=getCloudConfig();$("apiEndpointInfo").textContent="Endpoint: "+cfg.url+"/functions/v1/knowledge-api";
      toast("Chave criada. Copie e guarde agora; ela não será exibida novamente.");
    };
    $("copyApiKeyBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("generatedApiKey").textContent);toast("Chave copiada.");}catch{toast("Não foi possível copiar automaticamente. Selecione e copie a chave.");}};
    try{await connectSupabase();}catch(e){console.warn("Supabase ainda não configurado:",e.message);setCloudStatus("Nuvem ainda não configurada.",false);}
  }
  window.addEventListener("online",async()=>{if(cloudClient&&cloudUser){try{await syncFromCloud();await refresh();}catch(e){console.warn(e);}}});
  async function seed(){
    const agents=await all(STORE_A);if(!agents.length)for(const a of DEFAULT_AGENTS)await put(STORE_A,a);
  }
  async function getData(){const [knowledge,folders,agents,media]=await Promise.all([all(STORE_K),all(STORE_F),all(STORE_A),all(STORE_M)]);return{knowledge,folders,agents,media};}
  function escapeHTML(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function formatDate(d){try{return new Date(d).toLocaleDateString("pt-BR");}catch{return "";}}
  function showView(name){
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
    const titles={library:"Biblioteca",editor:"Criar conhecimento",import:"Importar arquivos",agents:"Agentes",backup:"Backup e exportação"};
    $("pageTitle").textContent=titles[name]||"Biblioteca";
    if(name==="editor")renderEditorAgents();
  }
  function bindNavigation(){
    document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
    $("newKnowledgeBtn").onclick=()=>newKnowledge();$("emptyCreateBtn").onclick=()=>newKnowledge();
    $("cancelEditBtn").onclick=()=>{ $("knowledgeForm").reset();$("knowledgeId").value="";showView("library");};
  }
  async function refresh(){
    const d=await getData();
    $("statKnowledge").textContent=d.knowledge.length;$("statFolders").textContent=d.folders.length;
    $("statFiles").textContent=d.media.length;$("statShares").textContent=d.knowledge.reduce((n,k)=>n+(k.agents||[]).length,0);
    fillFolderSelects(d.folders);renderLibrary(d);renderAgents(d);renderExportSelect(d.knowledge);
  }
  function fillFolderSelects(folders){
    const opts=folders.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join("");
    ["folderFilter","knowledgeFolder","importFolder"].forEach(id=>{
      const el=$(id),old=el.value,first=id==="folderFilter"?'<option value="">Todas as pastas</option>':'<option value="">Sem pasta</option>';
      el.innerHTML=first+opts;if([...el.options].some(o=>o.value===old))el.value=old;
    });
  }
  function renderLibrary(d){
    const q=$("searchInput").value.toLowerCase(),folder=$("folderFilter").value,cat=$("categoryFilter").value;
    const folders=new Map(d.folders.map(f=>[f.id,f.name]));
    const list=d.knowledge.filter(k=>(!q||[k.title,k.summary,k.content,k.category,(k.tags||[]).join(" ")].join(" ").toLowerCase().includes(q))&&(!folder||k.folderId===folder)&&(!cat||k.category===cat)).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
    $("knowledgeList").innerHTML=list.map(k=>`<article class="knowledge-card"><div><h3>${escapeHTML(k.title)}</h3><p>${escapeHTML(k.summary||((k.content||"").slice(0,180))||"Sem resumo.")}</p><div class="meta"><span class="chip">${escapeHTML(k.category||"Geral")}</span><span class="chip">${escapeHTML(folders.get(k.folderId)||"Sem pasta")}</span><span class="chip">${(k.agents||[]).length} agente(s)</span><span class="chip">${(k.attachments||[]).length} anexo(s)</span><span class="chip">Atualizado ${formatDate(k.updatedAt)}</span></div></div><div class="card-actions">${(k.attachments||[]).length?`<button class="icon-btn" data-action="attachments" data-id="${k.id}" title="Baixar anexos">⇩ ${k.attachments.length}</button>`:""}<button class="icon-btn" data-action="edit" data-id="${k.id}" title="Editar">✎</button><button class="icon-btn" data-action="export" data-id="${k.id}" title="Exportar">⇩</button><button class="icon-btn" data-action="delete" data-id="${k.id}" title="Excluir">×</button></div></article>`).join("");
    $("emptyLibrary").classList.toggle("show",list.length===0);
    $("knowledgeList").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>handleKnowledgeAction(b.dataset.action,b.dataset.id)));
  }
  async function downloadAttachments(knowledge){
    const ids=knowledge.attachments||[];if(!ids.length){toast("Este conhecimento não tem anexos.");return;}
    for(const id of ids){
      const meta=await req(tx(STORE_M).get(id));if(!meta){toast("Metadados do anexo não encontrados.");continue;}
      let blob=meta.blob;
      if(!blob&&cloudClient&&cloudUser&&meta.storagePath){const {data,error}=await cloudClient.storage.from("knowledge-files").download(meta.storagePath);if(error){toast("Falha ao baixar anexo: "+error.message);continue;}blob=data;}
      if(blob){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=meta.name||"anexo";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}else toast("Anexo não disponível neste dispositivo. Entre na nuvem para baixar.");
    }
  }
  async function handleKnowledgeAction(action,id){
    const k=await req(tx(STORE_K).get(id));if(!k)return;
    if(action==="edit")editKnowledge(k);
    if(action==="export")downloadText(toMarkdown(k),safeName(k.title)+".md","text/markdown");
    if(action==="attachments")await downloadAttachments(k);
    if(action==="delete"&&confirm(`Excluir "${k.title}"? Esta ação não pode ser desfeita.`)){await remove(STORE_K,id);await refresh();toast("Conhecimento excluído.");}
  }
  function newKnowledge(){ $("knowledgeForm").reset();$("knowledgeId").value="";$("editorHeading").textContent="Novo conhecimento";renderEditorAgents();showView("editor");}
  async function editKnowledge(k){
    $("knowledgeId").value=k.id;$("knowledgeTitle").value=k.title;$("knowledgeCategory").value=k.category||"Geral";
    $("knowledgeFolder").value=k.folderId||"";$("knowledgeSummary").value=k.summary||"";
    $("knowledgeContent").value=k.content||"";$("knowledgeTags").value=(k.tags||[]).join(", ");
    $("editorHeading").textContent="Editar conhecimento";renderEditorAgents(k.agents||[]);showView("editor");
  }
  async function renderEditorAgents(selected=[]){
    const agents=await all(STORE_A);
    $("editorAgentChecks").innerHTML=agents.map(a=>`<label class="agent-check"><input type="checkbox" value="${escapeHTML(a.id)}" ${selected.includes(a.id)?"checked":""}>${escapeHTML(a.name)}</label>`).join("");
  }
  $("knowledgeForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const id=$("knowledgeId").value||uid(),old=await req(tx(STORE_K).get(id));
    const agents=[...$("editorAgentChecks").querySelectorAll("input:checked")].map(x=>x.value);
    const item={id,title:$("knowledgeTitle").value.trim(),category:$("knowledgeCategory").value,folderId:$("knowledgeFolder").value||"",summary:$("knowledgeSummary").value.trim(),content:$("knowledgeContent").value.trim(),tags:$("knowledgeTags").value.split(",").map(x=>x.trim()).filter(Boolean),agents,createdAt:old?.createdAt||now(),updatedAt:now(),source:old?.source||"manual",attachments:old?.attachments||[]};
    await put(STORE_K,item);await refresh();showView("library");toast(cloudUser?"Conhecimento salvo e sincronizado.":"Conhecimento salvo neste navegador.");
  });
  $("searchInput").addEventListener("input",refresh);$("folderFilter").addEventListener("change",refresh);$("categoryFilter").addEventListener("change",refresh);
  $("createFolderBtn").onclick=()=>$("folderDialog").showModal();
  $("folderForm").addEventListener("submit",async e=>{e.preventDefault();const name=$("folderName").value.trim();if(!name)return;await put(STORE_F,{id:uid(),name,createdAt:now()});$("folderDialog").close();$("folderName").value="";await refresh();toast("Pasta criada.");});
  $("manageAgentsBtn").onclick=()=>$("agentDialog").showModal();
  $("agentForm").addEventListener("submit",async e=>{e.preventDefault();const name=$("agentName").value.trim();if(!name)return;await put(STORE_A,{id:uid(),name,role:$("agentRole").value.trim()});$("agentDialog").close();$("agentName").value="";$("agentRole").value="";await refresh();toast("Agente adicionado.");});
  function renderAgents(d){
    $("agentsGrid").innerHTML=d.agents.map(a=>{const count=d.knowledge.filter(k=>(k.agents||[]).includes(a.id)).length;return `<article class="agent-card"><div class="agent-avatar">◎</div><strong>${escapeHTML(a.name)}</strong><p>${escapeHTML(a.role||"Agente da MinhaIA")}</p><div class="agent-count">${count} conhecimento(s) associado(s)</div></article>`;}).join("");
  }
  function renderExportSelect(knowledge){const el=$("singleExportSelect"),old=el.value;el.innerHTML='<option value="">Selecione um conhecimento</option>'+knowledge.map(k=>`<option value="${k.id}">${escapeHTML(k.title)}</option>`).join("");if([...el.options].some(o=>o.value===old))el.value=old;}
  function safeName(s){return (s||"conhecimento").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9-_]+/gi,"_").slice(0,70)||"conhecimento";}
  function toMarkdown(k){return `# ${k.title}\n\n**Categoria:** ${k.category||"Geral"}  \n**Tags:** ${(k.tags||[]).join(", ")}  \n**Agentes:** ${(k.agents||[]).join(", ")||"Nenhum"}\n\n## Resumo\n${k.summary||"Sem resumo."}\n\n## Conteúdo\n${k.content||""}\n\n---\nCriado: ${k.createdAt||""}  \nAtualizado: ${k.updatedAt||""}\n`;}
  function downloadText(content,name,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  $("exportJsonBtn").onclick=async()=>{const d=await getData();downloadText(JSON.stringify({app:"MinhaIA Central de Conhecimento",version:1,exportedAt:now(),...d},null,2),"minhaia-backup-"+Date.now()+".json","application/json");toast("Backup JSON exportado.");};
  $("exportMdBtn").onclick=async()=>{const id=$("singleExportSelect").value;if(!id)return toast("Selecione um conhecimento.");const k=await req(tx(STORE_K).get(id));downloadText(toMarkdown(k),safeName(k.title)+".md","text/markdown");};
  $("restoreBtn").onclick=()=>$("backupInput").click();
  $("backupInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());for(const s of [STORE_K,STORE_F,STORE_A,STORE_M])if(Array.isArray(data[s]))for(const item of data[s])if(item&&item.id)await put(s,item);await refresh();toast("Backup restaurado. Os registros atuais foram preservados.");}catch(err){console.error(err);toast("Não foi possível ler esse backup JSON.");}e.target.value="";};

  const fileInput=$("fileInput"),drop=$("dropzone");
  $("chooseFilesBtn").onclick=()=>fileInput.click();
  fileInput.onchange=e=>{queueFiles([...e.target.files]);fileInput.value="";};
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("drag");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("drag");}));
  drop.addEventListener("drop",e=>queueFiles([...e.dataTransfer.files]));
  function queueFiles(files){if(!files.length)return;currentFiles.push(...files);$("importQueue").innerHTML=currentFiles.map((f,i)=>`<div class="queue-item"><div><b>${escapeHTML(f.name)}</b><small>${(f.size/1024/1024).toFixed(2)} MB · ${escapeHTML(f.type||"tipo não identificado")}</small></div><span class="queue-status" id="qstatus-${i}">Na fila</span></div>`).join("")+`<div class="form-actions"><button class="secondary" id="clearQueueBtn">Limpar fila</button><button class="primary" id="processQueueBtn">Processar e salvar</button></div>`;
    $("clearQueueBtn").onclick=()=>{currentFiles=[];$("importQueue").innerHTML="";};
    $("processQueueBtn").onclick=processQueue;
  }
  async function extractPDF(file){
    if(!window.pdfjsLib)throw new Error("PDF.js não carregou. Verifique sua internet e atualize a página.");
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let out="";
    for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),content=await page.getTextContent();out+=`\n\n[Página ${p}]\n`+content.items.map(x=>x.str).join(" ");}
    return out.trim();
  }
  async function extractDOCX(file){
    if(!window.mammoth)throw new Error("Mammoth não carregou. Verifique sua internet e atualize a página.");
    const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});return result.value.trim();
  }
  async function extractImage(file){
    if(!window.Tesseract)throw new Error("Tesseract.js não carregou. Verifique sua internet e atualize a página.");
    const result=await Tesseract.recognize(file,"por+eng",{logger:m=>{}});return result.data.text.trim();
  }
  async function extractTextFile(file){
    const text=await file.text(),ext=file.name.split(".").pop().toLowerCase();
    if(ext==="html"||ext==="htm"){const doc=new DOMParser().parseFromString(text,"text/html");return doc.body.innerText||doc.documentElement.textContent;}
    if(ext==="json"){const parsed=JSON.parse(text);return JSON.stringify(parsed,null,2);}
    return text;
  }
  async function processQueue(){
    const files=[...currentFiles];if(!files.length)return;
    $("processQueueBtn").disabled=true;$("processQueueBtn").textContent="Processando…";
    for(let i=0;i<files.length;i++){
      const file=files[i],status=$("qstatus-"+i);if(status)status.textContent="Lendo…";
      try{
        const ext=file.name.split(".").pop().toLowerCase();let content="",kind="document",isMedia=false;
        if(["pdf"].includes(ext))content=await extractPDF(file);
        else if(ext==="docx")content=await extractDOCX(file);
        else if(["png","jpg","jpeg","webp","bmp"].includes(ext)){content=await extractImage(file);kind="image-ocr";}
        else if(["txt","md","json","csv","html","htm"].includes(ext))content=await extractTextFile(file);
        else if(["mp3","wav","ogg","m4a","mp4","webm","mov"].includes(ext)){isMedia=true;kind="media";content=`Arquivo de mídia anexado: ${file.name}\nTipo: ${file.type||ext}\nTamanho: ${file.size} bytes.\n\nA transcrição não foi gerada nesta versão. Adicione uma API de transcrição para converter fala em texto.`;}
        else throw new Error("Formato não suportado nesta versão.");
        const mediaId=uid();
        // Guardamos o Blob original no IndexedDB para permitir recuperação local do anexo.
        await put(STORE_M,{id:mediaId,name:file.name,type:file.type||"",size:file.size,blob:file,createdAt:now(),kind});
        const title=file.name.replace(/\.[^.]+$/,"");
        await put(STORE_K,{id:uid(),title,category:$("importCategory").value,folderId:$("importFolder").value||"",summary:`Importado de ${file.name}. ${isMedia?"Arquivo de mídia anexado; transcrição pendente.":""}`,content:content||`Arquivo ${file.name} importado sem texto extraível.`,tags:[kind,ext],agents:[],createdAt:now(),updatedAt:now(),source:"import",attachments:[mediaId]});
        if(status)status.textContent=isMedia?"Anexado · sem transcrição":"Concluído";
      }catch(err){console.error(err);if(status)status.textContent="Erro: "+err.message;}
    }
    currentFiles=[];await refresh();$("processQueueBtn")?.remove();$("clearQueueBtn")?.remove();toast("Processamento da fila finalizado.");
  }

  // Exportação compacta dos conhecimentos também pode ser consumida por outra aplicação.
  // A integração direta com o backend MinhaIA será configurada quando houver endpoint/API.
  async function init(){
    if(!("indexedDB" in window)){ $("storageStatus").textContent="IndexedDB indisponível neste navegador";toast("Seu navegador não oferece IndexedDB.");return;}
    try{db=await openDB();await seed();$("storageStatus").textContent="IndexedDB ativo · dados locais";bindNavigation();await initCloudControls();await refresh();}
    catch(err){console.error(err);$("storageStatus").textContent="Falha ao abrir banco local";toast("Erro ao iniciar o banco local.");}
  }
  init();
})();
