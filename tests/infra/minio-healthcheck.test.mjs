import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const dirs=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function run(extra){
 const dir=mkdtempSync(join(tmpdir(),'minio-health-'));dirs.push(dir);
 writeFileSync(join(dir,'wget'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$ARG_LOG"\nexit "${WGET_TEST_EXIT:-0}"\n',{mode:0o755});
 const env={...process.env,PATH:dir,ARG_LOG:join(dir,'args')};delete env.no_proxy;delete env.NO_PROXY;
 const result=spawnSync('/bin/sh',[resolve('infra/minio/healthcheck.sh')],{env:{...env,...extra}});
 return {status:result.status,args:readFileSync(join(dir,'args'),'utf8').trim().split('\n')};
}
const original=['-q','-O','/dev/null','http://127.0.0.1:9000/minio/health/live'];
test('exact existing loopback exceptions are honored without changing the URL',()=>{
 for(const no_proxy of ['127.0.0.1','localhost,127.0.0.1,::1','127.0.0.1:9000'])expect(run({no_proxy}).args).toEqual(['-Y','off',...original]);
});
test('absent, unrelated, misleading and other-port exceptions keep original proxy behavior',()=>{
 for(const no_proxy of ['','localhost','127.0.0.10','evil127.0.0.1','127.0.0.1:9001'])expect(run({no_proxy}).args).toEqual(original);
 expect(run({}).args).toEqual(original);
});
test('upper-case fallback applies only when lower-case variable is unset',()=>{
 expect(run({NO_PROXY:'127.0.0.1'}).args).toEqual(['-Y','off',...original]);
 expect(run({NO_PROXY:'127.0.0.1',no_proxy:''}).args).toEqual(original);
});
test('actual healthcheck failure remains a failure',()=>{
 expect(run({no_proxy:'127.0.0.1',WGET_TEST_EXIT:'1'}).status).toBe(1);
});
