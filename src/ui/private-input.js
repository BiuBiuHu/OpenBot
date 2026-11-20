// This module never puts values in chat, localStorage, URLs or tool messages.
export async function sealPrivateInput(challenge, values, publicValues) {
  if(publicValues && !Object.keys(publicValues).length)publicValues=undefined;
  const encode = value => new TextEncoder().encode(value);
  const base64 = buffer => { let out='';for(const byte of new Uint8Array(buffer))out+=String.fromCharCode(byte);return btoa(out); };
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const publicKey = await crypto.subtle.importKey('jwk',challenge.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = JSON.stringify({id:challenge.id,taskId:challenge.taskId,requestId:challenge.requestId,origin:challenge.origin,expiresAt:challenge.expiresAt,...(publicValues?{publicValues:Object.fromEntries(Object.entries(publicValues).sort(([a],[b])=>a.localeCompare(b)))}:{})});
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encode(aad)},key,encode(JSON.stringify(values)));
  const wrappedKey = await crypto.subtle.encrypt('RSA-OAEP',publicKey,await crypto.subtle.exportKey('raw',key));
  return {challengeId:challenge.id,wrappedKey:base64(wrappedKey),iv:base64(iv),ciphertext:base64(ciphertext),...(publicValues?{publicValues}:{})};
}

const icons = {
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M10.5 5.1C18.5 5.2 22 12 22 12a20 20 0 0 1-3 4M6 6C3.5 8 2 12 2 12s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
  hand: '<path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 4-2 7-6 7h-2c-2 0-3-1-4-3l-4-5a2 2 0 0 1 3-2l1 1Z"/>',
};
function icon(name) {
  const node=document.createElement('span');node.className='hi-icon';node.setAttribute('aria-hidden','true');
  node.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;return node;
}
function element(tag,className,text) {const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;}
function interactionStyles() {
  if(document.getElementById('private-interaction-styles'))return;
  const style=document.createElement('style');style.id='private-interaction-styles';style.textContent=`
    .human-interaction{width:460px;max-width:100%;box-sizing:border-box;margin-top:12px;padding:24px;border:1px solid #394735;border-radius:16px;background:#141c15;color:#e7eedc;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 28px #0002}
    .human-interaction *{box-sizing:border-box}.human-interaction p{margin:0}.human-interaction .hi-header{display:flex;gap:12px;align-items:center;margin-bottom:14px}
    .human-interaction .hi-emblem{display:grid;place-items:center;width:40px;height:40px;flex:none;border:1px solid #425439;border-radius:12px;background:#253323;color:#c3e990}
    .human-interaction .hi-icon{display:inline-flex;width:20px;height:20px;flex:none}.human-interaction svg{width:100%;height:100%}
    .human-interaction .hi-eyebrow{font-size:11px;letter-spacing:.06em;color:#b4c3a7}.human-interaction .hi-title{margin:0;font-size:18px;font-weight:650;line-height:1.5;color:#f0f5e9}
    .human-interaction .hi-reason{color:#bac5b0;font-size:13px;overflow-wrap:anywhere;margin-bottom:18px}
    .human-interaction .hi-site{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;padding:10px 12px;margin-bottom:20px;border:1px solid #303e2d;border-radius:9px;background:#1b251a}
    .human-interaction .hi-site-label{color:#aab69f;font-size:12px}.human-interaction .hi-origin{font-size:13px;font-weight:550;overflow-wrap:anywhere;color:#e1ebd7}
    .human-interaction .hi-field{margin-bottom:17px;min-width:0}.human-interaction .hi-label-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:7px}
    .human-interaction label{font-size:13px;font-weight:550;color:#e4ebdb}.human-interaction .hi-badge{color:#bdd6a6;font-size:11px;display:flex;align-items:center;gap:4px}.human-interaction .hi-badge .hi-icon{width:12px;height:12px}
    .human-interaction .hi-input-wrap{position:relative}.human-interaction input{display:block;width:100%;height:48px;min-width:0;margin:0;border:1px solid #4a5843;border-radius:9px;background:#0e150f;color:#edf3e6;padding:11px 13px;font:16px/1.5 system-ui;outline:none;transition:border-color .15s,box-shadow .15s}
    .human-interaction input.hi-secret{padding-right:85px}.human-interaction input::placeholder{color:#788772}.human-interaction input:focus{border-color:#b6e36a;box-shadow:0 0 0 3px #b6e36a22}.human-interaction input[aria-invalid="true"]{border-color:#e79a86}.human-interaction input:disabled{opacity:.65}
    .human-interaction button{font:500 13px/1.5 system-ui;cursor:pointer;min-height:44px;margin:0;border-radius:8px;padding:10px 14px;transition:background .15s,color .15s}
    .human-interaction button:focus-visible{outline:2px solid #c2ed84;outline-offset:3px}.human-interaction button:disabled{cursor:wait;opacity:.65}
    .human-interaction .hi-toggle{position:absolute;right:2px;top:2px;min-height:44px;height:44px;display:flex;align-items:center;gap:5px;padding:0 9px;border:0;background:transparent;color:#b9c8ad}.human-interaction .hi-toggle:hover{background:#243221;color:#ebf5df}.human-interaction .hi-toggle .hi-icon{width:17px;height:17px}
    .human-interaction .hi-field-error{margin-top:5px;color:#f0ac97;font-size:12px}.human-interaction [hidden]{display:none!important}
    .human-interaction .hi-note{display:flex;align-items:flex-start;gap:7px;font-size:12px;line-height:1.65;color:#aebda2;margin:3px 0 18px}.human-interaction .hi-note .hi-icon{width:15px;height:15px;margin-top:2px}
    .human-interaction .hi-primary{width:100%;min-height:48px;border:1px solid #bedf89;background:#b6e36a;color:#192411;font-size:14px;font-weight:650;display:flex;justify-content:center;align-items:center;gap:8px}.human-interaction .hi-primary:hover:not(:disabled){background:#c6ed88}
    .human-interaction .hi-footer{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 4px;margin-top:12px;color:#a3b096;font-size:12px}.human-interaction .hi-secondary{background:transparent;border:0;color:#c2d3b1;padding:8px;min-height:40px}.human-interaction .hi-secondary:hover{background:#253322;color:#ecf5e2}
    .human-interaction .hi-status{margin-top:12px;padding:10px 12px;border-radius:8px;background:#202d1c;color:#c9dfb8;font-size:13px;overflow-wrap:anywhere}.human-interaction .hi-status[data-tone="error"]{background:#32231e;color:#f0b3a0}.human-interaction .hi-status[data-tone="warning"]{background:#302b1b;color:#e9d399}
    .human-interaction .hi-spinner{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:hi-spin .8s linear infinite}.human-interaction .hi-takeover-hint{font-size:13px;color:#b6c5a9;margin:0 0 20px}
    @keyframes hi-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.human-interaction *{transition:none!important}.human-interaction .hi-spinner{animation:none;border-style:dotted}}
    @media(max-width:480px){.human-interaction{padding:18px 16px;border-radius:12px}.human-interaction .hi-title{font-size:17px}.human-interaction .hi-site{display:block}.human-interaction .hi-origin{display:block;margin-top:3px}}
  `;document.head.append(style);
}

