import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"import {Screen,MediaHub} from './frontend/src/media.js';window.mediaTest={Screen,MediaHub};",resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.route('http://127.0.0.1:4173/__media_test__', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
 await page.goto('http://127.0.0.1:4173/__media_test__');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const {Screen,MediaHub}=window.mediaTest;
  const screen=new Screen();
  const image=color=>{const c=document.createElement('canvas');c.width=c.height=2;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,2,2);return c;};
  const red=image('red'),blue=image('blue');
  const first=screen.draw({state:'playing',img:red}),same=screen.draw({state:'playing',img:red}),changed=screen.draw({state:'playing',img:blue});
  const pixel=[...screen.g.getImageData(100,100,1,1).data];screen.dispose();
  let requests=0;const blob=await new Promise(r=>red.toBlob(r));
  const media=new MediaHub({hass:{hassUrl:p=>new URL(p,location.origin).href,fetchWithAuth:async()=>{requests++;return new Response(blob);}}});
  const blocked=media.resolve('https://third-party.invalid/cover.jpg')===null;
  media.image('/snapshot',{auth:true,maxAge:1});
  for(let i=0;i<100&&!media.cache.values().next().value.img;i++)await new Promise(r=>setTimeout(r,10));
  const original=media.cache.values().next().value.img;
  media.cache.values().next().value.loaded=1;
  media.image('/snapshot',{auth:true,maxAge:1});
  for(let i=0;i<100&&media.cache.values().next().value.pending;i++)await new Promise(r=>setTimeout(r,10));
  return {first,same,changed,pixel,blocked,requests,replaced:original!==media.cache.values().next().value.img};
 });
 assert.deepEqual(result,{first:true,same:false,changed:true,pixel:[0,0,255,255],blocked:true,requests:2,replaced:true});
 console.log('PASS: changed artwork redraws; camera reloads same URL; external media blocked');
}finally{await browser.close();}
