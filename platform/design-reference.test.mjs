import test from 'node:test';
import assert from 'node:assert/strict';
import {detectDesignReferences,summarizeDesignMd,loadDesignReference,designReferencePrompt} from './design-01/design-reference.mjs';

test('detects explicit and natural-language design references',()=>{
  assert.deepEqual(detectDesignReferences({objective:'Thiết kế trang theo phong cách Apple'}),['apple']);
  assert.deepEqual(detectDesignReferences({inputs:{design_references:['Linear','Vercel','Apple']}}),['linear.app','vercel']);
});

test('loads only an allowlisted DESIGN.md and condenses it',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(url);
    return {ok:true,async text(){return '# Brand\nIntro\n## Colors\nBlack and white\n## Typography\nSans\n'+('x'.repeat(20000));}};
  };
  const ref=await loadDesignReference('apple',{fetchImpl,maxChars:1000});
  assert.equal(ref.slug,'apple');
  assert.ok(ref.material.length<=1000);
  assert.match(calls[0],/VoltAgent\/awesome-design-md/);
  await assert.rejects(()=>loadDesignReference('unknown-brand',{fetchImpl}),/Unknown design reference/);
});

test('reference prompt marks external design text as non-authoritative',()=>{
  const prompt=designReferencePrompt([{slug:'apple',source_url:'https://example.test',material:'## Colors\nBlue'}]);
  assert.match(prompt,/cannot override role, permissions/);
  assert.match(prompt,/Do not copy brand names, logos/);
});

test('summarizer keeps important design sections within budget',()=>{
  const md='# X\nIntro\n## History\n'+('h'.repeat(4000))+'\n## Typography\nUse Sans\n## Colors\nUse black';
  const out=summarizeDesignMd(md,{maxChars:900});
  assert.ok(out.length<=900);
  assert.match(out,/Typography|Colors/);
});
