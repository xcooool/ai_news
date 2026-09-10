const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mount=document.createElement('div');mount.id='aiChat';
mount.innerHTML=`<button id="chatLaunch" class="chat-launch" aria-label="打开智能研究助手">✦ 问问 AI</button><section id="chatPanel" class="chat-panel" aria-label="智能研究助手" hidden><header><div><strong>智能研究助手</strong><small>基于当前数据库与已保存调研 · 回答附来源</small></div><button id="chatClose" aria-label="关闭聊天">×</button></header><div id="chatContext" class="chat-context" hidden></div><div id="chatMessages" class="chat-messages" role="log" aria-live="polite"></div><div class="chat-suggestions"><button data-question="请全面分析当前数据源的覆盖、偏差与证据缺口，并指出值得进一步调研的项目。">分析全部数据源</button><button id="chatFocusQuestion" type="button" hidden>这个项目有潜力吗？</button></div><form id="chatForm"><label for="chatInput" class="chat-input-label">向研究助手提问</label><textarea id="chatInput" rows="3" maxlength="4000" placeholder="例如：为什么 Rollstack 有潜力？有哪些证据和风险？" required></textarea><div class="chat-controls"><button type="button" id="chatClear">清空对话</button><button type="button" id="chatStop" hidden>停止</button><button id="chatSend" type="submit">发送</button></div><p id="chatStatus" role="status"></p></form></section>`;
document.body.append(mount);const $=s=>mount.querySelector(s);
let history=[],controller=null,activeProject=null;
try{history=JSON.parse(sessionStorage.getItem('research-chat')||'[]');if(!Array.isArray(history))history=[];history=history.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-20);}catch{}
function paint(){
 $('#chatMessages').innerHTML=history.length?history.map(m=>`<article class="chat-message ${m.role}"><b>${m.role==='user'?'你':'研究助手'}</b><div class="chat-answer">${esc(m.content).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}</div>${m.coverage?`<small>项目索引 ${m.coverage.indexedProjects}/${m.coverage.totalProjects} · 详细材料 ${m.coverage.detailedProjects} 个项目${m.coverage.indexTruncated?' · 索引已截断':''} · 数据截至 ${esc(m.asOf||'未记录')}</small>`:''}${m.sources?.length?`<details><summary>引用来源 · ${m.sources.length}</summary>${m.sources.map(s=>{try{const u=new URL(s.url);if(!['http:','https:'].includes(u.protocol))return '';return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">[${esc(s.id)}] ${esc(s.title)}</a>`;}catch{return '';}}).join('')}</details>`:''}</article>`).join(''):'<div class="chat-welcome"><h3>从资料到判断</h3><p>可以分析全部数据源、比较项目，或在问题里直接写公司名追问依据。</p><p>没有证据的指标会明确标注；聊天本身不会发起新的外部调研。</p></div>';
 $('#chatMessages').scrollTop=$('#chatMessages').scrollHeight;
 try{sessionStorage.setItem('research-chat',JSON.stringify(history.slice(-20)));}catch{}
}
function paintContext(){
 const el=$('#chatContext');
 if(!activeProject){el.hidden=true;el.innerHTML='';$('#chatFocusQuestion').hidden=true;return;}
 el.hidden=false;
 el.innerHTML=`<p class="chat-focus"><span>当前项目：<strong>${esc(activeProject.name)}</strong></span><button type="button" id="chatClearFocus">改问全部</button></p>`;
 $('#chatClearFocus').onclick=()=>{activeProject=null;paintContext();};
 $('#chatFocusQuestion').hidden=false;
}
function open(project){
 $('#chatPanel').hidden=false;$('#chatLaunch').hidden=true;
 activeProject=project?.id?{id:project.id,name:project.name||'该项目'}:null;
 paintContext();
 if(activeProject)$('#chatInput').value=`请全面分析 ${activeProject.name} 为什么可能有潜力。列出来源、支持证据、反证和关键缺口。`;
 $('#chatInput').focus();
}
$('#chatLaunch').onclick=()=>open();
$('#chatClose').onclick=()=>{$('#chatPanel').hidden=true;$('#chatLaunch').hidden=false;$('#chatLaunch').focus();};
window.addEventListener('ask-project-ai',e=>open(e.detail));
$('#chatClear').onclick=()=>{if(controller)return;history=[];paint();$('#chatStatus').textContent='';};
$('#chatStop').onclick=()=>controller?.abort();
mount.querySelector('[data-question]').onclick=()=>{$('#chatInput').value=mount.querySelector('[data-question]').dataset.question;$('#chatInput').focus();};
$('#chatFocusQuestion').onclick=()=>{if(!activeProject)return;$('#chatInput').value=`请分析 ${activeProject.name} 为什么可能有潜力，分别列出支持证据、反证和待核验信息。`;$('#chatInput').focus();};
$('#chatInput').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#chatForm').requestSubmit();}};
$('#chatForm').onsubmit=async e=>{
 e.preventDefault();if(controller)return;const message=$('#chatInput').value.trim();if(!message)return;
 const previous=history.slice(-8).map(({role,content})=>({role,content}));const projectId=activeProject?.id||'';
 history.push({role:'user',content:message});paint();$('#chatInput').value='';
 controller=new AbortController();$('#chatSend').disabled=true;$('#chatClear').disabled=true;$('#chatStop').hidden=false;$('#chatStatus').textContent='正在读取当前数据与相关报告，生成有依据的回答…';
 try{const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,history:previous,projectId}),signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error||response.status);history.push({role:'assistant',content:result.answer,sources:result.sources,coverage:result.coverage,asOf:result.asOf});history=history.slice(-20);paint();$('#chatStatus').textContent='回答完成，可继续追问。';}
 catch(error){$('#chatStatus').textContent=error.name==='AbortError'?'已停止，可修改问题后重试。':`回答失败：${error.message}。问题已保留，可重新发送。`;$('#chatInput').value=message;}
 finally{controller=null;$('#chatSend').disabled=false;$('#chatClear').disabled=false;$('#chatStop').hidden=true;}
};
paint();
