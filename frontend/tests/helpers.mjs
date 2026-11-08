import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// Keep the real source layout so existing focused VM regressions still execute it.
export function readTypeScript(url) {
 return stripTypeScriptTypes(readFileSync(url,'utf8'),{mode:'strip'});
}
