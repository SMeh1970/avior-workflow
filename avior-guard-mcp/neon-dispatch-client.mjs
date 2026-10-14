import { postgresDispatchStore } from './postgres-dispatch-store.mjs';

/**
 * Uses the official Neon driver. DATABASE_URL is injected by Neon Functions at runtime.
 * No connection strings, tokens or database credentials are included in source.
 * This factory is intentionally not exposed as an MCP action: it may be imported only
 * by the separate, fully authorized once-only dispatch workflow.
 */
export async function createNeonDispatchStore({url=process.env.DATABASE_URL,importDriver=()=>import('@neondatabase/serverless')}={}) {
  if (typeof url !== 'string' || !/^postgres(?:ql)?:\/\//i.test(url)) throw Error('DATABASE_URL_UNAVAILABLE');
  const {neon} = await importDriver();
  if (typeof neon !== 'function') throw Error('NEON_DRIVER_UNAVAILABLE');
  const sql=neon(url);
  if(typeof sql.query !== 'function') throw Error('NEON_DRIVER_QUERY_UNAVAILABLE');
  return postgresDispatchStore({query:(statement,values)=>sql.query(statement,values)});
}