export function renderInteraction({task,container,api,refresh}) {
  const i=task.interaction;if(!i||i.state==='completed')return;
  interactionStyles();
  const privateInput=i.kind==='private_input';
  const panel=element('section','human-interaction');panel.setAttribute('role','region');panel.setAttribute('aria-label',privateInput?'填写登录与私密信息':'需要你接管');
  const header=element('div','hi-header'),emblem=element('span','hi-emblem');emblem.append(icon(privateInput?'lock':'hand'));
  const titles=element('div','hi-titles');titles.append(element('p','hi-eyebrow','等待你的协助'),element('h3','hi-title',privateInput?'填写信息，继续任务':'请接管远端页面'));header.append(emblem,titles);
  panel.append(header,element('p','hi-reason',i.reason));container.append(panel);
  document.title='需要你协助 · OpenBot';
  const route=`tasks/${task.id}/interactions/${i.id}`;
  const status=element('p','hi-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
  const message=(text,tone='info')=>{status.hidden=!text;status.textContent=text;status.dataset.tone=tone;};
  let busy=false,uncertain=false,finished=false;
  const setBusy=(value)=>{busy=value;panel.setAttribute('aria-busy',String(value));for(const control of panel.querySelectorAll('input,button'))control.disabled=value;};
  const primary=element('button','hi-primary');primary.type='button';
  const progress=(text)=>{primary.replaceChildren();const spinner=element('span','hi-spinner');spinner.setAttribute('aria-hidden','true');primary.append(spinner,document.createTextNode(text));};
  const check=element('button','hi-secondary','核对任务状态');check.type='button';check.hidden=true;
  check.onclick=async()=>{if(busy)return;setBusy(true);try{await refresh();message('请查看远端页面与任务状态；确认结果前不要重复填写。','warning');}catch{message('暂时无法连接，请稍后核对任务状态。','warning');}finally{setBusy(false);if(uncertain)primary.disabled=true;}};
  const footer=element('div','hi-footer');
  const manual=element('button','hi-secondary','手动接管');manual.type='button';
  let clearSecrets=()=>{};
  manual.onclick=async()=>{
    if(busy||finished)return;clearSecrets();setBusy(true);message('正在切换为手动接管…');
    try{await api(route+'/takeover','POST',{});message('已交给你操作，请在远端页面完成后继续。');await refresh();}
    catch{message('接管状态尚未确认，请先核对任务状态。','warning');check.hidden=false;}
    finally{setBusy(false);if(uncertain)primary.disabled=true;}
  };
  if(privateInput && i.origin){const target=element('div','hi-site');target.append(element('span','hi-site-label','填写到此网站'),element('span','hi-origin',i.origin));panel.append(target);}
  if(i.state==='applying'){
    uncertain=true;message('信息已送达，填写结果尚未确认。请检查远端页面，避免重复提交。','warning');check.hidden=false;footer.append(check,manual);panel.append(status,footer);return;
  }
  if(!privateInput){
    panel.append(element('p','hi-takeover-hint','请在远端电脑中完成所需操作。你操作期间，Agent 会等待，不会抢回控制。'));
    primary.textContent='我已完成，继续任务';
    primary.onclick=async()=>{if(busy||uncertain||finished)return;setBusy(true);progress('正在恢复任务…');message('正在通知 Agent 继续。');try{await api(route+'/complete','POST',{});finished=true;busy=false;panel.setAttribute('aria-busy','false');primary.textContent='已继续';message('Agent 已恢复执行。');try{await refresh();}catch{message('任务已继续，状态暂时无法刷新。');}}catch{uncertain=true;primary.textContent='等待核对';check.hidden=false;message('恢复结果尚未确认，请先核对任务状态。','warning');setBusy(false);primary.disabled=true;}};
    panel.append(primary,status,check);return;
  }
  const form=element('form','hi-form');form.autocomplete='off';form.noValidate=true;
  const fields=[];
  for(const field of i.fields||[]){
    const secret=field.sensitive!==false,group=element('div','hi-field'),row=element('div','hi-label-row');
    const input=element('input',secret?'hi-secret':'hi-public');input.id=`private-${i.id}-${field.id}`;input.type=secret?'password':'text';input.autocomplete='off';input.required=true;input.maxLength=4096;input.spellcheck=false;input.setAttribute('autocapitalize','none');input.setAttribute('aria-label',field.label);input.dataset.privateInput=String(secret);
    const label=element('label','',field.label);label.htmlFor=input.id;row.append(label);
    if(secret){const badge=element('span','hi-badge');badge.append(icon('lock'),document.createTextNode('加密提交'));row.append(badge);}
    const wrap=element('div','hi-input-wrap');wrap.append(input);
    const error=element('p','hi-field-error','请填写'+field.label);error.id=input.id+'-error';error.hidden=true;input.setAttribute('aria-describedby',error.id);
    const setInvalid=value=>{input.setAttribute('aria-invalid',String(value));error.hidden=!value;};input.oninput=()=>{if(input.value.length)setInvalid(false);};
    let hide=()=>{};
    if(secret){const toggle=element('button','hi-toggle');toggle.type='button';toggle.setAttribute('aria-controls',input.id);
      const show=value=>{input.type=value?'text':'password';toggle.replaceChildren(icon(value?'hidden':'eye'),document.createTextNode(value?'隐藏':'显示'));toggle.setAttribute('aria-label',(value?'隐藏':'显示')+field.label);toggle.setAttribute('aria-pressed',String(value));};hide=()=>show(false);hide();toggle.onclick=()=>show(input.type==='password');wrap.append(toggle);
    }
    group.append(row,wrap,error);form.append(group);fields.push({field,input,secret,hide,setInvalid});
  }
  clearSecrets=()=>{for(const f of fields)if(f.secret){f.input.value='';f.hide();}};
  const clearAll=()=>{for(const f of fields){f.input.value='';f.hide();}};
  const note=element('p','hi-note');note.append(icon('lock'),document.createTextNode('密码仅用于远端填写，不会发送给模型。账号以普通信息提交。'));
  primary.type='submit';primary.textContent='填写并继续';form.append(note,primary,status);
  footer.append(element('span','','想自己操作？'),manual,check);form.append(footer);panel.append(form);
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||uncertain||finished)return;
    const invalid=fields.filter(f=>!f.input.value.length);for(const f of fields)f.setInvalid(!f.input.value.length);
    if(invalid.length){invalid[0].input.focus();return;}
    const values=Object.fromEntries(fields.map(f=>[f.field.id,f.input.value]));let dispatched=false;
    setBusy(true);message('正在保护密码并准备填写。');progress('正在加密…');
    try{
      const {challenge}=await api(route+'/challenge','POST',{});const publicValues={},secrets={};
      for(const f of fields)(f.secret?secrets:publicValues)[f.field.id]=values[f.field.id];
      const envelope=await sealPrivateInput(challenge,secrets,publicValues);for(const key of Object.keys(secrets))secrets[key]='';clearSecrets();
      progress('正在填写…');message('正在将信息填写到远端页面，请稍候。');dispatched=true;
      await api(route+'/fill','POST',{envelope});clearAll();finished=true;busy=false;panel.setAttribute('aria-busy','false');primary.textContent='已填写，正在继续';message('信息已填写，Agent 正在继续任务。');try{await refresh();}catch{message('信息已填写，任务状态暂时无法刷新。');}
    }catch(error){
      clearSecrets();setBusy(false);
      if(dispatched||error.status===409){uncertain=true;primary.textContent='等待核对填写结果';primary.disabled=true;check.hidden=false;message('填写结果尚未确认。请检查远端页面，避免重复提交。','warning');}
      else{primary.textContent='重新填写并继续';message('暂未提交成功。账号已保留，请重新填写密码后重试。','error');const first=fields.find(f=>f.secret);first?.input.focus();}
      // Observe only: an unknown fill outcome must never trigger an automatic retry.
      try{await refresh();}catch{}
    }finally{for(const key of Object.keys(values))values[key]='';}
  };
}
