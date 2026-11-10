window.__ModuleLoader__.load({
  id: '@workain/dsh-forge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {useState, useEffect, useRef} = React;
    const NS = 'workainForge';
    const en = {
      title:'GitHub and GitLab', name:'Name', type:'Type', key:'Key', workspaces:'Workspaces',
      add:'Add connection', save:'Save', remove:'Remove', cancel:'Cancel', refresh:'Reload',
      stored:'Saved — enter a new key to replace', enter:'Enter key', choose:'Choose workspaces',
      empty:'No connections configured.', loading:'Loading…', error:'Some changes may have been saved. Inspect the refreshed table before retrying; if reload failed, reload it manually.',
      confirm:'Remove this connection and its bindings?', move:'Some selected workspaces use another key. Replace their connection?',
      host:'Server address', done:'Saved.', unknown:'Unavailable workspace',
    };
    const ru = {
      title:'GitHub и GitLab', name:'Название', type:'Тип', key:'Ключ', workspaces:'Воркспейсы',
      add:'Добавить подключение', save:'Сохранить', remove:'Удалить', cancel:'Отмена', refresh:'Обновить',
      stored:'Сохранён — введите новый для замены', enter:'Введите ключ', choose:'Выбрать воркспейсы',
      empty:'Подключения не настроены.', loading:'Загрузка…', error:'Часть изменений могла сохраниться. Проверьте обновлённую таблицу перед повтором; если загрузка не удалась, обновите её вручную.',
      confirm:'Удалить подключение и его привязки?', move:'Некоторые выбранные воркспейсы используют другой ключ. Заменить их подключение?',
      host:'Адрес сервера', done:'Сохранено.', unknown:'Недоступный воркспейс',
    };
    const cell = {padding:'10px 8px',verticalAlign:'top',textAlign:'left',borderBottom:'1px solid #8883'};
    const control = {width:'100%',minWidth:0,boxSizing:'border-box'};
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
      return h('tr',null,
        h('td',{style:cell},h('input',{'aria-label':t('name'),value:name,required:true,maxLength:120,style:control,disabled:busy,onChange:edit(setName)}),
          h('div',{style:{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}},
            h('button',{type:'button',disabled:busy||!dirty||!name.trim()||(newRow&&!token.trim()),onClick:save},t('save')),
            newRow?h('button',{type:'button',disabled:busy,onClick:close},t('cancel')):
              h('button',{type:'button',disabled:busy,onClick:()=>{if(window.confirm(t('confirm')))perform(post=>post({action:'remove',id:connection.id}));}},t('remove')))),
        h('td',{style:cell},h('select',{'aria-label':t('type'),value:provider,style:control,disabled:busy||!newRow,onChange:event=>{setProvider(event.target.value);setHost(event.target.value==='github'?'https://github.com':'https://gitlab.com');setDirty(true);}},
          h('option',{value:'github'},'GitHub'),h('option',{value:'gitlab'},'GitLab')),
          h('details',{style:{marginTop:8}},h('summary',null,t('host')),h('input',{'aria-label':t('host'),value:host,style:control,disabled:busy||!newRow,onChange:edit(setHost)}))),
        h('td',{style:cell},h('input',{'aria-label':t('key'),type:'password',value:token,style:control,autoComplete:'new-password',spellCheck:false,
          placeholder:newRow?t('enter'):t('stored'),disabled:busy,onChange:edit(setToken)})),
        h('td',{style:cell},h('details',null,h('summary',null,selected.length?selected.map(id=>workspaces.find(w=>w.id===id)?.title||id).join(', '):t('choose')),
          ...workspaces.map(workspace=>h('label',{key:workspace.id,style:{display:'flex',gap:6,marginTop:6}},
            h('input',{type:'checkbox',checked:selected.includes(workspace.id),disabled:busy,onChange:event=>{setSelected(event.target.checked?[...selected,workspace.id]:selected.filter(id=>id!==workspace.id));setDirty(true);}}),workspace.title||workspace.id)))),
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
          if(operation) await operation(input=>request(input,controller.signal));
          const result=await request(undefined,controller.signal);
          if(controller.signal.aborted)return;
          setState(result);if(operation)setMessage(t('done'));return true;
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
      return h('section',{style:{padding:20,maxWidth:1000,overflowWrap:'anywhere'}},
        h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}},h('h2',null,t('title')),
          h('div',{style:{display:'flex',gap:8}},h('button',{type:'button',disabled:busy||!state||!!draft,onClick:()=>setDraft({id:'connection-'+window.crypto.randomUUID(),name:'',provider:'github',host:'https://github.com'})},t('add')),
            h('button',{type:'button',disabled:busy,onClick:()=>perform()},t('refresh')))),
        h('div',{role:'status',style:{minHeight:24}},busy?t('loading'):message),
        h('div',{style:{overflowX:'auto'}},h('table',{style:{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:520}},
          h('thead',null,h('tr',null,...['name','type','key','workspaces'].map(key=>h('th',{key,scope:'col',style:cell},t(key))))),
          h('tbody',null,...(state?.connections??[]).map(connection=>h(Row,{key:connection.id,connection,state,busy,perform,t})),
            draft?h(Row,{key:draft.id,connection:draft,state,busy,perform,t,newRow:true,close:()=>setDraft(null)}):null,
            state&&!state.connections.length&&!draft?h('tr',null,h('td',{colSpan:4,style:cell},t('empty'))):null))),
      );
    }
    return {inject:['slots','locale'],apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,{en,ru,zh:en}));
      const t=ctx.locale.bind(NS);
      ctx.effect(()=>ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'workain-forge',order:75,label:()=>t('title'),locale:NS,inject:()=>({t})},Settings)));
    }};
  },
});
