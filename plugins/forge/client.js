window.__ModuleLoader__.load({
  id: '@workain/dsh-forge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {Button, Input, Checkbox, Tag} = require('@deepseek-ai/dsh-client-ui-primitives');
    const {useState, useEffect, useRef} = React;
    const NS = 'workainForge';
    const en = {
      title:'GitHub and GitLab', name:'Name', type:'Type', key:'Key', workspaces:'Workspaces',
      add:'Add connection', save:'Save', remove:'Remove', cancel:'Cancel', refresh:'Reload',
      stored:'Saved — enter a new key to replace', enter:'Enter key', choose:'Choose workspaces',
      empty:'No connections configured.', loading:'Loading…', error:'Some changes may have been saved. Inspect the refreshed table before retrying; if reload failed, reload it manually.',
      confirm:'Remove this connection and its bindings?', move:'Some selected workspaces use another key. Replace their connection?',
      host:'Server address', done:'Saved.', unknown:'Unavailable workspace', all:'All current', clear:'Clear all', removeWorkspace:'Remove workspace',
      githubHint:'GitHub PAT: fine-grained or classic. Choose repository permissions for the actions you need. SSH keys do not work with REST API.',
      gitlabHint:'GitLab personal access token: read_api for reading, api for writes. SSH keys do not work with REST API.',
      tokenDocs:'How to create a token', verified:'Verified', failed:'Verification failed', unverified:'Not verified', edited:'Key changed — save to verify',
      verificationDetail:'Connected at the recorded time; repository permissions must be checked separately.', verificationWarning:'Saved, but connection verification failed. Check the token, server and access rights.',
    };
    const ru = {
      title:'GitHub и GitLab', name:'Название', type:'Тип', key:'Ключ', workspaces:'Воркспейсы',
      add:'Добавить подключение', save:'Сохранить', remove:'Удалить', cancel:'Отмена', refresh:'Обновить',
      stored:'Сохранён — введите новый для замены', enter:'Введите ключ', choose:'Выбрать воркспейсы',
      empty:'Подключения не настроены.', loading:'Загрузка…', error:'Часть изменений могла сохраниться. Проверьте обновлённую таблицу перед повтором; если загрузка не удалась, обновите её вручную.',
      confirm:'Удалить подключение и его привязки?', move:'Некоторые выбранные воркспейсы используют другой ключ. Заменить их подключение?',
      host:'Адрес сервера', done:'Сохранено.', unknown:'Недоступный воркспейс', all:'Все текущие', clear:'Снять все', removeWorkspace:'Убрать воркспейс',
      githubHint:'GitHub PAT: fine-grained или classic. Выберите права репозитория под нужные операции. SSH-ключи не подходят для REST API.',
      gitlabHint:'Персональный токен GitLab: read_api для чтения, api для записи. SSH-ключи не подходят для REST API.',
      tokenDocs:'Как создать токен', verified:'Верифицировано', failed:'Проверка не пройдена', unverified:'Не проверено', edited:'Ключ изменён — сохраните для проверки',
      verificationDetail:'Подключение проверено в указанное время; права на репозитории проверяются отдельно.', verificationWarning:'Сохранено, но подключиться не удалось. Проверьте токен, сервер и права доступа.',
    };
    const styles = `
.workain-forge-settings{padding:20px;max-width:1100px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.workain-forge-settings .forge-toolbar,.workain-forge-settings .forge-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.workain-forge-settings .forge-toolbar{justify-content:space-between;margin-bottom:16px}
.workain-forge-settings h2{font-size:18px;line-height:1.4;font-weight:500;margin:0}
.workain-forge-settings .forge-table-wrap{overflow:auto;border-radius:12px;border:.5px solid var(--dsw-alias-border-l2)}
.workain-forge-settings table{width:100%;min-width:700px;border-collapse:collapse;table-layout:fixed;background:var(--dsw-alias-bg-layer-1)}
.workain-forge-settings th,.workain-forge-settings td{padding:14px 12px;vertical-align:top;text-align:left;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.workain-forge-settings th{font-weight:500;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.workain-forge-settings th:nth-child(1){width:20%}.workain-forge-settings th:nth-child(2){width:17%}.workain-forge-settings th:nth-child(3){width:29%}
.workain-forge-settings tbody tr:last-child td{border-bottom:0}
.workain-forge-settings input:not([type=checkbox]),.workain-forge-settings select{width:100%;min-width:0;box-sizing:border-box}
.workain-forge-settings select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;height:36px}
.workain-forge-settings .forge-actions{margin-top:10px}.workain-forge-settings .forge-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:8px 0;line-height:1.5}
.workain-forge-settings .forge-hint a{color:var(--dsw-alias-link)}
.workain-forge-settings .forge-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.workain-forge-settings .forge-chip{display:inline-flex;align-items:center;max-width:100%;gap:2px;background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;padding:2px 6px}
.workain-forge-settings .forge-chip-label{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.workain-forge-settings .forge-chip button{min-width:20px;padding:0;height:22px}
.workain-forge-settings details{margin-top:8px}.workain-forge-settings summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.workain-forge-settings .forge-picker{max-height:200px;overflow:auto;padding:8px 0}
.workain-forge-settings .forge-option{display:flex;align-items:center;gap:8px;margin-top:8px;overflow-wrap:anywhere}
.workain-forge-settings .forge-status{min-height:24px;margin-bottom:8px;color:var(--dsw-alias-label-secondary)}
`;
    function Row({connection, state, busy, perform, t, newRow, close}) {
      const initial = () => Object.entries(state.workspaceBindings).filter(([,id])=>id===connection.id).map(([id])=>id);
      const [name,setName] = useState(connection.name), [provider,setProvider] = useState(connection.provider);
      const [host,setHost] = useState(connection.host), [token,setToken] = useState(''), [selected,setSelected] = useState(initial);
      const [dirty,setDirty] = useState(newRow);
      useEffect(()=>{
        if(!dirty){setName(connection.name);setProvider(connection.provider);setHost(connection.host);setSelected(initial());}
      },[connection,state.workspaceBindings,dirty]);
      const workspaces = [...state.workspaces];
      for (const id of selected) if(!workspaces.some(w=>w.id===id)) workspaces.push({id,title:t('unknown')});
      const edit = setter => event => {setter(event.target.value);setDirty(true);};
      const save = async () => {
        const current = state.workspaceBindings;
        if(selected.some(id=>current[id]&&current[id]!==connection.id)&&!window.confirm(t('move')))return;
        const secret=token;setToken('');
        const saved = await perform(async post => {
          await post({action:'save',connection:{id:connection.id,name,provider,host},...(secret?{token:secret}:{})});
          for(const id of initial()) if(!selected.includes(id)) await post({action:'unbindWorkspace',workspaceId:id});
          for(const id of selected) if(current[id]!==connection.id) await post({action:'bindWorkspace',workspaceId:id,connectionId:connection.id});
        });
        if(saved){setDirty(false);if(newRow)close();}
      };
      const status = token ? 'unverified' : (connection.verification?.state ?? 'unverified');
      const label = token ? t('edited') : t(status === 'verified' ? 'verified' : status === 'failed' ? 'failed' : 'unverified');
      const docs = provider === 'github' ? 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' : 'https://docs.gitlab.com/user/profile/personal_access_tokens/';
      const chooseAll = () => {setSelected(state.workspaces.map(w=>w.id));setDirty(true);};
      return h('tr',null,
        h('td',null,h(Input,{'aria-label':t('name'),value:name,required:true,maxLength:120,disabled:busy,onChange:edit(setName)}),
          h('div',{className:'forge-actions'},
            h(Button,{size:'sm',variant:'primary',type:'button',disabled:busy||!dirty||!name.trim()||(newRow&&!token.trim()),onClick:save},t('save')),
            newRow?h(Button,{size:'sm',type:'button',disabled:busy,onClick:close},t('cancel')):
              h(Button,{size:'sm',type:'button',disabled:busy,onClick:()=>{if(window.confirm(t('confirm')))perform(post=>post({action:'remove',id:connection.id}));}},t('remove')))),
        h('td',null,h('select',{'aria-label':t('type'),value:provider,disabled:busy||!newRow,onChange:event=>{setProvider(event.target.value);setHost(event.target.value==='github'?'https://github.com':'https://gitlab.com');setDirty(true);}},
          h('option',{value:'github'},'GitHub'),h('option',{value:'gitlab'},'GitLab')),
          h('details',null,h('summary',null,t('host')),h(Input,{'aria-label':t('host'),value:host,disabled:busy||!newRow,onChange:edit(setHost)}))),
        h('td',null,h(Input,{'aria-label':t('key'),type:'password',value:token,autoComplete:'new-password',spellCheck:false,
          placeholder:newRow?t('enter'):t('stored'),disabled:busy,onChange:edit(setToken)}),
          h('p',{className:'forge-hint'},t(provider==='github'?'githubHint':'gitlabHint'),' ',h('a',{href:docs,target:'_blank',rel:'noopener noreferrer'},t('tokenDocs'))),
          h('span',{title:[t('verificationDetail'),connection.verification?.checkedAt].filter(Boolean).join(' ')},h(Tag,{tone:status==='verified'?'success':status==='failed'?'warning':'neutral'},label)),
          status==='verified'&&connection.verification?.login?h('div',{className:'forge-hint'},connection.verification.login):null),
        h('td',null,h('div',{className:'forge-chips'},...selected.map(id=>{const title=workspaces.find(w=>w.id===id)?.title||id;return h('span',{key:id,className:'forge-chip'},h('span',{className:'forge-chip-label',title},title),h(Button,{size:'sm',type:'button','aria-label':t('removeWorkspace')+': '+title,disabled:busy,onClick:()=>{setSelected(selected.filter(item=>item!==id));setDirty(true);}},'×'));})),
          h('details',null,h('summary',null,t('choose')),
            h('div',{className:'forge-actions'},h(Button,{size:'sm',type:'button',disabled:busy,onClick:chooseAll},t('all')),h(Button,{size:'sm',type:'button',disabled:busy,onClick:()=>{setSelected([]);setDirty(true);}},t('clear'))),
            h('div',{className:'forge-picker'},...workspaces.map(workspace=>h(Checkbox,{key:workspace.id,className:'forge-option',label:workspace.title||workspace.id,
              checked:selected.includes(workspace.id),disabled:busy,onChange:checked=>{setSelected(checked?[...selected,workspace.id]:selected.filter(id=>id!==workspace.id));setDirty(true);}}))))),
      );
    }

    function Settings({t}) {
      const [state,setState] = useState(null), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
      const [draft,setDraft] = useState(null);
      const lifetime = useRef(null), flight = useRef(false);
      async function request(input, signal) {
        const response = await fetch(input?'/api/workain-forge.mutate':'/api/workain-forge',{credentials:'same-origin',cache:'no-store',signal,
          ...(input?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}:{})});
        if(!response.ok)throw new Error('settings request failed');
        return response.json();
      }
      async function perform(operation) {
        const controller=lifetime.current;
        if(!controller||controller.signal.aborted||flight.current)return;
        flight.current=true;setBusy(true);setMessage('');
        try {
          let warning=false;
          if(operation) await operation(async input=>{const value=await request(input,controller.signal);if(value.warning==='verification-failed')warning=true;return value;});
          const result=await request(undefined,controller.signal);
          if(controller.signal.aborted)return;
          setState(result);if(operation)setMessage(t(warning?'verificationWarning':'done'));return true;
        } catch {
          if(!controller.signal.aborted){
            try {
              const result=await request(undefined,controller.signal);
              if(!controller.signal.aborted){setState(result);setDraft(current=>current&&result.connections.some(connection=>connection.id===current.id)?null:current);}
            } catch (error) { void error; /* Keep the error visible when readback is unavailable; never retry the write. */ }
            if(!controller.signal.aborted)setMessage(t('error'));
          }
        }
        finally {flight.current=false;if(!controller.signal.aborted)setBusy(false);}
      }
      useEffect(()=>{const controller=new AbortController();lifetime.current=controller;perform();return()=>{controller.abort();lifetime.current=null;};},[]);
      return h('section',{className:'workain-forge-settings'},h('style',null,styles),
        h('div',{className:'forge-toolbar'},h('h2',null,t('title')),
          h('div',{className:'forge-actions'},h(Button,{variant:'primary',size:'sm',type:'button',disabled:busy||!state||!!draft,onClick:()=>setDraft({id:'connection-'+window.crypto.randomUUID(),name:'',provider:'github',host:'https://github.com'})},t('add')),
            h(Button,{size:'sm',type:'button',disabled:busy,onClick:()=>perform()},t('refresh')))),
        h('div',{role:'status',className:'forge-status'},busy?t('loading'):message),
        h('div',{className:'forge-table-wrap'},h('table',null,
          h('thead',null,h('tr',null,...['name','type','key','workspaces'].map(key=>h('th',{key,scope:'col'},t(key))))),
          h('tbody',null,...(state?.connections??[]).map(connection=>h(Row,{key:connection.id,connection,state,busy,perform,t})),
            draft?h(Row,{key:draft.id,connection:draft,state,busy,perform,t,newRow:true,close:()=>setDraft(null)}):null,
            state&&!state.connections.length&&!draft?h('tr',null,h('td',{colSpan:4},t('empty'))):null))),
      );
    }

    return {inject:['slots','locale'],apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,{en,ru,zh:en}));
      const t=ctx.locale.bind(NS);
      ctx.effect(()=>ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'workain-forge',order:75,label:()=>t('title'),locale:NS,inject:()=>({t})},Settings)));
    }};
  },
});
