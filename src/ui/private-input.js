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
export function renderInteraction({task,container,api,refresh}) {
  const i=task.interaction;if(!i||i.state==='completed')return;
  const panel=document.createElement('section');panel.className='human-interaction';panel.setAttribute('role','region');panel.setAttribute('aria-label','需要你协助');
  const heading=document.createElement('strong');heading.textContent='需要你协助';
  const reason=document.createElement('p');reason.textContent=i.reason;
  const status=document.createElement('p');status.setAttribute('role','status');
  panel.append(heading,reason);container.append(panel);
  document.title='需要你协助 · OpenBot';
  const route=`tasks/${task.id}/interactions/${i.id}`;
  if(i.kind==='private_input'){const manual=document.createElement('button');manual.type='button';manual.textContent='改为手动接管';manual.onclick=async()=>{manual.disabled=true;for(const input of panel.querySelectorAll('input'))input.value='';try{await api(route+'/takeover','POST',{});await refresh();}catch{status.textContent='接管请求未完成，请检查连接。';}finally{manual.disabled=false;}};panel.append(manual);}
  if(i.state==='applying') {status.textContent='输入已送达，结果尚不确定。请检查远端页面，勿重复填写。';panel.append(status);return;}
  const button=document.createElement('button');button.type='button';
  if(i.kind==='private_input') {
    const target=document.createElement('p');target.textContent=`私密输入将发送到：${i.origin}`;panel.append(target);
    const form=document.createElement('form');form.autocomplete='off';
    const inputs=[];
    const controls=[];
    for(const field of i.fields||[]){
      const secret=field.sensitive!==false;
      const label=document.createElement('label');label.textContent=field.label;label.style.display='block';
      const input=document.createElement('input');input.type=secret?'password':'text';input.autocomplete='off';input.required=true;input.maxLength=4096;input.setAttribute('aria-label',field.label);input.dataset.privateInput=String(secret);input.style.display='block';label.append(input);form.append(label);inputs.push([field.id,input]);
      if(secret){
        const toggle=document.createElement('button');toggle.type='button';
        const hide=()=>{input.type='password';toggle.textContent='显示';toggle.setAttribute('aria-label','显示'+field.label);toggle.setAttribute('aria-pressed','false');};hide();
        toggle.onclick=()=>{const reveal=input.type==='password';input.type=reveal?'text':'password';toggle.textContent=reveal?'隐藏':'显示';toggle.setAttribute('aria-label',(reveal?'隐藏':'显示')+field.label);toggle.setAttribute('aria-pressed',String(reveal));};
        form.append(toggle);controls.push(hide);
      }
    }
    const hint=document.createElement('p');hint.textContent='账号等普通信息明文提交，密码等私密信息加密传输。';form.append(hint);
    const clear=()=>{for(const [,input]of inputs)input.value='';for(const hide of controls)hide();};
    button.type='submit';button.textContent='填写并继续';form.append(button,status);panel.append(form);
    form.onsubmit=async event=>{
      event.preventDefault();button.disabled=true;const values=Object.fromEntries(inputs.map(([id,input])=>[id,input.value]));
      try{const {challenge}=await api(route+'/challenge','POST',{});const publicValues={},secrets={};for(const field of i.fields||[])(field.sensitive===false?publicValues:secrets)[field.id]=values[field.id];const envelope=await sealPrivateInput(challenge,secrets,publicValues);for(const key of Object.keys(secrets))secrets[key]='';clear();for(const key of Object.keys(values))values[key]='';status.textContent='正在安全填写…';await api(route+'/fill','POST',{envelope});await refresh();}
      catch(error){clear();for(const key of Object.keys(values))values[key]='';status.textContent=error.status===409?'请求已变化或结果待核对，请检查远端页面。':'暂未完成，请查看连接状态后重试。';await refresh();}
      finally{button.disabled=false;}
    };
  } else {
    const hint=document.createElement('p');hint.textContent='请在右侧远端电脑中完成所需操作，然后点击继续。等待期间 Agent 不会操作页面。';panel.append(hint);
    button.textContent='我已完成，继续任务';button.onclick=async()=>{button.disabled=true;try{await api(route+'/complete','POST',{});await refresh();}catch{status.textContent='恢复结果尚不确定，请核对连接状态。';}finally{button.disabled=false;}};panel.append(button,status);
  }
}
