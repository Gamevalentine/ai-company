import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptState, decryptState } from './state-crypto.mjs';

test('encrypted durable state round-trips and hides plaintext',()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const pem=privateKey.export({type:'pkcs8',format:'pem'});
  const state={tasks:[{task_id:'T1',objective:'private objective'}],memories:[{value:'private memory'}]};
  const envelope=encryptState(state,pem);
  const serialized=JSON.stringify(envelope);
  assert.equal(serialized.includes('private objective'),false);
  assert.equal(serialized.includes('private memory'),false);
  assert.deepEqual(decryptState(envelope,pem),state);
});

test('tampered ciphertext cannot be decrypted',()=>{
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const pem=privateKey.export({type:'pkcs8',format:'pem'});
  const envelope=encryptState({ok:true},pem);
  const buf=Buffer.from(envelope.ciphertext,'base64');
  buf[0]^=1;
  envelope.ciphertext=buf.toString('base64');
  assert.throws(()=>decryptState(envelope,pem));
});
