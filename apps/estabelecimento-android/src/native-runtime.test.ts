import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL as NodeURL } from 'node:url';
// Runs official SDK/polyfill code in Node with only the native module port
// substituted. Also checks boot import ordering; this is not a device run.
describe('compatibilidade da URL usada pelo SDK no Android', () => {
  it('carrega a URL completa antes da aplicação e constrói o SDK oficial', () => {
    const entry = fileURLToPath(new NodeURL('../index.ts', import.meta.url));
    const source = `
      import assert from 'node:assert/strict';
      import {registerHooks} from 'node:module';
      import {readFileSync} from 'node:fs';
      assert.ok(readFileSync(process.argv[1],'utf8').trimStart().startsWith("import 'react-native-url-polyfill/auto';"));
      registerHooks({resolve(specifier,context,next){
        if(specifier==='react-native')return {url:'data:text/javascript,export const NativeModules={};',shortCircuit:true};
        return next(specifier,context);
      }});
      const {createClient}=await import('@supabase/supabase-js');
      const originalURL=globalThis.URL;
      class ReadonlyNativeURL extends originalURL {get protocol(){return super.protocol;}}
      globalThis.URL=ReadonlyNativeURL;
      assert.throws(()=>{new ReadonlyNativeURL('https://fixture.supabase.co').protocol='wss:';},TypeError);
      const polyfill=await import('react-native-url-polyfill/js/URL.js');
      globalThis.URL=polyfill.URL;globalThis.URLSearchParams=polyfill.URLSearchParams;
      const client=createClient('https://fixture.supabase.co','sb_publishable_fixture_only',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      assert.equal(typeof client.auth.signInWithPassword,'function');
      const url=new URL('https://fixture.supabase.co/realtime/v1');url.protocol='wss:';assert.equal(url.protocol,'wss:');
      assert.equal(new URLSearchParams('refresh_token=encoded%2Bvalue').get('refresh_token'),'encoded+value');
      console.log('NATIVE_URL_SDK_OK');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, entry], {
      cwd: fileURLToPath(new NodeURL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('NATIVE_URL_SDK_OK');
  });
});
