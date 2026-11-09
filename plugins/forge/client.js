window.__ModuleLoader__.load({
  id: '@workain/dsh-forge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {useState, useEffect, useRef} = React;
    const NS = 'workainForge';
    const en = {
      title:'GitHub and GitLab', intro:'Connections are stored once in Harness credentials, shared by sessions in this profile. Folder bindings override workspace bindings; the longest folder path wins. No default key is used.',
      security:'Tokens stay on the server after saving. Local Harness credential storage is not encrypted. Any unrestricted local process or trusted plugin may read it. Use limited tokens and repository permissions.',
      id:'Connection ID', name:'Name', provider:'Provider', host:'HTTPS host', token:'Token (blank keeps the current token)', save:'Save connection', remove:'Remove connection and its bindings', test:'Check account',
      workspace:'Workspace ID', folder:'Absolute folder path', connection:'Connection', bindWorkspace:'Bind workspace', bindFolder:'Bind folder', unbind:'Remove binding',
      refresh:'Reload', loading:'Loading…', error:'Request failed. Reload and inspect the settings before trying again.', confirm:'Remove this connection and all its bindings?',
      connections:'Connections', bindings:'Bindings', empty:'No connections configured.', account:'Account', note:'These tools access repository REST APIs. Git clone/fetch/push and the official forge panel do not yet use these connections.',
      choose:'Choose a connection', done:'Saved.', edit:'Edit',
    };
    const ru = {
      title:'GitHub и GitLab', intro:'Подключения сохраняются один раз в credentials Harness и доступны сессиям этого профиля. Привязка папки важнее привязки workspace; побеждает самая вложенная папка. Ключ по умолчанию не выбирается.',
      security:'После сохранения токены остаются на сервере. Локальное хранилище credentials Harness не зашифровано. Неограниченный локальный процесс или доверенный плагин может прочитать его. Используйте токены с минимальными правами.',
      id:'Идентификатор подключения', name:'Название', provider:'Сервис', host:'HTTPS-хост', token:'Токен (пусто — оставить текущий)', save:'Сохранить подключение', remove:'Удалить подключение и его привязки', test:'Проверить аккаунт',
      workspace:'ID рабочего пространства', folder:'Абсолютный путь папки', connection:'Подключение', bindWorkspace:'Привязать workspace', bindFolder:'Привязать папку', unbind:'Снять привязку',
      refresh:'Обновить', loading:'Загрузка…', error:'Запрос не выполнен. Обновите и проверьте настройки перед повтором.', confirm:'Удалить подключение и все его привязки?',
      connections:'Подключения', bindings:'Привязки', empty:'Подключения не настроены.', account:'Аккаунт', note:'Инструменты используют REST API репозиториев. Git clone/fetch/push и официальная forge-панель пока не используют эти подключения.',
      choose:'Выберите подключение', done:'Сохранено.', edit:'Изменить',
    };
    function Settings({t}) {
      const [state,setState] = useState(null), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
      const [id,setId] = useState(''), [name,setName] = useState(''), [provider,setProvider] = useState('github'), [host,setHost] = useState('https://github.com');
      const [token,setToken] = useState(''), [selected,setSelected] = useState(''), [workspace,setWorkspace] = useState(''), [folder,setFolder] = useState('');
      const lifetime = useRef(null);
      useEffect(() => { const controller = new AbortController(); lifetime.current=controller; run(); return () => {controller.abort(); lifetime.current=null;}; }, []);
      async function run(input) {
        const controller = lifetime.current;
        if (!controller || controller.signal.aborted || busy) return;
        setBusy(true); setMessage('');
        try {
          const result = await fetch(input?'/api/workain-forge.mutate':'/api/workain-forge', {credentials:'same-origin', cache:'no-store', signal:controller.signal,
            ...(input ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)} : {}),
          });
          const value = await result.json();
          if (!result.ok) throw new Error(t('error'));
          if (controller.signal.aborted) return;
          if (input?.action === 'test') setMessage(`${t('account')}: ${value.login ?? '—'}`);
          else { setState(value); if(input) setMessage(t('done')); }
        } catch { if (!controller.signal.aborted) setMessage(t('error')); }
        finally { if (!controller.signal.aborted) setBusy(false); }
      }
      const field = (key,value,set,props={}) => h('label',{style:{display:'grid',gap:4,marginBottom:10}},t(key),h('input',{value,onChange:event=>set(event.target.value),disabled:busy,...props}));
      const button = (key,onClick,disabled=false) => h('button',{type:'button',disabled:busy||disabled,onClick,style:{marginRight:8,marginBottom:8}},t(key));
      const choose = h('label',null,t('connection'),h('select',{value:selected,disabled:busy,onChange:event=>setSelected(event.target.value)},
        h('option',{value:''},t('choose')),...(state?.connections??[]).map(c=>h('option',{key:c.id,value:c.id},c.name))));
      return h('section',{style:{maxWidth:800,padding:20,overflowWrap:'anywhere'}},
        h('h2',null,t('title')),h('p',null,t('intro')),h('p',null,t('security')),h('p',null,t('note')),
        button('refresh',()=>run()), h('p',{role:'status'},busy?t('loading'):message),
        h('h3',null,t('connections')),
        ...(state?.connections??[]).map(c=>h('div',{key:c.id,style:{borderBottom:'1px solid #8885',padding:8}},
          h('strong',null,c.name),h('span',null,` — ${c.provider} · ${c.host} · ${c.id} `),
          button('edit',()=>{setId(c.id);setName(c.name);setProvider(c.provider);setHost(c.host);setToken('');}),button('test',()=>run({action:'test',id:c.id})),button('remove',()=>{if(window.confirm(t('confirm')))run({action:'remove',id:c.id});}),
        )),state?.connections?.length===0?h('p',null,t('empty')):null,
        h('form',{onSubmit:event=>{event.preventDefault();const secret=token;setToken('');run({action:'save',connection:{id,name,provider,host},token:secret});}},
          field('id',id,setId,{required:true,pattern:'[a-z][a-z0-9-]{0,63}'}),field('name',name,setName,{required:true,maxLength:120}),
          h('label',null,t('provider'),h('select',{value:provider,disabled:busy,onChange:event=>{setProvider(event.target.value);setHost(event.target.value==='github'?'https://github.com':'https://gitlab.com');}},h('option',{value:'github'},'GitHub'),h('option',{value:'gitlab'},'GitLab'))),
          field('host',host,setHost,{required:true}),field('token',token,setToken,{type:'password',autoComplete:'new-password',spellCheck:false}),
          h('button',{type:'submit',disabled:busy},t('save'))),
        h('h3',null,t('bindings')),choose,
        h('label',{style:{display:'grid',gap:4,marginBottom:10}},t('workspace'),h('select',{value:workspace,disabled:busy,onChange:event=>setWorkspace(event.target.value)},h('option',{value:''},'—'),...(state?.workspaces??[]).map(w=>h('option',{key:w.id,value:w.id},w.title||w.id)))),button('bindWorkspace',()=>run({action:'bindWorkspace',workspaceId:workspace,connectionId:selected}),!workspace||!selected),
        field('folder',folder,setFolder),button('bindFolder',()=>run({action:'bindFolder',folder,connectionId:selected}),!folder||!selected),
        ...Object.entries(state?.workspaceBindings??{}).map(([key,value])=>h('p',{key:`w-${key}`},`${t('workspace')}: ${key} → ${value} `,button('unbind',()=>run({action:'unbindWorkspace',workspaceId:key})))),
        ...Object.entries(state?.folderBindings??{}).map(([key,value])=>h('p',{key:`f-${key}`},`${key} → ${value} `,button('unbind',()=>run({action:'unbindFolder',folder:key})))),
      );
    }
    return {inject:['slots','locale'],apply(ctx) {
      ctx.effect(()=>ctx.locale.register(NS,{en,ru,zh:en}));
      const t=ctx.locale.bind(NS);
      ctx.effect(()=>ctx.slots.inject('plugins.item',()=>ctx.slots.register({name:'plugins.item',id:'workain-forge',order:75,label:()=>t('title'),locale:NS,inject:()=>({t})},Settings)));
    }};
  },
});
