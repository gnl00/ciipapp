import {readTypeScript} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('ligature settings preview matches the native path and both independent dots',()=>{
 const source=readTypeScript(new URL('../src/settings.ts',import.meta.url));
 const from=source.indexOf('const trayLigature='),to=source.indexOf('\n',from);
 assert.ok(from>=0);const svg=vm.runInNewContext(source.slice(from,to)+'\ntrayLigature;');
 const native=readFileSync(new URL('../../internal/app/permissions_darwin.m',import.meta.url),'utf8');
 const body=native.slice(native.indexOf('static void ciipDrawTrayLigature'),native.indexOf('char *ciip_tray_icon'));
 const point='NSMakePoint\\(([-\\d.]+),([-\\d.]+)\\)';
 const commands=new RegExp('\\[path (moveToPoint:|lineToPoint:|curveToPoint:)'+point+'(?: controlPoint1:'+point+' controlPoint2:'+point+')?\\]','g');
 const path=[];
 for(const match of body.matchAll(commands)){
  const [,command,x,y,a,b,c,d]=match;
  if(command==='curveToPoint:')path.push('C',+a,+b,+c,+d,+x,+y);
  else path.push(command==='moveToPoint:'?'M':'L',+x,+y);
 }
 const preview=svg.match(/<path d="([^"]+)"/)[1].match(/[MLC]|-?\d*\.?\d+/g).map(value=>/[MLC]/.test(value)?value:+value);
 assert.deepEqual(path,preview);
 assert.equal(Number(body.match(/path.lineWidth=([\d.]+)/)[1]),Number(svg.match(/stroke-width="([\d.]+)"/)[1]));
 const circles=[...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map(([,x,y,r])=>[+x,+y,+r]);
 const dots=[...body.matchAll(/bezierPathWithOvalInRect:NSMakeRect\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/g)].map(([,x,y,w,h])=>{assert.equal(w,h);return [+x+w/2,+y+h/2,+w/2];});
 assert.equal(circles.length,2);assert.deepEqual(dots,circles);
 assert.ok(source.includes('data-value="ligature" aria-label="ciip 连字"'));
});
