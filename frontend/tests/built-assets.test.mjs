import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('native pin bundle exposes its entry point without external modules',()=>{const source=readFileSync(new URL('../dist/pin.js',import.meta.url),'utf8');const context=vm.createContext({});vm.runInContext(source,context);assert.equal(typeof context.CiipPin.startPin,'function');});
