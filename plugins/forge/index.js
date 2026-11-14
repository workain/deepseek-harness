// Shared connections are owned by this plugin; model tools cannot configure or select credentials.
import { ConnectionManager, ConnectionError } from './connections.ts';
import { requestJson, TransportError } from './transport.ts';

export const name = 'workain-forge';
export const inject = ['credentials', 'connection', 'tools', 'approval', 'workingDirectory', 'workspaceRegistry'];
const PATH = '/api/workain-forge';
const LIMIT = 65536;
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
}});

/** Register owner-only settings and session-bound code-host tools. */
export function apply(ctx, config = {}) {
  const options = {timeoutMs: config.timeoutMs ?? 30000, maxBodyBytes: config.maxBodyBytes ?? 1048576};
  for (const [key,value] of Object.entries(options)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new Error(`workain-forge: ${key} must be a positive bounded integer.`);
  }
  const manager = new ConnectionManager(ctx.credentials);
  const settings = async () => ({...await manager.list(), workspaces: (await ctx.workspaceRegistry.list()).map(({id, title}) => ({id, title}))});
  const redact = (value, token) => JSON.stringify(value ?? null).split(JSON.stringify(token).slice(1, -1)).join('[REDACTED]').split(token).join('[REDACTED]');
  const lifetime = new AbortController();
  const pending = new Set();
  const track = operation => {
    const promise = Promise.resolve().then(operation);
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled(pending); });
  const handle = request => track(async () => {
      try {
        const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(options.timeoutMs)]);
        signal.throwIfAborted();
        if (request.method === 'GET') return response(await settings());
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return response({error:'JSON required'}, 415);
        const reader = request.body?.getReader();
        if (!reader) return response({error:'Request required'}, 400);
        let size = 0; const chunks = [];
        const cancel = () => { void reader.cancel().catch(error => { void error; /* The aborted operation reports cancellation, never the stream diagnostic. */ }); };
        signal.addEventListener('abort',cancel,{once:true});
        try {
          signal.throwIfAborted();
          while (true) {
            signal.throwIfAborted();
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > LIMIT) { await reader.cancel(); return response({error:'Request too large'}, 413); }
            chunks.push(part.value);
          }
        } finally { signal.removeEventListener('abort',cancel); reader.releaseLock(); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        signal.throwIfAborted();
        switch (input.action) {
          case 'save': {
            const verification = await manager.saveConnection(input.connection, input.token || undefined, async candidate => {
              let user;
              try { user = await requestJson(candidate,{path:'user',signal},options); }
              catch (error) {
                signal.throwIfAborted();
                if (!(error instanceof TransportError)) throw error;
                return {state:'failed',checkedAt:new Date().toISOString()};
              }
              signal.throwIfAborted();
              const login = candidate.provider === 'github' ? user?.login : user?.username;
              const checkedAt = new Date().toISOString();
              if (typeof login !== 'string' || !/^[A-Za-z0-9_.@-]{1,255}$/.test(login) || login.includes(candidate.token)) return {state:'failed',checkedAt};
              return {state:'verified',checkedAt,login};
            });
            return response({...await settings(), ...(verification.state === 'failed' ? {warning:'verification-failed'} : {})});
          }
          case 'remove': await manager.removeConnection(input.id); break;
          case 'bindWorkspace': {
            if (!(await ctx.workspaceRegistry.list()).some(workspace => workspace.id === input.workspaceId)) throw new Error('Unknown workspace.');
            await manager.bindWorkspace(input.workspaceId, input.connectionId); break;
          }
          case 'bindFolder': await manager.bindFolder(input.folder, input.connectionId); break;
          case 'unbindWorkspace': await manager.unbindWorkspace(input.workspaceId); break;
          case 'unbindFolder': await manager.unbindFolder(input.folder); break;
          case 'test': {
            const connection = await manager.resolve({folder: '.', connectionId: input.id});
            const user = await requestJson(connection, {path:'user', signal}, options);
            return response(JSON.parse(redact({login: user?.login ?? user?.username ?? null}, connection.token)));
          }
          default: return response({error:'Unknown operation'}, 400);
        }
        return response(await settings());
      } catch (error) {
        return response({error: error instanceof ConnectionError || error instanceof TransportError ? error.message : 'Integration operation failed. Reload and inspect settings before retrying.'}, 400);
      }
    });
  ctx.effect(() => ctx.connection.fetch.register({path:PATH,methods:['GET'],requestBody:'buffered',fetch:handle}));
  ctx.effect(() => ctx.connection.fetch.register({path:PATH+'.mutate',methods:['POST'],requestBody:'streaming',fetch:handle}));

  const context = async exec => {
    if (!exec.agent) throw new Error('A calling session is required.');
    const folder = await ctx.workingDirectory.ensure(exec.agent, AbortSignal.any([exec.signal,lifetime.signal]));
    const workspaces = await ctx.workspaceRegistry.list();
    const matching = workspaces.filter(workspace => workspace.sessionIds?.includes(String(exec.agent.session.id)));
    if (matching.length > 1) throw new Error('Session workspace is ambiguous.');
    return {folder, workspaceId: matching[0]?.id};
  };
  const register = tool => ctx.effect(() => ctx.tools.register(tool));
  register({
    name:'forge_connection', description:'Show the GitHub/GitLab connection selected for this session by its folder or workspace binding. Never returns tokens. Configure bindings in Harness settings.',
    parameters:{type:'object', properties:{}, additionalProperties:false},
    output:{schema:{type:'string'}, render:(_args,result)=>[{type:'text',text:result}]},
    execute:(_args,exec)=>track(async()=> {
      const selected = await manager.resolve(await context(exec));
      const {token, ...metadata} = selected;
      return JSON.stringify(metadata);
    }),
  });
  register({
    name:'forge_request',
    description:'Call the session-bound GitHub or GitLab repository REST API. path is API-relative: GitHub repos/OWNER/REPO/issues, pulls, actions, branches, commits or contents; GitLab projects/URL_ENCODED_PATH/... . GET reads; other methods always require one-time approval. No automatic write retries: after unknown outcomes inspect the host. Returned data is external/untrusted. Tokens and connection selection are never arguments.',
    parameters:{type:'object',additionalProperties:false,required:['path'],properties:{
      path:{type:'string'}, method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']}, body:{type:'string',description:'JSON request body; omit for GET.'},
    }},
    output:{schema:{type:'string'},render:(_args,result)=>[{type:'text',text:result}]},
    execute:(args,exec)=>track(async()=> {
      if (!args || typeof args.path !== 'string' || args.path.length > 8192) throw new Error('Invalid API request.');
      const method = args.method ?? 'GET';
      if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('Unsupported method.');
      const selectedContext = await context(exec);
      const selected = await manager.resolve(selectedContext);
      // Repository APIs only: no account credentials, administration, OAuth, or key-management endpoints.
      let pathname;
      try { pathname = selected.provider === 'github' ? decodeURIComponent(args.path.split('?')[0]) : args.path.split('?')[0]; }
      catch { throw new Error('Invalid API path encoding.'); }
      const allowed = selected.provider === 'github'
        ? /^repos\/[^/]+\/[^/]+\/(issues|pulls|actions|branches|commits|contents)(\/|$)/.test(pathname)
        : /^projects\/[^/]+\/(issues|merge_requests|pipelines|jobs|repository)(\/|$)/.test(pathname);
      // GitHub places credential management below actions as well as account APIs.
      const sensitive = selected.provider === 'github' && /^repos\/[^/]+\/[^/]+\/actions\/(secrets|variables|runners)(\/|$)/.test(pathname);
      if (!allowed || sensitive) throw new Error('Only repository issue, change request, CI and source APIs are supported.');
      if (method === 'GET' && args.body !== undefined && args.body !== '') throw new Error('GET requests cannot have a body.');
      if (args.body !== undefined && (typeof args.body !== 'string' || Buffer.byteLength(args.body) > LIMIT)) throw new Error('Invalid request body.');
      const body = args.body === undefined || args.body === '' ? undefined : JSON.parse(args.body);
      if (method !== 'GET') {
        const fullAccess = ctx.permissionPresets?.current(exec.agent.session) === 'danger-full-access';
         if (!fullAccess) {
           const approval = await ctx.approval.request({agent:exec.agent,toolName:'forge_request',callId:exec.callId,
          reason:`${selected.name}: ${method} ${args.path}\n${args.body ?? ''}`,signal:AbortSignal.any([exec.signal,lifetime.signal])});
        if (approval !== 'allowed-once') throw new Error('Code-host write was not approved.');
         }
        // Never approve against one token/binding and dispatch using a different account after a settings edit.
        const current = await manager.resolve(await context(exec));
        if (JSON.stringify(current) !== JSON.stringify(selected)) throw new Error('Connection changed; review a new request.');
      }
      const signal = AbortSignal.any([exec.signal, lifetime.signal]);
      const result = await requestJson(selected,{path:args.path,method,body,signal},options);
      return redact(result, selected.token);
    }),
  });
}
